using System.Threading;
using System.Diagnostics.CodeAnalysis;
using System.Windows;

namespace HomeTunnel.Client;

[SuppressMessage(
    "Design",
    "CA1001:Types that own disposable fields should be disposable",
    Justification = "WPF owns the Application lifecycle; OnExit releases and disposes the single-instance mutex.")]
public partial class App : System.Windows.Application
{
    private Mutex? _singleInstance;

    public static string CurrentTheme { get; private set; } = "light";

    public static void ApplyTheme(string? theme)
    {
        var normalized = string.Equals(theme, "dark", System.StringComparison.OrdinalIgnoreCase) ? "dark" : "light";
        CurrentTheme = normalized;
        var isDark = normalized == "dark";

        SetBrushColor("InkBrush", isDark ? "#F8FAFC" : "#0F172A");
        SetBrushColor("TextBrush", isDark ? "#E2E8F0" : "#334155");
        SetBrushColor("TextSecondaryBrush", isDark ? "#CBD5E1" : "#475569");
        SetBrushColor("MutedBrush", isDark ? "#94A3B8" : "#64748B");
        SetBrushColor("PageBrush", isDark ? "#0F172A" : "#F8FAFC");
        SetBrushColor("SurfaceBrush", isDark ? "#1E293B" : "#FFFFFF");
        SetBrushColor("SurfaceMutedBrush", isDark ? "#334155" : "#F1F5F9");
        SetBrushColor("BorderBrush", isDark ? "#334155" : "#E2E8F0");
        SetBrushColor("BorderStrongBrush", isDark ? "#475569" : "#CBD5E1");
        SetBrushColor("HoverBorderBrush", isDark ? "#64748B" : "#94A3B8");
        SetBrushColor("PrimaryBrush", isDark ? "#38BDF8" : "#0369A1");
        SetBrushColor("PrimaryContrastBrush", isDark ? "#0F172A" : "#FFFFFF");
        SetBrushColor("PrimaryHoverBrush", isDark ? "#7DD3FC" : "#075985");
        SetBrushColor("PrimarySoftBrush", isDark ? "#0C4A6E" : "#F0F9FF");
        SetBrushColor("PrimaryBorderBrush", isDark ? "#0284C7" : "#BAE6FD");
        SetBrushColor("BrandMintBrush", "#FFFFFF");
        SetBrushColor("FocusRingBrush", isDark ? "#4038BDF8" : "#400284C7");
        SetBrushColor("FocusAccentBrush", isDark ? "#38BDF8" : "#0369A1");
        SetBrushColor("SuccessBrush", isDark ? "#34D399" : "#047857");
        SetBrushColor("SuccessDotBrush", isDark ? "#10B981" : "#10B981");
        SetBrushColor("SuccessSoftBrush", isDark ? "#064E3B" : "#ECFDF5");
        SetBrushColor("SuccessBorderBrush", isDark ? "#047857" : "#A7F3D0");
        SetBrushColor("WarningBrush", isDark ? "#FBBF24" : "#B45309");
        SetBrushColor("WarningDotBrush", isDark ? "#F59E0B" : "#F59E0B");
        SetBrushColor("WarningSoftBrush", isDark ? "#78350F" : "#FFFBEB");
        SetBrushColor("WarningBorderBrush", isDark ? "#B45309" : "#FDE68A");
        SetBrushColor("DangerBrush", isDark ? "#F87171" : "#B91C1C");
        SetBrushColor("DangerDotBrush", isDark ? "#EF4444" : "#EF4444");
        SetBrushColor("DangerSoftBrush", isDark ? "#7F1D1D" : "#FEF2F2");
        SetBrushColor("DangerBorderBrush", isDark ? "#B91C1C" : "#FECACA");
        SetBrushColor("SidebarBrush", isDark ? "#0F172A" : "#F8FAFC");
        SetBrushColor("SidebarRaisedBrush", isDark ? "#1E293B" : "#FFFFFF");
        SetBrushColor("SidebarTextBrush", isDark ? "#F8FAFC" : "#0F172A");
        SetBrushColor("SidebarMutedBrush", isDark ? "#94A3B8" : "#64748B");
        SetBrushColor("OverlayBrush", isDark ? "#CC0F172A" : "#800F172A");
    }

    private static void SetBrushColor(string key, string hexColor)
    {
        if (Current?.Resources[key] is System.Windows.Media.SolidColorBrush brush)
        {
            var color = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hexColor);
            if (brush.IsFrozen)
            {
                Current.Resources[key] = new System.Windows.Media.SolidColorBrush(color);
            }
            else
            {
                brush.Color = color;
            }
        }
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
#if DEBUG
        const string mutexName = "Local\\HomeTunnel.Client.Debug";
#else
        const string mutexName = "Local\\HomeTunnel.Client.v1";
#endif
        _singleInstance = new Mutex(true, mutexName, out var created);
        if (!created)
        {
            BrandDialog.Show(null, "Home Tunnel 已在运行", "你可以从任务栏通知区域打开正在运行的客户端。", BrandDialogTone.Information);
            Shutdown();
            return;
        }

        var window = new MainWindow();
        MainWindow = window;
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _singleInstance?.ReleaseMutex();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}
