using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using HomeTunnel.Client.Models;
using HomeTunnel.Client.Services;
using Forms = System.Windows.Forms;
using MediaBrush = System.Windows.Media.Brush;

namespace HomeTunnel.Client;

public partial class MainWindow : Window
{
    private readonly LocalStateStore _stateStore = new();
    private readonly LocalState _state;
    private readonly SafeLogger _logger;
    private readonly FrpcSupervisor _supervisor;
    private readonly DiagnosticsService _diagnostics;
    private readonly UpdateService _updateService;
    private readonly ObservableCollection<TunnelConnection> _connections = [];
    private readonly DispatcherTimer _syncTimer = new() { Interval = TimeSpan.FromMinutes(3) };
    private readonly DispatcherTimer _heartbeatTimer = new() { Interval = TimeSpan.FromSeconds(30) };
    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private int _syncPending;
    private readonly System.Drawing.Icon? _trayIcon;
    private readonly Forms.NotifyIcon _tray;
    private ApiClient _api;
    private string? _pendingUsername;
    private bool _paused;
    private bool _reallyExit;
    private bool _initializing = true;
    private string _agentState = "Offline";
    private bool _repairRequired;
    private DateTimeOffset? _lastAppliedLeaseExpires;
    private bool _isCheckingUpdates;
    private bool _isUpdateDialogOpen;
    private UpdateCheckResult? _pendingUpdate;
    private UpdateCheckResult? _availableUpdate;
    private string? _availableUpdateVersion;
    private string? _downloadedInstallerPath;
    private CancellationTokenSource? _updateDownloadCancellation;
    private Task? _updateDownloadTask;
    private int _updateDownloadPercentage;
    private Forms.ToolStripMenuItem? _trayUpdateItem;
    private CancellationTokenSource? _realtimeCancellation;
    private Task? _realtimeTask;

    public MainWindow()
    {
        _state = _stateStore.Load();
        _logger = new SafeLogger(_stateStore.LogDirectory);
        App.ApplyTheme(_state.Theme);
        InitializeComponent();
        ApplyWorkAreaBounds();
        MigrateLegacyServerProfile();
        _supervisor = new FrpcSupervisor(_stateStore, _logger);
        _supervisor.StatusChanged += snapshot => Dispatcher.Invoke(() => ApplyAgentStatus(snapshot));
        _diagnostics = new DiagnosticsService(_stateStore);
        _updateService = CreateUpdateService();
        _api = new ApiClient(_state.ApiBaseUrl);
        ConnectionsList.ItemsSource = _connections;
        ServerAddressBox.Text = _state.ServerBaseUrl;
        CheckUpdateLoginButton.IsEnabled = true;
        LoginVersionText.Text = $"当前版本 v{AppVersion.Current}";
        MainClientVersionText.Text = $"v{AppVersion.Current}";

        _trayIcon = LoadTrayIcon();
        _tray = CreateTrayIcon();
        _syncTimer.Tick += (_, _) => RunSafely(() => SynchronizeAsync(showBusy: false), "SYNC_TIMER_FAILED");
        _heartbeatTimer.Tick += (_, _) => RunSafely(HeartbeatAsync, "HEARTBEAT_TIMER_FAILED");
        AutoStartCheckBox.IsChecked = _state.StartWithWindows;
        UpdateThemeToggleText();
        _initializing = false;
        Loaded += (_, _) => RunSafely(async () =>
        {
#if DEBUG
            if (string.Equals(Environment.GetEnvironmentVariable("HOME_TUNNEL_UI_QA"), "1", StringComparison.Ordinal))
            {
                ConfigureUiQa();
                return;
            }
#endif
            if (Environment.GetCommandLineArgs().Contains("--background", StringComparer.OrdinalIgnoreCase)) Hide();
            await TryAutomaticLoginAsync();
            if (LoginView.Visibility == Visibility.Visible)
            {
                if (string.IsNullOrWhiteSpace(ServerAddressBox.Text)) ServerAddressBox.Focus();
                else UsernameBox.Focus();
            }
            await CheckForUpdatesAsync(manual: false);
        }, "WINDOW_LOADED_FAILED");
    }

    /// <summary>包装 fire-and-forget 的异步 UI 回调，未处理异常统一写入脱敏日志。</summary>
    private void RunSafely(Func<Task> action, string eventCode) => _ = RunSafelyCoreAsync(action, eventCode);

    private async Task RunSafelyCoreAsync(Func<Task> action, string eventCode)
    {
        try
        {
            await action();
        }
        catch (Exception error)
        {
            _logger.Warn(eventCode, SafeMessage(error));
        }
    }

#if DEBUG
    private void ConfigureUiQa()
    {
        var view = Environment.GetEnvironmentVariable("HOME_TUNNEL_UI_QA_VIEW")?.Trim().ToLowerInvariant();
        if (view == "update")
        {
            Dispatcher.BeginInvoke(() =>
            {
                var release = new ReleaseMetadata(
                    "2.2.6",
                    "windows",
                    "x64",
                    "HomeTunnel-Setup-2.2.6-x64.exe",
                    58_900_000,
                    new string('a', 64),
                    DateTimeOffset.Now.AddDays(-1),
                    "https://github.com/ZHanry/home-tunnel/releases/download/v2.2.6/HomeTunnel-Setup-2.2.6-x64.exe",
                    "https://github.com/ZHanry/home-tunnel/releases/latest");
                UpdateDialog.Available(
                    this,
                    new UpdateCheckResult(
                        AppVersion.Current,
                        release,
                        UpdateService.ResolveTrustedDownloadUri(release.DownloadUrl),
                        true)).ShowDialog();
            }, DispatcherPriority.ApplicationIdle);
            return;
        }

        if (view == "password")
        {
            LoginView.Visibility = Visibility.Collapsed;
            PasswordChangeView.Visibility = Visibility.Visible;
            NewPasswordBox.Focus();
            return;
        }

        if (view is not ("main" or "editor" or "new-editor" or "empty" or "long"))
        {
            UsernameBox.Focus();
            return;
        }

        LoginView.Visibility = Visibility.Collapsed;
        MainView.Visibility = Visibility.Visible;
        AccountText.Text = "家庭管理员 · admin";
        if (view == "empty")
        {
            ApplyAgentStatus(new AgentSnapshot(
                "Online",
                "配置已同步，当前还没有连接",
                DateTimeOffset.Now.AddMinutes(55),
                12));
            return;
        }

        var longContent = view == "long";
        var firstSubdomain = longContent
            ? "home-media-library-with-a-deliberately-long-subdomain-preview"
            : "my-nas";
        _connections.Add(new TunnelConnection
        {
            Id = "qa-nas",
            Name = longContent
                ? "家庭媒体资料库与远程备份管理服务（用于验证超长连接名称不会覆盖状态）"
                : "家庭 NAS",
            Subdomain = firstSubdomain,
            PublicUrl = $"https://{firstSubdomain}.{ProductConfiguration.TunnelDomain}",
            LocalScheme = "https",
            LocalHost = longContent ? "very-long-local-service-hostname.lan" : "192.168.1.20",
            LocalPort = 5001,
            Enabled = true,
            Version = 12,
            State = "Online",
        });
        _connections.Add(new TunnelConnection
        {
            Id = "qa-home-assistant",
            Name = "Home Assistant",
            Subdomain = "my-home",
            PublicUrl = $"https://my-home.{ProductConfiguration.TunnelDomain}",
            LocalScheme = "http",
            LocalHost = "127.0.0.1",
            LocalPort = 8123,
            Enabled = true,
            Version = 8,
            State = "Online",
        });
        _connections.Add(new TunnelConnection
        {
            Id = "qa-dev",
            Name = "开发预览",
            Subdomain = "dev-preview",
            PublicUrl = $"https://dev-preview.{ProductConfiguration.TunnelDomain}",
            LocalScheme = "http",
            LocalHost = "127.0.0.1",
            LocalPort = 3000,
            Enabled = true,
            Version = 3,
            State = "Waiting",
        });
        if (view == "long")
        {
            for (var index = 4; index <= 9; index++)
            {
                _connections.Add(new TunnelConnection
                {
                    Id = $"qa-extra-{index}",
                    Name = $"额外验证连接 {index}",
                    Subdomain = $"qa-extra-{index}",
                    PublicUrl = $"https://qa-extra-{index}.{ProductConfiguration.TunnelDomain}",
                    LocalScheme = "http",
                    LocalHost = "127.0.0.1",
                    LocalPort = 3000 + index,
                    Enabled = true,
                    Version = index,
                    State = index % 2 == 0 ? "Online" : "Waiting",
                });
            }
            Dispatcher.BeginInvoke(() =>
            {
                if (ConnectionsList.Template?.FindName("ConnectionsScrollViewer", ConnectionsList) is ScrollViewer scrollViewer)
                    scrollViewer.ScrollToEnd();
            }, DispatcherPriority.ApplicationIdle);
        }
        ApplyAgentStatus(new AgentSnapshot(
            "Online",
            "配置已同步，3 条连接中有 2 条正在运行",
            DateTimeOffset.Now.AddMinutes(55),
            12));

        if (view is "editor" or "new-editor")
        {
            Dispatcher.BeginInvoke(() =>
            {
                var dialog = new ConnectionDialog(
                    this,
                    view == "new-editor" ? null : _connections[0],
                    (_, _) => Task.CompletedTask,
                    (_, _) => Task.CompletedTask);
                dialog.ShowDialog();
            }, DispatcherPriority.ApplicationIdle);
        }
    }
#endif

