using Android.App;
using Android.Content.PM;
using Android.Runtime;
using Microsoft.Maui;
using Microsoft.Maui.Hosting;

namespace YCraSy.Agent.Android;

[Activity(Theme = "@style/Maui.MainTheme.NoActionBar", MainLauncher = true, ConfigurationChanges = ConfigChanges.ScreenSize |
    ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout |
    ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
public sealed class MainActivity : MauiAppCompatActivity { }

[Application(UsesCleartextTraffic = false)]
public sealed class MainApplication(nint handle, JniHandleOwnership ownership)
    : MauiApplication(handle, ownership)
{
    protected override MauiApp CreateMauiApp() => MauiApp.CreateBuilder().UseMauiApp<AgentApp>().Build();
}
