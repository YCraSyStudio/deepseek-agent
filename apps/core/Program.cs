using System.Net;
using System.Text.Json;
using YCraSy.Agent.Runtime.Configuration;
using YCraSy.Agent.Runtime.Model;
using YCraSy.Agent.Runtime.Webview;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
if (Environment.GetEnvironmentVariable("LISTEN_PID") != Environment.ProcessId.ToString() ||
    Environment.GetEnvironmentVariable("LISTEN_FDS") != "1")
    throw new InvalidOperationException("Start the runtime through ycrasy-agent.socket.");

builder.WebHost.ConfigureKestrel(options => options.ListenHandle(3));

builder.Services.AddSingleton<WebviewHub>();
builder.Services.AddSingleton<SettingsStore>();
builder.Services.AddSingleton<SecretStore>();
builder.Services.AddSingleton<ConfigService>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<IModelClient, DeepSeekClient>();
builder.Services.AddSingleton<GenerationService>();
builder.Services.AddSingleton<ProtocolHandler>();

var app = builder.Build();
var hub = app.Services.GetRequiredService<WebviewHub>();
var protocol = app.Services.GetRequiredService<ProtocolHandler>();
var ui = new UiBundle(app.Configuration, app.Environment);

app.Use(async (context, next) =>
{
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    await next();
});

app.MapPost("/api/credentials/{operation}", async (string operation, HttpContext context, SecretStore secrets) =>
{
    if (context.Request.Headers.ContainsKey("Origin") || context.Request.Headers["X-YcraSy-Client"] != "extension" || !context.Request.HasJsonContentType())
        return Results.BadRequest();
    var input = await context.Request.ReadFromJsonAsync<CredentialImport>(context.RequestAborted);
    if (input is null || !Uri.TryCreate(input.Origin, UriKind.Absolute, out var uri) ||
        (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)) ||
        !string.IsNullOrEmpty(uri.UserInfo))
        return Results.BadRequest();
    context.Response.Headers.CacheControl = "no-store";
    if (operation == "get")
    {
        var key = await secrets.ReadAsync(input.Origin, context.RequestAborted);
        return key is null ? Results.NoContent() : Results.Text(key);
    }
    if (operation == "delete")
    {
        secrets.Delete(input.Origin);
        return Results.NoContent();
    }
    if (operation is not ("import" or "put") || string.IsNullOrWhiteSpace(input.Key)) return Results.BadRequest();
    await secrets.WriteAsync(input.Origin, input.Key, context.RequestAborted, replace: operation == "put");
    var stored = await secrets.ReadAsync(input.Origin, context.RequestAborted);
    return string.Equals(stored, input.Key, StringComparison.Ordinal) ? Results.NoContent() : Results.Conflict();
}).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(32768));
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    protocolVersion = ProtocolHandler.ProtocolVersion,
}));
app.MapGet("/", () => Results.Redirect("/ui/"));
app.MapGet("/ui/", ui.WriteIndexAsync);
app.MapGet("/ui/shim.js", WriteShimAsync);
app.MapGet("/ui/events", (HttpContext context) => hub.StreamAsync(context, context.RequestAborted));
app.MapGet("/ui/assets/{**path}", (HttpContext context, string path) =>
    ui.WriteAssetAsync(context, path, context.RequestAborted));
app.MapPost("/ui/post", PostAsync);
app.Run();

async Task WriteShimAsync(HttpContext context)
{
    context.Response.ContentType = "text/javascript; charset=utf-8";
    context.Response.Headers.CacheControl = "no-store";
    await context.Response.WriteAsync(UiBundle.Shim, context.RequestAborted);
}

async Task PostAsync(HttpContext context)
{
    if (!context.Request.HasJsonContentType())
    {
        context.Response.StatusCode = StatusCodes.Status415UnsupportedMediaType;
        return;
    }

    if (context.Request.Headers.Origin is { Count: > 0 } origin &&
        !string.Equals(origin, $"{context.Request.Scheme}://{context.Request.Host}", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }

    using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
    await protocol.HandleAsync(document.RootElement, hub, context.RequestAborted);
    context.Response.StatusCode = StatusCodes.Status202Accepted;
}

internal sealed record CredentialImport(string Origin, string? Key);
