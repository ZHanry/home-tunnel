using System.Windows;
using System.Windows.Media;
using MediaBrush = System.Windows.Media.Brush;

namespace HomeTunnel.Client;

public enum BrandDialogTone
{
    Information,
    Success,
    Warning,
    Danger,
}

public partial class BrandDialog : Window
{
    private BrandDialog(
        Window? owner,
        string title,
        string message,
        string primaryText,
        string? cancelText,
        BrandDialogTone tone,
        string? details)
    {
        InitializeComponent();
        if (owner is not null)
        {
            Owner = owner;
        }
        else
        {
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }

        Title = $"{title} - Home Tunnel";
        TitleText.Text = title;
        MessageText.Text = message;
        PrimaryButton.Content = primaryText;
        CancelButton.Content = cancelText ?? "取消";
        CancelButton.Visibility = cancelText is null ? Visibility.Collapsed : Visibility.Visible;
        EyebrowText.Text = tone switch
        {
            BrandDialogTone.Success => "操作已完成",
            BrandDialogTone.Warning => "需要确认",
            BrandDialogTone.Danger => "危险操作",
            _ => "Home Tunnel",
        };

        if (!string.IsNullOrWhiteSpace(details))
        {
            DetailsText.Text = details;
            DetailsPanel.Visibility = Visibility.Visible;
        }

        ApplyTone(tone);
        Loaded += (_, _) => PrimaryButton.Focus();
    }

    public static bool Confirm(
        Window owner,
        string title,
        string message,
        string primaryText,
        BrandDialogTone tone = BrandDialogTone.Warning,
        string cancelText = "取消",
        string? details = null) =>
        new BrandDialog(owner, title, message, primaryText, cancelText, tone, details).ShowDialog() == true;

    public static void Show(
        Window? owner,
        string title,
        string message,
        BrandDialogTone tone = BrandDialogTone.Information,
        string primaryText = "知道了",
        string? details = null) =>
        new BrandDialog(owner, title, message, primaryText, null, tone, details).ShowDialog();

    private void ApplyTone(BrandDialogTone tone)
    {
        var resources = tone switch
        {
            BrandDialogTone.Success => ("SuccessSoftBrush", "SuccessBorderBrush", "SuccessBrush", "IconCheck"),
            BrandDialogTone.Warning => ("WarningSoftBrush", "WarningBorderBrush", "WarningBrush", "IconAlert"),
            BrandDialogTone.Danger => ("DangerSoftBrush", "DangerBorderBrush", "DangerBrush", "IconAlert"),
            _ => ("PrimarySoftBrush", "PrimaryBorderBrush", "PrimaryBrush", "IconShield"),
        };
        IconBorder.Background = (MediaBrush)FindResource(resources.Item1);
        IconBorder.BorderBrush = (MediaBrush)FindResource(resources.Item2);
        IconPath.Stroke = (MediaBrush)FindResource(resources.Item3);
        IconPath.Data = (Geometry)FindResource(resources.Item4);
        EyebrowText.Foreground = (MediaBrush)FindResource(resources.Item3);

        if (tone == BrandDialogTone.Danger)
            PrimaryButton.Style = (Style)FindResource("DangerButtonStyle");
    }

    private void PrimaryButton_Click(object sender, RoutedEventArgs e) => DialogResult = true;

    private void CancelButton_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
