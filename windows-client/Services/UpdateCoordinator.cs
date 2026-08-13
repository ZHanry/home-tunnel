using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

/// <summary>
/// Owns update discovery/download state while the window remains responsible
/// only for user prompts and launching a re-verified installer.
/// </summary>
internal sealed class UpdateCoordinator : IDisposable
{
    private readonly UpdateService _service;
    private readonly LocalState _state;
    private readonly LocalStateStore _stateStore;
    private readonly SafeLogger _logger;
    private CancellationTokenSource? _downloadCancellation;
    private Task? _downloadTask;

    public UpdateCoordinator(
        UpdateService service,
        LocalState state,
        LocalStateStore stateStore,
        SafeLogger logger)
    {
        _service = service;
        _state = state;
        _stateStore = stateStore;
        _logger = logger;
    }

    public event Action? StateChanged;
    public event Action<UpdateCheckResult>? DownloadReady;

    public UpdateCheckResult? AvailableUpdate { get; private set; }
    public string? AvailableVersion => AvailableUpdate?.Release.Version;
    public string? DownloadedInstallerPath { get; private set; }
    public int DownloadPercentage { get; private set; }
    public bool IsDownloading => _downloadTask is { IsCompleted: false };

    public async Task<UpdateCheckResult?> CheckAsync(CancellationToken cancellationToken)
    {
        var result = await _service.CheckIfAvailableAsync(cancellationToken);
        if (result is null || !result.IsUpdateAvailable)
        {
            ClearAvailableUpdate();
            return result;
        }

        AvailableUpdate = result;
        DownloadedInstallerPath = await _service.FindDownloadedInstallerAsync(result, cancellationToken);
        DownloadPercentage = DownloadedInstallerPath is null ? 0 : 100;
        NotifyStateChanged();
        return result;
    }

    public bool StartDownload(
        UpdateCheckResult result,
        bool userRequested,
        Func<Exception, Task<bool>> shouldRetry)
    {
        if (IsDownloading) return false;
        AvailableUpdate = result;
        DownloadedInstallerPath = null;
        DownloadPercentage = 0;
        _state.DismissedUpdateVersion = null;
        _state.DismissedUpdateAtUtc = null;
        _stateStore.Save(_state);

        var cancellation = new CancellationTokenSource();
        _downloadCancellation = cancellation;
        _downloadTask = DownloadLoopAsync(result, userRequested, shouldRetry, cancellation);
        NotifyStateChanged();
        return true;
    }

    private async Task DownloadLoopAsync(
        UpdateCheckResult result,
        bool userRequested,
        Func<Exception, Task<bool>> shouldRetry,
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
                        DownloadPercentage = value.Percentage;
                        NotifyStateChanged();
                    });
                    completedPath = await _service.DownloadAsync(result, progress, cancellation.Token);
                    DownloadedInstallerPath = completedPath;
                    DownloadPercentage = 100;
                    NotifyStateChanged();
                    break;
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception error)
                {
                    _logger.Warn("UPDATE_DOWNLOAD_FAILED", SafeMessage(error));
                    if (!userRequested || !await shouldRetry(error)) break;
                }
            }
        }
        finally
        {
            if (ReferenceEquals(_downloadCancellation, cancellation))
            {
                _downloadTask = null;
                _downloadCancellation = null;
            }
            cancellation.Dispose();
            NotifyStateChanged();
        }

        if (completedPath is not null) DownloadReady?.Invoke(result);
    }

    public async Task<string?> FindVerifiedInstallerAsync(
        UpdateCheckResult result,
        CancellationToken cancellationToken)
    {
        var installer = await _service.FindDownloadedInstallerAsync(result, cancellationToken);
        DownloadedInstallerPath = installer;
        NotifyStateChanged();
        return installer;
    }

    public void Dismiss(string version, DateTimeOffset now)
    {
        _state.DismissedUpdateVersion = version;
        _state.DismissedUpdateAtUtc = now;
        _stateStore.Save(_state);
    }

	public bool IsAutomaticPromptSuppressed(string version, DateTimeOffset now) =>
		IsPromptSuppressed(version, _state.DismissedUpdateVersion, _state.DismissedUpdateAtUtc, now);

	internal static bool IsPromptSuppressed(
		string version,
		string? dismissedVersion,
		DateTimeOffset? dismissedAt,
		DateTimeOffset now) =>
		string.Equals(dismissedVersion, version, StringComparison.Ordinal) &&
		dismissedAt.HasValue &&
		now - dismissedAt.Value < TimeSpan.FromHours(24);

    public void ClearAvailableUpdate()
    {
        AvailableUpdate = null;
        DownloadedInstallerPath = null;
        DownloadPercentage = 0;
        NotifyStateChanged();
    }

    public void CancelDownload() => _downloadCancellation?.Cancel();

    private void NotifyStateChanged() => StateChanged?.Invoke();

    private static string SafeMessage(Exception error) =>
        error is ApiException api ? $"{api.ErrorCode}: {api.Message}" : error.GetType().Name;

    public void Dispose()
    {
        CancelDownload();
        _service.Dispose();
    }
}
