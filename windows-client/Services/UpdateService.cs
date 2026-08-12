using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

public sealed record UpdateCheckResult(
    string CurrentVersion,
    ReleaseMetadata Release,
    Uri DownloadUri,
    bool IsUpdateAvailable);

public sealed record UpdateDownloadProgress(long BytesReceived, long TotalBytes)
{
    public int Percentage => TotalBytes <= 0
        ? 0
        : (int)Math.Clamp(BytesReceived * 100L / TotalBytes, 0, 100);
}

public sealed class UpdateService : IDisposable
{
    public static readonly Uri ProductionReleaseEndpoint = ProductConfiguration.ReleaseEndpoint;
    private const int MaximumMetadataBytes = 64 * 1024;
    private const int DownloadBufferBytes = 128 * 1024;
    private const int MaximumRedirects = 5;
    private static readonly string[] GitHubAssetHosts =
    [
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
    ];
    private readonly HttpClient _http;
    private readonly Uri _releaseEndpoint;
    private readonly Uri _trustedOrigin;
    private readonly bool _usesGitHubReleaseSource;
    private readonly string _downloadDirectory;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    /// <summary>下载期间连续无数据的最长时间；超过即中断本次下载（保留已下载片段以便续传）。</summary>
    internal TimeSpan DownloadIdleTimeout { get; set; } = TimeSpan.FromSeconds(60);

    public UpdateService() : this(ProductionReleaseEndpoint, CreateProductionHandler()) { }

    public UpdateService(HttpMessageHandler handler) : this(ProductionReleaseEndpoint, handler) { }

    public UpdateService(Uri releaseEndpoint, HttpMessageHandler handler, string? downloadDirectory = null)
    {
        _releaseEndpoint = releaseEndpoint ?? throw new ArgumentNullException(nameof(releaseEndpoint));
        _usesGitHubReleaseSource = releaseEndpoint == ProductionReleaseEndpoint;
        _trustedOrigin = new Uri(releaseEndpoint.GetLeftPart(UriPartial.Authority) + "/");
        _downloadDirectory = string.IsNullOrWhiteSpace(downloadDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HomeTunnel", "updates")
            : Path.GetFullPath(downloadDirectory);
        _http = new HttpClient(handler ?? throw new ArgumentNullException(nameof(handler)), disposeHandler: true)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"HomeTunnel-Windows/{AppVersion.Current}");
    }

    public async Task<UpdateCheckResult> CheckAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        using var response = await SendWithTrustedRedirectsAsync(
            _releaseEndpoint,
            RequestKind.Metadata,
            rangeStart: null,
            timeout.Token);
        response.EnsureSuccessStatusCode();

        if (response.Content.Headers.ContentLength is > MaximumMetadataBytes)
            throw new InvalidDataException("更新信息响应过大。");
        var payload = await response.Content.ReadAsByteArrayAsync(timeout.Token);
        if (payload.Length == 0 || payload.Length > MaximumMetadataBytes)
            throw new InvalidDataException("更新信息响应为空或过大。");

        ReleaseMetadata release;
        try
        {
            release = JsonSerializer.Deserialize<ReleaseMetadata>(payload, _json)
                ?? throw new InvalidDataException("更新信息为空。");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("更新信息格式无效。", error);
        }

        ValidateRelease(release);
        var downloadUri = ResolveDownloadUri(release.DownloadUrl, release);

