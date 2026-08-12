using System.ComponentModel;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using HomeTunnel.Client.Models;
using HomeTunnel.Client.Services;

namespace HomeTunnel.Client;

public enum ConnectionDialogAction
{
    None,
    Saved,
    Deleted,
}

public sealed record ConnectionDialogResult(ConnectionDialogAction Action, TunnelConnection? Connection);

public partial class ConnectionDialog : Window
{
    private readonly TunnelConnection? _snapshot;
    private readonly Func<TunnelConnection, CancellationToken, Task> _saveAction;
    private readonly Func<TunnelConnection, CancellationToken, Task>? _deleteAction;
    private readonly string _tunnelDomain;
    private string _baseline = "";
    private bool _isBusy;
    private bool _allowClose;

    public ConnectionDialog(
        Window owner,
        TunnelConnection? snapshot,
        Func<TunnelConnection, CancellationToken, Task> saveAction,
        Func<TunnelConnection, CancellationToken, Task>? deleteAction = null,
        string? tunnelDomain = null)
    {
        InitializeComponent();
        Owner = owner;
        _snapshot = snapshot is null ? null : Clone(snapshot);
        _saveAction = saveAction;
        _deleteAction = deleteAction;
        _tunnelDomain = NormalizeTunnelDomain(tunnelDomain);
        UpdatePublicAddressHint();
        SubdomainBox.TextChanged += (_, _) => UpdatePublicAddressHint();

        if (_snapshot is null)
        {
            DialogTitleText.Text = "新建连接";
            DialogSubtitleText.Text = "映射本地服务至公网，生成专属访问地址";
            HeaderIconPath.Data = (System.Windows.Media.Geometry)FindResource("IconPlus");
            DeleteButton.Visibility = Visibility.Collapsed;
            EnabledBox.Content = "创建后立即启用公网访问";
        }
        else
        {
            DialogTitleText.Text = "编辑连接";
            DialogSubtitleText.Text = "修改连接配置与本地服务目标";
            HeaderIconPath.Data = (System.Windows.Media.Geometry)FindResource("IconEdit");
            HeaderIconBorder.Background = (System.Windows.Media.Brush)FindResource("SurfaceMutedBrush");
            HeaderIconBorder.BorderBrush = (System.Windows.Media.Brush)FindResource("BorderStrongBrush");
            ConnectionNameBox.Text = _snapshot.Name;
            SubdomainBox.Text = _snapshot.Subdomain;
            SchemeBox.SelectedIndex = _snapshot.LocalScheme == "https" ? 1 : 0;
            EnabledBox.IsChecked = _snapshot.Enabled;
            LocalHostBox.Text = _snapshot.LocalHost;
            LocalPortBox.Text = _snapshot.LocalPort.ToString();
            DeleteButton.Visibility = _deleteAction is null ? Visibility.Collapsed : Visibility.Visible;
            EnabledBox.Content = "启用公网访问";
            UpdatePublicAddressHint();
        }

        Loaded += (_, _) =>
        {
            _baseline = CaptureForm();
            ConnectionNameBox.Focus();
            ConnectionNameBox.SelectAll();
        };
    }

    public ConnectionDialogResult Result { get; private set; } = new(ConnectionDialogAction.None, null);

