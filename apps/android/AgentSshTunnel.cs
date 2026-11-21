using System.Net;
using System.Text;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace YCraSy.Agent.Android;

internal sealed class UntrustedHostException(string fingerprint, bool changed) : Exception
{
    internal string Fingerprint { get; } = fingerprint;
    internal bool Changed { get; } = changed;
}

internal sealed class AgentSshTunnel(SshClient client, PrivateKeyFile? key, SshCommand relay, Stream relayInput, Uri page) : IDisposable
{
    private const string Loopback = "127.0.0.1";
    private bool disposed;

    internal Uri Page { get; } = page;
    internal object ClientIdentity => client;
    internal event EventHandler<ExceptionEventArgs> ConnectionError
    {
        add => client.ErrorOccurred += value;
        remove => client.ErrorOccurred -= value;
    }

    internal static async Task<AgentSshTunnel> OpenAsync(Uri server, string user, bool usePrivateKey,
        string credential, string? passphrase, string? certificate, string? knownFingerprint)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        using var keyBytes = usePrivateKey ? new MemoryStream(Encoding.UTF8.GetBytes(credential.Trim() + "\n")) : null;
        using var certificateBytes = string.IsNullOrWhiteSpace(certificate)
            ? null : new MemoryStream(Encoding.UTF8.GetBytes(certificate.Trim() + "\n"));
        var key = keyBytes is null ? null : new PrivateKeyFile(keyBytes, passphrase, certificateBytes);
        var port = server.Port > 0 ? server.Port : 22;
        var ssh = key is null
            ? new SshClient(server.IdnHost, port, user, credential)
            : new SshClient(server.IdnHost, port, user, key);
        string? rejectedFingerprint = null;
        EventHandler<HostKeyEventArgs> checkHostKey = (_, args) =>
        {
            args.CanTrust = string.Equals(args.FingerPrintSHA256, knownFingerprint, StringComparison.Ordinal);
            if (!args.CanTrust) { rejectedFingerprint = args.FingerPrintSHA256; }
        };
        ssh.HostKeyReceived += checkHostKey;
        ssh.ConnectionInfo.Timeout = TimeSpan.FromSeconds(12);
        ssh.KeepAliveInterval = TimeSpan.FromSeconds(15);
        try
        {
            try
            {
                await ssh.ConnectAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (SshException) when (rejectedFingerprint is not null)
            {
                throw new UntrustedHostException(rejectedFingerprint, knownFingerprint is not null);
            }

            var relay = ssh.CreateCommand("exec \"$HOME/.local/lib/ycrasy-agent/relay/YCraSy.Agent.Web\"");
            var execution = relay.ExecuteAsync(CancellationToken.None);
            _ = execution.ContinueWith(task => _ = task.Exception, TaskContinuationOptions.OnlyOnFaulted);
            var relayInput = relay.CreateInputStream();
            using var reader = new StreamReader(relay.OutputStream, Encoding.UTF8, leaveOpen: true);
            var handshake = (await reader.ReadLineAsync(timeout.Token).ConfigureAwait(false))?.Split(' ');
            if (handshake is not [var portText, var code] || !ushort.TryParse(portText, out var remotePort) ||
                remotePort == 0 || code.Length != 64 || !code.All(char.IsAsciiHexDigit))
                throw new InvalidOperationException("Instala el servicio YCraSy en la cuenta SSH del PC.");
            var forward = new ForwardedPortLocal(Loopback, 0, Loopback, remotePort);
            ssh.AddForwardedPort(forward);
            forward.Start();
            var url = new Uri($"http://{Loopback}:{forward.BoundPort}/ui/?code={Uri.EscapeDataString(code)}");
            using var probe = new HttpClient(new SocketsHttpHandler
            {
                AllowAutoRedirect = false,
                UseCookies = false,
                UseProxy = false,
            }) { Timeout = TimeSpan.FromSeconds(8) };
            try
            {
                using var response = await probe.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, timeout.Token)
                    .ConfigureAwait(false);
                if (response.StatusCode == HttpStatusCode.Unauthorized)
                {
                    throw new InvalidOperationException("El código del IDE móvil ya no es válido. Vuelve a conectar con la cuenta SSH.");
                }
                if (!response.IsSuccessStatusCode)
                {
                    throw new InvalidOperationException("El host ycrasy-agent no están disponibles en el PC.");
                }
            }
            catch (HttpRequestException)
            {
                throw new InvalidOperationException("No se pudo alcanzar ASP.NET por SSH. Comprueba que esté instalado para esta cuenta.");
            }

            return new AgentSshTunnel(ssh, key, relay, relayInput, url);
        }
        catch
        {
            ssh.Dispose();
            key?.Dispose();
            throw;
        }
    }

    public void Dispose()
    {
        if (disposed) { return; }
        disposed = true;
        relayInput.Dispose();
        client.Dispose();
        relay.Dispose();
        key?.Dispose();
    }
}
