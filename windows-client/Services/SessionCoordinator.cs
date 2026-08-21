using HomeTunnel.Client.Models;

namespace HomeTunnel.Client.Services;

/// <summary>Owns registration persistence and local session teardown.</summary>
internal sealed class SessionCoordinator
{
    private readonly LocalStateStore _stateStore;
    private readonly LocalState _state;
    private readonly FrpcSupervisor _supervisor;

    public SessionCoordinator(LocalStateStore stateStore, LocalState state, FrpcSupervisor supervisor)
    {
        _stateStore = stateStore;
        _state = state;
        _supervisor = supervisor;
    }

    public void PersistRegistration(DeviceRegistration registration)
    {
        if (_state.DeviceId is not null && _state.DeviceId != registration.DeviceId)
        {
            CredentialStore.Delete(CredentialStore.Target(_state.ServerBaseUrl, _state.DeviceId));
            CredentialStore.Delete(CredentialStore.LegacyTarget(_state.DeviceId));
        }
        _state.DeviceId = registration.DeviceId;
        _state.LastConfigVersion = 0;
        _state.SyncCapabilityVersion = 0;
        _state.AppliedConfigVersion = 0;
        CredentialStore.Write(
            CredentialStore.Target(_state.ServerBaseUrl, registration.DeviceId),
            registration.DeviceCredential);
        _stateStore.Save(_state);
    }

    public async Task ClearLocalSessionAsync()
    {
        await _supervisor.ClearSensitiveRuntimeAsync();
        if (_state.DeviceId is not null)
        {
            CredentialStore.Delete(CredentialStore.Target(_state.ServerBaseUrl, _state.DeviceId));
            CredentialStore.Delete(CredentialStore.LegacyTarget(_state.DeviceId));
        }
        _state.DeviceId = null;
        _state.LastConfigVersion = 0;
        _state.SyncCapabilityVersion = 0;
        _state.AppliedConfigVersion = 0;
        _state.CachedConnections.Clear();
        _stateStore.Save(_state);
    }
}
