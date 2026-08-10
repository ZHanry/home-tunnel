namespace HomeTunnel.Client;

/// <summary>Documentation-only values used by tests and design-time previews.</summary>
public static class ProductConfiguration
{
    public const string GitHubOwner = "ZHanry";
    public const string GitHubRepository = "home-tunnel";
    public static Uri ProjectUri { get; } = new($"https://github.com/{GitHubOwner}/{GitHubRepository}/");
    public static Uri ReleaseEndpoint { get; } = new(ProjectUri, "releases/latest/download/latest.json");
    public static Uri ReleaseDownloadRoot { get; } = new(ProjectUri, "releases/download/");

    public static Uri PublicBaseUri { get; } = new("https://console.tunnel.example.com/");
    public static Uri ApiBaseUri { get; } = new(PublicBaseUri, "api/v1/");
    public const string TunnelDomain = "tunnel.example.com";
    public const string FrpsHost = "203.0.113.10";
    public const int FrpsPort = 7000;
}
