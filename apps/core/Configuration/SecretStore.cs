using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace YCraSy.Agent.Runtime.Configuration;

public sealed class SecretStore
{
    public static string Origin(string baseUrl) => new Uri(baseUrl).GetLeftPart(UriPartial.Authority);

    private static string Name(string origin) =>
        "deepseek-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Origin(origin)))).ToLowerInvariant();

    public async Task<string?> ReadAsync(string origin, CancellationToken ct)
    {
        var name = Name(origin);
        var path = Path.Combine(AgentPaths.Home, name + ".cred");
        if (!File.Exists(path)) return null;
        return await RunAsync(["decrypt", "--refuse-null", "--name=" + name, path, "-"], null, ct);
    }

    public async Task WriteAsync(string origin, string value, CancellationToken ct, bool replace = true)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("Empty credential.");
        AgentPaths.EnsureHome();
        var name = Name(origin);
        var path = Path.Combine(AgentPaths.Home, name + ".cred");
        if (!replace && File.Exists(path)) return;
        var temporary = path + "." + Guid.NewGuid().ToString("N");
        try
        {
            await RunAsync(["encrypt", "--with-key=host", "--name=" + name, "-", temporary], value, ct);
            var verified = await RunAsync(["decrypt", "--refuse-null", "--name=" + name, temporary, "-"], null, ct);
            if (!string.Equals(value, verified, StringComparison.Ordinal))
                throw new IOException("Credential verification failed.");
            try { File.Move(temporary, path, replace); }
            catch (IOException) when (!replace && File.Exists(path)) { }
        }
        finally { File.Delete(temporary); }
    }

    public void Delete(string origin) => File.Delete(Path.Combine(AgentPaths.Home, Name(origin) + ".cred"));

    private static async Task<string> RunAsync(string[] arguments, string? value, CancellationToken ct)
    {
        var info = new ProcessStartInfo("/usr/bin/systemd-creds")
        {
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            UseShellExecute = false,
        };
        info.ArgumentList.Add("--user");
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        using var process = Process.Start(info) ?? throw new IOException("Cannot start systemd-creds.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var error = process.StandardError.ReadToEndAsync(timeout.Token);
            if (value is not null) await process.StandardInput.WriteAsync(value.AsMemory(), timeout.Token);
            process.StandardInput.Close();
            await Task.WhenAll(output, error, process.WaitForExitAsync(timeout.Token));
            if (process.ExitCode != 0) throw new IOException("User-scoped systemd credential operation failed.");
            return await output;
        }
        finally { if (!process.HasExited) process.Kill(); }
    }
}
