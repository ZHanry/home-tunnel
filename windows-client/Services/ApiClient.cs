using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.IO;
using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

public sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private string? _accessToken;
    private string? _refreshToken;
    private DateTimeOffset _accessExpiresAt;

    public UserInfo? CurrentUser { get; private set; }

    public ApiClient(string baseUrl)
    {
        _http = new HttpClient
        {
            BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/"),
            Timeout = TimeSpan.FromSeconds(15),
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"HomeTunnel-Windows/{AppVersion.Current}");
    }

    public async Task<SessionResponse> LoginAsync(string username, string password, CancellationToken cancellationToken)
    {
        var session = await PostPublicAsync<SessionResponse>("auth/login", new
        {
            username,
            password,
            client_type = "windows",
        }, cancellationToken);
        SetSession(session);
        return session;
    }

    public async Task<SessionResponse> DeviceLoginAsync(string deviceId, string credential, CancellationToken cancellationToken)
    {
        var session = await PostPublicAsync<SessionResponse>("auth/device", new
        {
            device_id = deviceId,
            device_credential = credential,
        }, cancellationToken);
        SetSession(session);
        return session;
    }

    public async Task ChangePasswordAsync(string currentPassword, string newPassword, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Post, "auth/password/change", new
        {
            current_password = currentPassword,
            new_password = newPassword,
        }, cancellationToken, allowRefresh: false);
        await EnsureSuccessAsync(response, cancellationToken);
        ClearSession();
    }

    public Task<DeviceRegistration> RegisterDeviceAsync(
        string name,
        string installId,
        string fingerprintHash,
        CancellationToken cancellationToken) =>
        SendJsonAsync<DeviceRegistration>(HttpMethod.Post, "devices/register", new
        {
            name,
            install_id = installId,
            fingerprint_hash = fingerprintHash,
            client_version = AppVersion.Current,
        }, cancellationToken);

    public Task<ConnectionList> GetConnectionsAsync(CancellationToken cancellationToken) =>
        SendJsonAsync<ConnectionList>(HttpMethod.Get, "client/connections", null, cancellationToken);

    public Task<TunnelConnection> CreateConnectionAsync(
        string deviceId,
        TunnelConnection value,
        CancellationToken cancellationToken) =>
        SendJsonAsync<TunnelConnection>(HttpMethod.Post, "client/connections", new
        {
            device_id = deviceId,
            name = value.Name,
            subdomain = value.Subdomain,
            local_scheme = value.LocalScheme,
            local_host = value.LocalHost,
            local_port = value.LocalPort,
            enabled = value.Enabled,
        }, cancellationToken);

    public Task<TunnelConnection> UpdateConnectionAsync(TunnelConnection value, CancellationToken cancellationToken) =>
        SendJsonAsync<TunnelConnection>(HttpMethod.Patch, $"client/connections/{Uri.EscapeDataString(value.Id)}", new
        {
            name = value.Name,
            subdomain = value.Subdomain,
            local_scheme = value.LocalScheme,
            local_host = value.LocalHost,
            local_port = value.LocalPort,
            enabled = value.Enabled,
            expected_version = value.Version,
        }, cancellationToken, value.Version);

    public async Task DeleteConnectionAsync(TunnelConnection value, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Delete, $"client/connections/{Uri.EscapeDataString(value.Id)}",
            new { expected_version = value.Version }, cancellationToken, expectedVersion: value.Version);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public Task<SyncResponse> SyncAsync(
        string deviceId,
        long lastConfigVersion,
        DateTimeOffset? leaseExpiresAt,
        CancellationToken cancellationToken) =>
        SendJsonAsync<SyncResponse>(HttpMethod.Post, "client/sync", new
        {
            device_id = deviceId,
            last_config_version = lastConfigVersion,
            supports_optional_lease = true,
            lease_expires_at = leaseExpiresAt.HasValue ? FormatUtcTimestamp(leaseExpiresAt.Value) : null,
        }, cancellationToken);

    public async Task ListenForConfigurationChangesAsync(
        string deviceId,
        Func<Task> onConfigurationChanged,
        CancellationToken cancellationToken)
    {
        if (_refreshToken is not null && _accessExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(1))
            await RefreshAsync(cancellationToken);
        var accessToken = _accessToken ?? throw new ApiException(401, "SESSION_REVOKED", "设备会话已失效");
        var endpoint = new Uri(_http.BaseAddress!, "ws");
        var builder = new UriBuilder(endpoint)
        {
            Scheme = endpoint.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws",
            Port = endpoint.IsDefaultPort ? -1 : endpoint.Port,
        };
        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Authorization", $"Bearer {accessToken}");
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        await socket.ConnectAsync(builder.Uri, cancellationToken);

        var buffer = new byte[16 * 1024];
        while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (result.MessageType != WebSocketMessageType.Text) continue;
                await message.WriteAsync(buffer.AsMemory(0, result.Count), cancellationToken);
                if (message.Length > 64 * 1024) throw new InvalidDataException("实时事件超过允许大小");
            }
            while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Text &&
                IsConfigurationChangeEvent(Encoding.UTF8.GetString(message.GetBuffer(), 0, checked((int)message.Length)), deviceId))
            {
                await onConfigurationChanged();
            }
        }
    }

    internal static bool IsConfigurationChangeEvent(string payload, string deviceId)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            if (!root.TryGetProperty("event", out var eventProperty)) return false;
            var eventName = eventProperty.GetString();
            if (eventName is not ("config.version.changed" or "connection.command" or "subject.revoked")) return false;
            if (!root.TryGetProperty("payload", out var eventPayload) || eventPayload.ValueKind != JsonValueKind.Object ||
                !eventPayload.TryGetProperty("device_id", out var eventDevice)) return true;
            return string.Equals(eventDevice.GetString(), deviceId, StringComparison.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public async Task HeartbeatAsync(
        string deviceId,
        long appliedConfigVersion,
        IReadOnlyCollection<TunnelConnection> connections,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Post, "client/heartbeat", new
        {
            device_id = deviceId,
            applied_config_version = appliedConfigVersion,
            client_version = AppVersion.Current,
            agent_version = FrpcSupervisor.Version,
            clock_utc = FormatUtcTimestamp(DateTimeOffset.UtcNow),
            connections = connections.Select(connection => new
            {
                connection_id = connection.Id,
                applied_version = connection.AppliedVersion,
                state = connection.State,
                error_code = connection.LastErrorCode,
                error_summary = connection.LastErrorCode is null ? null : "受管 Agent 报告错误，详细信息仅保留在本机脱敏日志。",
            }),
        }, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    internal static string FormatUtcTimestamp(DateTimeOffset value) =>
        value.UtcDateTime.ToString("O", System.Globalization.CultureInfo.InvariantCulture);

    public async Task LogoutAsync(CancellationToken cancellationToken)
    {
        if (_accessToken is null) return;
        try
        {
            using var response = await SendAsync(HttpMethod.Post, "auth/logout", new { }, cancellationToken, allowRefresh: false);
            await EnsureSuccessAsync(response, cancellationToken);
        }
        finally
        {
            ClearSession();
        }
    }

    private void SetSession(SessionResponse session)
    {
        _accessToken = session.AccessToken;
        _refreshToken = session.RefreshToken;
        _accessExpiresAt = session.AccessExpiresAt;
        CurrentUser = session.User;
    }

    private void ClearSession()
    {
        _accessToken = null;
        _refreshToken = null;
        _accessExpiresAt = default;
        CurrentUser = null;
    }

    private async Task<T> PostPublicAsync<T>(string path, object value, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(value, options: _json),
        };
        using var response = await _http.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return (await response.Content.ReadFromJsonAsync<T>(_json, cancellationToken))
            ?? throw new ApiException(502, "INVALID_RESPONSE", "控制中心返回了空响应");
    }

    private async Task<T> SendJsonAsync<T>(
        HttpMethod method,
        string path,
        object? value,
        CancellationToken cancellationToken,
        long? expectedVersion = null)
    {
        using var response = await SendAsync(method, path, value, cancellationToken, expectedVersion: expectedVersion);
        await EnsureSuccessAsync(response, cancellationToken);
        return (await response.Content.ReadFromJsonAsync<T>(_json, cancellationToken))
            ?? throw new ApiException(502, "INVALID_RESPONSE", "控制中心返回了空响应");
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string path,
        object? value,
        CancellationToken cancellationToken,
        bool allowRefresh = true,
        long? expectedVersion = null)
    {
        if (allowRefresh && _refreshToken is not null && _accessExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(1))
            await RefreshAsync(cancellationToken);

        var response = await SendOnceAsync(method, path, value, cancellationToken, expectedVersion);
        if (allowRefresh && response.StatusCode == HttpStatusCode.Unauthorized && _refreshToken is not null)
        {
            response.Dispose();
            await RefreshAsync(cancellationToken);
            response = await SendOnceAsync(method, path, value, cancellationToken, expectedVersion);
        }
        return response;
    }

    private async Task<HttpResponseMessage> SendOnceAsync(
        HttpMethod method,
        string path,
        object? value,
        CancellationToken cancellationToken,
        long? expectedVersion)
    {
        using var request = new HttpRequestMessage(method, path);
        if (value is not null) request.Content = JsonContent.Create(value, options: _json);
        if (_accessToken is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _accessToken);
        request.Headers.TryAddWithoutValidation("X-Request-Id", Guid.NewGuid().ToString());
        if (expectedVersion.HasValue) request.Headers.TryAddWithoutValidation("If-Match", $"\"{expectedVersion.Value}\"");
        return await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancellationToken);
    }

    private async Task RefreshAsync(CancellationToken cancellationToken)
    {
        await _refreshLock.WaitAsync(cancellationToken);
        try
        {
            if (_accessToken is not null && _accessExpiresAt > DateTimeOffset.UtcNow.AddMinutes(1)) return;
            var refreshToken = _refreshToken ?? throw new ApiException(401, "SESSION_REVOKED", "设备会话已失效");
            var result = await PostPublicAsync<RefreshResponse>("auth/refresh", new
            {
                refresh_token = refreshToken,
                client_type = "windows",
            }, cancellationToken);
            _accessToken = result.AccessToken;
            _refreshToken = result.RefreshToken;
            _accessExpiresAt = result.AccessExpiresAt;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode) return;
        try
        {
            var error = await response.Content.ReadFromJsonAsync<ApiError>(_json, cancellationToken);
            throw new ApiException((int)response.StatusCode, error?.ErrorCode ?? "HTTP_ERROR", error?.Message ?? $"HTTP {(int)response.StatusCode}");
        }
        catch (JsonException)
        {
            throw new ApiException((int)response.StatusCode, "HTTP_ERROR", $"控制中心返回 HTTP {(int)response.StatusCode}");
        }
    }

    public void Dispose()
    {
        _http.Dispose();
        _refreshLock.Dispose();
    }

    private sealed record RefreshResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken,
        [property: JsonPropertyName("access_expires_at")] DateTimeOffset AccessExpiresAt);

    private sealed record ApiError(
        [property: JsonPropertyName("error_code")] string ErrorCode,
        [property: JsonPropertyName("message")] string Message);
}
