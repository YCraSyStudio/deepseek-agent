using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;

var runtimeDirectory = Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR") ??
    throw new InvalidOperationException("The SSH account needs a systemd user session.");
var socketPath = Path.Combine(runtimeDirectory, "ycrasy-agent.sock");
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
builder.Services.AddHttpClient("agent", client => client.Timeout = Timeout.InfiniteTimeSpan)
    .RemoveAllLoggers().ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false, UseCookies = false, UseProxy = false,
        ConnectCallback = async (_, ct) =>
        {
            var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            try
            {
                await socket.ConnectAsync(new UnixDomainSocketEndPoint(socketPath), ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch { socket.Dispose(); throw; }
        },
    });
var ticket = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
var session = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers.CacheControl = "no-store";
    if (context.Request.Path == "/ui/" && context.Request.Query["code"] == ticket)
    {
        context.Response.Cookies.Append("ycrasy-session", session,
            new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/ui/" });
    }
    else if (context.Request.Cookies["ycrasy-session"] != session)
    {
        context.Response.StatusCode = 401;
        return;
    }
    await next();
});

app.MapGet("/", () => Results.Redirect("/ui/"));
app.MapGet("/health", () => Results.Ok());
app.MapGet("/ui/", Forward);
app.MapGet("/ui/shim.js", Forward);
app.MapGet("/ui/events", Forward);
app.MapGet("/ui/assets/{asset}", Forward);
app.MapPost("/ui/post", Forward).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(800 * 1024));
app.MapGet("/ui/workspace/files", Forward);
app.MapGet("/ui/workspace/file", Forward);
app.MapPut("/ui/workspace/file", Forward).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(800 * 1024));
await app.StartAsync();
Console.WriteLine($"{new Uri(app.Urls.Single()).Port} {ticket}");
await Console.Out.FlushAsync();
await Console.In.ReadLineAsync();
await app.StopAsync();

static async Task Forward(HttpContext context, IHttpClientFactory clients)
{
    var request = context.Request;
    var hasBody = HttpMethods.IsPost(request.Method) || HttpMethods.IsPut(request.Method);
    if (hasBody &&
        (!request.HasJsonContentType() ||
         !string.Equals(request.Headers.Origin, $"{request.Scheme}://{request.Host}", StringComparison.OrdinalIgnoreCase)))
    {
        context.Response.StatusCode = 403;
        return;
    }

    using var upstream = new HttpRequestMessage(new HttpMethod(request.Method),
        new Uri("http://localhost" + request.Path.ToUriComponent() + (request.Path == "/ui/" ? "" : request.QueryString.ToUriComponent())));
    foreach (var header in new[] { "Last-Event-ID", "X-YcraSy-Workspace", "Sec-Fetch-Site" })
    {
        if (request.Headers.TryGetValue(header, out var values))
        {
            upstream.Headers.TryAddWithoutValidation(header, values.ToArray());
        }
    }

    if (hasBody)
    {
        upstream.Content = new StreamContent(request.Body);
        upstream.Content.Headers.ContentType = new("application/json");
    }

    using var client = clients.CreateClient("agent");
    using var headerTimeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
    headerTimeout.CancelAfter(TimeSpan.FromSeconds(15));

    HttpResponseMessage response;
    try
    {
        response = await client.SendAsync(upstream, HttpCompletionOption.ResponseHeadersRead, headerTimeout.Token);
    }
    catch (Exception exception) when (!context.RequestAborted.IsCancellationRequested &&
        exception is HttpRequestException or OperationCanceledException)
    {
        context.Response.StatusCode = 502;
        await context.Response.WriteAsync("The account backend is unavailable.");
        return;
    }

    using (response)
    {
        context.Response.StatusCode = (int)response.StatusCode;
        foreach (var header in new[] { "Cache-Control", "Content-Security-Policy", "Content-Type" })
        {
            if (response.Headers.TryGetValues(header, out var values) ||
                response.Content.Headers.TryGetValues(header, out values))
            {
                context.Response.Headers[header] = values.ToArray();
            }
        }
        if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
        {
            foreach (var cookie in cookies)
            {
                context.Response.Headers.Append("Set-Cookie", context.Request.IsHttps ? cookie + "; Secure" : cookie);
            }
        }

        await context.Response.StartAsync(context.RequestAborted);
        await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
    }
}
