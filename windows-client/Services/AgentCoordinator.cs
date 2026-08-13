using System.IO;
using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

/// <summary>Coordinates lease decisions and the managed Agent apply lifecycle.</summary>
internal sealed class AgentCoordinator
{
    private readonly FrpcSupervisor _supervisor;
    private DateTimeOffset? _lastAppliedLeaseExpires;

    public AgentCoordinator(FrpcSupervisor supervisor) => _supervisor = supervisor;

    public DateTimeOffset? LastAppliedLeaseExpires => _lastAppliedLeaseExpires;

    public bool ShouldRequestLease(string agentState, DateTimeOffset now) =>
        ShouldRequestLease(agentState, _lastAppliedLeaseExpires, now);

    public bool ShouldApply(SyncResponse sync, string agentState, DateTimeOffset now) =>
        sync.FullSync ||
        agentState is "Offline" or "Error" or "RepairRequired" or "ExpiredStop" ||
        !_lastAppliedLeaseExpires.HasValue ||
        _lastAppliedLeaseExpires <= now.AddMinutes(15);

    public async Task ApplyIfRequiredAsync(
        LocalState state,
        SyncResponse sync,
        string agentState,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!ShouldApply(sync, agentState, now)) return;
        if (sync.Lease is null) throw new InvalidDataException("控制中心未返回应用配置所需的租约");
        if (await _supervisor.ApplyAsync(state, sync, cancellationToken))
            _lastAppliedLeaseExpires = sync.Lease.ExpiresAt;
    }

    internal static bool ShouldRequestLease(
        string agentState,
        DateTimeOffset? leaseExpiresAt,
        DateTimeOffset now) =>
        agentState is not "Online" ||
        !leaseExpiresAt.HasValue ||
        leaseExpiresAt.Value <= now.AddMinutes(15);
}
