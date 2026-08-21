using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Reflection;
using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

public sealed record AgentSnapshot(string State, string Message, DateTimeOffset? LeaseExpiresAt, long AppliedConfigVersion);
public sealed record AgentIntegritySnapshot(
    string Status,
    string FileName,
    string Version,
    string ExpectedSha256,
    string? ActualSha256,
    string? ExpectedSignerThumbprint);
internal sealed record AgentTrustProfile(
    string Server,
    int Port,
    string Domain,
    IReadOnlyList<string> AllowedCustomDomains,
    IReadOnlyList<int> AllowedTcpPorts,
    IReadOnlyList<int> AllowedUdpPorts,
    string? TlsCaSha256 = null);

public sealed partial class FrpcSupervisor : IDisposable
{
    public const string Version = "3.1.0";
    public const string FrpVersion = "0.70.1";
    public const string BinaryFileName = "HomeTunnel.Agent.exe";
    internal const string FrpsCaFileName = "frps-ca.pem";
    private const string DevelopmentSha256 = "e37a9eee2d02b14283a6a41c43a578e79b2d52e3898d37d6e579c63a94044565";
    public static string ExpectedSha256 { get; } = ReadAssemblyMetadata("HomeTunnelAgentSha256") ?? DevelopmentSha256;
    public static string? ExpectedSignerThumbprint { get; } = NormalizeOptional(ReadAssemblyMetadata("HomeTunnelAgentSignerThumbprint"));

    /// <summary>进程稳定运行超过该时长后，重启失败计数重新从零累计。</summary>
    private static readonly TimeSpan StableRunThreshold = TimeSpan.FromSeconds(60);

    private enum DesiredState
    {
        Stopped,
        Running,
    }

    private readonly LocalStateStore _store;
    private readonly SafeLogger _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _proxyStateLock = new();
    private Dictionary<string, TunnelConnection> _proxiesByName = new(StringComparer.Ordinal);
    private Process? _process;
    private string? _lastKnownGoodPath;
    private AgentTrustProfile? _lastTrustProfile;
    private DateTimeOffset? _lastLeaseExpiresAt;
    private long _lastAppliedVersion;
    private DateTimeOffset _processStartedAtUtc;
    private int _restartFailures;
    private bool _stopping;
    private volatile DesiredState _desiredState = DesiredState.Stopped;

    public event Action<AgentSnapshot>? StatusChanged;

    public FrpcSupervisor(LocalStateStore store, SafeLogger logger)
    {
        _store = store;
        _logger = logger;
        SecureRuntimeDirectory();
        _lastKnownGoodPath = Directory.EnumerateFiles(_store.RuntimeDirectory, "lkg-*.toml")
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }

