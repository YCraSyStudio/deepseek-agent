using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;
using Microsoft.Maui.Storage;
using Renci.SshNet.Common;

namespace YCraSy.Agent.Android;

public sealed class AgentApp : Application
{
    protected override Window CreateWindow(IActivationState? activationState)
    {
        var server = new Entry { Placeholder = "IP, host o ssh://host:puerto", Keyboard = Keyboard.Url };
        var user = new Entry { Placeholder = "Usuario SSH" };
        var method = new Picker { Title = "Autenticación SSH", ItemsSource = new[] { "Contraseña", "Clave privada / certificado SSH" }, SelectedIndex = 0 };
        var password = new Entry { Placeholder = "Contraseña SSH", IsPassword = true };
        var key = new Editor { Placeholder = "Pega la clave privada OpenSSH", HeightRequest = 110, IsVisible = false, IsSpellCheckEnabled = false, IsTextPredictionEnabled = false };
        var passphrase = new Entry { Placeholder = "Frase de la clave (opcional)", IsPassword = true, IsVisible = false };
        var certificate = new Editor { Placeholder = "Certificado OpenSSH (opcional)", HeightRequest = 72, IsVisible = false, IsSpellCheckEnabled = false, IsTextPredictionEnabled = false };
        var error = new Label();
        var web = new WebView { IsVisible = false };
        var connect = new Button { Text = "Conectar" };
        var form = new VerticalStackLayout { Padding = 16, Children = { server, user, method, password, key, passphrase, certificate, connect, error } };
        var formScroll = new ScrollView { Content = form };
        var layout = new Grid { Children = { formScroll, web } };
        var page = new AgentPage { Content = layout };
        var window = new Window(page);
        AgentSshTunnel? tunnel = null;
        var closed = false;

        method.SelectedIndexChanged += (_, _) =>
        {
            password.IsVisible = method.SelectedIndex == 0;
            key.IsVisible = passphrase.IsVisible = certificate.IsVisible = method.SelectedIndex == 1;
        };

        web.Navigating += (_, navigation) =>
        {
            if (tunnel is { } current && (!Uri.TryCreate(navigation.Url, UriKind.Absolute, out var uri) ||
                Uri.Compare(uri, current.Page, UriComponents.SchemeAndServer, UriFormat.Unescaped,
                    StringComparison.OrdinalIgnoreCase) != 0))
            {
                navigation.Cancel = true;
            }
        };

        connect.Clicked += async (_, _) =>
        {
            var address = server.Text?.Trim() ?? "";
            var login = user.Text?.Trim();
            var useKey = method.SelectedIndex == 1;
            var credential = useKey ? key.Text : password.Text;
            if (!TrySshAddress(address, out var endpoint) || string.IsNullOrWhiteSpace(login) || string.IsNullOrWhiteSpace(credential))
            {
                error.Text = "Introduce la dirección del PC, el usuario SSH y su contraseña o clave privada.";
                return;
            }

            form.IsEnabled = false;
            error.Text = "Conectando por SSH…";
            var pinName = $"ssh-host:{endpoint.IdnHost}:{(endpoint.Port > 0 ? endpoint.Port : 22)}";
            var knownPin = Preferences.Default.Get<string?>(pinName, null);
            try
            {
                try
                {
                    tunnel = await ConnectToHost(knownPin);
                }
                catch (UntrustedHostException ex) when (!ex.Changed && !closed)
                {
                    if (!await page.DisplayAlertAsync("Verificar el servidor SSH",
                        $"{endpoint.Host}\nSHA256:{ex.Fingerprint}\n\nCompara esta huella con la del PC antes de continuar.",
                        "Confiar y conectar", "Cancelar"))
                    {
                        error.Text = "Conexión cancelada.";
                        return;
                    }

                    tunnel = await ConnectToHost(ex.Fingerprint);
                    Preferences.Default.Set(pinName, ex.Fingerprint);
                }

                if (closed) { Disconnect(); return; }
                tunnel.ConnectionError += HandleTunnelError;
                web.Source = tunnel.Page.AbsoluteUri;
                web.IsVisible = true;
                formScroll.IsVisible = false;
                error.Text = "";
            }
            catch (UntrustedHostException)
            {
                error.Text = "La huella SSH del servidor no coincide. Verifica la identidad del PC antes de volver a conectar.";
            }
            catch (SshAuthenticationException)
            {
                error.Text = "El PC rechazó el usuario o la credencial SSH.";
            }
            catch (InvalidOperationException ex)
            {
                error.Text = ex.Message;
            }
            catch (OperationCanceledException)
            {
                error.Text = "La conexión tardó demasiado. Comprueba el host, el puerto y la VPN.";
            }
            catch (Exception)
            {
                error.Text = "No se pudo conectar. Comprueba la dirección, la VPN y el formato de la clave SSH.";
            }
            finally
            {
                form.IsEnabled = true;
                password.Text = key.Text = passphrase.Text = certificate.Text = "";
            }

            Task<AgentSshTunnel> ConnectToHost(string? pin) => AgentSshTunnel.OpenAsync(endpoint, login!, useKey, credential!,
                string.IsNullOrEmpty(passphrase.Text) ? null : passphrase.Text, certificate.Text, pin);
        };

        void HandleTunnelError(object? sender, ExceptionEventArgs args) => page.Dispatcher.Dispatch(() =>
        {
            if (!ReferenceEquals(sender, tunnel?.ClientIdentity)) { return; }
            Disconnect();
            error.Text = "Se ha interrumpido la conexión SSH. Vuelve a conectar.";
        });

        void Disconnect()
        {
            var previous = tunnel;
            tunnel = null;
            if (previous is not null)
            {
                previous.ConnectionError -= HandleTunnelError;
                _ = Task.Run(previous.Dispose);
            }
            web.Source = new HtmlWebViewSource { Html = "" };
            web.IsVisible = false;
            formScroll.IsVisible = true;
        }

        page.TryDisconnect = () =>
        {
            if (tunnel is null) { return false; }
            Disconnect();
            return true;
        };
        window.Destroying += (_, _) => { closed = true; Disconnect(); };
        return window;
    }

    private sealed class AgentPage : ContentPage
    {
        internal Func<bool>? TryDisconnect { get; set; }

        protected override bool OnBackButtonPressed() =>
            TryDisconnect?.Invoke() == true || base.OnBackButtonPressed();
    }

    internal static bool TrySshAddress(string raw, out Uri endpoint)
    {
        var value = raw.Contains("://", StringComparison.Ordinal) ? raw : "ssh://" + raw;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "ssh" &&
            uri.Host.Length > 0 && uri.UserInfo.Length == 0 && uri.Port != 0 &&
            uri.AbsolutePath is "" or "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0)
        {
            endpoint = uri;
            return true;
        }
        endpoint = null!;
        return false;
    }
}
