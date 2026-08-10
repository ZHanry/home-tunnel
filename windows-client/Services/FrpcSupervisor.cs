using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
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
internal sealed record AgentTrustProfile(string Server, int Port, string Domain);

public sealed class FrpcSupervisor : IDisposable
{
    public const string Version = "2.2.4";
    public const string FrpVersion = "0.62.1";
    public const string BinaryFileName = "HomeTunnel.Agent.exe";
    private const string DevelopmentSha256 = "eee75a6ca45dd539d57ff6e2a6790579919de5105264ad3cdd0008fcbce234e5";
    public static string ExpectedSha256 { get; } = ReadAssemblyMetadata("HomeTunnelAgentSha256") ?? DevelopmentSha256;
    public static string? ExpectedSignerThumbprint { get; } = NormalizeOptional(ReadAssemblyMetadata("HomeTunnelAgentSignerThumbprint"));

    private readonly LocalStateStore _store;
    private readonly SafeLogger _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Process? _process;
    private string? _lastKnownGoodPath;
    private AgentTrustProfile? _lastTrustProfile;
    private int _restartFailures;
    private bool _stopping;

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
                var code = integrity.Status == "Unreadable" ? "AGENT_UNREADABLE" : "AGENT_HASH_INVALID";
                Report("RepairRequired", $"{code}：受管 Agent 未通过完整性检查，请修复客户端。", lease.ExpiresAt, state.AppliedConfigVersion);
                return false;
            }
            if (lease.ExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(1))
            {
                Report("ExpiredStop", "租约已过期或即将过期，隧道已停止", lease.ExpiresAt, state.AppliedConfigVersion);
                await StopInternalAsync();
                return false;
            }

            var pending = Path.Combine(_store.RuntimeDirectory, $"pending-{Guid.NewGuid():N}.toml");
            await File.WriteAllTextAsync(pending, RenderConfig(state, sync), new UTF8Encoding(false), cancellationToken);
            Report("Applying", $"正在应用配置 v{sync.TargetConfigVersion}", lease.ExpiresAt, state.AppliedConfigVersion);
            var trustProfile = new AgentTrustProfile(state.FrpsHost, state.FrpsPort, state.TunnelDomain);

            var verification = await RunAndCaptureAsync(binary, "verify", pending, trustProfile, TimeSpan.FromSeconds(12), cancellationToken);
            if (verification.ExitCode != 0)
            {
                _logger.Error("AGENT_CONFIG_INVALID", verification.Output);
                SecureDelete(pending);
                Report("Error", "AGENT_CONFIG_INVALID：新配置校验失败，已保留上一版本", lease.ExpiresAt, state.AppliedConfigVersion);
                return false;
            }

            await StopInternalAsync();
            _lastTrustProfile = trustProfile;
            var started = Start(binary, pending, trustProfile);
            await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
            if (started.HasExited)
            {
                _logger.Error("AGENT_START", $"Agent 提前退出，exit_code={started.ExitCode}");
                SecureDelete(pending);
                await RestoreLastKnownGoodAsync(binary, cancellationToken);
                Report("Error", "AGENT_START：新配置启动失败，已尝试恢复上一版本", lease.ExpiresAt, state.AppliedConfigVersion);
                return false;
            }

            var lkg = Path.Combine(_store.RuntimeDirectory, $"lkg-{sync.TargetConfigVersion}.toml");
            File.Move(pending, lkg, true);
            if (_lastKnownGoodPath is not null && !string.Equals(_lastKnownGoodPath, lkg, StringComparison.OrdinalIgnoreCase))
                SecureDelete(_lastKnownGoodPath);
            _lastKnownGoodPath = lkg;
            _process = started;
            _restartFailures = 0;
            state.AppliedConfigVersion = sync.TargetConfigVersion;
            foreach (var connection in state.CachedConnections)
            {
                connection.AppliedVersion = connection.Version;
                connection.State = connection.Enabled ? "Online" : "Disabled";
                connection.LastErrorCode = null;
            }
            _logger.Info("AGENT_APPLIED", $"Applied config version {sync.TargetConfigVersion}");
            Report("Online", $"{state.CachedConnections.Count(c => c.Enabled)} 条连接正在运行", lease.ExpiresAt, sync.TargetConfigVersion);
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
        foreach (var file in Directory.EnumerateFiles(_store.RuntimeDirectory, "*.toml")) SecureDelete(file);
        _lastKnownGoodPath = null;
        _lastTrustProfile = null;
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
        start.ArgumentList.Add("run");
        start.ArgumentList.Add("--config");
        start.ArgumentList.Add(configPath);
        start.ArgumentList.Add("--server");
        start.ArgumentList.Add(trustProfile.Server);
        start.ArgumentList.Add("--port");
        start.ArgumentList.Add(trustProfile.Port.ToString(System.Globalization.CultureInfo.InvariantCulture));
        start.ArgumentList.Add("--domain");
        start.ArgumentList.Add(trustProfile.Domain);
        var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) _logger.Info("AGENT_STDOUT", e.Data); };
        process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) _logger.Warn("AGENT_STDERR", e.Data); };
        process.Exited += (_, _) => _ = OnUnexpectedExitAsync(process);
        if (!process.Start()) throw new InvalidOperationException("无法启动 Home Tunnel Agent");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    private async Task OnUnexpectedExitAsync(Process exited)
    {
        if (_stopping || !ReferenceEquals(_process, exited) || _lastKnownGoodPath is null || _lastTrustProfile is null) return;
        _restartFailures++;
        if (_restartFailures > 5)
        {
            Report("Error", "AGENT_RESTART_LIMIT：Agent 连续退出，已停止自动重启", null, 0);
            return;
        }
        var delay = TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, _restartFailures)));
        Report("Degraded", $"Agent 意外退出，{delay.TotalSeconds:0} 秒后重试", null, 0);
        await Task.Delay(delay);
        if (_stopping || !File.Exists(_lastKnownGoodPath)) return;
        try
        {
            var integrity = await InspectInstalledAgentAsync(CancellationToken.None);
            if (integrity.Status != "Valid")
            {
                Report("RepairRequired", "AGENT_INTEGRITY：受管 Agent 已缺失或损坏，请修复客户端。", null, 0);
                return;
            }
            _process = Start(Path.Combine(AppContext.BaseDirectory, BinaryFileName), _lastKnownGoodPath, _lastTrustProfile);
            _logger.Warn("AGENT_RESTARTED", $"restart_attempt={_restartFailures}");
        }
        catch (Exception error)
        {
            _logger.Error("AGENT_RESTART_FAILED", error.Message);
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

    private string RenderConfig(LocalState state, SyncResponse sync)
    {
        var lease = sync.Lease ?? throw new InvalidOperationException("同步响应未包含 Agent 租约");
        var builder = new StringBuilder();
        builder.AppendLine($"serverAddr = {Toml(state.FrpsHost)}");
        builder.AppendLine($"serverPort = {state.FrpsPort}");
        builder.AppendLine($"user = {Toml(sync.DeviceId)}");
        builder.AppendLine("loginFailExit = true");
        builder.AppendLine("transport.tls.enable = true");
        builder.AppendLine("transport.tls.disableCustomTLSFirstByte = true");
        builder.AppendLine("transport.heartbeatInterval = 30");
        builder.AppendLine("transport.heartbeatTimeout = 90");
        builder.AppendLine($"metadatas.home_tunnel_lease = {Toml(lease.Lease)}");
        builder.AppendLine("log.to = \"console\"");
        builder.AppendLine("log.level = \"info\"");

        foreach (var connection in sync.Connections.Where(item => item.Enabled))
        {
            var proxyName = string.IsNullOrWhiteSpace(connection.ProxyName)
                ? $"ht_{connection.Id.Replace("-", "")}_v{connection.Version}"
                : connection.ProxyName;
            builder.AppendLine();
            builder.AppendLine("[[proxies]]");
            builder.AppendLine($"name = {Toml(proxyName)}");
            builder.AppendLine("type = \"http\"");
            builder.AppendLine($"customDomains = [{Toml(connection.Subdomain + "." + state.TunnelDomain)}]");
            builder.AppendLine("transport.useEncryption = true");
            builder.AppendLine("transport.useCompression = true");
            builder.AppendLine("healthCheck.type = \"tcp\"");
            builder.AppendLine("healthCheck.timeoutSeconds = 3");
            builder.AppendLine("healthCheck.intervalSeconds = 10");
            if (connection.LocalScheme == "https")
            {
                builder.AppendLine("[proxies.plugin]");
                builder.AppendLine("type = \"http2https\"");
                builder.AppendLine($"localAddr = {Toml($"{connection.LocalHost}:{connection.LocalPort}")}");
                builder.AppendLine($"hostHeaderRewrite = {Toml(connection.LocalHost)}");
            }
            else
            {
                builder.AppendLine($"localIP = {Toml(connection.LocalHost)}");
                builder.AppendLine($"localPort = {connection.LocalPort}");
            }
        }
        return builder.ToString();
    }

    private static string Toml(string value) => $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "")}\"";

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
        start.ArgumentList.Add(command);
        start.ArgumentList.Add("--config");
        start.ArgumentList.Add(configPath);
        start.ArgumentList.Add("--server");
        start.ArgumentList.Add(trustProfile.Server);
        start.ArgumentList.Add("--port");
        start.ArgumentList.Add(trustProfile.Port.ToString(System.Globalization.CultureInfo.InvariantCulture));
        start.ArgumentList.Add("--domain");
        start.ArgumentList.Add(trustProfile.Domain);
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
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            return Snapshot(string.Equals(actual, ExpectedSha256, StringComparison.OrdinalIgnoreCase) ? "Valid" : "HashMismatch", actual);
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
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true);
            var actual = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
            return Snapshot(string.Equals(actual, ExpectedSha256, StringComparison.OrdinalIgnoreCase) ? "Valid" : "HashMismatch", actual);
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

    private static void SecureDelete(string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            var length = new FileInfo(path).Length;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.None))
            {
                var zeroes = new byte[Math.Min(64 * 1024, Math.Max(1, (int)Math.Min(length, 64 * 1024)))];
                long remaining = length;
                while (remaining > 0)
                {
                    var count = (int)Math.Min(remaining, zeroes.Length);
                    stream.Write(zeroes, 0, count);
                    remaining -= count;
                }
                stream.Flush(true);
            }
            File.Delete(path);
        }
        catch { }
    }

    private void Report(string state, string message, DateTimeOffset? expiresAt, long version) =>
        StatusChanged?.Invoke(new AgentSnapshot(state, message, expiresAt, version));

    public void Dispose()
    {
        try { StopAsync("应用关闭").GetAwaiter().GetResult(); } catch { }
        _gate.Dispose();
    }
}