    public async Task<bool> ApplyAsync(LocalState state, SyncResponse sync, CancellationToken cancellationToken)
    {
        var lease = sync.Lease ?? throw new InvalidOperationException("同步响应未包含应用配置所需的租约");
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var integrity = await InspectInstalledAgentAsync(cancellationToken);
            var binary = Path.Combine(AppContext.BaseDirectory, BinaryFileName);
            if (integrity.Status == "Missing")
            {
                Report("RepairRequired", "AGENT_MISSING：受管 Agent 被安全软件移除或安装不完整，请修复客户端。", lease.ExpiresAt, state.AppliedConfigVersion);
                return false;
            }
            if (integrity.Status != "Valid")
            {
                var code = integrity.Status switch
                {
                    "Unreadable" => "AGENT_UNREADABLE",
                    "SignerMismatch" => "AGENT_SIGNER_INVALID",
                    _ => "AGENT_HASH_INVALID",
                };
                Report("RepairRequired", $"{code}：受管 Agent 未通过完整性检查，请修复客户端。", lease.ExpiresAt, state.AppliedConfigVersion);
                return false;
            }
            if (lease.ExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(1))
            {
                Report("ExpiredStop", "租约已过期或即将过期，隧道已停止", lease.ExpiresAt, state.AppliedConfigVersion);
                _desiredState = DesiredState.Stopped;
                await StopInternalAsync();
                return false;
            }

            // 服务端下发了 FRPS 证书时：把 PEM 写入运行时目录（每次覆盖，保证与
            // 状态一致），配置固定该 CA 文件，并把写入字节的 SHA-256 交给 Agent 复核。
            string? caPath = null;
            string? caSha256 = null;
            if (!string.IsNullOrWhiteSpace(state.FrpsTlsCertificatePem))
            {
                caPath = Path.Combine(_store.RuntimeDirectory, FrpsCaFileName);
                var caBytes = new UTF8Encoding(false).GetBytes(state.FrpsTlsCertificatePem);
                await File.WriteAllBytesAsync(caPath, caBytes, cancellationToken);
                caSha256 = Convert.ToHexString(SHA256.HashData(caBytes)).ToLowerInvariant();
            }

            var pending = Path.Combine(_store.RuntimeDirectory, $"pending-{Guid.NewGuid():N}.toml");
            await File.WriteAllTextAsync(pending, RenderConfig(state, sync, caPath), new UTF8Encoding(false), cancellationToken);
            Report("Applying", $"正在应用配置 v{sync.TargetConfigVersion}", lease.ExpiresAt, state.AppliedConfigVersion);
            var trustProfile = CreateTrustProfile(state, sync.Connections, caSha256);

            var verification = await RunAndCaptureAsync(binary, "verify", pending, trustProfile, TimeSpan.FromSeconds(12), cancellationToken);
            if (verification.ExitCode != 0)
            {
                _logger.Error("AGENT_CONFIG_INVALID", verification.Output);
                DeleteRuntimeFile(pending);
                Report("Error", "AGENT_CONFIG_INVALID：新配置校验失败，已保留上一版本", lease.ExpiresAt, state.AppliedConfigVersion);
                return false;
            }

            await StopInternalAsync();
            _lastTrustProfile = trustProfile;
            RegisterProxyConnections(state.CachedConnections);
            var started = Start(binary, pending, trustProfile);
            _process = started;
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
            }
            catch
            {
                // 取消时不能留下持有有效租约的脱管进程。
                await StopInternalAsync();
                DeleteRuntimeFile(pending);
                throw;
            }
            if (started.HasExited)
            {
                _logger.Error("AGENT_START", $"Agent 提前退出，exit_code={started.ExitCode}");
                DeleteRuntimeFile(pending);
                await RestoreLastKnownGoodAsync(binary, cancellationToken);
                Report("Error", "AGENT_START：新配置启动失败，已尝试恢复上一版本", lease.ExpiresAt, state.AppliedConfigVersion);
                return false;
            }

