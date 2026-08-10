using System.Windows;
using System.Windows.Media;
using MediaBrush = System.Windows.Media.Brush;

namespace HomeTunnel.Client;

public enum UpdateDialogMode
{
    Available,
    Downloading,
    Ready,
    UpToDate,
    Failure,
    DownloadFailure,
}

public partial class UpdateDialog : Window
{
    private UpdateDialogMode _mode;

    private UpdateDialog(Window owner, UpdateDialogMode mode)
    {
        InitializeComponent();
        Owner = owner;
        _mode = mode;
        Loaded += (_, _) => PrimaryActionButton.Focus();
    }

    public bool DownloadRequested { get; private set; }
    public bool InstallRequested { get; private set; }

    public static UpdateDialog Available(Window owner, Services.UpdateCheckResult result)
    {
        var dialog = new UpdateDialog(owner, UpdateDialogMode.Available);
        dialog.EyebrowText.Text = "新版本可用";
        dialog.TitleText.Text = $"Home Tunnel {result.Release.Version} 已发布";
        dialog.SummaryText.Text = "客户端可以在后台直接下载安装包，下载期间隧道会继续运行。完成校验后会再次提醒你安装。";
        dialog.CurrentVersionText.Text = $"v{result.CurrentVersion}";
        dialog.LatestVersionText.Text = $"v{result.Release.Version}";
        var hash = result.Release.Sha256.ToLowerInvariant();
        dialog.DetailsText.Text = $"{result.Release.FileName}  ·  {FormatBytes(result.Release.SizeBytes)}\n" +
                                  $"发布于 {result.Release.ReleasedAt.ToLocalTime():yyyy-MM-dd HH:mm}  ·  SHA-256 {hash[..12]}…{hash[^8..]}\n" +
                                  "客户端将通过官方 HTTPS 地址下载并校验完整 SHA-256，不会打开浏览器或自动运行安装程序。";
        dialog.CancelActionButton.Content = "稍后";
        dialog.PrimaryActionButton.Content = "后台下载";
        System.Windows.Automation.AutomationProperties.SetName(dialog.PrimaryActionButton, "在后台下载 Home Tunnel 新版本");
        return dialog;
    }

    public static UpdateDialog Downloading(Window owner, Services.UpdateCheckResult result, int percentage)
    {
        var dialog = new UpdateDialog(owner, UpdateDialogMode.Downloading);
        dialog.EyebrowText.Text = "正在后台下载";
        dialog.TitleText.Text = $"正在获取 Home Tunnel {result.Release.Version}";
        dialog.SummaryText.Text = "你可以关闭此窗口或最小化客户端，下载会在后台继续，现有隧道不会中断。";
        dialog.CurrentVersionText.Text = $"v{result.CurrentVersion}";
        dialog.LatestVersionText.Text = $"v{result.Release.Version}";
        dialog.DetailsText.Text = $"{result.Release.FileName}  ·  {FormatBytes(result.Release.SizeBytes)}\n下载完成后会执行大小与 SHA-256 双重校验。";
        dialog.DownloadProgressPanel.Visibility = Visibility.Visible;
        dialog.DownloadProgressBar.Value = Math.Clamp(percentage, 0, 100);
        dialog.DownloadProgressText.Text = $"{Math.Clamp(percentage, 0, 100)}%";
        dialog.CancelActionButton.Visibility = Visibility.Collapsed;
        dialog.PrimaryActionButton.Content = "继续后台运行";
        return dialog;
    }

    public static UpdateDialog Ready(Window owner, Services.UpdateCheckResult result)
    {
        var dialog = new UpdateDialog(owner, UpdateDialogMode.Ready);
        dialog.EyebrowText.Text = "下载与校验完成";
        dialog.EyebrowText.Foreground = (MediaBrush)dialog.FindResource("SuccessBrush");
        dialog.TitleText.Text = $"Home Tunnel {result.Release.Version} 可以安装";
        dialog.SummaryText.Text = "安装包已由客户端下载并通过完整性校验。安装时客户端会安全停止隧道进程。";
        dialog.CurrentVersionText.Text = $"v{result.CurrentVersion}";
        dialog.LatestVersionText.Text = $"v{result.Release.Version}";
        dialog.DetailsPanel.Background = (MediaBrush)dialog.FindResource("SuccessSoftBrush");
        dialog.DetailsPanel.BorderBrush = (MediaBrush)dialog.FindResource("SuccessBorderBrush");
        dialog.DetailsText.Foreground = (MediaBrush)dialog.FindResource("SuccessBrush");
        dialog.DetailsText.Text = $"{result.Release.FileName}  ·  {FormatBytes(result.Release.SizeBytes)}\nSHA-256 校验通过；安装程序只会在你点击“立即安装”后运行。";
        dialog.StatusIconBorder.Background = (MediaBrush)dialog.FindResource("SuccessSoftBrush");
        dialog.StatusIconBorder.BorderBrush = (MediaBrush)dialog.FindResource("SuccessBorderBrush");
        dialog.StatusIconPath.Data = (Geometry)dialog.FindResource("IconCheck");
        dialog.StatusIconPath.Stroke = (MediaBrush)dialog.FindResource("SuccessBrush");
        dialog.CancelActionButton.Content = "稍后";
        dialog.PrimaryActionButton.Content = "立即安装";
        System.Windows.Automation.AutomationProperties.SetName(dialog.PrimaryActionButton, "安装已下载的 Home Tunnel 新版本");
        return dialog;
    }