    private Forms.NotifyIcon CreateTrayIcon()
    {
        var menu = new Forms.ContextMenuStrip
        {
            BackColor = System.Drawing.Color.White,
            ForeColor = System.Drawing.Color.FromArgb(0x18, 0x22, 0x30),
            Font = new System.Drawing.Font("Segoe UI", 9.5f),
            Padding = new Forms.Padding(6),
            ShowImageMargin = false,
            Renderer = new Forms.ToolStripProfessionalRenderer(new HomeTunnelColorTable()),
        };
        var tray = new Forms.NotifyIcon
        {
            Text = "Home Tunnel - 正在启动",
            Icon = _trayIcon ?? System.Drawing.SystemIcons.Application,
            Visible = true,
            ContextMenuStrip = menu,
        };
        tray.DoubleClick += (_, _) => ShowWindow();
        tray.BalloonTipClicked += (_, _) => ShowWindow();
        tray.ContextMenuStrip.Items.Add("显示主界面", null, (_, _) => ShowWindow());
        tray.ContextMenuStrip.Items.Add("暂停 / 恢复隧道", null, (_, _) =>
            Dispatcher.BeginInvoke(() => RunSafely(TogglePauseAsync, "TRAY_PAUSE_FAILED")));
        _trayUpdateItem = new Forms.ToolStripMenuItem("检查更新");
        _trayUpdateItem.Click += (_, _) => Dispatcher.BeginInvoke(() => RunSafely(async () =>
        {
            ShowWindow();
            await CheckForUpdatesAsync(manual: true);
        }, "TRAY_UPDATE_FAILED"));
        tray.ContextMenuStrip.Items.Add(_trayUpdateItem);
        tray.ContextMenuStrip.Items.Add("导出诊断", null, (_, _) => ExportDiagnostics());
        tray.ContextMenuStrip.Items.Add(new Forms.ToolStripSeparator());
        tray.ContextMenuStrip.Items.Add("完全退出并停止隧道", null, (_, _) =>
            Dispatcher.BeginInvoke(() => RunSafely(ExitCompletelyAsync, "TRAY_EXIT_FAILED")));
        return tray;
    }

    private static System.Drawing.Icon? LoadTrayIcon()
    {
        try
        {
            return Environment.ProcessPath is { Length: > 0 } path
                ? System.Drawing.Icon.ExtractAssociatedIcon(path)
                : null;
        }
        catch
        {
            return null;
        }
    }

    private UpdateService CreateUpdateService()
    {
#if UPDATE_QA
        return new UpdateService(
            new Uri("http://127.0.0.1:18765/latest.json"),
            new HttpClientHandler { AllowAutoRedirect = false });
#else
#if DEBUG
        var overrideValue = Environment.GetEnvironmentVariable("HOME_TUNNEL_UPDATE_ENDPOINT");
        if (Uri.TryCreate(overrideValue, UriKind.Absolute, out var overrideUri) &&
            overrideUri.Scheme is "http" or "https")
            return new UpdateService(overrideUri, new HttpClientHandler { AllowAutoRedirect = false });
#endif
        return new UpdateService();
#endif
    }

    private void MigrateLegacyServerProfile()
    {
        if (!string.IsNullOrWhiteSpace(_state.ServerBaseUrl) ||
            string.IsNullOrWhiteSpace(_state.FrpsHost) ||
            _state.FrpsPort is < 1 or > 65535 ||
            string.IsNullOrWhiteSpace(_state.TunnelDomain) ||
            !Uri.TryCreate(_state.ApiBaseUrl, UriKind.Absolute, out var api) ||
            api.Scheme != Uri.UriSchemeHttps)
            return;
        _state.ServerBaseUrl = new Uri(api.GetLeftPart(UriPartial.Authority) + "/").AbsoluteUri;
    }

    private void ApplyServerProfile(ServerProfile profile)
    {
        var previousServer = _state.ServerBaseUrl;
        var changed = !string.IsNullOrWhiteSpace(previousServer) &&
            !string.Equals(previousServer, profile.PublicBaseUri.AbsoluteUri, StringComparison.OrdinalIgnoreCase);
        if (changed)
        {
            if (_state.DeviceId is not null)
            {
                CredentialStore.Delete(CredentialStore.Target(previousServer, _state.DeviceId));
                CredentialStore.Delete(CredentialStore.LegacyTarget(_state.DeviceId));
            }
            _state.DeviceId = null;
            _state.LastConfigVersion = 0;
            _state.AppliedConfigVersion = 0;
            _state.CachedConnections.Clear();
        }

        _state.ServerBaseUrl = profile.PublicBaseUri.AbsoluteUri;
        _state.ApiBaseUrl = profile.ApiBaseUri.AbsoluteUri;
        _state.FrpsHost = profile.FrpsHost;
        _state.FrpsPort = profile.FrpsPort;
        _state.TunnelDomain = profile.TunnelDomain;
        _state.FrpsTlsCertificatePem = profile.FrpsTlsCertificatePem;
        ServerAddressBox.Text = profile.PublicBaseUri.AbsoluteUri.TrimEnd('/');
        CheckUpdateLoginButton.IsEnabled = true;

        _api.Dispose();
        _api = new ApiClient(_state.ApiBaseUrl);
    }

