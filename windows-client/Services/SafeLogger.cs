using System.Text.RegularExpressions;
using System.IO;

namespace HomeTunnel.Client.Services;

public sealed partial class SafeLogger
{
    private readonly string _directory;
    private readonly object _lock = new();

    public SafeLogger(string directory)
    {
        _directory = directory;
        Directory.CreateDirectory(directory);
        Prune();
    }

    public void Info(string eventCode, string message) => Write("info", eventCode, message);
    public void Warn(string eventCode, string message) => Write("warn", eventCode, message);
    public void Error(string eventCode, string message) => Write("error", eventCode, message);

    private void Write(string level, string eventCode, string message)
    {
        var clean = SensitivePattern().Replace(message.Replace('\r', ' ').Replace('\n', ' '), "$1[REDACTED]");
        var line = $"{{\"timestamp\":\"{DateTimeOffset.UtcNow:O}\",\"level\":\"{level}\",\"event_code\":\"{Escape(eventCode)}\",\"message\":\"{Escape(clean)}\"}}{Environment.NewLine}";
        lock (_lock)
        {
            File.AppendAllText(Path.Combine(_directory, $"home-tunnel-{DateTime.UtcNow:yyyy-MM-dd}.jsonl"), line);
        }
    }

    private void Prune()
    {
        foreach (var file in Directory.EnumerateFiles(_directory, "home-tunnel-*.jsonl"))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(file) < DateTime.UtcNow.AddDays(-7)) File.Delete(file);
            }
            catch { }
        }
    }

    private static string Escape(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    [GeneratedRegex("(?i)(authorization|cookie|password|credential|refresh_token|access_token|lease)(?:\\s*[:=]\\s*|%3[dD])([^\\s,;]+)")]
    private static partial Regex SensitivePattern();
}
