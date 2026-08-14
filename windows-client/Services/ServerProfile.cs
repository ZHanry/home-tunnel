using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace HomeTunnel.Client.Services;

public sealed record ServerProfile(
    Uri PublicBaseUri,
    Uri ApiBaseUri,
    string FrpsHost,
    int FrpsPort,
    string TunnelDomain,
    string? FrpsTlsCertificatePem)
{
    private const int MaximumConfigurationBytes = 32 * 1024;
    private const int MaximumCertificatePemChars = 16 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Regex DomainPattern = new(
        "^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
        RegexOptions.CultureInvariant);

    public static Uri NormalizeAddress(string? value)
    {
        var input = value?.Trim() ?? "";
        if (input.Length == 0) throw new InvalidDataException("请输入服务器地址。");
        if (!input.Contains("://", StringComparison.Ordinal)) input = "https://" + input;
        if (!Uri.TryCreate(input, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            string.IsNullOrWhiteSpace(uri.Host) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            uri.AbsolutePath is not ("" or "/"))
            throw new InvalidDataException("服务器地址必须是 HTTPS 根地址，例如 https://console.tunnel.example.com。");
        return new Uri(uri.GetLeftPart(UriPartial.Authority) + "/");
    }

    public static async Task<ServerProfile> DiscoverAsync(
        string? address,
        CancellationToken cancellationToken,
        HttpMessageHandler? handler = null)
    {
        var requestedOrigin = NormalizeAddress(address);
        handler ??= new HttpClientHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.All,
        };
        using var http = new HttpClient(handler, disposeHandler: true) { Timeout = TimeSpan.FromSeconds(12) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"HomeTunnel-Windows/{AppVersion.Current}");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await http.GetAsync(
            new Uri(requestedOrigin, "api/v1/public/config"),
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if ((int)response.StatusCode is >= 300 and < 400)
            throw new InvalidDataException("服务器配置地址发生了重定向，请填写最终 HTTPS 地址。");
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > MaximumConfigurationBytes)
            throw new InvalidDataException("服务器配置响应过大。");
        var payload = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        if (payload.Length == 0 || payload.Length > MaximumConfigurationBytes)
            throw new InvalidDataException("服务器配置响应为空或过大。");

        DiscoveryResponse value;
        try
        {
            value = JsonSerializer.Deserialize<DiscoveryResponse>(payload, JsonOptions)
                ?? throw new InvalidDataException("服务器配置为空。");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("服务器配置格式无效。", error);
        }

        var canonicalOrigin = NormalizeAddress(value.PublicBaseUrl);
        if (!SameOrigin(requestedOrigin, canonicalOrigin))
            throw new InvalidDataException("服务器返回了不同的控制中心地址，请直接填写该地址。");
        var tunnelDomain = (value.TunnelDomain ?? "").Trim().Trim('.').ToLowerInvariant();
        if (!DomainPattern.IsMatch(tunnelDomain))
            throw new InvalidDataException("服务器返回的隧道域名无效。");
        var frpsHost = (value.FrpsHost ?? "").Trim();
        if (frpsHost.Length is < 1 or > 253 ||
            frpsHost.Any(char.IsWhiteSpace) ||
            frpsHost.Contains('/') ||
            frpsHost.Contains('\\'))
            throw new InvalidDataException("服务器返回的 FRPS 地址无效。");
        if (value.FrpsPort is < 1 or > 65535)
            throw new InvalidDataException("服务器返回的 FRPS 端口无效。");
        // 可选字段：服务端未配置 FRPS 证书时不出现，客户端行为保持不变。
        var certificatePem = string.IsNullOrWhiteSpace(value.FrpsTlsCertificatePem) ? null : value.FrpsTlsCertificatePem;
        if (certificatePem is not null &&
            (certificatePem.Length > MaximumCertificatePemChars ||
             !certificatePem.Contains("-----BEGIN CERTIFICATE-----", StringComparison.Ordinal) ||
             !certificatePem.Contains("-----END CERTIFICATE-----", StringComparison.Ordinal)))
            throw new InvalidDataException("服务器返回的 FRPS 证书无效。");

        return new ServerProfile(
            canonicalOrigin,
            new Uri(canonicalOrigin, "api/v1/"),
            frpsHost,
            value.FrpsPort,
            tunnelDomain,
            certificatePem);
    }

    private static bool SameOrigin(Uri left, Uri right) =>
        string.Equals(left.Scheme, right.Scheme, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase) &&
        left.Port == right.Port;

    private sealed record DiscoveryResponse(
        [property: JsonPropertyName("public_base_url")] string? PublicBaseUrl,
        [property: JsonPropertyName("tunnel_domain")] string? TunnelDomain,
        [property: JsonPropertyName("frps_host")] string? FrpsHost,
        [property: JsonPropertyName("frps_port")] int FrpsPort,
        [property: JsonPropertyName("frps_tls_certificate_pem")] string? FrpsTlsCertificatePem = null);
}