            var lkg = Path.Combine(_store.RuntimeDirectory, $"lkg-{sync.TargetConfigVersion}.toml");
            File.Move(pending, lkg, true);
            if (_lastKnownGoodPath is not null && !string.Equals(_lastKnownGoodPath, lkg, StringComparison.OrdinalIgnoreCase))
                DeleteRuntimeFile(_lastKnownGoodPath);
            _lastKnownGoodPath = lkg;
            _restartFailures = 0;
            _desiredState = DesiredState.Running;
            _lastLeaseExpiresAt = lease.ExpiresAt;
            _lastAppliedVersion = sync.TargetConfigVersion;
            state.AppliedConfigVersion = sync.TargetConfigVersion;
            foreach (var connection in state.CachedConnections)
                connection.AppliedVersion = connection.Version;
            _logger.Info("AGENT_APPLIED", $"Applied config version {sync.TargetConfigVersion}");
            Report("Online", $"{state.CachedConnections.Count(c => c.Enabled)} 条连接已提交给 Agent", lease.ExpiresAt, sync.TargetConfigVersion);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopAsync(string reason)
    {
        await _gate.WaitAsync();
        try
        {
            _desiredState = DesiredState.Stopped;
            await StopInternalAsync();
            _logger.Info("AGENT_STOPPED", reason);
            Report("Offline", reason, null, 0);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task ClearSensitiveRuntimeAsync()
    {
        await StopAsync("账号已退出");
        foreach (var file in Directory.EnumerateFiles(_store.RuntimeDirectory, "*.toml")) DeleteRuntimeFile(file);
        DeleteRuntimeFile(Path.Combine(_store.RuntimeDirectory, FrpsCaFileName));
        _lastKnownGoodPath = null;
        _lastTrustProfile = null;
        _lastLeaseExpiresAt = null;
        _lastAppliedVersion = 0;
        lock (_proxyStateLock) _proxiesByName = new(StringComparer.Ordinal);
    }

    internal static string ProxyNameFor(TunnelConnection connection) =>
        string.IsNullOrWhiteSpace(connection.ProxyName)
            ? $"ht_{connection.Id.Replace("-", "")}_v{connection.Version}"
            : connection.ProxyName;

    internal static AgentTrustProfile CreateTrustProfile(
        LocalState state,
        IEnumerable<TunnelConnection> connections,
        string? tlsCaSha256 = null)
    {
        var values = connections.ToArray();
        return new AgentTrustProfile(
            state.FrpsHost,
            state.FrpsPort,
            state.TunnelDomain,
            values
                .Where(connection => connection.Enabled && connection.ProxyType == "http")
                .SelectMany(connection => connection.CustomDomains)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            CollectRemotePorts(values, "tcp"),
            CollectRemotePorts(values, "udp"),
            tlsCaSha256);
    }

    private static int[] CollectRemotePorts(IEnumerable<TunnelConnection> connections, string proxyType) =>
        connections
            .Where(connection => connection.Enabled && connection.ProxyType == proxyType && connection.RemotePort is > 0)
            .Select(connection => connection.RemotePort!.Value)
            .Distinct()
            .Order()
            .ToArray();

    private void RegisterProxyConnections(IEnumerable<TunnelConnection> connections)
    {
        var index = new Dictionary<string, TunnelConnection>(StringComparer.Ordinal);
        foreach (var connection in connections)
        {
            if (connection.Enabled)
            {
                // 真实状态由 Agent 的 FRP 日志回传后再置为 Online/Error。
                connection.State = "Waiting";
                connection.LastErrorCode = null;
                index[ProxyNameFor(connection)] = connection;
            }
            else
            {
                connection.State = "Disabled";
                connection.LastErrorCode = null;
            }
        }
        lock (_proxyStateLock) _proxiesByName = index;
    }

    // FRP 0.70.1 客户端日志：`[<user>.<proxyName>] start proxy success` 或
    // `[<user>.<proxyName>] start error: ...`（client/control.go）。
    [GeneratedRegex(@"\[(?<name>[^\[\]\s]+)\] (?<result>start proxy success|start error)", RegexOptions.CultureInvariant)]
    private static partial Regex ProxyStartEventPattern();

    internal static bool TryParseProxyStartEvent(string line, out string proxyName, out bool success)
    {
        proxyName = "";
        success = false;
        var match = ProxyStartEventPattern().Match(line);
        if (!match.Success) return false;
        proxyName = match.Groups["name"].Value;
        success = match.Groups["result"].Value == "start proxy success";
        return true;
    }

    private void HandleAgentLogLine(string line)
    {
        if (!TryParseProxyStartEvent(line, out var proxyName, out var success)) return;
        TunnelConnection? connection;
        lock (_proxyStateLock)
        {
            if (!_proxiesByName.TryGetValue(proxyName, out connection))
            {
                // Agent 上报的代理全名带 "{user}." 前缀，剥离后再匹配。
                var separator = proxyName.IndexOf('.');
                if (separator <= 0 || !_proxiesByName.TryGetValue(proxyName[(separator + 1)..], out connection)) return;
            }
        }
        connection.State = success ? "Online" : "Error";
        connection.LastErrorCode = success ? null : "PROXY_START_ERROR";
        if (!success) _logger.Warn("AGENT_PROXY_START_FAILED", $"proxy={proxyName}");
    }

    private Process Start(string binary, string configPath, AgentTrustProfile trustProfile)
    {
        var start = new ProcessStartInfo(binary)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = _store.RuntimeDirectory,
        };
        AddTrustArguments(start, "run", configPath, trustProfile);
        var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrWhiteSpace(e.Data)) return;
            _logger.Info("AGENT_STDOUT", e.Data);
            HandleAgentLogLine(e.Data);
        };
        process.ErrorDataReceived += (_, e) =>
        {
            if (string.IsNullOrWhiteSpace(e.Data)) return;
            _logger.Warn("AGENT_STDERR", e.Data);
            HandleAgentLogLine(e.Data);
        };
        process.Exited += (_, _) => _ = OnUnexpectedExitAsync(process);
        if (!process.Start()) throw new InvalidOperationException("无法启动 Home Tunnel Agent");
        _processStartedAtUtc = DateTimeOffset.UtcNow;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    private async Task OnUnexpectedExitAsync(Process exited)
    {
        if (_stopping || _desiredState != DesiredState.Running || !ReferenceEquals(_process, exited)) return;
        if (_lastKnownGoodPath is null || _lastTrustProfile is null) return;
        if (DateTimeOffset.UtcNow - _processStartedAtUtc >= StableRunThreshold)
            _restartFailures = 0;
        _restartFailures++;
        if (_restartFailures > 5)
        {
            Report("Error", "AGENT_RESTART_LIMIT：Agent 连续退出，已停止自动重启", null, 0);
            return;
        }
        var delay = TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, _restartFailures)));
        Report("Degraded", $"Agent 意外退出，{delay.TotalSeconds:0} 秒后重试", null, 0);
        await Task.Delay(delay);
        // backoff 醒来后必须在锁内复查期望状态与进程身份：期间可能已应用新配置
        // （_process 已指向新进程）或用户已暂停/退出（期望状态为 Stopped）。
        try
        {
            await _gate.WaitAsync();
        }
        catch (ObjectDisposedException)
        {
            // 应用正在关闭。
            return;
        }
        try
        {
            if (_stopping || _desiredState != DesiredState.Running || !ReferenceEquals(_process, exited)) return;
            if (_lastKnownGoodPath is null || _lastTrustProfile is null || !File.Exists(_lastKnownGoodPath)) return;
            var integrity = await InspectInstalledAgentAsync(CancellationToken.None);
            if (integrity.Status != "Valid")
            {
                Report("RepairRequired", "AGENT_INTEGRITY：受管 Agent 已缺失或损坏，请修复客户端。", null, 0);
                return;
            }
            var restarted = Start(Path.Combine(AppContext.BaseDirectory, BinaryFileName), _lastKnownGoodPath, _lastTrustProfile);
            _process = restarted;
            exited.Dispose();
            _logger.Warn("AGENT_RESTARTED", $"restart_attempt={_restartFailures}");
            Report("Online", "Agent 已自动恢复运行", _lastLeaseExpiresAt, _lastAppliedVersion);
        }
        catch (Exception error)
        {
            _logger.Error("AGENT_RESTART_FAILED", error.Message);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task RestoreLastKnownGoodAsync(string binary, CancellationToken cancellationToken)
    {
        if (_lastKnownGoodPath is null || _lastTrustProfile is null || !File.Exists(_lastKnownGoodPath)) return;
        try
        {
            _process = Start(binary, _lastKnownGoodPath, _lastTrustProfile);
            await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
        }
        catch (Exception error)
        {
            _logger.Error("AGENT_ROLLBACK_FAILED", error.Message);
        }
    }

    private async Task StopInternalAsync()
    {
        if (_process is null) return;
        _stopping = true;
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
                await _process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
            }
        }
        catch { }
        finally
        {
            _process.Dispose();
            _process = null;
            _stopping = false;
        }
    }

    internal static string RenderConfig(LocalState state, SyncResponse sync, string? trustedCaPath)
    {
        var lease = sync.Lease ?? throw new InvalidOperationException("同步响应未包含 Agent 租约");
        var builder = new StringBuilder();
        builder.AppendLine(CultureInfo.InvariantCulture, $"serverAddr = {Toml(state.FrpsHost)}");
        builder.AppendLine(CultureInfo.InvariantCulture, $"serverPort = {state.FrpsPort}");
        builder.AppendLine(CultureInfo.InvariantCulture, $"user = {Toml(sync.DeviceId)}");
        builder.AppendLine("loginFailExit = true");
        builder.AppendLine("transport.tls.enable = true");
        builder.AppendLine("transport.tls.disableCustomTLSFirstByte = true");
        if (trustedCaPath is not null)
        {
            builder.AppendLine(CultureInfo.InvariantCulture, $"transport.tls.trustedCaFile = {Toml(trustedCaPath)}");
            builder.AppendLine(CultureInfo.InvariantCulture, $"transport.tls.serverName = {Toml(state.FrpsHost)}");
        }
        builder.AppendLine("transport.heartbeatInterval = 30");
        builder.AppendLine("transport.heartbeatTimeout = 90");
        builder.AppendLine(CultureInfo.InvariantCulture, $"metadatas.home_tunnel_lease = {Toml(lease.Lease)}");
        builder.AppendLine("log.to = \"console\"");
        builder.AppendLine("log.level = \"info\"");

        foreach (var connection in sync.Connections.Where(item => item.Enabled))
        {
            builder.AppendLine();
            builder.AppendLine("[[proxies]]");
            builder.AppendLine(CultureInfo.InvariantCulture, $"name = {Toml(ProxyNameFor(connection))}");
            switch (connection.ProxyType)
            {
                case "http":
                    builder.AppendLine("type = \"http\"");
                    var domains = new[] { connection.Subdomain + "." + state.TunnelDomain }
                        .Concat(connection.CustomDomains)
                        .Select(Toml);
                    builder.AppendLine(CultureInfo.InvariantCulture, $"customDomains = [{string.Join(", ", domains)}]");
                    break;
                case "tcp":
                case "udp":
                    builder.AppendLine(CultureInfo.InvariantCulture, $"type = {Toml(connection.ProxyType)}");
                    builder.AppendLine(CultureInfo.InvariantCulture, $"remotePort = {connection.RemotePort ?? throw new InvalidOperationException($"{connection.ProxyType.ToUpperInvariant()} 连接缺少远程端口")}");
                    break;
                default:
                    throw new InvalidOperationException($"连接 {connection.Id} 使用了不支持的代理类型：{connection.ProxyType}");
            }
            builder.AppendLine("transport.useEncryption = true");
            builder.AppendLine("transport.useCompression = true");
            if (connection.ProxyType != "udp")
            {
                builder.AppendLine("healthCheck.type = \"tcp\"");
                builder.AppendLine("healthCheck.timeoutSeconds = 3");
                builder.AppendLine("healthCheck.intervalSeconds = 10");
            }
            if (connection.ProxyType == "http" && connection.LocalScheme == "https")
            {
                builder.AppendLine("[proxies.plugin]");
                builder.AppendLine("type = \"http2https\"");
                builder.AppendLine(CultureInfo.InvariantCulture, $"localAddr = {Toml($"{connection.LocalHost}:{connection.LocalPort}")}");
                builder.AppendLine(CultureInfo.InvariantCulture, $"hostHeaderRewrite = {Toml(connection.LocalHost)}");
            }
            else
            {
                builder.AppendLine(CultureInfo.InvariantCulture, $"localIP = {Toml(connection.LocalHost)}");
                builder.AppendLine(CultureInfo.InvariantCulture, $"localPort = {connection.LocalPort}");
            }
        }
        return builder.ToString();
    }

    private static string Toml(string value) => $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "")}\"";

    /// <summary>verify 与 run 两条命令路径共用的受管信任参数；含 CA 时追加哈希复核参数。</summary>
    internal static void AddTrustArguments(ProcessStartInfo start, string command, string configPath, AgentTrustProfile trustProfile)
    {
        start.ArgumentList.Add(command);
        start.ArgumentList.Add("--config");
        start.ArgumentList.Add(configPath);
        start.ArgumentList.Add("--server");
        start.ArgumentList.Add(trustProfile.Server);
        start.ArgumentList.Add("--port");
        start.ArgumentList.Add(trustProfile.Port.ToString(System.Globalization.CultureInfo.InvariantCulture));
        start.ArgumentList.Add("--domain");
        start.ArgumentList.Add(trustProfile.Domain);
        if (trustProfile.AllowedCustomDomains.Count > 0)
        {
            start.ArgumentList.Add("--allow-custom-domains");
            start.ArgumentList.Add(string.Join(",", trustProfile.AllowedCustomDomains));
        }
        if (trustProfile.AllowedTcpPorts.Count > 0)
        {
            start.ArgumentList.Add("--allow-tcp-ports");
            start.ArgumentList.Add(string.Join(",", trustProfile.AllowedTcpPorts));
        }
        if (trustProfile.AllowedUdpPorts.Count > 0)
        {
            start.ArgumentList.Add("--allow-udp-ports");
            start.ArgumentList.Add(string.Join(",", trustProfile.AllowedUdpPorts));
        }
        if (trustProfile.TlsCaSha256 is not null)
        {
            start.ArgumentList.Add("--tls-ca-sha256");
            start.ArgumentList.Add(trustProfile.TlsCaSha256);
        }
    }

    private static async Task<(int ExitCode, string Output)> RunAndCaptureAsync(
        string file,
        string command,
        string configPath,
        AgentTrustProfile trustProfile,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(file)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        AddTrustArguments(start, command, configPath, trustProfile);
        using var process = new Process
        {
            StartInfo = start,
        };
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken).WaitAsync(timeout, cancellationToken);
        return (process.ExitCode, (await stdout) + " " + (await stderr));
    }

    public static AgentIntegritySnapshot InspectInstalledAgent()
    {
        var path = Path.Combine(AppContext.BaseDirectory, BinaryFileName);
        if (!File.Exists(path))
            return Snapshot("Missing", null);
        try
        {
            string actual;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            return Snapshot(ResolveIntegrityStatus(path, actual), actual);
        }
        catch (IOException)
        {
            return Snapshot("Unreadable", null);
        }
        catch (UnauthorizedAccessException)
        {
            return Snapshot("Unreadable", null);
        }
    }

    private static async Task<AgentIntegritySnapshot> InspectInstalledAgentAsync(CancellationToken cancellationToken)
    {
        var path = Path.Combine(AppContext.BaseDirectory, BinaryFileName);
        if (!File.Exists(path))
            return Snapshot("Missing", null);
        try
        {
            string actual;
            await using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true))
                actual = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
            return Snapshot(ResolveIntegrityStatus(path, actual), actual);
        }
        catch (IOException)
        {
            return Snapshot("Unreadable", null);
        }
        catch (UnauthorizedAccessException)
        {
            return Snapshot("Unreadable", null);
        }
    }

    private static string ResolveIntegrityStatus(string path, string actualSha256)
    {
        if (!string.Equals(actualSha256, ExpectedSha256, StringComparison.OrdinalIgnoreCase))
            return "HashMismatch";
        if (ExpectedSignerThumbprint is not null && !SignerMatchesExpected(path))
            return "SignerMismatch";
        return "Valid";
    }

    private static bool SignerMatchesExpected(string path)
    {
        try
        {
            // There is no X509CertificateLoader API that extracts the Authenticode signer
            // from a signed PE file; CreateFromSignedFile remains the Windows BCL entry point.
#pragma warning disable SYSLIB0057
            using var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
#pragma warning restore SYSLIB0057
            return string.Equals(certificate.GetCertHashString(HashAlgorithmName.SHA1), ExpectedSignerThumbprint, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(certificate.GetCertHashString(HashAlgorithmName.SHA256), ExpectedSignerThumbprint, StringComparison.OrdinalIgnoreCase);
        }
        catch (CryptographicException)
        {
            // 未签名或签名结构无效。
            return false;
        }
    }

    private static AgentIntegritySnapshot Snapshot(string status, string? actualSha256) =>
        new(status, BinaryFileName, Version, ExpectedSha256, actualSha256, ExpectedSignerThumbprint);

    private static string? ReadAssemblyMetadata(string key) =>
        typeof(FrpcSupervisor).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(item => string.Equals(item.Key, key, StringComparison.Ordinal))?.Value;

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();

    private void SecureRuntimeDirectory()
    {
        Directory.CreateDirectory(_store.RuntimeDirectory);
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var sid = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("当前用户 SID 不可用");
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
            security.SetOwner(sid);
            security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            new DirectoryInfo(_store.RuntimeDirectory).SetAccessControl(security);
        }
        catch (Exception error)
        {
            _logger.Warn("RUNTIME_ACL_FAILED", error.Message);
        }
    }

    private void DeleteRuntimeFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception error)
        {
            _logger.Warn("RUNTIME_FILE_DELETE_FAILED", $"{Path.GetFileName(path)}: {error.GetType().Name}");
        }
    }

    private void Report(string state, string message, DateTimeOffset? expiresAt, long version) =>
        StatusChanged?.Invoke(new AgentSnapshot(state, message, expiresAt, version));

    public void Dispose()
    {
        // Dispose 可能在 UI 线程执行，不做长时间同步等待，直接终止进程树。
        _desiredState = DesiredState.Stopped;
        _stopping = true;
        try
        {
            var process = _process;
            _process = null;
            if (process is not null)
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                process.Dispose();
            }
        }
        catch { }
        _gate.Dispose();
    }
}
