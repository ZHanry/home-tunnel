using System.Globalization;
using System.Windows.Data;

namespace HomeTunnel.Client;

public sealed class ConnectionStateConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => value?.ToString() switch
    {
        "Online" => "在线",
        "Applying" => "正在应用",
        "Disabled" => "已禁用",
        "Waiting" => "等待中",
        "Error" => "异常",
        "Offline" => "离线",
        { Length: > 0 } state => state,
        _ => "未知",
    };

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => System.Windows.Data.Binding.DoNothing;
}
