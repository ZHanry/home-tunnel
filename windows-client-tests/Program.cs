using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using HomeTunnel.Client;
using HomeTunnel.Client.Models;
using HomeTunnel.Client.Services;

namespace HomeTunnel.Client.Tests;

internal static class Program
{
    private static int _assertions;

    private static async Task<int> Main()
    {
        try
        {
            TestSemanticVersions();
            TestApiUtcTimestamp();
            TestServerAddressValidation();
            await TestServerDiscoveryAsync();
            TestOptimizedSynchronization();
            TestTrustedDownloadUrls();
            await TestReleaseValidationAsync();
            await TestGitHubRedirectPolicyAsync();
            await TestVerifiedBackgroundDownloadAsync();
            if (string.Equals(Environment.GetEnvironmentVariable("HOME_TUNNEL_SKIP_AGENT_TESTS"), "1", StringComparison.Ordinal))
                Console.WriteLine("SKIP: managed Agent binary integration checks");
            else
                await TestManagedAgentAsync();
            Console.WriteLine($"PASS: {_assertions} update checks");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"FAIL: {error.Message}");
            return 1;
        }
    }

    private static void TestSemanticVersions()
    {
        Assert(AppVersion.Current == "2.2.4", "client version must be 2.2.4");
        Assert(
            typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion == AppVersion.Current,
            "public client version metadata does not expose a local source revision");
        Assert(SemanticVersion.Compare("2.0.1", "2.0.0") > 0, "patch update comparison");
        Assert(SemanticVersion.Compare("2.1.0", "2.0.99") > 0, "minor update comparison");
        Assert(SemanticVersion.Compare("3.0.0", "2.99.99") > 0, "major update comparison");
        Assert(SemanticVersion.Compare("2.0.1-rc.1", "2.0.1") < 0, "prerelease precedence");
        Assert(SemanticVersion.Compare("2.0.1-beta.10", "2.0.1-beta.2") > 0, "numeric prerelease comparison");
        Assert(SemanticVersion.Compare("2.0.1+build.7", "2.0.1+build.9") == 0, "build metadata ignored");
        Assert(!SemanticVersion.TryParse("2.00.1", out _), "leading zero rejected");
        Assert(!SemanticVersion.TryParse("2.0", out _), "incomplete version rejected");
    }

    private static void TestApiUtcTimestamp()
    {
        var source = new DateTimeOffset(2026, 8, 10, 8, 30, 15, TimeSpan.FromHours(8));
        var formatted = ApiClient.FormatUtcTimestamp(source);
        Assert(formatted == "2026-08-10T00:30:15.0000000Z", "API UTC timestamp uses the server-accepted Z suffix");
        Assert(!formatted.Contains('+', StringComparison.Ordinal), "API UTC timestamp does not use an offset suffix");
    }

    private static void TestServerAddressValidation()
    {
        var normalized = ServerProfile.NormalizeAddress("console.tunnel.example.com");
        Assert(normalized.AbsoluteUri == "https://console.tunnel.example.com/", "server address defaults to HTTPS");
        AssertThrows<InvalidDataException>(
            () => ServerProfile.NormalizeAddress("http://console.tunnel.example.com"),
            "plain HTTP server address rejected");
        AssertThrows<InvalidDataException>(
            () => ServerProfile.NormalizeAddress("https://user@console.tunnel.example.com"),
            "server address user information rejected");
        AssertThrows<InvalidDataException>(
            () => ServerProfile.NormalizeAddress("https://console.tunnel.example.com/subpath"),
            "server subpath rejected");
    }

    private static async Task TestServerDiscoveryAsync()
    {
        var payload = JsonSerializer.Serialize(new
        {
            public_base_url = "https://console.tunnel.example.com",
            tunnel_domain = ProductConfiguration.TunnelDomain,
            frps_host = ProductConfiguration.FrpsHost,
            frps_port = ProductConfiguration.FrpsPort,
        });
        var profile = await ServerProfile.DiscoverAsync(
            "console.tunnel.example.com",
            CancellationToken.None,
            new StaticJsonHandler(payload));
        Assert(profile.ApiBaseUri.AbsoluteUri == "https://console.tunnel.example.com/api/v1/", "API address derived from selected server");
        Assert(profile.FrpsHost == ProductConfiguration.FrpsHost, "FRPS host discovered from selected server");
        Assert(profile.TunnelDomain == ProductConfiguration.TunnelDomain, "tunnel domain discovered from selected server");

        var mismatch = JsonSerializer.Serialize(new
        {
            public_base_url = "https://other.example.com",
            tunnel_domain = ProductConfiguration.TunnelDomain,
            frps_host = ProductConfiguration.FrpsHost,
            frps_port = ProductConfiguration.FrpsPort,
        });
        await AssertThrowsAsync<InvalidDataException>(
            () => ServerProfile.DiscoverAsync(
                "console.tunnel.example.com",
                CancellationToken.None,
                new StaticJsonHandler(mismatch)),
            "cross-origin server discovery rejected");
    }

    private static void TestOptimizedSynchronization()
    {
        var now = new DateTimeOffset(2026, 8, 10, 0, 0, 0, TimeSpan.Zero);
        Assert(MainWindow.ShouldRequestLease("Offline", now.AddHours(12), now), "offline Agent requests a usable lease");
        Assert(MainWindow.ShouldRequestLease("Online", now.AddMinutes(10), now), "near-expiry lease is renewed");
        Assert(!MainWindow.ShouldRequestLease("Online", now.AddHours(12), now), "healthy long-lived lease is reused");

        var unchanged = JsonSerializer.Deserialize<SyncResponse>("""
            {
              "device_id":"11111111-1111-1111-1111-111111111111",
              "full_sync":false,
              "target_config_version":4,
              "connections":[],
              "content_hash":"abc",
              "lease":null,
              "server_time":"2026-08-10T00:00:00Z"
            }
            """, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert(unchanged is not null, "unchanged sync response is parsed");
        Assert(unchanged!.Lease is null && unchanged.FullSync == false, "unchanged sync accepts an omitted replacement lease");

        const string deviceId = "11111111-1111-1111-1111-111111111111";
        Assert(ApiClient.IsConfigurationChangeEvent(
            JsonSerializer.Serialize(new { @event = "config.version.changed", payload = new { device_id = deviceId } }), deviceId),
            "matching realtime configuration event triggers synchronization");
        Assert(!ApiClient.IsConfigurationChangeEvent(
            """{"event":"config.version.changed","payload":{"device_id":"22222222-2222-2222-2222-222222222222"}}""", deviceId),
            "another device's realtime event is ignored");
        Assert(!ApiClient.IsConfigurationChangeEvent(
            """{"event":"realtime.connected","payload":{}}""", deviceId),
            "realtime handshake does not trigger synchronization");
    }

    private static void TestTrustedDownloadUrls()
    {
        var trustedInstaller = GitHubDownloadUri("2.2.4");
        var absolute = UpdateService.ResolveTrustedDownloadUri(trustedInstaller.AbsoluteUri);
        Assert(absolute == trustedInstaller, "versioned GitHub release URL accepted");

        var malicious = new[]
        {
            "http://github.com/ZHanry/home-tunnel/releases/download/v2.2.4/HomeTunnel-Setup-2.2.4-x64.exe",
            "https://evil.example/ZHanry/home-tunnel/releases/download/v2.2.4/HomeTunnel-Setup-2.2.4-x64.exe",
            "https://github.com@evil.example/ZHanry/home-tunnel/releases/download/v2.2.4/HomeTunnel-Setup-2.2.4-x64.exe",
            "https://github.com/ZHanry/home-tunnel/releases/download/v2.2.4/HomeTunnel-Setup-2.2.4-x64.exe?redirect=evil",
            "https://github.com/another/repository/releases/download/v2.2.4/HomeTunnel-Setup-2.2.4-x64.exe",
            "https://github.com/ZHanry/home-tunnel/releases/latest/download/HomeTunnel-Setup-2.2.4-x64.exe",
            "https://github.com/ZHanry/home-tunnel/releases/download/v2.2.5/HomeTunnel-Setup-2.2.4-x64.exe",
            "https://github.com/ZHanry/home-tunnel/releases/download/v2.2.4/sub/HomeTunnel-Setup-2.2.4-x64.exe",
            "/downloads/HomeTunnel-Setup-2.2.4-x64.exe",
        };
        foreach (var value in malicious)
        {
            AssertThrows<InvalidDataException>(() => UpdateService.ResolveTrustedDownloadUri(value), $"malicious URL rejected: {value}");
        }
    }

    private static async Task TestReleaseValidationAsync()
    {
        var validPayload = ReleasePayload("2.2.5", GitHubDownloadUri("2.2.5").AbsoluteUri);
        using (var service = new UpdateService(new StaticJsonHandler(validPayload)))
        {
            var result = await service.CheckAsync(CancellationToken.None);
            Assert(result.IsUpdateAvailable, "newer release detected");
            Assert(result.Release.Version == "2.2.5", "release metadata parsed");
        }

        var maliciousPayload = ReleasePayload("2.2.5", "https://evil.example/downloads/HomeTunnel-Setup-2.2.5-x64.exe");
        using var maliciousService = new UpdateService(new StaticJsonHandler(maliciousPayload));
        await AssertThrowsAsync<InvalidDataException>(
            () => maliciousService.CheckAsync(CancellationToken.None),
            "malicious release URL rejected during check");
    }

    private static async Task TestVerifiedBackgroundDownloadAsync()
    {
        var bytes = Enumerable.Range(0, 260_123).Select(index => (byte)(index * 31 % 251)).ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var payload = ReleasePayload(
            "2.2.5",
            GitHubDownloadUri("2.2.5").AbsoluteUri,
            bytes.Length,
            hash);
        var root = Path.Combine(Path.GetTempPath(), $"HomeTunnel-UpdateService-Test-{Guid.NewGuid():N}");
        try
        {
            var versionDirectory = Path.Combine(root, "2.2.5");
            Directory.CreateDirectory(versionDirectory);
            var partial = Path.Combine(versionDirectory, "HomeTunnel-Setup-2.2.5-x64.exe.part");
            await File.WriteAllBytesAsync(partial, bytes[..8192]);

            var handler = new UpdateHandler(payload, bytes);
            using var service = new UpdateService(UpdateService.ProductionReleaseEndpoint, handler, root);
            var result = await service.CheckAsync(CancellationToken.None);
            var lastPercentage = 0;
            var installer = await service.DownloadAsync(
                result,
                new InlineProgress<UpdateDownloadProgress>(value => lastPercentage = value.Percentage),
                CancellationToken.None);

            Assert(handler.DownloadRequests == 1, "installer downloaded exactly once");
            Assert(handler.RangeRequests == 1, "partial installer resumed with an HTTP range");
            Assert(lastPercentage == 100, "download progress reaches 100 percent");
            Assert(File.Exists(installer), "verified installer moved to final path");
            Assert(new FileInfo(installer).Length == bytes.Length, "downloaded installer size verified");
            Assert(
                string.Equals(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(installer))), hash, StringComparison.OrdinalIgnoreCase),
                "downloaded installer SHA-256 verified");

            var cached = await service.DownloadAsync(result, null, CancellationToken.None);
            Assert(cached == installer, "verified installer reused from local cache");
            Assert(handler.DownloadRequests == 1, "cached installer avoids another network download");

            await File.WriteAllBytesAsync(installer, [1, 2, 3]);
            Assert(await service.FindDownloadedInstallerAsync(result, CancellationToken.None) is null, "tampered cached installer rejected");
            Assert(!File.Exists(installer), "tampered cached installer removed");

            var badPayload = ReleasePayload(
                "2.2.5",
                GitHubDownloadUri("2.2.5").AbsoluteUri,
                bytes.Length,
                new string('0', 64));
            using var badService = new UpdateService(
                UpdateService.ProductionReleaseEndpoint,
                new UpdateHandler(badPayload, bytes),
                Path.Combine(root, "bad"));
            var badResult = await badService.CheckAsync(CancellationToken.None);
            await AssertThrowsAsync<InvalidDataException>(
                () => badService.DownloadAsync(badResult, null, CancellationToken.None),
                "download with mismatched SHA-256 rejected");
            Assert(
                !Directory.EnumerateFiles(Path.Combine(root, "bad"), "*.part", SearchOption.AllDirectories).Any(),
                "untrusted partial installer removed after hash failure");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static async Task TestGitHubRedirectPolicyAsync()
    {
        var bytes = Enumerable.Range(0, 32_777).Select(index => (byte)(index * 17 % 251)).ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var payload = ReleasePayload("2.2.5", GitHubDownloadUri("2.2.5").AbsoluteUri, bytes.Length, hash);
        var root = Path.Combine(Path.GetTempPath(), $"HomeTunnel-GitHub-Redirect-Test-{Guid.NewGuid():N}");
        try
        {
            var handler = new GitHubRedirectHandler(payload, bytes);
            using var service = new UpdateService(UpdateService.ProductionReleaseEndpoint, handler, root);
            var result = await service.CheckAsync(CancellationToken.None);
            var installer = await service.DownloadAsync(result, null, CancellationToken.None);
            Assert(handler.MetadataRedirects == 2, "GitHub latest metadata redirects followed explicitly");
            Assert(handler.InstallerRedirects == 1, "GitHub installer redirect followed explicitly");
            Assert(await File.ReadAllBytesAsync(installer) is { } downloaded && downloaded.SequenceEqual(bytes),
                "installer delivered by the trusted GitHub asset host is accepted");

            using var maliciousService = new UpdateService(new RedirectHandler("https://evil.example/latest.json"));
            await AssertThrowsAsync<InvalidDataException>(
                () => maliciousService.CheckAsync(CancellationToken.None),
                "metadata redirect outside GitHub asset hosts is rejected");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static async Task TestManagedAgentAsync()
    {
        var agent = Path.Combine(AppContext.BaseDirectory, FrpcSupervisor.BinaryFileName);
        Assert(File.Exists(agent), "managed Agent is copied to the client output");
        var actualHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(agent))).ToLowerInvariant();
        Assert(actualHash == FrpcSupervisor.ExpectedSha256, "managed Agent matches the hash embedded in the client");
        Assert(FrpcSupervisor.InspectInstalledAgent().Status == "Valid", "managed Agent integrity inspection succeeds");

        var root = Path.Combine(Path.GetTempPath(), $"HomeTunnel-Agent-Test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var validConfig = Path.Combine(root, "managed.toml");
            await File.WriteAllTextAsync(validConfig, $$"""
                serverAddr = "{{ProductConfiguration.FrpsHost}}"
                serverPort = {{ProductConfiguration.FrpsPort}}
                user = "test-device"
                loginFailExit = true
                transport.tls.enable = true
                transport.tls.disableCustomTLSFirstByte = true
                transport.heartbeatInterval = 30
                transport.heartbeatTimeout = 90
                metadatas.home_tunnel_lease = "test-only-lease"
                log.to = "console"
                log.level = "info"

                [[proxies]]
                name = "ht_test_v1"
                type = "http"
                customDomains = ["agent-test.{{ProductConfiguration.TunnelDomain}}"]
                transport.useEncryption = true
                transport.useCompression = true
                healthCheck.type = "tcp"
                healthCheck.timeoutSeconds = 3
                healthCheck.intervalSeconds = 10
                localIP = "127.0.0.1"
                localPort = 5088
                """);
            var trustArguments = new[]
            {
                "--server", ProductConfiguration.FrpsHost,
                "--port", ProductConfiguration.FrpsPort.ToString(),
                "--domain", ProductConfiguration.TunnelDomain,
            };
            var valid = await RunAgentAsync(agent, ["verify", "--config", validConfig, .. trustArguments]);
            Assert(valid.ExitCode == 0 && valid.Output.Contains("配置有效", StringComparison.Ordinal), "managed Home Tunnel config is accepted");

            var invalidConfig = Path.Combine(root, "generic.toml");
            await File.WriteAllTextAsync(invalidConfig, (await File.ReadAllTextAsync(validConfig)).Replace(
                "type = \"http\"",
                "type = \"tcp\"\nremotePort = 65000",
                StringComparison.Ordinal));
            var invalid = await RunAgentAsync(agent, ["verify", "--config", invalidConfig, .. trustArguments]);
            Assert(invalid.ExitCode != 0, "generic TCP proxy configuration is rejected");

            var mismatchedServer = await RunAgentAsync(agent,
                ["verify", "--config", validConfig, "--server", "frps.other.example", "--port", "7000", "--domain", ProductConfiguration.TunnelDomain]);
            Assert(mismatchedServer.ExitCode != 0, "config that differs from the user-selected server is rejected");

            var genericCli = await RunAgentAsync(agent, "tcp", "--server", "evil.example");
            Assert(genericCli.ExitCode != 0, "generic FRPC command line is rejected");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static async Task<(int ExitCode, string Output)> RunAgentAsync(string agent, params string[] arguments)
    {
        var start = new System.Diagnostics.ProcessStartInfo(agent)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("managed Agent process did not start");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15));
        return (process.ExitCode, (await stdout) + (await stderr));
    }

    private static string ReleasePayload(
        string version,
        string downloadUrl,
        long sizeBytes = 58_000_000,
        string? sha256 = null) => JsonSerializer.Serialize(new
    {
        version,
        platform = "windows",
        architecture = "x64",
        file_name = $"HomeTunnel-Setup-{version}-x64.exe",
        size_bytes = sizeBytes,
        sha256 = sha256 ?? new string('a', 64),
        released_at = "2026-08-09T05:00:00Z",
        download_url = downloadUrl,
        stable_download_url = $"https://github.com/{ProductConfiguration.GitHubOwner}/{ProductConfiguration.GitHubRepository}/releases/latest",
    });

    private static Uri GitHubDownloadUri(string version) => new(
        ProductConfiguration.ReleaseDownloadRoot,
        $"v{version}/HomeTunnel-Setup-{version}-x64.exe");

    private static void Assert(bool condition, string message)
    {
        _assertions++;
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void AssertThrows<T>(Action action, string message) where T : Exception
    {
        _assertions++;
        try { action(); }
        catch (T) { return; }
        throw new InvalidOperationException(message);
    }

    private static async Task AssertThrowsAsync<T>(Func<Task> action, string message) where T : Exception
    {
        _assertions++;
        try { await action(); }
        catch (T) { return; }
        throw new InvalidOperationException(message);
    }

    private sealed class StaticJsonHandler(string payload) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
                RequestMessage = request,
            });
    }

    private sealed class InlineProgress<T>(Action<T> report) : IProgress<T>
    {
        public void Report(T value) => report(value);
    }

    private sealed class RedirectHandler(string location) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.Found) { RequestMessage = request };
            response.Headers.Location = new Uri(location);
            return Task.FromResult(response);
        }
    }

    private sealed class GitHubRedirectHandler(string metadata, byte[] installer) : HttpMessageHandler
    {
        public int MetadataRedirects { get; private set; }
        public int InstallerRedirects { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var uri = request.RequestUri ?? throw new InvalidOperationException("request URI is missing");
            if (uri.Host == "github.com" && uri.AbsolutePath.EndsWith("/releases/latest/download/latest.json", StringComparison.Ordinal))
            {
                MetadataRedirects++;
                return Task.FromResult(Redirect(
                    request,
                    "https://github.com/ZHanry/home-tunnel/releases/download/v2.2.5/latest.json"));
            }
            if (uri.Host == "github.com" && uri.AbsolutePath.EndsWith("/latest.json", StringComparison.Ordinal))
            {
                MetadataRedirects++;
                return Task.FromResult(Redirect(
                    request,
                    "https://release-assets.githubusercontent.com/github-metadata/latest.json?token=test-only"));
            }
            if (uri.Host == "release-assets.githubusercontent.com" && uri.AbsolutePath == "/github-metadata/latest.json")
                return Task.FromResult(Ok(request, new StringContent(metadata, Encoding.UTF8, "application/json")));
            if (uri.Host == "github.com" && uri.AbsolutePath.EndsWith("HomeTunnel-Setup-2.2.5-x64.exe", StringComparison.Ordinal))
            {
                InstallerRedirects++;
                return Task.FromResult(Redirect(
                    request,
                    "https://release-assets.githubusercontent.com/github-installer/HomeTunnel.exe?token=test-only"));
            }
            if (uri.Host == "release-assets.githubusercontent.com" && uri.AbsolutePath == "/github-installer/HomeTunnel.exe")
                return Task.FromResult(Ok(request, new ByteArrayContent(installer)));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound) { RequestMessage = request });
        }

        private static HttpResponseMessage Redirect(HttpRequestMessage request, string location)
        {
            var response = new HttpResponseMessage(HttpStatusCode.Found) { RequestMessage = request };
            response.Headers.Location = new Uri(location);
            return response;
        }

        private static HttpResponseMessage Ok(HttpRequestMessage request, HttpContent content) => new(HttpStatusCode.OK)
        {
            RequestMessage = request,
            Content = content,
        };
    }

    private sealed class UpdateHandler(string metadata, byte[] installer) : HttpMessageHandler
    {
        public int DownloadRequests { get; private set; }
        public int RangeRequests { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.AbsolutePath.EndsWith("latest.json", StringComparison.Ordinal) == true)
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(metadata, Encoding.UTF8, "application/json"),
                    RequestMessage = request,
                });
            }

            DownloadRequests++;
            var start = request.Headers.Range?.Ranges.Single().From ?? 0;
            if (start > 0) RangeRequests++;
            var content = new ByteArrayContent(installer[(int)start..]);
            var response = new HttpResponseMessage(start > 0 ? HttpStatusCode.PartialContent : HttpStatusCode.OK)
            {
                Content = content,
                RequestMessage = request,
            };
            if (start > 0)
                response.Content.Headers.ContentRange = new ContentRangeHeaderValue(start, installer.LongLength - 1, installer.LongLength);
            return Task.FromResult(response);
        }
    }
}