    public static UpdateDialog UpToDate(Window owner, string currentVersion)
    {
        var dialog = new UpdateDialog(owner, UpdateDialogMode.UpToDate);
        dialog.Title = "已是最新版本 - Home Tunnel";
        dialog.EyebrowText.Text = "检查完成";
        dialog.EyebrowText.Foreground = (MediaBrush)dialog.FindResource("SuccessBrush");
        dialog.TitleText.Text = "已经是最新版本";
        dialog.SummaryText.Text = $"当前安装的 Home Tunnel v{currentVersion} 已是可用的最新版本，无需下载或重新安装。";
        dialog.VersionPanel.Visibility = Visibility.Collapsed;
        dialog.DetailsPanel.Background = (MediaBrush)dialog.FindResource("SuccessSoftBrush");
        dialog.DetailsPanel.BorderBrush = (MediaBrush)dialog.FindResource("SuccessBorderBrush");
        dialog.DetailsText.Foreground = (MediaBrush)dialog.FindResource("SuccessBrush");
        dialog.DetailsText.Text = "检查已完成。你可以随时从登录页或客户端“更多”菜单再次手动检查。";
        dialog.StatusIconBorder.Background = (MediaBrush)dialog.FindResource("SuccessSoftBrush");
        dialog.StatusIconBorder.BorderBrush = (MediaBrush)dialog.FindResource("SuccessBorderBrush");
        dialog.StatusIconPath.Data = (Geometry)dialog.FindResource("IconCheck");
        dialog.StatusIconPath.Stroke = (MediaBrush)dialog.FindResource("SuccessBrush");
        dialog.CancelActionButton.Visibility = Visibility.Collapsed;
        dialog.PrimaryActionButton.Content = "知道了";
        return dialog;
    }

    public static UpdateDialog Failure(Window owner, string message)
    {
        var dialog = new UpdateDialog(owner, UpdateDialogMode.Failure);
        dialog.Title = "检查更新失败 - Home Tunnel";
        dialog.EyebrowText.Text = "暂时无法检查";
        dialog.EyebrowText.Foreground = (MediaBrush)dialog.FindResource("DangerBrush");
        dialog.TitleText.Text = "没有获取到版本信息";
        dialog.SummaryText.Text = message;
        dialog.VersionPanel.Visibility = Visibility.Collapsed;
        dialog.DetailsPanel.Background = (MediaBrush)dialog.FindResource("DangerSoftBrush");
        dialog.DetailsPanel.BorderBrush = (MediaBrush)dialog.FindResource("DangerBorderBrush");
        dialog.DetailsText.Foreground = (MediaBrush)dialog.FindResource("DangerBrush");
        dialog.DetailsText.Text = $"请确认电脑可以访问 {ProductConfiguration.ProjectUri.Host}，然后点击“重新检查”。取消后也可稍后从客户端再次检查。";
        dialog.StatusIconBorder.Background = (MediaBrush)dialog.FindResource("DangerSoftBrush");
        dialog.StatusIconBorder.BorderBrush = (MediaBrush)dialog.FindResource("DangerBorderBrush");
        dialog.StatusIconPath.Data = (Geometry)dialog.FindResource("IconAlert");
        dialog.StatusIconPath.Stroke = (MediaBrush)dialog.FindResource("DangerBrush");
        dialog.CancelActionButton.Content = "取消";
        dialog.PrimaryActionButton.Content = "重新检查";
        return dialog;
    }

    public static UpdateDialog DownloadFailure(Window owner, string message)
    {
        var dialog = Failure(owner, message);
        dialog._mode = UpdateDialogMode.DownloadFailure;
        dialog.Title = "下载更新失败 - Home Tunnel";
        dialog.EyebrowText.Text = "下载暂时中断";
        dialog.TitleText.Text = "没有完成安装包下载";
        dialog.DetailsText.Text = "已下载的有效片段会保留。重新下载时将优先尝试断点续传，并再次执行完整 SHA-256 校验。";
        dialog.CancelActionButton.Content = "稍后";
        dialog.PrimaryActionButton.Content = "重新下载";
        return dialog;
    }

    private void PrimaryActionButton_Click(object sender, RoutedEventArgs e)
    {
        if (_mode is UpdateDialogMode.Available or UpdateDialogMode.DownloadFailure)
            DownloadRequested = true;
        if (_mode == UpdateDialogMode.Ready)
            InstallRequested = true;
        DialogResult = true;
    }

    private void CancelActionButton_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private static string FormatBytes(long bytes) => bytes >= 1024L * 1024
        ? $"{bytes / 1024d / 1024d:0.0} MB"
        : $"{bytes / 1024d:0} KB";
}