    private async Task TryAutomaticLoginAsync()
    {
        if (!_state.HasServerProfile || string.IsNullOrWhiteSpace(_state.DeviceId)) return;
        try
        {
            var profile = await ServerProfile.DiscoverAsync(_state.ServerBaseUrl, CancellationToken.None);
            ApplyServerProfile(profile);
            _stateStore.Save(_state);
        }
        catch (Exception error)
        {
            _logger.Warn("SERVER_DISCOVERY_FAILED", SafeMessage(error));
            LoginError.Text = Friendly(error);
            ShowLogin();
            return;
        }

        var target = CredentialStore.Target(_state.ServerBaseUrl, _state.DeviceId);
        var credential = CredentialStore.Read(target);
        var legacyTarget = CredentialStore.LegacyTarget(_state.DeviceId);
        var legacyCredential = false;
        if (string.IsNullOrWhiteSpace(credential))
        {
            credential = CredentialStore.Read(legacyTarget);
            legacyCredential = !string.IsNullOrWhiteSpace(credential);
        }
        if (string.IsNullOrWhiteSpace(credential)) return;
        await WithBusyAsync("正在认证本机设备…", async token =>
        {
            try
            {
                var session = await _api.DeviceLoginAsync(_state.DeviceId, credential, token);
                if (legacyCredential)
                {
                    CredentialStore.Write(target, credential);
                    CredentialStore.Delete(legacyTarget);
                }
                await EnterMainAsync(session, token);
            }
            catch (Exception error)
            {
                _logger.Warn("AUTO_LOGIN_FAILED", SafeMessage(error));
                LoginError.Text = "设备会话已失效，请使用用户名和密码重新登录。";
                ShowLogin();
            }
        });
    }

    private async void CheckUpdateButton_Click(object sender, RoutedEventArgs e)
    {
        MoreMenuPopup.IsOpen = false;
        await CheckForUpdatesAsync(manual: true);
    }

    private async Task CheckForUpdatesAsync(bool manual)
    {
        if (_isCheckingUpdates) return;
        if (manual && await ShowCurrentUpdateStateAsync()) return;
        _isCheckingUpdates = true;
        SetUpdateButtonsBusy(busy: true, showProgressText: manual);
        try
        {
            while (true)
            {
                try
                {
                    var result = await _updateService.CheckAsync(CancellationToken.None);
                    if (result.IsUpdateAvailable)
                    {
                        await HandleAvailableUpdateAsync(result, manual);
                    }
                    else
                    {
                        _availableUpdate = null;
                        _availableUpdateVersion = null;
                        _downloadedInstallerPath = null;
                        UpdateButtonLabels();
                        if (manual) UpdateDialog.UpToDate(this, result.CurrentVersion).ShowDialog();
                    }
                    break;
                }
                catch (Exception error)
                {
                    _logger.Warn("UPDATE_CHECK_FAILED", SafeMessage(error));
                    if (!manual) break;
                    var retry = UpdateDialog.Failure(this, FriendlyUpdateError(error)).ShowDialog() == true;
                    if (!retry) break;
                }
            }
        }
        finally
        {
            _isCheckingUpdates = false;
            SetUpdateButtonsBusy(busy: false, showProgressText: manual);
        }
    }

    private async Task<bool> ShowCurrentUpdateStateAsync()
    {
        if (_availableUpdate is null) return false;
        if (_downloadedInstallerPath is not null)
        {
            await ShowReadyUpdateDialogAsync(_availableUpdate);
            return true;
        }
        if (_updateDownloadTask is { IsCompleted: false })
        {
            UpdateDialog.Downloading(this, _availableUpdate, _updateDownloadPercentage).ShowDialog();
            return true;
        }
        return false;
    }

    private async Task HandleAvailableUpdateAsync(UpdateCheckResult result, bool manual)
    {
        _availableUpdate = result;
        _availableUpdateVersion = result.Release.Version;
        _downloadedInstallerPath = await _updateService.FindDownloadedInstallerAsync(result, CancellationToken.None);
        UpdateButtonLabels();

        if (_downloadedInstallerPath is not null)
        {
            if (manual || !IsAutomaticPromptSuppressed(result.Release.Version))
                await ShowReadyUpdateDialogAsync(result);
            else
                _pendingUpdate = result;
            return;
        }

        if (!manual)
        {
            StartBackgroundUpdateDownload(result, userRequested: false);
            return;
        }

        ShowAvailableUpdateDialog(result);
    }

    private void StartBackgroundUpdateDownload(UpdateCheckResult result, bool userRequested)
    {
        if (_updateDownloadTask is { IsCompleted: false })
        {
            if (userRequested)
                UpdateDialog.Downloading(this, result, _updateDownloadPercentage).ShowDialog();
            return;
        }

        _availableUpdate = result;
        _availableUpdateVersion = result.Release.Version;
        _downloadedInstallerPath = null;
        _updateDownloadPercentage = 0;
        _state.DismissedUpdateVersion = null;
        _state.DismissedUpdateAtUtc = null;
        _stateStore.Save(_state);
        UpdateButtonLabels();

        var cancellation = new CancellationTokenSource();
        _updateDownloadCancellation = cancellation;
        _updateDownloadTask = DownloadUpdateInBackgroundAsync(result, userRequested, cancellation);
    }

