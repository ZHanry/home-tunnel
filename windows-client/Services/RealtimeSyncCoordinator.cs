using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

/// <summary>
/// Owns the lifecycle and reconnect policy for the device realtime channel.
/// UI dispatch and synchronization remain injected callbacks, so this service
/// contains no WPF dependency and can be exercised in a normal test runner.
/// </summary>
internal sealed class RealtimeSyncCoordinator : IDisposable
{
    private readonly SafeLogger _logger;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly object _gate = new();
    private CancellationTokenSource? _cancellation;
    private Task? _loopTask;

    internal RealtimeSyncCoordinator(
        SafeLogger logger,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _logger = logger;
        _delay = delay ?? Task.Delay;
    }

    public void Start(
        ApiClient api,
        string? deviceId,
        Func<CancellationToken, Task> synchronize,
        Func<ApiException, Task> revoked)
    {
        Stop();
        if (string.IsNullOrWhiteSpace(deviceId)) return;

        var cancellation = new CancellationTokenSource();
        lock (_gate)
        {
            _cancellation = cancellation;
            _loopTask = Task.Run(
                () => RunLoopAsync(api, deviceId, synchronize, revoked, cancellation.Token),
                CancellationToken.None);
        }
    }

    public void Stop()
    {
        CancellationTokenSource? cancellation;
        Task? task;
        lock (_gate)
        {
            cancellation = _cancellation;
            task = _loopTask;
            _cancellation = null;
            _loopTask = null;
        }
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

    private async Task RunLoopAsync(
        ApiClient api,
        string deviceId,
        Func<CancellationToken, Task> synchronize,
        Func<ApiException, Task> revoked,
        CancellationToken cancellationToken)
    {
        var retryDelay = TimeSpan.FromSeconds(1);
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await api.ListenForConfigurationChangesAsync(
                    deviceId,
                    async () => await synchronize(cancellationToken),
                    cancellationToken);
                retryDelay = TimeSpan.FromSeconds(1);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (ApiException error) when (IsTerminalRevocation(error))
            {
                _logger.Warn("REALTIME_REVOKED", SafeMessage(error));
                await revoked(error);
                return;
            }
            catch (Exception error)
            {
                _logger.Warn("REALTIME_RECONNECT", SafeMessage(error));
            }

            try
            {
                await _delay(retryDelay, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            retryDelay = NextRetryDelay(retryDelay);
        }
    }

    internal static bool IsTerminalRevocation(ApiException error) =>
        error.StatusCode == 401 ||
        error.ErrorCode is "DEVICE_REVOKED" or "USER_DISABLED" or "SESSION_REVOKED";

    internal static TimeSpan NextRetryDelay(TimeSpan current) =>
        TimeSpan.FromSeconds(Math.Min(30, Math.Max(1, current.TotalSeconds * 2)));

    private static string SafeMessage(Exception error) =>
        error is ApiException api ? $"{api.ErrorCode}: {api.Message}" : error.GetType().Name;

    public void Dispose() => Stop();
}
