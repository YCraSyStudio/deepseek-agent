using System.Runtime.InteropServices;

namespace YCraSy.Agent.Runtime.Configuration;

public static class AgentPaths
{
    private const UnixFileMode DirectoryMode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;
    private const UnixFileMode FileMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;

    public static string Home { get; } = Resolve();

    public static string SettingsFile => Path.Combine(Home, "settings.json");


    public static void EnsureHome()
    {
        Directory.CreateDirectory(Home);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(Home, DirectoryMode);
        }
    }

    public static void Restrict(string path)
    {
        if (!OperatingSystem.IsWindows() && File.Exists(path))
        {
            File.SetUnixFileMode(path, FileMode);
        }
    }

    private static string Resolve()
    {
        var configured = Environment.GetEnvironmentVariable("YCRASY_AGENT_HOME");
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Path.GetFullPath(configured);
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(home))
        {
            home = Environment.GetEnvironmentVariable("HOME") ?? Path.GetTempPath();
        }

        return Path.Combine(home, ".ycrasy-agent");
    }
}
