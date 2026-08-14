using System.IO;
using System.Globalization;
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
using Xunit;

namespace HomeTunnel.Client.Tests;

public sealed class ClientBehaviorTests
{
	private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

	[Fact]
	public void TestSemanticVersions()
	{
		Assert.True(AppVersion.Current == "2.5.0", "client version must be 2.5.0");
		Assert.True(
			typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion == AppVersion.Current,
			"public client version metadata does not expose a local source revision");
		Assert.True(SemanticVersion.Compare("2.0.1", "2.0.0") > 0, "patch update comparison");
		Assert.True(SemanticVersion.Compare("2.1.0", "2.0.99") > 0, "minor update comparison");
		Assert.True(SemanticVersion.Compare("3.0.0", "2.99.99") > 0, "major update comparison");
		Assert.True(SemanticVersion.Compare("2.0.1-rc.1", "2.0.1") < 0, "prerelease precedence");
		Assert.True(SemanticVersion.Compare("2.0.1-beta.10", "2.0.1-beta.2") > 0, "numeric prerelease comparison");
		Assert.True(SemanticVersion.Compare("2.0.1+build.7", "2.0.1+build.9") == 0, "build metadata ignored");
		Assert.True(!SemanticVersion.TryParse("2.00.1", out _), "leading zero rejected");
		Assert.True(!SemanticVersion.TryParse("2.0", out _), "incomplete version rejected");
	}

	[Fact]
	public void TestApiUtcTimestamp()
	{
		var source = new DateTimeOffset(2026, 8, 10, 8, 30, 15, TimeSpan.FromHours(8));
		var formatted = ApiClient.FormatUtcTimestamp(source);
		Assert.True(formatted == "2026-08-10T00:30:15.0000000Z", "API UTC timestamp uses the server-accepted Z suffix");
		Assert.True(!formatted.Contains('+', StringComparison.Ordinal), "API UTC timestamp does not use an offset suffix");
	}

	[Fact]
	public void TestServerAddressValidation()
	{
		var normalized = ServerProfile.NormalizeAddress("console.tunnel.example.com");
		Assert.True(normalized.AbsoluteUri == "https://console.tunnel.example.com/", "server address defaults to HTTPS");
		TestAssert.Throws<InvalidDataException>(
			() => ServerProfile.NormalizeAddress("http://console.tunnel.example.com"),
			"plain HTTP server address rejected");
		TestAssert.Throws<InvalidDataException>(
			() => ServerProfile.NormalizeAddress("https://user@console.tunnel.example.com"),
			"server address user information rejected");
		TestAssert.Throws<InvalidDataException>(
			() => ServerProfile.NormalizeAddress("https://console.tunnel.example.com/subpath"),
			"server subpath rejected");
	}

	[Fact]
	public async Task TestServerDiscoveryAsync()
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
		Assert.True(profile.ApiBaseUri.AbsoluteUri == "https://console.tunnel.example.com/api/v1/", "API address derived from selected server");
		Assert.True(profile.FrpsHost == ProductConfiguration.FrpsHost, "FRPS host discovered from selected server");
		Assert.True(profile.TunnelDomain == ProductConfiguration.TunnelDomain, "tunnel domain discovered from selected server");

