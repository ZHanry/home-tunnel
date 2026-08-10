using System.Security.Cryptography;
using System.Security.Principal;
using System.IO;
using System.Text;
using System.Text.Json;
using HomeTunnel.Client.Models;
using Microsoft.Win32;

namespace HomeTunnel.Client.Services;

public sealed class LocalStateStore
{
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public string RootDirectory { get; } = ResolveRootDirectory();
    public string StatePath => Path.Combine(RootDirectory, "state.json");
    public string LogDirectory => Path.Combine(RootDirectory, "logs");
    public string RuntimeDirectory => Path.Combine(RootDirectory, "runtime");

    private static string ResolveRootDirectory()
    {
#if UPDATE_QA
        return Path.Combine(Path.GetTempPath(), "HomeTunnel-Update-QA");
#else
#if DEBUG
        var debugRoot = Environment.GetEnvironmentVariable("HOME_TUNNEL_DEBUG_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(debugRoot)) return Path.GetFullPath(debugRoot);
#endif
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HomeTunnel");
#endif
    }

    public LocalState Load()
    {
        Directory.CreateDirectory(RootDirectory);
        if (!File.Exists(StatePath)) return new LocalState();
        try
        {
            return JsonSerializer.Deserialize<LocalState>(File.ReadAllText(StatePath), _json) ?? new LocalState();
        }
        catch
        {
            var damaged = StatePath + ".damaged-" + DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            File.Move(StatePath, damaged, true);
            return new LocalState();
        }
    }

    public void Save(LocalState state)
    {
        Directory.CreateDirectory(RootDirectory);
        var temporary = StatePath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state, _json), new UTF8Encoding(false));
        File.Move(temporary, StatePath, true);
    }

    public string Fingerprint(LocalState state)
    {
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        var material = $"{Environment.MachineName}\n{sid}\n{state.InstallId}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material))).ToLowerInvariant();
    }

    public static void SetAutoStart(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (enabled)
            key.SetValue("HomeTunnel", $"\"{Environment.ProcessPath}\" --background", RegistryValueKind.String);
        else
            key.DeleteValue("HomeTunnel", false);
    }
}
