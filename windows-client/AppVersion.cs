using System.Reflection;

namespace HomeTunnel.Client;

public static class AppVersion
{
    public static string Current { get; } = ResolveCurrent();

    private static string ResolveCurrent()
    {
        var assembly = typeof(AppVersion).Assembly;
        var informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (!string.IsNullOrWhiteSpace(informational))
            return informational.Split('+', 2)[0];

        var version = assembly.GetName().Version;
        return version is null ? "0.0.0" : $"{version.Major}.{version.Minor}.{Math.Max(0, version.Build)}";
    }
}