    private async void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy) return;
        ShowDialogError("");
        var value = BuildValue();
        if (value is null) return;

        SetBusy(true, "正在验证本地目标…");
        try
        {
            if (!await ProbeLocalAsync(value.LocalHost, value.LocalPort) &&
                !BrandDialog.Confirm(
                    this,
                    "本地目标暂不可达",
                    "Home Tunnel 当前无法连接这个本地地址。保存后，连接会以等待或异常状态同步。",
                    "仍然保存",
                    BrandDialogTone.Warning,
                    "返回修改",
                    $"{value.LocalScheme}://{value.LocalHost}:{value.LocalPort}"))
                return;

            SetBusy(true, "正在保存连接…");
            await _saveAction(value, CancellationToken.None);
            Result = new ConnectionDialogResult(ConnectionDialogAction.Saved, value);
            _allowClose = true;
            DialogResult = true;
        }
        catch (ApiException error) when (error.ErrorCode == "VERSION_CONFLICT")
        {
            ShowDialogError("这条连接已在其他位置更新。列表已经刷新，请关闭后重新打开并核对最新配置。");
        }
        catch (Exception error)
        {
            ShowDialogError(Friendly(error));
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void DeleteButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || _snapshot is null || _deleteAction is null) return;
        if (!BrandDialog.Confirm(
                this,
                "删除连接",
                $"确认删除“{_snapshot.Name}”吗？公网地址会立即失效。",
                "删除连接",
                BrandDialogTone.Danger,
                "取消",
                string.IsNullOrWhiteSpace(_snapshot.PublicUrl)
                    ? $"https://{_snapshot.Subdomain}.{_tunnelDomain}"
                    : _snapshot.PublicUrl))
            return;

        ShowDialogError("");
        SetBusy(true, "正在删除连接…");
        try
        {
            await _deleteAction(_snapshot, CancellationToken.None);
            Result = new ConnectionDialogResult(ConnectionDialogAction.Deleted, _snapshot);
            _allowClose = true;
            DialogResult = true;
        }
        catch (Exception error)
        {
            ShowDialogError(Friendly(error));
        }
        finally
        {
            SetBusy(false);
        }
    }

    private TunnelConnection? BuildValue()
    {
        var name = ConnectionNameBox.Text.Trim();
        var subdomain = SubdomainBox.Text.Trim().ToLowerInvariant();
        var localHost = LocalHostBox.Text.Trim();

        if (name.Length == 0)
        {
            ShowError("请输入连接名称。", ConnectionNameBox);
            return null;
        }
        if (!Regex.IsMatch(subdomain, "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"))
        {
            ShowError("子域只能包含小写字母、数字和连字符，且首尾不能为连字符。", SubdomainBox, selectAll: true);
            return null;
        }
        if (localHost.Length == 0)
        {
            ShowError("请输入本地主机地址。", LocalHostBox);
            return null;
        }
        if (!int.TryParse(LocalPortBox.Text, out var port) || port is < 1 or > 65535)
        {
            ShowError("本地端口必须是 1–65535。", LocalPortBox, selectAll: true);
            return null;
        }

        return new TunnelConnection
        {
            Id = _snapshot?.Id ?? "",
            DeviceId = _snapshot?.DeviceId ?? "",
            Name = name,
            Subdomain = subdomain,
            PublicUrl = _snapshot?.PublicUrl ?? $"https://{subdomain}.{_tunnelDomain}",
            LocalScheme = ((ComboBoxItem)SchemeBox.SelectedItem).Content?.ToString() ?? "http",
            LocalHost = localHost,
            LocalPort = port,
            Enabled = EnabledBox.IsChecked == true,
            Version = _snapshot?.Version ?? 0,
            State = _snapshot?.State ?? "Pending",
            AppliedVersion = _snapshot?.AppliedVersion ?? 0,
            LastErrorCode = _snapshot?.LastErrorCode,
            ProxyName = _snapshot?.ProxyName,
        };
    }

    private void ShowError(string message, System.Windows.Controls.TextBox field, bool selectAll = false)
    {
        ShowDialogError(message);
        field.Focus();
        if (selectAll) field.SelectAll();
    }

    private void SetBusy(bool busy, string message = "正在处理…")
    {
        _isBusy = busy;
        BusyText.Text = message;
        BusyText.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        TopProgressBar.Visibility = busy ? Visibility.Visible : Visibility.Hidden;
        FormPanel.IsEnabled = !busy;
        DeleteButton.IsEnabled = !busy;
        CancelButton.IsEnabled = !busy;
        SaveButton.IsEnabled = !busy;
        Mouse.OverrideCursor = busy ? System.Windows.Input.Cursors.Wait : null;
    }

    private void ShowDialogError(string message)
    {
        DialogError.Text = message;
        ErrorBanner.Visibility = string.IsNullOrWhiteSpace(message)
            ? Visibility.Collapsed
            : Visibility.Visible;
    }

    private void UpdatePublicAddressHint()
    {
        var subdomain = SubdomainBox.Text.Trim().ToLowerInvariant();
        PublicAddressHint.Text = $"https://{(subdomain.Length == 0 ? "<子域>" : subdomain)}.{_tunnelDomain}";
    }

    private void RequestClose()
    {
        if (_isBusy) return;
        Close();
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e) => RequestClose();

    private void Window_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != Key.Escape) return;
        e.Handled = true;
        RequestClose();
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_allowClose) return;
        if (_isBusy)
        {
            e.Cancel = true;
            return;
        }
        if (CaptureForm() == _baseline) return;
        if (BrandDialog.Confirm(
                this,
                "放弃未保存的修改",
                "关闭后，本次填写的连接参数不会保存。",
                "放弃修改",
                BrandDialogTone.Warning,
                "继续编辑"))
        {
            _allowClose = true;
            return;
        }
        e.Cancel = true;
    }

    private string CaptureForm() => string.Join("\u001f", new[]
    {
        ConnectionNameBox.Text,
        SubdomainBox.Text,
        SchemeBox.SelectedIndex.ToString(),
        EnabledBox.IsChecked == true ? "1" : "0",
        LocalHostBox.Text,
        LocalPortBox.Text,
    });

    private static async Task<bool> ProbeLocalAsync(string host, int port)
    {
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(host, port).WaitAsync(TimeSpan.FromSeconds(2));
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string Friendly(Exception error) => error switch
    {
        ApiException api => api.Message,
        HttpRequestException => "无法连接控制中心，请检查网络后重试。",
        TaskCanceledException => "请求超时，请稍后重试。",
        _ => "操作失败，请查看脱敏诊断日志。",
    };

    private static string NormalizeTunnelDomain(string? value)
    {
        var normalized = value?.Trim().Trim('.').ToLowerInvariant();
        return !string.IsNullOrWhiteSpace(normalized) &&
               Regex.IsMatch(normalized, "^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", RegexOptions.CultureInvariant)
            ? normalized
            : ProductConfiguration.TunnelDomain;
    }

    private static TunnelConnection Clone(TunnelConnection source) => new()
    {
        Id = source.Id,
        DeviceId = source.DeviceId,
        Name = source.Name,
        Subdomain = source.Subdomain,
        PublicUrl = source.PublicUrl,
        LocalScheme = source.LocalScheme,
        LocalHost = source.LocalHost,
        LocalPort = source.LocalPort,
        Enabled = source.Enabled,
        Version = source.Version,
        State = source.State,
        AppliedVersion = source.AppliedVersion,
        LastErrorCode = source.LastErrorCode,
        ProxyName = source.ProxyName,
    };
}
