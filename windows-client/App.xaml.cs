using System.Threading;
using System.Windows;

namespace HomeTunnel.Client;

public partial class App : System.Windows.Application
{
    private Mutex? _singleInstance;

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