		var mismatch = JsonSerializer.Serialize(new
		{
			public_base_url = "https://other.example.com",
			tunnel_domain = ProductConfiguration.TunnelDomain,
			frps_host = ProductConfiguration.FrpsHost,
			frps_port = ProductConfiguration.FrpsPort,
		});
		await TestAssert.ThrowsAsync<InvalidDataException>(
			() => ServerProfile.DiscoverAsync(
				"console.tunnel.example.com",
				CancellationToken.None,
				new StaticJsonHandler(mismatch)),
			"cross-origin server discovery rejected");
	}

	[Fact]
	public void TestOptimizedSynchronization()
	{
		var now = new DateTimeOffset(2026, 8, 10, 0, 0, 0, TimeSpan.Zero);
		Assert.True(MainWindow.ShouldRequestLease("Offline", now.AddHours(12), now), "offline Agent requests a usable lease");
		Assert.True(MainWindow.ShouldRequestLease("Online", now.AddMinutes(10), now), "near-expiry lease is renewed");
		Assert.True(!MainWindow.ShouldRequestLease("Online", now.AddHours(12), now), "healthy long-lived lease is reused");

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
            """, WebJson);
		Assert.True(unchanged is not null, "unchanged sync response is parsed");
		Assert.True(unchanged!.Lease is null && unchanged.FullSync == false, "unchanged sync accepts an omitted replacement lease");

		const string deviceId = "11111111-1111-1111-1111-111111111111";
		Assert.True(ApiClient.IsConfigurationChangeEvent(
			JsonSerializer.Serialize(new { @event = "config.version.changed", payload = new { device_id = deviceId } }), deviceId),
			"matching realtime configuration event triggers synchronization");
		Assert.True(!ApiClient.IsConfigurationChangeEvent(
			"""{"event":"config.version.changed","payload":{"device_id":"22222222-2222-2222-2222-222222222222"}}""", deviceId),
			"another device's realtime event is ignored");
		Assert.True(!ApiClient.IsConfigurationChangeEvent(
			"""{"event":"realtime.connected","payload":{}}""", deviceId),
			"realtime handshake does not trigger synchronization");
	}

	[Fact]
	public void TestCoordinatorPolicies()
	{
		var now = new DateTimeOffset(2026, 8, 13, 0, 0, 0, TimeSpan.Zero);
		Assert.Equal(TimeSpan.FromSeconds(2), RealtimeSyncCoordinator.NextRetryDelay(TimeSpan.FromSeconds(1)));
		Assert.Equal(TimeSpan.FromSeconds(30), RealtimeSyncCoordinator.NextRetryDelay(TimeSpan.FromSeconds(20)));
		Assert.Equal(TimeSpan.FromSeconds(30), RealtimeSyncCoordinator.NextRetryDelay(TimeSpan.FromSeconds(30)));
		Assert.True(
			RealtimeSyncCoordinator.IsTerminalRevocation(new ApiException(401, "HTTP_ERROR", "revoked")),
			"HTTP 401 permanently stops realtime reconnects");
		Assert.True(
			RealtimeSyncCoordinator.IsTerminalRevocation(new ApiException(403, "DEVICE_REVOKED", "revoked")),
			"explicit device revocation permanently stops realtime reconnects");
		Assert.False(
			RealtimeSyncCoordinator.IsTerminalRevocation(new ApiException(503, "HTTP_ERROR", "temporary")),
			"temporary failures remain reconnectable");
		Assert.False(
			AgentCoordinator.ShouldRequestLease("Online", now.AddMinutes(16), now),
			"a healthy lease outside the renewal window is reused");
		Assert.True(
			AgentCoordinator.ShouldRequestLease("Online", now.AddMinutes(15), now),
			"a lease at the renewal boundary is refreshed");
	}

	[Fact]
	public void TestUpdatePromptSuppressionPolicy()
	{
		var now = new DateTimeOffset(2026, 8, 13, 12, 0, 0, TimeSpan.Zero);
		Assert.True(
			UpdateCoordinator.IsPromptSuppressed("2.5.0", "2.5.0", now.AddHours(-23), now),
			"the same release remains suppressed during the 24-hour quiet period");
		Assert.False(
			UpdateCoordinator.IsPromptSuppressed("2.5.0", "2.5.0", now.AddHours(-24), now),
			"the prompt becomes eligible at the 24-hour boundary");
		Assert.False(
			UpdateCoordinator.IsPromptSuppressed("2.5.1", "2.5.0", now.AddHours(-1), now),
			"a newer version is never hidden by a prior dismissal");
	}

	[Fact]
	public void TestManagedConfigRendering()
	{
		var state = new LocalState
		{
			FrpsHost = ProductConfiguration.FrpsHost,
			FrpsPort = ProductConfiguration.FrpsPort,
			TunnelDomain = ProductConfiguration.TunnelDomain,
		};
		var sync = new SyncResponse(
			"11111111-1111-1111-1111-111111111111",
			true,
			3,
			[
				new TunnelConnection { Id = "1111-2222", Subdomain = "app", CustomDomains = ["home.example.net"], LocalScheme = "http", LocalHost = "127.0.0.1", LocalPort = 8080, Enabled = true, Version = 3 },
				new TunnelConnection { Id = "tcp-3333", Subdomain = "ssh", ProxyType = "tcp", TcpRemotePort = 10001, LocalHost = "127.0.0.1", LocalPort = 22, Enabled = true, Version = 4 },
			],
			"hash",
			new LeaseInfo("signed-lease", DateTimeOffset.UtcNow.AddHours(1), 3),
			DateTimeOffset.UtcNow);

		var withoutCa = FrpcSupervisor.RenderConfig(state, sync, null);
		Assert.True(!withoutCa.Contains("trustedCaFile", StringComparison.Ordinal), "config without CA omits trustedCaFile");
		Assert.True(!withoutCa.Contains("serverName", StringComparison.Ordinal), "config without CA omits serverName");
		Assert.True(withoutCa.Contains($"serverAddr = \"{ProductConfiguration.FrpsHost}\"", StringComparison.Ordinal), "config keeps the discovered FRPS host");
		Assert.True(withoutCa.Contains($"customDomains = [\"app.{ProductConfiguration.TunnelDomain}\", \"home.example.net\"]", StringComparison.Ordinal), "config renders the managed and verified custom domains");
		Assert.True(withoutCa.Contains("type = \"tcp\"", StringComparison.Ordinal) && withoutCa.Contains("remotePort = 10001", StringComparison.Ordinal), "config renders an administrator-authorized TCP proxy");

		var caPath = @"C:\Users\test user\HomeTunnel\runtime\frps-ca.pem";
		var withCa = FrpcSupervisor.RenderConfig(state, sync, caPath);
		Assert.True(
			withCa.Contains($"transport.tls.trustedCaFile = \"{caPath.Replace("\\", "\\\\")}\"", StringComparison.Ordinal),
			"config with CA pins the TOML-escaped trusted CA path");
		Assert.True(
			withCa.Contains($"transport.tls.serverName = \"{ProductConfiguration.FrpsHost}\"", StringComparison.Ordinal),
			"config with CA pins the FRPS server name");
		Assert.True(
			withCa.IndexOf("transport.tls.trustedCaFile", StringComparison.Ordinal) <
				withCa.IndexOf("transport.heartbeatInterval", StringComparison.Ordinal),
			"CA pinning lines are rendered in the common transport section");
	}

	[Fact]
	public void TestAgentProxyLogParsing()
	{
		Assert.True(
			FrpcSupervisor.TryParseProxyStartEvent(
				"2026-08-12 17:00:00.123 [I] [control.go:172] [abcd1234] [device-1.ht_conn_v3] start proxy success",
				out var successName,
				out var success) && success && successName == "device-1.ht_conn_v3",
			"FRP proxy start success log line is parsed");
		Assert.True(
			FrpcSupervisor.TryParseProxyStartEvent(
				"2026-08-12 17:00:01.456 [W] [control.go:170] [abcd1234] [device-1.ht_conn_v3] start error: port already used",
				out var errorName,
				out var errorSuccess) && !errorSuccess && errorName == "device-1.ht_conn_v3",
			"FRP proxy start error log line is parsed");
		Assert.True(
			!FrpcSupervisor.TryParseProxyStartEvent(
				"2026-08-12 17:00:00.001 [I] [service.go:306] login to server success, get run id [abcd1234]",
				out _,
				out _),
			"unrelated FRP log line is ignored");
		Assert.True(
			!FrpcSupervisor.TryParseProxyStartEvent("", out _, out _),
			"empty log line is ignored");

		var generated = new TunnelConnection { Id = "1111-2222", Version = 7, ProxyName = null };
		Assert.True(FrpcSupervisor.ProxyNameFor(generated) == "ht_11112222_v7", "generated proxy name matches rendered config");
		var explicitName = new TunnelConnection { Id = "1111-2222", Version = 7, ProxyName = "custom_name" };
		Assert.True(FrpcSupervisor.ProxyNameFor(explicitName) == "custom_name", "explicit proxy name is preserved");
	}

	[Fact]
	public async Task TestDownloadIdleTimeoutAsync()
	{
		var payload = ReleasePayload("2.4.1", GitHubDownloadUri("2.4.1").AbsoluteUri, 1_000_000, new string('a', 64));
		var root = Path.Combine(Path.GetTempPath(), $"HomeTunnel-IdleTimeout-Test-{Guid.NewGuid():N}");
		try
		{
			using var service = new UpdateService(
				UpdateService.ProductionReleaseEndpoint,
				new StallingDownloadHandler(payload, 1_000_000),
				root)
			{
				DownloadIdleTimeout = TimeSpan.FromMilliseconds(400),
			};
			var result = await service.CheckAsync(CancellationToken.None);
			var watch = System.Diagnostics.Stopwatch.StartNew();
			await TestAssert.ThrowsAsync<TaskCanceledException>(
				() => service.DownloadAsync(result, null, CancellationToken.None),
				"stalled installer download aborts after the idle timeout");
			Assert.True(watch.Elapsed < TimeSpan.FromSeconds(15), "idle timeout aborts the stalled download promptly");
		}
		finally
		{
			if (Directory.Exists(root)) Directory.Delete(root, true);
		}
	}

	[Fact]
	public void TestTrustedDownloadUrls()
	{
		var trustedInstaller = GitHubDownloadUri("2.2.5");
		var absolute = UpdateService.ResolveTrustedDownloadUri(trustedInstaller.AbsoluteUri);
		Assert.True(absolute == trustedInstaller, "versioned GitHub release URL accepted");

		var malicious = new[]
		{
			"http://github.com/ZHanry/home-tunnel/releases/download/v2.2.5/HomeTunnel-Setup-2.2.5-x64.exe",
			"https://evil.example/ZHanry/home-tunnel/releases/download/v2.2.5/HomeTunnel-Setup-2.2.5-x64.exe",
			"https://github.com@evil.example/ZHanry/home-tunnel/releases/download/v2.2.5/HomeTunnel-Setup-2.2.5-x64.exe",
			"https://github.com/ZHanry/home-tunnel/releases/download/v2.2.5/HomeTunnel-Setup-2.2.5-x64.exe?redirect=evil",
			"https://github.com/another/repository/releases/download/v2.2.5/HomeTunnel-Setup-2.2.5-x64.exe",
			"https://github.com/ZHanry/home-tunnel/releases/latest/download/HomeTunnel-Setup-2.2.5-x64.exe",
			"https://github.com/ZHanry/home-tunnel/releases/download/v2.2.6/HomeTunnel-Setup-2.2.5-x64.exe",
			"https://github.com/ZHanry/home-tunnel/releases/download/v2.2.5/sub/HomeTunnel-Setup-2.2.5-x64.exe",
			"/downloads/HomeTunnel-Setup-2.2.5-x64.exe",
		};
		foreach (var value in malicious)
		{
			TestAssert.Throws<InvalidDataException>(() => UpdateService.ResolveTrustedDownloadUri(value), $"malicious URL rejected: {value}");
		}
	}

	[Fact]
	public async Task TestReleaseValidationAsync()
	{
		var validPayload = ReleasePayload("2.5.1", GitHubDownloadUri("2.5.1").AbsoluteUri);
		using (var service = new UpdateService(new StaticJsonHandler(validPayload)))
		{
			var result = await service.CheckAsync(CancellationToken.None);
			Assert.True(result.IsUpdateAvailable, "newer release detected");
			Assert.True(result.Release.Version == "2.5.1", "release metadata parsed");
		}

		var maliciousPayload = ReleasePayload("2.4.1", "https://evil.example/downloads/HomeTunnel-Setup-2.4.1-x64.exe");
		using var maliciousService = new UpdateService(new StaticJsonHandler(maliciousPayload));
		await TestAssert.ThrowsAsync<InvalidDataException>(
			() => maliciousService.CheckAsync(CancellationToken.None),
			"malicious release URL rejected during check");
	}

	[Fact]
	public async Task TestMissingReleaseManifestAsync()
	{
		using var service = new UpdateService(new StatusHandler(HttpStatusCode.NotFound));
		var unavailable = await service.CheckIfAvailableAsync(CancellationToken.None);
		Assert.True(unavailable is null, "missing Windows latest.json safely disables update discovery");

		using var failingService = new UpdateService(new StatusHandler(HttpStatusCode.InternalServerError));
		await TestAssert.ThrowsAsync<HttpRequestException>(
			async () => { _ = await failingService.CheckIfAvailableAsync(CancellationToken.None); },
			"non-404 update failures remain visible");
	}

	[Fact]
	public async Task TestVerifiedBackgroundDownloadAsync()
	{
		var bytes = Enumerable.Range(0, 260_123).Select(index => (byte)(index * 31 % 251)).ToArray();
		var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
		var payload = ReleasePayload(
			"2.4.1",
			GitHubDownloadUri("2.4.1").AbsoluteUri,
			bytes.Length,
			hash);
		var root = Path.Combine(Path.GetTempPath(), $"HomeTunnel-UpdateService-Test-{Guid.NewGuid():N}");
		try
		{
			var versionDirectory = Path.Combine(root, "2.4.1");
			Directory.CreateDirectory(versionDirectory);
			var partial = Path.Combine(versionDirectory, "HomeTunnel-Setup-2.4.1-x64.exe.part");
			await File.WriteAllBytesAsync(partial, bytes[..8192]);

			var handler = new UpdateHandler(payload, bytes);
			using var service = new UpdateService(UpdateService.ProductionReleaseEndpoint, handler, root);
			var result = await service.CheckAsync(CancellationToken.None);
			var lastPercentage = 0;
			var installer = await service.DownloadAsync(
				result,
				new InlineProgress<UpdateDownloadProgress>(value => lastPercentage = value.Percentage),
				CancellationToken.None);

			Assert.True(handler.DownloadRequests == 1, "installer downloaded exactly once");
			Assert.True(handler.RangeRequests == 1, "partial installer resumed with an HTTP range");
			Assert.True(lastPercentage == 100, "download progress reaches 100 percent");
			Assert.True(File.Exists(installer), "verified installer moved to final path");
			Assert.True(new FileInfo(installer).Length == bytes.Length, "downloaded installer size verified");
			Assert.True(
				string.Equals(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(installer))), hash, StringComparison.OrdinalIgnoreCase),
				"downloaded installer SHA-256 verified");

			var cached = await service.DownloadAsync(result, null, CancellationToken.None);
			Assert.True(cached == installer, "verified installer reused from local cache");
			Assert.True(handler.DownloadRequests == 1, "cached installer avoids another network download");

			await File.WriteAllBytesAsync(installer, [1, 2, 3]);
			Assert.True(await service.FindDownloadedInstallerAsync(result, CancellationToken.None) is null, "tampered cached installer rejected");
			Assert.True(!File.Exists(installer), "tampered cached installer removed");

			var badPayload = ReleasePayload(
				"2.4.1",
				GitHubDownloadUri("2.4.1").AbsoluteUri,
				bytes.Length,
				new string('0', 64));
			using var badService = new UpdateService(
				UpdateService.ProductionReleaseEndpoint,
				new UpdateHandler(badPayload, bytes),
				Path.Combine(root, "bad"));
			var badResult = await badService.CheckAsync(CancellationToken.None);
			await TestAssert.ThrowsAsync<InvalidDataException>(
				() => badService.DownloadAsync(badResult, null, CancellationToken.None),
				"download with mismatched SHA-256 rejected");
			Assert.True(
				!Directory.EnumerateFiles(Path.Combine(root, "bad"), "*.part", SearchOption.AllDirectories).Any(),
				"untrusted partial installer removed after hash failure");
		}
		finally
		{
			if (Directory.Exists(root)) Directory.Delete(root, true);
		}
	}

	[Fact]
	public async Task TestGitHubRedirectPolicyAsync()
	{
		var bytes = Enumerable.Range(0, 32_777).Select(index => (byte)(index * 17 % 251)).ToArray();
		var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
		var payload = ReleasePayload("2.4.1", GitHubDownloadUri("2.4.1").AbsoluteUri, bytes.Length, hash);
		var root = Path.Combine(Path.GetTempPath(), $"HomeTunnel-GitHub-Redirect-Test-{Guid.NewGuid():N}");
		try
		{
			var handler = new GitHubRedirectHandler(payload, bytes);
			using var service = new UpdateService(UpdateService.ProductionReleaseEndpoint, handler, root);
			var result = await service.CheckAsync(CancellationToken.None);
			var installer = await service.DownloadAsync(result, null, CancellationToken.None);
			Assert.True(handler.MetadataRedirects == 2, "GitHub latest metadata redirects followed explicitly");
			Assert.True(handler.InstallerRedirects == 1, "GitHub installer redirect followed explicitly");
			Assert.True(await File.ReadAllBytesAsync(installer) is { } downloaded && downloaded.SequenceEqual(bytes),
				"installer delivered by the trusted GitHub asset host is accepted");

			using var maliciousService = new UpdateService(new RedirectHandler("https://evil.example/latest.json"));
			await TestAssert.ThrowsAsync<InvalidDataException>(
				() => maliciousService.CheckAsync(CancellationToken.None),
				"metadata redirect outside GitHub asset hosts is rejected");
		}
		finally
		{
			if (Directory.Exists(root)) Directory.Delete(root, true);
		}
	}

	[Fact]
	public async Task TestManagedAgentAsync()
	{
		if (string.Equals(Environment.GetEnvironmentVariable("HOME_TUNNEL_SKIP_AGENT_TESTS"), "1", StringComparison.Ordinal)) return;
		var agent = Path.Combine(AppContext.BaseDirectory, FrpcSupervisor.BinaryFileName);
		Assert.True(File.Exists(agent), "managed Agent is copied to the client output");
		var actualHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(agent))).ToLowerInvariant();
		Assert.True(actualHash == FrpcSupervisor.ExpectedSha256, "managed Agent matches the hash embedded in the client");
		Assert.True(FrpcSupervisor.InspectInstalledAgent().Status == "Valid", "managed Agent integrity inspection succeeds");

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
				"--port", ProductConfiguration.FrpsPort.ToString(CultureInfo.InvariantCulture),
				"--domain", ProductConfiguration.TunnelDomain,
			};
			var valid = await RunAgentAsync(agent, ["verify", "--config", validConfig, .. trustArguments]);
			Assert.True(valid.ExitCode == 0 && valid.Output.Contains("配置有效", StringComparison.Ordinal), "managed Home Tunnel config is accepted");

			var invalidConfig = Path.Combine(root, "generic.toml");
			await File.WriteAllTextAsync(invalidConfig, (await File.ReadAllTextAsync(validConfig)).Replace(
				"type = \"http\"",
				"type = \"tcp\"\nremotePort = 65000",
				StringComparison.Ordinal));
			var invalid = await RunAgentAsync(agent, ["verify", "--config", invalidConfig, .. trustArguments]);
			Assert.True(invalid.ExitCode != 0, "generic TCP proxy configuration is rejected");

			var validText = await File.ReadAllTextAsync(validConfig);
			var rejectedVariants = new (string Name, string Content)[]
			{
				("subdomain escape", validText.Replace(
					$"customDomains = [\"agent-test.{ProductConfiguration.TunnelDomain}\"]",
					$"customDomains = [\"agent-test.{ProductConfiguration.TunnelDomain}\"]\nsubdomain = \"evil\"",
					StringComparison.Ordinal)),
				("dns server override", validText.Replace(
					"user = \"test-device\"",
					"user = \"test-device\"\ndnsServer = \"198.51.100.53\"",
					StringComparison.Ordinal)),
				("stun server override", validText.Replace(
					"user = \"test-device\"",
					"user = \"test-device\"\nnatHoleStunServer = \"attacker.example:3478\"",
					StringComparison.Ordinal)),
				("tcp mux disabled", validText.Replace(
					"user = \"test-device\"",
					"user = \"test-device\"\ntransport.tcpMux = false",
					StringComparison.Ordinal)),
				("pool count override", validText.Replace(
					"user = \"test-device\"",
					"user = \"test-device\"\ntransport.poolCount = 8",
					StringComparison.Ordinal)),
				("login fail exit disabled", validText.Replace(
					"loginFailExit = true",
					"loginFailExit = false",
					StringComparison.Ordinal)),
			};
			foreach (var (name, content) in rejectedVariants)
			{
				var variantConfig = Path.Combine(root, $"rejected-{rejectedVariants.TakeWhile(v => v.Name != name).Count()}.toml");
				await File.WriteAllTextAsync(variantConfig, content);
				var rejected = await RunAgentAsync(agent, ["verify", "--config", variantConfig, .. trustArguments]);
				Assert.True(rejected.ExitCode != 0, $"managed surface violation is rejected: {name}");
			}

			var mismatchedServer = await RunAgentAsync(agent,
				["verify", "--config", validConfig, "--server", "frps.other.example", "--port", "7000", "--domain", ProductConfiguration.TunnelDomain]);
			Assert.True(mismatchedServer.ExitCode != 0, "config that differs from the user-selected server is rejected");

			// 服务端下发 FRPS 证书的场景：配置固定 CA 与 serverName，Agent 复核文件哈希。
			var caBytes = new UTF8Encoding(false).GetBytes(
				"-----BEGIN CERTIFICATE-----\ntest-only-frps-ca\n-----END CERTIFICATE-----\n");
			var caPath = Path.Combine(root, "frps-ca.pem");
			await File.WriteAllBytesAsync(caPath, caBytes);
			var caSha256 = Convert.ToHexString(SHA256.HashData(caBytes)).ToLowerInvariant();
			var caConfig = Path.Combine(root, "managed-ca.toml");
			await File.WriteAllTextAsync(caConfig, (await File.ReadAllTextAsync(validConfig)).Replace(
				"transport.tls.disableCustomTLSFirstByte = true",
				"transport.tls.disableCustomTLSFirstByte = true\n" +
				$"transport.tls.trustedCaFile = \"{caPath.Replace("\\", "\\\\")}\"\n" +
				$"transport.tls.serverName = \"{ProductConfiguration.FrpsHost}\"",
				StringComparison.Ordinal));
			var caAccepted = await RunAgentAsync(agent,
				["verify", "--config", caConfig, .. trustArguments, "--tls-ca-sha256", caSha256]);
			Assert.True(caAccepted.ExitCode == 0, "managed config pinning the delivered FRPS CA is accepted");
			var caHashMismatch = await RunAgentAsync(agent,
				["verify", "--config", caConfig, .. trustArguments, "--tls-ca-sha256", new string('0', 64)]);
			Assert.True(caHashMismatch.ExitCode != 0, "CA file that differs from the client-written hash is rejected");
			var caWithoutFlag = await RunAgentAsync(agent, ["verify", "--config", caConfig, .. trustArguments]);
			Assert.True(caWithoutFlag.ExitCode != 0, "config with trustedCaFile but no --tls-ca-sha256 is rejected");

			var genericCli = await RunAgentAsync(agent, "tcp", "--server", "evil.example");
			Assert.True(genericCli.ExitCode != 0, "generic FRPC command line is rejected");
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

	private static class TestAssert
	{
		public static void Throws<T>(Action action, string message) where T : Exception
		{
			try { action(); }
			catch (T) { return; }
			throw new Xunit.Sdk.XunitException(message);
		}

		public static async Task ThrowsAsync<T>(Func<Task> action, string message) where T : Exception
		{
			try { await action(); }
			catch (T) { return; }
			throw new Xunit.Sdk.XunitException(message);
		}
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

	private sealed class StatusHandler(HttpStatusCode statusCode) : HttpMessageHandler
	{
		protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
			Task.FromResult(new HttpResponseMessage(statusCode) { RequestMessage = request });
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
					"https://github.com/ZHanry/home-tunnel/releases/download/v2.4.1/latest.json"));
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
			if (uri.Host == "github.com" && uri.AbsolutePath.EndsWith("HomeTunnel-Setup-2.4.1-x64.exe", StringComparison.Ordinal))
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

	private sealed class StallingDownloadHandler(string metadata, long installerSize) : HttpMessageHandler
	{
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

			return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
			{
				Content = new StallingContent(installerSize),
				RequestMessage = request,
			});
		}
	}

	private sealed class StallingContent(long length) : HttpContent
	{
		protected override Task<Stream> CreateContentReadStreamAsync() => Task.FromResult<Stream>(new StallingStream());

		protected override async Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context) =>
			await Task.Delay(Timeout.InfiniteTimeSpan);

		protected override bool TryComputeLength(out long computedLength)
		{
			computedLength = length;
			return true;
		}
	}

	private sealed class StallingStream : Stream
	{
		public override bool CanRead => true;
		public override bool CanSeek => false;
		public override bool CanWrite => false;
		public override long Length => throw new NotSupportedException();
		public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

		public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken)
		{
			await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
			return 0;
		}

		public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
			ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

		public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
		public override void Flush() { }
		public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
		public override void SetLength(long value) => throw new NotSupportedException();
		public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
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
