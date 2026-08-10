using System.IO.Compression;
using System.IO;
using System.Text;
using System.Text.Json;
using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

public sealed class DiagnosticsService(LocalStateStore store)
{
    public string Export(LocalState state)
    {
        var agentIntegrity = FrpcSupervisor.InspectInstalledAgent();
        var outputDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "HomeTunnel-Diagnostics");
        Directory.CreateDirectory(outputDirectory);
        var archive = Path.Combine(outputDirectory, $"home-tunnel-diagnostics-{DateTime.Now:yyyyMMdd-HHmmss}.zip");
        using var zip = ZipFile.Open(archive, ZipArchiveMode.Create);
        var summary = new
        {
            generated_at = DateTimeOffset.UtcNow,
            client_version = AppVersion.Current,
            agent_version = FrpcSupervisor.Version,
            agent_protocol_version = FrpcSupervisor.FrpVersion,
            agent_integrity = agentIntegrity.Status,
            agent_file = agentIntegrity.FileName,
            agent_expected_sha256 = agentIntegrity.ExpectedSha256,
            agent_actual_sha256 = agentIntegrity.ActualSha256,
            agent_expected_signer_thumbprint = agentIntegrity.ExpectedSignerThumbprint,
            security_guidance = "不要关闭 Microsoft Defender 或添加排除项；Agent 缺失或损坏时请使用客户端内的修复功能。",
            os = Environment.OSVersion.VersionString,
            architecture = System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
            device_id_prefix = state.DeviceId is null ? null : state.DeviceId[..Math.Min(8, state.DeviceId.Length)],
            last_config_version = state.LastConfigVersion,
            applied_config_version = state.AppliedConfigVersion,
            connections = state.CachedConnections.Select(item => new
            {
                id_prefix = item.Id[..Math.Min(8, item.Id.Length)],
                item.LocalScheme,
                item.LocalPort,
                item.Enabled,
                item.State,
                item.Version,
                item.AppliedVersion,
                item.LastErrorCode,
            }),
            excluded_sensitive_fields = new[] { "password", "device_credential", "access_token", "refresh_token", "frp_lease", "authorization", "cookie", "local_host" },
        };
        var entry = zip.CreateEntry("summary.json", CompressionLevel.Optimal);
        using (var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false)))
            writer.Write(JsonSerializer.Serialize(summary, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));

        if (Directory.Exists(store.LogDirectory))
        {
            foreach (var log in Directory.EnumerateFiles(store.LogDirectory, "*.jsonl").TakeLast(7))
                zip.CreateEntryFromFile(log, "logs/" + Path.GetFileName(log), CompressionLevel.Optimal);
        }
        return archive;
    }
}