    private async Task DownloadUpdateInBackgroundAsync(
        UpdateCheckResult result,
        bool userRequested,
        CancellationTokenSource cancellation)
    {
        string? completedPath = null;
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    var progress = new Progress<UpdateDownloadProgress>(value =>
                    {
                        _updateDownloadPercentage = value.Percentage;
                        UpdateButtonLabels();
                    });
                    completedPath = await _updateService.DownloadAsync(result, progress, cancellation.Token);
                    _downloadedInstallerPath = completedPath;
                    _updateDownloadPercentage = 100;
                    UpdateButtonLabels();
                    break;
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception error)
                {
                    _logger.Warn("UPDATE_DOWNLOAD_FAILED", SafeMessage(error));
                    if (!userRequested || !IsVisible) break;
                    var retry = UpdateDialog.DownloadFailure(this, FriendlyUpdateDownloadError(error)).ShowDialog() == true;
                    if (!retry) break;
                }
            }
        }
        finally
        {
            if (ReferenceEquals(_updateDownloadCancellation, cancellation))
            {
                _updateDownloadTask = null;
                _updateDownloadCancellation = null;
            }
            cancellation.Dispose();
            UpdateButtonLabels();
        }

        if (completedPath is null) return;
        _ = Dispatcher.BeginInvoke(
            new Action(async () => await NotifyUpdateReadyAsync(result)),
            DispatcherPriority.ApplicationIdle);
    }

    private async Task NotifyUpdateReadyAsync(UpdateCheckResult result)
    {
        _pendingUpdate = result;
        _tray.ShowBalloonTip(
            5000,
            $"Home Tunnel {result.Release.Version} 已下载",
            "安装包已完成 SHA-256 校验。点击通知即可安装。",
            Forms.ToolTipIcon.Info);

        if (IsVisible && !IsAutomaticPromptSuppressed(result.Release.Version))
        {
            _pendingUpdate = null;
            await ShowReadyUpdateDialogAsync(result);
        }
    }

    private void ShowAvailableUpdateDialog(UpdateCheckResult result)
    {
        if (_isUpdateDialogOpen)
        {
            _pendingUpdate = result;
            return;
        }

        _pendingUpdate = null;
        _isUpdateDialogOpen = true;
        try
        {
            var dialog = UpdateDialog.Available(this, result);
            dialog.ShowDialog();
            if (dialog.DownloadRequested)
            {
                StartBackgroundUpdateDownload(result, userRequested: true);
            }
            else
            {
                _state.DismissedUpdateVersion = result.Release.Version;
                _state.DismissedUpdateAtUtc = DateTimeOffset.UtcNow;
                _stateStore.Save(_state);
            }
        }
        finally
        {
            _isUpdateDialogOpen = false;
        }
    }

    private async Task ShowReadyUpdateDialogAsync(UpdateCheckResult result)
    {
        if (_isUpdateDialogOpen)
        {
            _pendingUpdate = result;
            return;
        }

        _pendingUpdate = null;
        _isUpdateDialogOpen = true;
        try
        {
            var dialog = UpdateDialog.Ready(this, result);
            dialog.ShowDialog();
            if (dialog.InstallRequested)
            {
                await LaunchVerifiedInstallerAsync(result);
            }
            else
            {
                _state.DismissedUpdateVersion = result.Release.Version;
                _state.DismissedUpdateAtUtc = DateTimeOffset.UtcNow;
                _stateStore.Save(_state);
            }
        }
        finally
        {
            _isUpdateDialogOpen = false;
        }
    }

    private async Task LaunchVerifiedInstallerAsync(UpdateCheckResult result)
    {
        try
        {
            var installer = await _updateService.FindDownloadedInstallerAsync(result, CancellationToken.None);
            if (installer is null)
            {
                _downloadedInstallerPath = null;
                UpdateButtonLabels();
                BrandDialog.Show(this, "安装包需要重新下载", "本地安装包未通过再次校验，客户端不会运行它。请重新检查更新。", BrandDialogTone.Warning);
                return;
            }
            Process.Start(new ProcessStartInfo(installer) { UseShellExecute = true });
            await ExitCompletelyAsync();
        }
        catch (Exception error)
        {
            _logger.Warn("UPDATE_INSTALLER_START_FAILED", SafeMessage(error));
            BrandDialog.Show(this, "无法启动安装程序", "安装包仍保存在本机，你可以稍后再次点击“安装新版本”。", BrandDialogTone.Danger);
        }
    }

    private bool IsAutomaticPromptSuppressed(string version) =>
        string.Equals(_state.DismissedUpdateVersion, version, StringComparison.Ordinal) &&
        _state.DismissedUpdateAtUtc.HasValue &&
        DateTimeOffset.UtcNow - _state.DismissedUpdateAtUtc.Value < TimeSpan.FromHours(24);

    private async void ShowPendingUpdateIfAny()
    {
        if (_pendingUpdate is not { } pending || IsAutomaticPromptSuppressed(pending.Release.Version)) return;
        if (_downloadedInstallerPath is not null)
            await ShowReadyUpdateDialogAsync(pending);
    }

    private void SetUpdateButtonsBusy(bool busy, bool showProgressText)
    {
        CheckUpdateLoginButton.IsEnabled = !busy;
        CheckUpdateMenuButton.IsEnabled = !busy;
        if (busy && showProgressText)
        {
            CheckUpdateLoginButton.Content = "正在检查…";
            CheckUpdateMenuText.Text = "正在检查…";
        }
        else if (!busy)
        {
            UpdateButtonLabels();
        }
    }

    private void UpdateButtonLabels()
    {
        var downloading = _updateDownloadTask is { IsCompleted: false };
        var label = _downloadedInstallerPath is not null && _availableUpdateVersion is not null
            ? $"安装 v{_availableUpdateVersion}"
            : downloading
                ? $"后台下载 {_updateDownloadPercentage}%"
                : _availableUpdateVersion is null ? "检查更新" : $"可更新至 v{_availableUpdateVersion}";
        CheckUpdateLoginButton.Content = label;
        CheckUpdateMenuText.Text = _downloadedInstallerPath is not null
            ? "安装新版本"
            : downloading ? $"正在后台下载 {_updateDownloadPercentage}%" : _availableUpdateVersion is null ? "检查更新" : "发现新版本";
        MoreUpdateBadge.Visibility = _availableUpdateVersion is null ? Visibility.Collapsed : Visibility.Visible;
        MenuUpdateVersionBadge.Visibility = _availableUpdateVersion is null ? Visibility.Collapsed : Visibility.Visible;
        MenuUpdateVersionText.Text = _availableUpdateVersion is null ? "" : $"v{_availableUpdateVersion}";
        if (_trayUpdateItem is not null) _trayUpdateItem.Text = label;
    }

    private static string FriendlyUpdateError(Exception error) => error switch
    {
        TaskCanceledException => "连接更新服务器超时。当前客户端和隧道不受影响，你可以检查网络后重新尝试。",
        HttpRequestException => "无法连接 Home Tunnel 更新服务器。当前客户端和隧道不受影响，请检查网络后重试。",
        InvalidDataException => "更新服务器返回的信息未通过安全校验。为避免下载错误文件，本次检查已停止，请稍后重试。",
        _ => "检查更新时发生异常。当前客户端和隧道不受影响，你可以稍后重新尝试。",
    };

    private static string FriendlyUpdateDownloadError(Exception error) => error switch
    {
        TaskCanceledException => "更新下载超时或已中断。已经下载的有效片段会保留，可以稍后继续。",
        HttpRequestException => "无法连接 Home Tunnel 更新服务器。已经下载的有效片段会保留，请检查网络后重试。",
        UnauthorizedAccessException => "客户端无法写入本机更新目录，请检查安全软件或当前用户权限。",
        IOException => "保存更新安装包时发生错误，请确认磁盘空间充足后重试。",
        InvalidDataException invalid => invalid.Message,
        _ => "下载更新时发生异常。现有客户端和隧道不受影响。",
    };

    private async void LoginButton_Click(object sender, RoutedEventArgs e) => await LoginAsync();

    private async void PasswordBox_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == Key.Enter) await LoginAsync();
    }

    private async Task LoginAsync()
    {
        LoginError.Text = "";
        var serverAddress = ServerAddressBox.Text.Trim();
        var username = UsernameBox.Text.Trim();
        var password = PasswordBox.Password;
        if (serverAddress.Length == 0)
        {
            LoginError.Text = "请输入服务器地址。";
            ServerAddressBox.Focus();
            return;
        }
        if (username.Length == 0)
        {
            LoginError.Text = "请输入用户名。";
            UsernameBox.Focus();
            return;
        }
        if (password.Length == 0)
        {
            LoginError.Text = "请输入密码。";
            PasswordBox.Focus();
            return;
        }
        LoginButton.IsEnabled = false;
        LoginButton.Content = "正在登录…";
        ServerAddressBox.IsEnabled = false;
        UsernameBox.IsEnabled = false;
        PasswordBox.IsEnabled = false;
        try
        {
            var profile = await ServerProfile.DiscoverAsync(serverAddress, CancellationToken.None);
            ApplyServerProfile(profile);
            var session = await _api.LoginAsync(username, password, CancellationToken.None);
            if (session.PasswordChangeRequired)
            {
                _pendingUsername = username;
                CurrentPasswordBox.Password = password;
                PasswordBox.Password = "";
                LoginView.Visibility = Visibility.Collapsed;
                PasswordChangeView.Visibility = Visibility.Visible;
                NewPasswordBox.Focus();
                return;
            }
            await RegisterAndEnterAsync(session, CancellationToken.None);
        }
        catch (Exception error)
        {
            LoginError.Text = Friendly(error);
            _logger.Warn("LOGIN_FAILED", SafeMessage(error));
        }
        finally
        {
            LoginButton.Content = "登录 Home Tunnel";
            LoginButton.IsEnabled = true;
            ServerAddressBox.IsEnabled = true;
            UsernameBox.IsEnabled = true;
            PasswordBox.IsEnabled = true;
        }
    }

    private async void ChangePasswordButton_Click(object sender, RoutedEventArgs e)
    {
        PasswordChangeError.Text = "";
        if (NewPasswordBox.Password != ConfirmPasswordBox.Password)
        {
            PasswordChangeError.Text = "两次输入的新密码不一致。";
            ConfirmPasswordBox.Focus();
            ConfirmPasswordBox.SelectAll();
            return;
        }
        if (NewPasswordBox.Password.Length < 12)
        {
            PasswordChangeError.Text = "新密码至少需要 12 个字符。";
            NewPasswordBox.Focus();
            NewPasswordBox.SelectAll();
            return;
        }
        var current = CurrentPasswordBox.Password;
        var next = NewPasswordBox.Password;
        ChangePasswordButton.IsEnabled = false;
        ChangePasswordButton.Content = "正在更新…";
        CurrentPasswordBox.IsEnabled = false;
        NewPasswordBox.IsEnabled = false;
        ConfirmPasswordBox.IsEnabled = false;
        try
        {
            await _api.ChangePasswordAsync(current, next, CancellationToken.None);
            _api.Dispose();
            _api = new ApiClient(_state.ApiBaseUrl);
            var session = await _api.LoginAsync(_pendingUsername ?? UsernameBox.Text.Trim(), next, CancellationToken.None);
            ClearPasswordFields();
            await RegisterAndEnterAsync(session, CancellationToken.None);
        }
        catch (Exception error)
        {
            PasswordChangeError.Text = Friendly(error);
            _logger.Warn("PASSWORD_CHANGE_FAILED", SafeMessage(error));
        }
        finally
        {
            ChangePasswordButton.Content = "更新密码";
            ChangePasswordButton.IsEnabled = true;
            CurrentPasswordBox.IsEnabled = true;
            NewPasswordBox.IsEnabled = true;
            ConfirmPasswordBox.IsEnabled = true;
        }
    }

    private void CancelPasswordButton_Click(object sender, RoutedEventArgs e)
    {
        ClearPasswordFields();
        ShowLogin();
    }

    private async Task RegisterAndEnterAsync(SessionResponse session, CancellationToken cancellationToken)
    {
        var registration = await _api.RegisterDeviceAsync(
            Environment.MachineName,
            _state.InstallId,
            _stateStore.Fingerprint(_state),
            cancellationToken);
        if (_state.DeviceId is not null && _state.DeviceId != registration.DeviceId)
        {
            CredentialStore.Delete(CredentialStore.Target(_state.ServerBaseUrl, _state.DeviceId));
            CredentialStore.Delete(CredentialStore.LegacyTarget(_state.DeviceId));
        }
        _state.DeviceId = registration.DeviceId;
        _state.LastConfigVersion = 0;
        _state.AppliedConfigVersion = 0;
        CredentialStore.Write(
            CredentialStore.Target(_state.ServerBaseUrl, registration.DeviceId),
            registration.DeviceCredential);
        _stateStore.Save(_state);
        await EnterMainAsync(session, cancellationToken);
    }

    private async Task EnterMainAsync(SessionResponse session, CancellationToken cancellationToken)
    {
        LoginView.Visibility = Visibility.Collapsed;
        PasswordChangeView.Visibility = Visibility.Collapsed;
        MainView.Visibility = Visibility.Visible;
        AccountText.Text = $"{session.User.DisplayName} · {session.User.Username}";
        await SynchronizeAsync(showBusy: false, cancellationToken);
        await RefreshConnectionsAsync(cancellationToken);
        _syncTimer.Start();
        _heartbeatTimer.Start();
        StartRealtime();
    }

    private async Task RefreshConnectionsAsync(CancellationToken cancellationToken)
    {
        var result = await _api.GetConnectionsAsync(cancellationToken);
        _connections.Clear();
        foreach (var item in result.Items) _connections.Add(item);
    }

    private async void SyncButton_Click(object sender, RoutedEventArgs e)
    {
        if (_repairRequired)
            await RepairClientAsync();
        else
            await SynchronizeAsync(showBusy: true);
    }

    private async Task SynchronizeAsync(bool showBusy, CancellationToken cancellationToken = default)
    {
        if (_paused || string.IsNullOrWhiteSpace(_state.DeviceId) || MainView.Visibility != Visibility.Visible) return;
        if (!await _syncLock.WaitAsync(0, cancellationToken))
        {
            // 已有同步在进行：登记待处理标记，由持锁方在结束后补跑一轮，
            // 避免 realtime 推送被静默丢弃后要等 3 分钟定时器兜底。
            Interlocked.Exchange(ref _syncPending, 1);
            // 再抢一次锁，弥补“持锁方刚检查完标记、这里才置位”的窗口。
            if (!await _syncLock.WaitAsync(0, cancellationToken)) return;
        }
        Interlocked.Exchange(ref _syncPending, 0);
        try
        {
            if (showBusy)
            {
                SyncButton.IsEnabled = false;
                SyncButton.Content = "正在同步…";
                StatusHeadlineText.Text = "正在同步配置";
            }
            var needsLease = ShouldRequestLease(_agentState, _lastAppliedLeaseExpires, DateTimeOffset.UtcNow);
            var sync = await _api.SyncAsync(
                _state.DeviceId,
                _state.LastConfigVersion,
                needsLease ? null : _lastAppliedLeaseExpires,
                cancellationToken);
            if (sync.FullSync)
            {
                _state.CachedConnections = sync.Connections;
                _state.LastConfigVersion = sync.TargetConfigVersion;
            }
            var complete = sync with { Connections = _state.CachedConnections };
            var shouldApply = sync.FullSync || _agentState is "Offline" or "Error" or "RepairRequired" or "ExpiredStop" ||
                !_lastAppliedLeaseExpires.HasValue || _lastAppliedLeaseExpires <= DateTimeOffset.UtcNow.AddMinutes(15);
            if (shouldApply)
            {
                if (sync.Lease is null) throw new InvalidDataException("控制中心未返回应用配置所需的租约");
                if (await _supervisor.ApplyAsync(_state, complete, cancellationToken))
                    _lastAppliedLeaseExpires = sync.Lease.ExpiresAt;
            }
            _stateStore.Save(_state);
            if (sync.FullSync) await RefreshConnectionsAsync(cancellationToken);
        }
        catch (ApiException error) when (error.ErrorCode is "DEVICE_REVOKED" or "USER_DISABLED" or "SESSION_REVOKED")
        {
            _logger.Warn("SUBJECT_REVOKED", error.ErrorCode);
            await LocalLogoutAsync(requestServer: false);
            LoginError.Text = "账号或设备已被撤销，请联系管理员。";
        }
        catch (Exception error)
        {
            _logger.Warn("SYNC_FAILED", SafeMessage(error));
            ApplyAgentStatus(new AgentSnapshot(
                "Degraded",
                "控制中心暂不可达；现有租约到期前继续运行。",
                _lastAppliedLeaseExpires,
                _state.AppliedConfigVersion));
        }
        finally
        {
            if (showBusy)
            {
                SyncButton.Content = _repairRequired ? "修复客户端" : "立即同步";
                SyncButton.IsEnabled = true;
            }
            _syncLock.Release();
        }
        if (Interlocked.Exchange(ref _syncPending, 0) == 1)
            await SynchronizeAsync(showBusy: false, cancellationToken);
    }

    private async Task RepairClientAsync()
    {
        SyncButton.IsEnabled = false;
        SyncButton.Content = "正在准备修复…";
        try
        {
            var release = await _updateService.CheckAsync(CancellationToken.None);
            var progress = new Progress<UpdateDownloadProgress>(value =>
            {
                SyncButton.Content = $"正在下载 {value.Percentage}%";
            });
            var installer = await _updateService.DownloadAsync(release, progress, CancellationToken.None);
            var verified = await _updateService.FindDownloadedInstallerAsync(release, CancellationToken.None);
            if (!string.Equals(installer, verified, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("修复安装包未通过最终校验。");

            BrandDialog.Show(
                this,
                "安全修复已准备好",
                "已从 Home Tunnel 官方更新源下载并校验安装包。点击确定后客户端会退出，请按中文安装向导完成覆盖安装。",
                BrandDialogTone.Success);
            Process.Start(new ProcessStartInfo(installer) { UseShellExecute = true });
            await ExitCompletelyAsync();
        }
        catch (Exception error)
        {
            _logger.Warn("CLIENT_REPAIR_FAILED", SafeMessage(error));
            BrandDialog.Show(
                this,
                "暂时无法修复",
                FriendlyUpdateDownloadError(error) + " 不要关闭 Defender 或添加排除项，请稍后重试。",
                BrandDialogTone.Danger);
        }
        finally
        {
            if (!_reallyExit)
            {
                SyncButton.Content = "修复客户端";
                SyncButton.IsEnabled = true;
            }
        }
    }

    private async Task HeartbeatAsync()
    {
        if (_paused || string.IsNullOrWhiteSpace(_state.DeviceId) || MainView.Visibility != Visibility.Visible) return;
        try
        {
            await _api.HeartbeatAsync(_state.DeviceId, _state.AppliedConfigVersion, _state.CachedConnections, CancellationToken.None);
        }
        catch (Exception error)
        {
            _logger.Warn("HEARTBEAT_FAILED", SafeMessage(error));
        }
    }

    internal static bool ShouldRequestLease(string agentState, DateTimeOffset? leaseExpiresAt, DateTimeOffset now) =>
        agentState is not "Online" || !leaseExpiresAt.HasValue || leaseExpiresAt.Value <= now.AddMinutes(15);

    private void StartRealtime()
    {
        StopRealtime();
        if (string.IsNullOrWhiteSpace(_state.DeviceId)) return;
        var cancellation = new CancellationTokenSource();
        var api = _api;
        var deviceId = _state.DeviceId;
        _realtimeCancellation = cancellation;
        _realtimeTask = Task.Run(() => RealtimeLoopAsync(api, deviceId, cancellation.Token));
    }

    private void StopRealtime()
    {
        var cancellation = _realtimeCancellation;
        var task = _realtimeTask;
        _realtimeCancellation = null;
        _realtimeTask = null;
        if (cancellation is null) return;
        cancellation.Cancel();
        if (task is null)
            cancellation.Dispose();
        else
            _ = task.ContinueWith(
                _ => cancellation.Dispose(),
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
    }

    private async Task RealtimeLoopAsync(ApiClient api, string deviceId, CancellationToken cancellationToken)
    {
        var retryDelay = TimeSpan.FromSeconds(1);
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await api.ListenForConfigurationChangesAsync(
                    deviceId,
                    async () => await Dispatcher.InvokeAsync(
                        async () => await SynchronizeAsync(showBusy: false, cancellationToken),
                        DispatcherPriority.Background).Task.Unwrap(),
                    cancellationToken);
                retryDelay = TimeSpan.FromSeconds(1);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (ApiException error) when (
                error.StatusCode == 401 ||
                error.ErrorCode is "DEVICE_REVOKED" or "USER_DISABLED" or "SESSION_REVOKED")
            {
                // 会话/设备已被撤销，重试没有意义：退出循环并走与 SynchronizeAsync
                // 相同的本地登出流程。
                _logger.Warn("REALTIME_REVOKED", SafeMessage(error));
                await Dispatcher.InvokeAsync(async () =>
                {
                    await LocalLogoutAsync(requestServer: false);
                    LoginError.Text = "账号或设备已被撤销，请联系管理员。";
                }, DispatcherPriority.Background).Task.Unwrap();
                return;
            }
            catch (Exception error)
            {
                _logger.Warn("REALTIME_RECONNECT", SafeMessage(error));
            }
            try
            {
                await Task.Delay(retryDelay, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            retryDelay = TimeSpan.FromSeconds(Math.Min(30, retryDelay.TotalSeconds * 2));
        }
    }

    private async void NewConnectionButton_Click(object sender, RoutedEventArgs e) =>
        await ShowConnectionDialogAsync(sender as System.Windows.Controls.Button ?? NewConnectionButton, null);

    private async void EditConnectionButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is System.Windows.Controls.Button { Tag: TunnelConnection connection } button)
            await ShowConnectionDialogAsync(button, connection);
    }

    private async Task ShowConnectionDialogAsync(System.Windows.Controls.Button trigger, TunnelConnection? snapshot)
    {
        var dialog = new ConnectionDialog(
            this,
            snapshot,
            async (value, token) =>
            {
                try
                {
                    if (snapshot is null)
                    {
                        value.DeviceId = _state.DeviceId ?? "";
                        await _api.CreateConnectionAsync(_state.DeviceId!, value, token);
                    }
                    else
                    {
                        await _api.UpdateConnectionAsync(value, token);
                    }
                }
                catch (ApiException error) when (error.ErrorCode == "VERSION_CONFLICT")
                {
                    await RefreshConnectionsAsync(token);
                    throw;
                }
            },
            snapshot is null ? null : async (value, token) => await _api.DeleteConnectionAsync(value, token),
            _state.TunnelDomain);

        dialog.ShowDialog();
        try
        {
            if (dialog.Result.Action is ConnectionDialogAction.Saved or ConnectionDialogAction.Deleted)
            {
                StatusHeadlineText.Text = "正在刷新连接";
                _state.LastConfigVersion = 0;
                await SynchronizeAsync(showBusy: false);
            }
        }
        catch (Exception error)
        {
            _logger.Warn("CONNECTION_REFRESH_FAILED", SafeMessage(error));
            BrandDialog.Show(this, "连接已提交", "服务器已接受本次操作，但列表刷新暂时失败。客户端会继续自动同步。", BrandDialogTone.Warning);
        }
        finally
        {
            if (trigger.IsLoaded) trigger.Focus();
            else NewConnectionButton.Focus();
        }
    }

    private async void PauseButton_Click(object sender, RoutedEventArgs e) => await TogglePauseAsync();

    private async Task TogglePauseAsync()
    {
        var pause = !_paused;
        PauseButton.IsEnabled = false;
        PauseButton.Content = pause ? "正在暂停…" : "正在恢复…";
        try
        {
            if (pause)
            {
                // 操作成功后再翻转状态，失败时保持原状态避免 UI 与实际不一致。
                await _supervisor.StopAsync("用户已暂停隧道");
                _paused = true;
                StatusHeadlineText.Text = "隧道已暂停";
            }
            else
            {
                _paused = false;
                StatusHeadlineText.Text = "正在恢复隧道";
                _state.LastConfigVersion = 0;
                try
                {
                    await SynchronizeAsync(showBusy: false);
                }
                catch
                {
                    _paused = true;
                    StatusHeadlineText.Text = "隧道已暂停";
                    throw;
                }
            }
        }
        catch (Exception error)
        {
            _logger.Warn("PAUSE_TOGGLE_FAILED", SafeMessage(error));
            BrandDialog.Show(this, "操作未完成", pause ? "暂停隧道时发生异常，请重试。" : "恢复隧道时发生异常，请重试。", BrandDialogTone.Warning);
        }
        finally
        {
            PauseButton.Content = _paused ? "恢复隧道" : "暂停隧道";
            PauseButton.IsEnabled = true;
        }
    }

    private void DiagnosticsButton_Click(object sender, RoutedEventArgs e)
    {
        MoreMenuPopup.IsOpen = false;
        ExportDiagnostics();
    }

    private void ExportDiagnostics()
    {
        try
        {
            var path = _diagnostics.Export(_state);
            BrandDialog.Show(
                this,
                "诊断已导出",
                "诊断包已生成，并已排除密码、设备凭据、令牌、租约和本地主机名。",
                BrandDialogTone.Success,
                details: path);
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
        }
        catch (Exception error)
        {
            BrandDialog.Show(this, "导出失败", Friendly(error), BrandDialogTone.Danger);
        }
    }

    private async void LogoutButton_Click(object sender, RoutedEventArgs e)
    {
        MoreMenuPopup.IsOpen = false;
        if (!BrandDialog.Confirm(
                this,
                "退出当前账号",
                "退出账号会立即停止本机所有隧道，并删除这台电脑保存的设备凭据。",
                "退出账号",
                BrandDialogTone.Danger,
                "取消"))
            return;
        await WithBusyAsync("正在退出并停止隧道…", async _ => await LocalLogoutAsync(requestServer: true));
    }

    private async Task LocalLogoutAsync(bool requestServer)
    {
        _syncTimer.Stop();
        _heartbeatTimer.Stop();
        StopRealtime();
        try { if (requestServer) await _api.LogoutAsync(CancellationToken.None); } catch (Exception error) { _logger.Warn("LOGOUT_REMOTE_FAILED", SafeMessage(error)); }
        await _supervisor.ClearSensitiveRuntimeAsync();
        if (_state.DeviceId is not null)
        {
            CredentialStore.Delete(CredentialStore.Target(_state.ServerBaseUrl, _state.DeviceId));
            CredentialStore.Delete(CredentialStore.LegacyTarget(_state.DeviceId));
        }
        _state.DeviceId = null;
        _state.LastConfigVersion = 0;
        _state.AppliedConfigVersion = 0;
        _state.CachedConnections.Clear();
        _stateStore.Save(_state);
        _api.Dispose();
        _api = new ApiClient(_state.ApiBaseUrl);
        _connections.Clear();
        ShowLogin();
    }

    private async void AutoStartCheckBox_Changed(object sender, RoutedEventArgs e)
    {
        if (_initializing) return;
        _state.StartWithWindows = AutoStartCheckBox.IsChecked == true;
        LocalStateStore.SetAutoStart(_state.StartWithWindows);
        _stateStore.Save(_state);
        await Task.CompletedTask;
    }

    private void ThemeToggleButton_Click(object sender, RoutedEventArgs e)
    {
        _state.Theme = App.CurrentTheme == "dark" ? "light" : "dark";
        App.ApplyTheme(_state.Theme);
        RefreshAgentStatusTheme();
        _stateStore.Save(_state);
        UpdateThemeToggleText();
    }

    private void UpdateThemeToggleText()
    {
        var switchToDark = App.CurrentTheme != "dark";
        ThemeToggleText.Text = switchToDark ? "切换到深色主题" : "切换到浅色主题";
        ThemeToggleButton.Tag = FindResource(switchToDark ? "IconMoon" : "IconSun");
        ThemeToggleButton.ToolTip = ThemeToggleText.Text;
        System.Windows.Automation.AutomationProperties.SetName(ThemeToggleButton, ThemeToggleText.Text);
    }

    private void RefreshAgentStatusTheme()
    {
        var visual = _agentState switch
        {
            "Online" => (Background: "SuccessSoftBrush", Border: "SuccessBorderBrush", Dot: "SuccessDotBrush", Text: "SuccessBrush"),
            "Applying" => (Background: "PrimarySoftBrush", Border: "PrimaryBorderBrush", Dot: "PrimaryBrush", Text: "PrimaryBrush"),
            "Degraded" => (Background: "WarningSoftBrush", Border: "WarningBorderBrush", Dot: "WarningDotBrush", Text: "WarningBrush"),
            "RepairRequired" or "Error" or "ExpiredStop" => (Background: "DangerSoftBrush", Border: "DangerBorderBrush", Dot: "DangerDotBrush", Text: "DangerBrush"),
            _ => (Background: "SurfaceMutedBrush", Border: "BorderStrongBrush", Dot: "MutedBrush", Text: "TextSecondaryBrush"),
        };
        AgentStatusBadge.Background = (MediaBrush)FindResource(visual.Background);
        AgentStatusBadge.BorderBrush = (MediaBrush)FindResource(visual.Border);
        AgentStatusDot.Background = (MediaBrush)FindResource(visual.Dot);
        AgentStatusText.Foreground = (MediaBrush)FindResource(visual.Text);
    }

    private void MoreButton_Click(object sender, RoutedEventArgs e)
    {
        MoreMenuPopup.IsOpen = !MoreMenuPopup.IsOpen;
        if (MoreMenuPopup.IsOpen)
            Dispatcher.BeginInvoke(() => CheckUpdateMenuButton.Focus(), DispatcherPriority.Input);
    }

    private void MoreMenuPopup_Closed(object sender, EventArgs e)
    {
        if (IsActive) MoreButton.Focus();
    }

    private void ApplyAgentStatus(AgentSnapshot snapshot)
    {
        _agentState = snapshot.State;
        _repairRequired = snapshot.State == "RepairRequired";
        var visual = snapshot.State switch
        {
            "Online" => (Label: "隧道在线", Background: "SuccessSoftBrush", Border: "SuccessBorderBrush", Dot: "SuccessDotBrush", Text: "SuccessBrush"),
            "Applying" => (Label: "正在应用", Background: "PrimarySoftBrush", Border: "PrimaryBorderBrush", Dot: "PrimaryBrush", Text: "PrimaryBrush"),
            "Degraded" => (Label: "连接受限", Background: "WarningSoftBrush", Border: "WarningBorderBrush", Dot: "WarningDotBrush", Text: "WarningBrush"),
            "RepairRequired" => (Label: "需要修复", Background: "DangerSoftBrush", Border: "DangerBorderBrush", Dot: "DangerDotBrush", Text: "DangerBrush"),
            "Error" => (Label: "运行异常", Background: "DangerSoftBrush", Border: "DangerBorderBrush", Dot: "DangerDotBrush", Text: "DangerBrush"),
            "ExpiredStop" => (Label: "租约已过期", Background: "DangerSoftBrush", Border: "DangerBorderBrush", Dot: "DangerDotBrush", Text: "DangerBrush"),
            _ => (Label: "隧道已停止", Background: "SurfaceMutedBrush", Border: "BorderStrongBrush", Dot: "MutedBrush", Text: "TextSecondaryBrush"),
        };
        RefreshAgentStatusTheme();
        AgentStatusText.Text = visual.Label;
        StatusHeadlineText.Text = _paused ? "隧道已暂停" : snapshot.State switch
        {
            "Online" => "连接运行正常",
            "Applying" => "正在应用最新配置",
            "Degraded" => "控制中心连接受限",
            "RepairRequired" => "客户端组件需要修复",
            "Error" => "连接需要处理",
            "ExpiredStop" => "安全租约已过期",
            _ => "隧道当前已停止",
        };
        AgentStatusBadge.ToolTip = $"Agent 状态：{snapshot.State}";
        LeaseStatusText.Text = snapshot.LeaseExpiresAt.HasValue
            ? $"{snapshot.Message}\n租约至 {snapshot.LeaseExpiresAt.Value.ToLocalTime():yyyy-MM-dd HH:mm}"
            : snapshot.Message;
        if (!_paused) SyncButton.Content = _repairRequired ? "修复客户端" : "立即同步";
        var trayText = $"Home Tunnel - {visual.Label}";
        _tray.Text = trayText[..Math.Min(63, trayText.Length)];
    }

    private void ShowLogin()
    {
        MoreMenuPopup.IsOpen = false;
        MainView.Visibility = Visibility.Collapsed;
        PasswordChangeView.Visibility = Visibility.Collapsed;
        LoginView.Visibility = Visibility.Visible;
        PasswordBox.Password = "";
        if (string.IsNullOrWhiteSpace(ServerAddressBox.Text)) ServerAddressBox.Focus();
        else UsernameBox.Focus();
    }

    private void ClearPasswordFields()
    {
        CurrentPasswordBox.Password = "";
        NewPasswordBox.Password = "";
        ConfirmPasswordBox.Password = "";
        _pendingUsername = null;
    }

    private async Task WithBusyAsync(string message, Func<CancellationToken, Task> action)
    {
        SetBusy(true, message);
        try { await action(CancellationToken.None); }
        finally { SetBusy(false); }
    }

    private void SetBusy(bool busy, string message = "正在处理…")
    {
        BusyText.Text = message;
        LoginView.IsEnabled = !busy;
        PasswordChangeView.IsEnabled = !busy;
        MainView.IsEnabled = !busy;
        BusyOverlay.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        Mouse.OverrideCursor = busy ? System.Windows.Input.Cursors.Wait : null;
    }

    private void ApplyWorkAreaBounds()
    {
        var workArea = SystemParameters.WorkArea;
        Height = Math.Max(620, Math.Min(720, workArea.Height - 16));
        Width = Math.Max(440, Math.Min(480, workArea.Width - 16));
    }

    private static string Friendly(Exception error) => error switch
    {
        ApiException api => api.Message,
        InvalidDataException invalid => invalid.Message,
        HttpRequestException => "无法连接控制中心，请检查网络后重试。",
        TaskCanceledException => "请求超时，请稍后重试。",
        _ => "操作失败，请查看脱敏诊断日志。",
    };

    private static string SafeMessage(Exception error) => error is ApiException api ? $"{api.ErrorCode}: {api.Message}" : error.GetType().Name;

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_reallyExit) return;
        e.Cancel = true;
        Hide();
        _tray.ShowBalloonTip(2500, "Home Tunnel 仍在运行", "关闭窗口只会最小化到托盘；隧道不会停止。", Forms.ToolTipIcon.Info);
    }

    private void ShowWindow()
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(ShowWindow);
            return;
        }
        Show();
        WindowState = WindowState.Normal;
        Activate();
        Dispatcher.BeginInvoke(ShowPendingUpdateIfAny, DispatcherPriority.ApplicationIdle);
    }

    private async Task ExitCompletelyAsync()
    {
        _reallyExit = true;
        _updateDownloadCancellation?.Cancel();
        _syncTimer.Stop();
        _heartbeatTimer.Stop();
        StopRealtime();
        await _supervisor.StopAsync("用户完全退出应用");
        _tray.Visible = false;
        _tray.Dispose();
        _trayIcon?.Dispose();
        _api.Dispose();
        _updateService.Dispose();
        _supervisor.Dispose();
        System.Windows.Application.Current.Shutdown();
    }

    private sealed class HomeTunnelColorTable : Forms.ProfessionalColorTable
    {
        private static readonly System.Drawing.Color PrimarySoft = System.Drawing.Color.FromArgb(0xEB, 0xF2, 0xFF);
        private static readonly System.Drawing.Color Border = System.Drawing.Color.FromArgb(0xEA, 0xEC, 0xF0);

        public override System.Drawing.Color ToolStripDropDownBackground => System.Drawing.Color.White;
        public override System.Drawing.Color MenuBorder => Border;
        public override System.Drawing.Color MenuItemBorder => System.Drawing.Color.FromArgb(0xB8, 0xD2, 0xFA);
        public override System.Drawing.Color MenuItemSelected => PrimarySoft;
        public override System.Drawing.Color MenuItemSelectedGradientBegin => PrimarySoft;
        public override System.Drawing.Color MenuItemSelectedGradientEnd => PrimarySoft;
        public override System.Drawing.Color MenuItemPressedGradientBegin => PrimarySoft;
        public override System.Drawing.Color MenuItemPressedGradientEnd => PrimarySoft;
        public override System.Drawing.Color ImageMarginGradientBegin => System.Drawing.Color.White;
        public override System.Drawing.Color ImageMarginGradientMiddle => System.Drawing.Color.White;
        public override System.Drawing.Color ImageMarginGradientEnd => System.Drawing.Color.White;
        public override System.Drawing.Color SeparatorDark => Border;
        public override System.Drawing.Color SeparatorLight => System.Drawing.Color.White;
    }
}