        var comparison = SemanticVersion.Compare(release.Version, AppVersion.Current);
        return new UpdateCheckResult(AppVersion.Current, release, downloadUri, comparison > 0);
    }

    public async Task<string?> FindDownloadedInstallerAsync(
        UpdateCheckResult result,
        CancellationToken cancellationToken)
    {
        ValidateDownloadResult(result);
        var installerPath = InstallerPath(result.Release);
        if (!File.Exists(installerPath)) return null;
        if (await VerifyInstallerAsync(installerPath, result.Release, cancellationToken)) return installerPath;
        File.Delete(installerPath);
        return null;
    }

    public async Task<string> DownloadAsync(
        UpdateCheckResult result,
        IProgress<UpdateDownloadProgress>? progress,
        CancellationToken cancellationToken)
    {
        ValidateDownloadResult(result);
        Directory.CreateDirectory(_downloadDirectory);
        var versionDirectory = Path.Combine(_downloadDirectory, result.Release.Version);
        Directory.CreateDirectory(versionDirectory);
        var installerPath = InstallerPath(result.Release);
        var partialPath = installerPath + ".part";

        var existingInstaller = await FindDownloadedInstallerAsync(result, cancellationToken);
        if (existingInstaller is not null)
        {
            progress?.Report(new UpdateDownloadProgress(result.Release.SizeBytes, result.Release.SizeBytes));
            return existingInstaller;
        }

        var resumeAt = File.Exists(partialPath) ? new FileInfo(partialPath).Length : 0;
        if (resumeAt < 0 || resumeAt >= result.Release.SizeBytes)
        {
            File.Delete(partialPath);
            resumeAt = 0;
        }

        // TCP 半开时读操作可能永远不返回：每次网络等待前重置空闲超时，
        // 让停滞的下载在有限时间内失败并保留 .part 以便续传。
        using var idleTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        idleTimeout.CancelAfter(DownloadIdleTimeout);
        using var response = await SendWithTrustedRedirectsAsync(
            result.DownloadUri,
            RequestKind.Installer,
            resumeAt > 0 ? resumeAt : null,
            idleTimeout.Token);
        ValidateDownloadResponse(response);

        var append = resumeAt > 0 && response.StatusCode == HttpStatusCode.PartialContent;
        if (append)
        {
            var range = response.Content.Headers.ContentRange;
            if (range?.From != resumeAt || (range.Length.HasValue && range.Length.Value != result.Release.SizeBytes))
                throw new InvalidDataException("更新服务器返回了无效的续传范围。");
        }
        else
        {
            resumeAt = 0;
        }

        var expectedRemaining = result.Release.SizeBytes - resumeAt;
        if (response.Content.Headers.ContentLength is { } responseLength && responseLength != expectedRemaining)
            throw new InvalidDataException("更新安装包大小与发布信息不一致。");

        await using (var source = await response.Content.ReadAsStreamAsync(idleTimeout.Token))
        await using (var destination = new FileStream(
            partialPath,
            append ? FileMode.Append : FileMode.Create,
            FileAccess.Write,
            FileShare.Read,
            DownloadBufferBytes,
            FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            var buffer = new byte[DownloadBufferBytes];
            var received = resumeAt;
            progress?.Report(new UpdateDownloadProgress(received, result.Release.SizeBytes));
            while (true)
            {
                idleTimeout.CancelAfter(DownloadIdleTimeout);
                int count;
                try
                {
                    count = await source.ReadAsync(buffer, idleTimeout.Token);
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    throw new TaskCanceledException("更新下载长时间没有收到数据，本次下载已中断；已下载的有效片段会保留。");
                }
                if (count == 0) break;
                received += count;
                if (received > result.Release.SizeBytes)
                    throw new InvalidDataException("更新安装包超过发布信息声明的大小。");
                await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
                progress?.Report(new UpdateDownloadProgress(received, result.Release.SizeBytes));
            }
            await destination.FlushAsync(cancellationToken);
        }

        if (new FileInfo(partialPath).Length != result.Release.SizeBytes)
            throw new InvalidDataException("更新安装包下载不完整，可稍后继续下载。");
        if (!await VerifyInstallerAsync(partialPath, result.Release, cancellationToken))
        {
            File.Delete(partialPath);
            throw new InvalidDataException("更新安装包 SHA-256 校验失败，已删除不可信文件。");
        }

        File.Move(partialPath, installerPath, true);
        progress?.Report(new UpdateDownloadProgress(result.Release.SizeBytes, result.Release.SizeBytes));
        CleanupObsoleteVersions(result.Release.Version);
        return installerPath;
    }

    public static Uri ResolveTrustedDownloadUri(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidDataException("更新下载地址为空。");
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !uri.IsDefaultPort ||
            !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidDataException("更新下载地址不受信任。");

        var path = Uri.UnescapeDataString(uri.AbsolutePath);
        var owner = Regex.Escape(ProductConfiguration.GitHubOwner);
        var repository = Regex.Escape(ProductConfiguration.GitHubRepository);
        const string semanticVersion = "\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?";
        var match = Regex.Match(
            path,
            $"^/{owner}/{repository}/releases/download/v(?<tag>{semanticVersion})/HomeTunnel-Setup-(?<file>{semanticVersion})-x64\\.exe$",
            RegexOptions.CultureInvariant);
        if (!match.Success ||
            !string.Equals(match.Groups["tag"].Value, match.Groups["file"].Value, StringComparison.Ordinal))
            throw new InvalidDataException("更新下载路径无效。");

        return uri;
    }

    private Uri ResolveDownloadUri(string? value, ReleaseMetadata release)
    {
        if (_usesGitHubReleaseSource)
        {
            var uri = ResolveTrustedDownloadUri(value);
            var expectedPath = $"/{ProductConfiguration.GitHubOwner}/{ProductConfiguration.GitHubRepository}" +
                $"/releases/download/v{release.Version}/{release.FileName}";
            if (!string.Equals(Uri.UnescapeDataString(uri.AbsolutePath), expectedPath, StringComparison.Ordinal))
                throw new InvalidDataException("更新文件名、版本与 GitHub 下载地址不一致。");
            return uri;
        }

        return ResolveCustomDownloadUri(value, release.FileName);
    }

    private Uri ResolveCustomDownloadUri(string? value, string expectedFileName)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidDataException("更新下载地址为空。");
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
            uri = new Uri(_trustedOrigin, value);

        var trustedScheme = _trustedOrigin.Scheme == Uri.UriSchemeHttps ||
            (_trustedOrigin.Scheme == Uri.UriSchemeHttp && _trustedOrigin.IsLoopback);
        if (!trustedScheme ||
            !SameOrigin(uri, _trustedOrigin) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            !string.Equals(Uri.UnescapeDataString(uri.AbsolutePath), $"/downloads/{expectedFileName}", StringComparison.Ordinal))
            throw new InvalidDataException("更新下载地址不受信任。");
        return uri;
    }

    private static void ValidateRelease(ReleaseMetadata release)
    {
        if (!SemanticVersion.TryParse(release.Version, out _))
            throw new InvalidDataException("最新版本号无效。");
        if (!string.Equals(release.Platform, "windows", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(release.Architecture, "x64", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("更新包与当前 Windows x64 客户端不匹配。");
        if (!string.Equals(release.FileName, $"HomeTunnel-Setup-{release.Version}-x64.exe", StringComparison.Ordinal) ||
            !string.Equals(Path.GetFileName(release.FileName), release.FileName, StringComparison.Ordinal))
            throw new InvalidDataException("更新文件名无效。");
        if (release.SizeBytes <= 0 || release.SizeBytes > 1024L * 1024 * 1024)
            throw new InvalidDataException("更新文件大小无效。");
        if (string.IsNullOrWhiteSpace(release.Sha256) ||
            !Regex.IsMatch(release.Sha256, "^[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant))
            throw new InvalidDataException("更新文件校验值无效。");
    }

    private static HttpClientHandler CreateProductionHandler() => new()
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.All,
    };

    private void ValidateDownloadResult(UpdateCheckResult result)
    {
        ValidateRelease(result.Release);
        var trusted = ResolveDownloadUri(result.DownloadUri.AbsoluteUri, result.Release);
        if (trusted != result.DownloadUri)
            throw new InvalidDataException("更新下载地址不受信任。");
    }

    private async Task<HttpResponseMessage> SendWithTrustedRedirectsAsync(
        Uri initialUri,
        RequestKind kind,
        long? rangeStart,
        CancellationToken cancellationToken)
    {
        ValidateInitialRequestUri(initialUri, kind);
        var current = initialUri;
        for (var redirectCount = 0; redirectCount <= MaximumRedirects; redirectCount++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, current);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(
                kind == RequestKind.Metadata
                    ? "application/json"
                    : "application/vnd.microsoft.portable-executable"));
            if (kind == RequestKind.Metadata)
                request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true };
            if (rangeStart.HasValue)
                request.Headers.Range = new RangeHeaderValue(rangeStart.Value, null);

            var response = await _http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            if (!IsRedirect(response.StatusCode))
            {
                var actual = response.RequestMessage?.RequestUri;
                if (actual is null || actual != current || !IsTrustedFinalUri(actual, kind))
                {
                    response.Dispose();
                    throw new InvalidDataException("更新来源不受信任。");
                }
                return response;
            }

            var location = response.Headers.Location;
            response.Dispose();
            if (location is null || redirectCount == MaximumRedirects)
                throw new InvalidDataException("GitHub 更新地址返回了无效或过多的重定向。");
            var next = location.IsAbsoluteUri ? location : new Uri(current, location);
            ValidateRedirect(current, next, kind);
            current = next;
        }

        throw new InvalidDataException("GitHub 更新地址返回了过多的重定向。");
    }

    private void ValidateInitialRequestUri(Uri uri, RequestKind kind)
    {
        if (_usesGitHubReleaseSource)
        {
            if (kind == RequestKind.Metadata)
            {
                if (uri != ProductConfiguration.ReleaseEndpoint)
                    throw new InvalidDataException("GitHub 更新清单地址不受信任。");
            }
            else
            {
                _ = ResolveTrustedDownloadUri(uri.AbsoluteUri);
            }
            return;
        }

        if (kind == RequestKind.Metadata)
        {
            if (uri != _releaseEndpoint || !IsTrustedCustomOrigin(uri))
                throw new InvalidDataException("更新清单地址不受信任。");
        }
        else if (!IsTrustedCustomOrigin(uri))
        {
            throw new InvalidDataException("更新下载地址不受信任。");
        }
    }

    private void ValidateRedirect(Uri current, Uri next, RequestKind kind)
    {
        if (_usesGitHubReleaseSource)
        {
            if (!IsCommonSecureUri(next))
                throw new InvalidDataException("GitHub 更新地址发生了不安全的重定向。");

            if (string.Equals(next.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.Equals(current.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
                    !string.IsNullOrEmpty(next.Query) ||
                    (kind == RequestKind.Metadata
                        ? !IsGitHubMetadataUri(next)
                        : next != current))
                    throw new InvalidDataException("GitHub 更新地址发生了不受信任的重定向。");
                return;
            }

            if (!IsGitHubAssetHost(next.Host) ||
                (!string.Equals(current.Host, "github.com", StringComparison.OrdinalIgnoreCase) &&
                 !IsGitHubAssetHost(current.Host)) ||
                next.AbsolutePath.Length <= 1)
                throw new InvalidDataException("GitHub 更新地址发生了不受信任的重定向。");
            return;
        }

        if (!IsTrustedCustomOrigin(next) || !string.IsNullOrEmpty(next.Query) ||
            (kind == RequestKind.Installer && !Uri.UnescapeDataString(next.AbsolutePath).StartsWith("/downloads/", StringComparison.Ordinal)))
            throw new InvalidDataException("更新地址发生了不受信任的重定向。");
    }

    private bool IsTrustedFinalUri(Uri uri, RequestKind kind)
    {
        if (!_usesGitHubReleaseSource) return IsTrustedCustomOrigin(uri);
        if (!IsCommonSecureUri(uri)) return false;
        if (string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            return kind == RequestKind.Metadata ? IsGitHubMetadataUri(uri) : IsGitHubDownloadUri(uri);
        return IsGitHubAssetHost(uri.Host) && uri.AbsolutePath.Length > 1;
    }

    private bool IsTrustedCustomOrigin(Uri uri)
    {
        var trustedScheme = _trustedOrigin.Scheme == Uri.UriSchemeHttps ||
            (_trustedOrigin.Scheme == Uri.UriSchemeHttp && _trustedOrigin.IsLoopback);
        return trustedScheme &&
            SameOrigin(uri, _trustedOrigin) &&
            string.IsNullOrEmpty(uri.UserInfo) &&
            string.IsNullOrEmpty(uri.Fragment);
    }

    private static bool IsGitHubMetadataUri(Uri uri)
    {
        if (!IsCommonSecureUri(uri) ||
            !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(uri.Query)) return false;
        if (uri == ProductConfiguration.ReleaseEndpoint) return true;
        var owner = Regex.Escape(ProductConfiguration.GitHubOwner);
        var repository = Regex.Escape(ProductConfiguration.GitHubRepository);
        return Regex.IsMatch(
            Uri.UnescapeDataString(uri.AbsolutePath),
            $"^/{owner}/{repository}/releases/download/v\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?/latest\\.json$",
            RegexOptions.CultureInvariant);
    }

    private static bool IsGitHubDownloadUri(Uri uri)
    {
        try
        {
            _ = ResolveTrustedDownloadUri(uri.AbsoluteUri);
            return true;
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }

    private static bool IsCommonSecureUri(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttps &&
        uri.IsDefaultPort &&
        string.IsNullOrEmpty(uri.UserInfo) &&
        string.IsNullOrEmpty(uri.Fragment);

    private static bool IsGitHubAssetHost(string host) =>
        GitHubAssetHosts.Contains(host, StringComparer.OrdinalIgnoreCase);

    private static bool SameOrigin(Uri left, Uri right) =>
        string.Equals(left.Scheme, right.Scheme, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase) &&
        left.Port == right.Port;

    private static bool IsRedirect(HttpStatusCode statusCode) =>
        statusCode is HttpStatusCode.MovedPermanently or
            HttpStatusCode.Found or
            HttpStatusCode.SeeOther or
            HttpStatusCode.TemporaryRedirect or
            HttpStatusCode.PermanentRedirect;

    private static void ValidateDownloadResponse(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.PartialContent))
            throw new InvalidDataException("更新服务器不支持安全下载。");
    }

    private enum RequestKind
    {
        Metadata,
        Installer,
    }

    private string InstallerPath(ReleaseMetadata release) =>
        Path.Combine(_downloadDirectory, release.Version, release.FileName);

    private static async Task<bool> VerifyInstallerAsync(
        string path,
        ReleaseMetadata release,
        CancellationToken cancellationToken)
    {
        var info = new FileInfo(path);
        if (!info.Exists || info.Length != release.SizeBytes) return false;
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            DownloadBufferBytes,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return string.Equals(Convert.ToHexString(hash), release.Sha256, StringComparison.OrdinalIgnoreCase);
    }

    private void CleanupObsoleteVersions(string currentVersion)
    {
        foreach (var directory in Directory.EnumerateDirectories(_downloadDirectory))
        {
            if (string.Equals(Path.GetFileName(directory), currentVersion, StringComparison.Ordinal)) continue;
            try { Directory.Delete(directory, true); } catch { }
        }
    }

    public void Dispose() => _http.Dispose();
}
