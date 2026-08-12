using System.Text.Json.Serialization;
using HomeTunnel.Client;

namespace HomeTunnel.Client.Models;

public sealed record UserInfo(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("password_state")] string PasswordState);

public sealed record SessionResponse(
    [property: JsonPropertyName("user")] UserInfo User,
    [property: JsonPropertyName("password_change_required")] bool PasswordChangeRequired,
    [property: JsonPropertyName("device_id")] string? DeviceId,
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("refresh_token")] string RefreshToken,
    [property: JsonPropertyName("csrf_token")] string CsrfToken,
    [property: JsonPropertyName("access_expires_at")] DateTimeOffset AccessExpiresAt,
    [property: JsonPropertyName("refresh_expires_at")] DateTimeOffset RefreshExpiresAt);

public sealed record DeviceRegistration(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("device_credential")] string DeviceCredential,
    [property: JsonPropertyName("config_version")] long ConfigVersion);

public sealed class TunnelConnection
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("device_id")] public string DeviceId { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("subdomain")] public string Subdomain { get; set; } = "";
    [JsonPropertyName("public_url")] public string PublicUrl { get; set; } = "";
    [JsonPropertyName("local_scheme")] public string LocalScheme { get; set; } = "http";
    [JsonPropertyName("local_host")] public string LocalHost { get; set; } = "127.0.0.1";
    [JsonPropertyName("local_port")] public int LocalPort { get; set; }
    [JsonPropertyName("enabled")] public bool Enabled { get; set; } = true;
    [JsonPropertyName("version")] public long Version { get; set; }
    [JsonPropertyName("state")] public string State { get; set; } = "Pending";
    [JsonPropertyName("applied_version")] public long AppliedVersion { get; set; }
    [JsonPropertyName("last_error_code")] public string? LastErrorCode { get; set; }
    [JsonPropertyName("proxy_name")] public string? ProxyName { get; set; }
}

public sealed record ConnectionList([property: JsonPropertyName("items")] List<TunnelConnection> Items);

public sealed record LeaseInfo(
    [property: JsonPropertyName("lease")] string Lease,
    [property: JsonPropertyName("expires_at")] DateTimeOffset ExpiresAt,
    [property: JsonPropertyName("config_version")] long ConfigVersion);

public sealed record SyncResponse(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("full_sync")] bool FullSync,
    [property: JsonPropertyName("target_config_version")] long TargetConfigVersion,
    [property: JsonPropertyName("connections")] List<TunnelConnection> Connections,
    [property: JsonPropertyName("content_hash")] string ContentHash,
    [property: JsonPropertyName("lease")] LeaseInfo? Lease,
    [property: JsonPropertyName("server_time")] DateTimeOffset ServerTime);

public sealed record ReleaseMetadata(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("platform")] string Platform,
    [property: JsonPropertyName("architecture")] string Architecture,
    [property: JsonPropertyName("file_name")] string FileName,
    [property: JsonPropertyName("size_bytes")] long SizeBytes,
    [property: JsonPropertyName("sha256")] string Sha256,
    [property: JsonPropertyName("released_at")] DateTimeOffset ReleasedAt,
    [property: JsonPropertyName("download_url")] string DownloadUrl,
    [property: JsonPropertyName("stable_download_url")] string? StableDownloadUrl);

public sealed class LocalState
{
    public string InstallId { get; set; } = Guid.NewGuid().ToString("N");
    public string? DeviceId { get; set; }
    public long LastConfigVersion { get; set; }
    public long AppliedConfigVersion { get; set; }
    public string ServerBaseUrl { get; set; } = "";
    public string ApiBaseUrl { get; set; } = ProductConfiguration.ApiBaseUri.AbsoluteUri;
    public string FrpsHost { get; set; } = "";
    public int FrpsPort { get; set; }
    public string TunnelDomain { get; set; } = "";
    public bool StartWithWindows { get; set; }
    public string Theme { get; set; } = "light";
    public string? DismissedUpdateVersion { get; set; }
    public DateTimeOffset? DismissedUpdateAtUtc { get; set; }
    public List<TunnelConnection> CachedConnections { get; set; } = [];

    [JsonIgnore]
    public bool HasServerProfile =>
        Uri.TryCreate(ServerBaseUrl, UriKind.Absolute, out var server) &&
        server.Scheme == Uri.UriSchemeHttps &&
        Uri.TryCreate(ApiBaseUrl, UriKind.Absolute, out var api) &&
        api.Scheme == Uri.UriSchemeHttps &&
        !string.IsNullOrWhiteSpace(FrpsHost) &&
        FrpsPort is >= 1 and <= 65535 &&
        !string.IsNullOrWhiteSpace(TunnelDomain);
}

public sealed class ApiException : Exception
{
    public int StatusCode { get; }
    public string ErrorCode { get; }
    public ApiException(int statusCode, string errorCode, string message) : base(message)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
    }
}
