using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace YCraSy.Agent.Runtime.Webview;

/// <summary>
/// Sirve el bundle compartido de la UI (dist/webview) e inyecta el shim que
/// implementa acquireVsCodeApi sobre HTTP + SSE.
/// </summary>
public sealed class UiBundle
{
    private static readonly IReadOnlyDictionary<string, string> ContentTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8",
        [".mjs"] = "text/javascript; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".woff"] = "font/woff",
        [".woff2"] = "font/woff2",
        [".ttf"] = "font/ttf",
        [".map"] = "application/json; charset=utf-8",
    };

    public UiBundle(IConfiguration configuration, IWebHostEnvironment environment)
    {
        Directory = Resolve(configuration["Runtime:UiDirectory"], environment.ContentRootPath);
    }

    public string Directory { get; }

    private static readonly Regex AssetPattern = new("(src|href)=\"(\\.?/?assets/[^\"]+)\"", RegexOptions.Compiled);

    public const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    public async Task WriteIndexAsync(HttpContext context, CancellationToken cancellationToken)
    {
        var path = Path.Combine(Directory, "index.html");
        if (!File.Exists(path))
        {
            await WriteMissingBundleAsync(context, cancellationToken);
            return;
        }

        var html = await File.ReadAllTextAsync(path, cancellationToken);
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        var index = AssetPattern.Replace(html, match =>
            $"{match.Groups[1].Value}=\"/ui/{match.Groups[2].Value.TrimStart('.', '/')}\"");
        index = index.Replace("<script", $"<script nonce=\"{nonce}\"", StringComparison.Ordinal);
        index = index.Replace("{{CSP_SOURCE}}", "'self'", StringComparison.Ordinal);
        index = index.Replace("{{NONCE}}", nonce, StringComparison.Ordinal);
        var shim = $"<script nonce=\"{nonce}\" src=\"/ui/shim.js\"></script>";
        index = index.Contains("</head>", StringComparison.OrdinalIgnoreCase)
            ? index.Replace("</head>", shim + "</head>", StringComparison.OrdinalIgnoreCase)
            : shim + index;

        context.Response.ContentType = ContentTypes[".html"];
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.ContentSecurityPolicy = ContentSecurityPolicy;
        await context.Response.WriteAsync(index, cancellationToken);
    }

    public async Task WriteAssetAsync(HttpContext context, string assetPath, CancellationToken cancellationToken)
    {
        var relative = assetPath.Replace('\\', '/');
        if (relative.Contains("..", StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var full = Path.GetFullPath(Path.Combine(Directory, "assets", relative));
        var assets = Path.GetFullPath(Path.Combine(Directory, "assets")) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(assets, StringComparison.Ordinal) || !File.Exists(full))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            await context.Response.WriteAsync($"Asset not available: GET /ui/assets/{relative}", cancellationToken);
            return;
        }

        context.Response.ContentType = ContentTypes.TryGetValue(Path.GetExtension(full), out var contentType)
            ? contentType
            : "application/octet-stream";
        context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        await context.Response.SendFileAsync(full, cancellationToken);
    }

    private static Task WriteMissingBundleAsync(HttpContext context, CancellationToken cancellationToken)
    {
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        context.Response.ContentType = ContentTypes[".html"];
        return context.Response.WriteAsync(
            "UI bundle not found. Build it with npm run build in the repository root, " +
            "or set Runtime:UiDirectory to the dist/webview folder.",
            cancellationToken);
    }

    private static string Resolve(string? configured, string contentRoot)
    {
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Path.GetFullPath(configured, contentRoot);
        }

        foreach (var start in new[] { contentRoot, AppContext.BaseDirectory, System.IO.Directory.GetCurrentDirectory() })
        {
            var current = new DirectoryInfo(start);
            while (current is not null)
            {
                var candidate = Path.Combine(current.FullName, "dist", "webview");
                if (File.Exists(Path.Combine(candidate, "index.html")))
                {
                    return candidate;
                }

                current = current.Parent;
            }
        }

        return Path.Combine(System.IO.Directory.GetCurrentDirectory(), "dist", "webview");
    }

    public const string Shim = """
(() => {
  const protocolVersion = 5;
  const queue = [];
  let sending = false;

  function flush() {
    if (sending || queue.length === 0) {
      return;
    }

    sending = true;
    const message = queue.shift();
    fetch("/ui/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    })
      .catch(() => {})
      .finally(() => {
        sending = false;
        flush();
      });
  }

  function post(message) {
    queue.push(message);
    flush();
  }

  function handshake() {
    post({ type: "initializeProtocol", protocolVersion });
  }

  window.acquireVsCodeApi = () => ({
    postMessage: post,
    getState: () => {
      try {
        return JSON.parse(localStorage.getItem("ycrasy.state") ?? "null");
      } catch {
        return null;
      }
    },
    setState: (value) => {
      try {
        localStorage.setItem("ycrasy.state", JSON.stringify(value));
      } catch {}
    },
  });

  const source = new EventSource("/ui/events");
  source.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    window.dispatchEvent(new MessageEvent("message", { data: payload }));
  };
  source.onopen = handshake;

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      handshake();
    }
  });

  handshake();
})();
""";
}
