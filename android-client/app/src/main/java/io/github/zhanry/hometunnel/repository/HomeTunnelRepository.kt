package io.github.zhanry.hometunnel.repository

import android.content.Context
import android.os.Build
import io.github.zhanry.hometunnel.model.AgentState
import io.github.zhanry.hometunnel.model.ApiException
import io.github.zhanry.hometunnel.model.PersistedState
import io.github.zhanry.hometunnel.model.ProxyKind
import io.github.zhanry.hometunnel.model.ServerProfile
import io.github.zhanry.hometunnel.model.SessionResponse
import io.github.zhanry.hometunnel.model.SyncMerger
import io.github.zhanry.hometunnel.model.SyncResponse
import io.github.zhanry.hometunnel.model.TunnelConnection
import io.github.zhanry.hometunnel.network.HomeTunnelApi
import io.github.zhanry.hometunnel.network.ServerDiscovery
import io.github.zhanry.hometunnel.storage.SecureStateStore
import io.github.zhanry.hometunnel.storage.StateUnavailableException
import io.github.zhanry.hometunnel.storage.installationFingerprint
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class AppScreen { LOADING, LOGIN, PASSWORD_CHANGE, HOME }

data class AppUiState(
    val screen: AppScreen = AppScreen.LOADING,
    val persisted: PersistedState = PersistedState(),
    val connections: List<TunnelConnection> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
)

data class SyncBundle(val state: PersistedState, val response: SyncResponse)

class HomeTunnelRepository(
    private val context: Context,
    val store: SecureStateStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val operationMutex = Mutex()
    private val _uiState = MutableStateFlow(AppUiState())
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    @Volatile
    private var api: HomeTunnelApi? = null
    @Volatile
    private var serviceActive: Boolean = false
    private var pendingLogin: PendingLogin? = null

    init {
        scope.launch {
            val state = try {
                store.load()
            } catch (error: StateUnavailableException) {
                _uiState.value = AppUiState(screen = AppScreen.LOGIN, error = error.message)
                return@launch
            }
            _uiState.value = AppUiState(
                screen = if (state.enrolled) AppScreen.HOME else AppScreen.LOGIN,
                persisted = state,
                connections = state.cachedConnections,
            )
            if (state.enrolled) refreshConnections(silent = true)
        }
    }

    fun login(server: String, username: String, password: String) = scope.launch {
        operationMutex.withLock {
            setBusy(true)
            try {
                val profile = ServerDiscovery.discover(server)
                val newApi = HomeTunnelApi(profile)
                val session = newApi.login(username.trim(), password)
                api = newApi
                if (session.passwordChangeRequired) {
                    pendingLogin = PendingLogin(profile, username.trim())
                    _uiState.value = _uiState.value.copy(
                        screen = AppScreen.PASSWORD_CHANGE,
                        busy = false,
                        error = null,
                    )
                } else {
                    registerAndEnter(profile, session)
                }
            } catch (error: Throwable) {
                setFailure(error)
            }
        }
    }

    fun changeRequiredPassword(currentPassword: String, newPassword: String) = scope.launch {
        operationMutex.withLock {
            val pending = pendingLogin ?: return@withLock setFailure(IllegalStateException("Login session expired"))
            val activeApi = api ?: return@withLock setFailure(IllegalStateException("Login session expired"))
            setBusy(true)
            try {
                activeApi.changePassword(currentPassword, newPassword)
                val session = activeApi.login(pending.username, newPassword)
                if (session.passwordChangeRequired) error("Server still requires a password change")
                pendingLogin = null
                registerAndEnter(pending.profile, session)
            } catch (error: Throwable) {
                setFailure(error)
            }
        }
    }

    fun cancelPasswordChange() {
        pendingLogin = null
        api?.clearSession()
        api = null
        _uiState.value = _uiState.value.copy(screen = AppScreen.LOGIN, busy = false, error = null)
    }

    fun refreshConnections(silent: Boolean = false) = scope.launch {
        if (!silent) setBusy(true)
        try {
            val state = _uiState.value.persisted
            val activeApi = ensureDeviceApi(state)
            val items = activeApi.listConnections().filter { it.deviceId == state.deviceId }
            _uiState.value = _uiState.value.copy(connections = items, busy = false, error = null)
        } catch (error: Throwable) {
            if (!silent) setFailure(error)
        }
    }

    fun saveConnection(value: TunnelConnection, isNew: Boolean) = scope.launch {
        operationMutex.withLock {
            setBusy(true)
            try {
                require(value.kind != ProxyKind.UNKNOWN) { "Unknown connection types are read-only" }
                val state = _uiState.value.persisted
                val activeApi = ensureDeviceApi(state)
                if (isNew) {
                    require(value.kind == ProxyKind.HTTP) { "Only HTTP connections can be created by a client" }
                    activeApi.createHttpConnection(requireNotNull(state.deviceId), value)
                } else {
                    activeApi.updateConnection(value)
                }
                val items = activeApi.listConnections().filter { it.deviceId == state.deviceId }
                _uiState.value = _uiState.value.copy(connections = items, busy = false, error = null)
            } catch (error: Throwable) {
                setFailure(error)
            }
        }
    }

    fun deleteConnection(value: TunnelConnection) = scope.launch {
        operationMutex.withLock {
            setBusy(true)
            try {
                require(value.kind != ProxyKind.UNKNOWN) { "Unknown connection types are read-only" }
                val state = _uiState.value.persisted
                val activeApi = ensureDeviceApi(state)
                activeApi.deleteConnection(value)
                val items = activeApi.listConnections().filter { it.deviceId == state.deviceId }
                _uiState.value = _uiState.value.copy(connections = items, busy = false, error = null)
            } catch (error: Throwable) {
                setFailure(error)
            }
        }
    }

    suspend fun currentState(): PersistedState = store.load()

    suspend fun synchronize(reportLease: Boolean, forceFull: Boolean = false): SyncBundle {
        val current = store.load()
        val activeApi = ensureDeviceApi(current)
        val response = activeApi.sync(current, reportLease, forceFull)
        val merged = SyncMerger.merge(current, response)
        store.save(merged)
        publishPersisted(merged)
        return SyncBundle(merged, response)
    }

    suspend fun heartbeat() {
        val current = store.load()
        ensureDeviceApi(current).heartbeat(current)
    }

    suspend fun configurationEvents(): Flow<Unit> {
        val current = store.load()
        return ensureDeviceApi(current).configurationEvents(requireNotNull(current.deviceId))
    }

    suspend fun reauthenticateDevice() {
        val current = store.load()
        api?.clearSession()
        api = null
        ensureDeviceApi(current)
    }

    suspend fun markServiceState(
        agentState: AgentState,
        message: String,
        desiredRunning: Boolean? = null,
    ): PersistedState {
        val updated = store.update { current ->
            current.copy(
                agentState = agentState,
                agentMessage = message,
                desiredRunning = desiredRunning ?: current.desiredRunning,
            )
        }
        publishPersisted(updated)
        return updated
    }

    suspend fun markApplied(bundle: SyncBundle, activeConnections: Int): PersistedState {
        val applied = store.update { current ->
            current.copy(
                appliedConfigVersion = bundle.response.targetConfigVersion,
                leaseExpiresAt = bundle.response.lease?.expiresAt ?: current.leaseExpiresAt,
                agentState = AgentState.ONLINE,
                agentMessage = "$activeConnections active connection(s)",
                cachedConnections = current.cachedConnections.map { connection ->
                    connection.copy(
                        appliedVersion = connection.version,
                        state = if (connection.enabled) "Online" else "Disabled",
                        lastErrorCode = null,
                    )
                },
            )
        }
        publishPersisted(applied)
        return applied
    }

    suspend fun clearLocalState() {
        val cleared = store.clear()
        api?.clearSession()
        api = null
        pendingLogin = null
        _uiState.value = AppUiState(screen = AppScreen.LOGIN, persisted = cleared)
    }

    fun logout(stopTunnel: () -> Unit) = scope.launch {
        operationMutex.withLock {
            setBusy(true)
            stopTunnel()
            var serverRevokedOrAlreadyInvalid = false
            try {
                val state = store.load()
                if (state.enrolled) ensureDeviceApi(state).logout()
                serverRevokedOrAlreadyInvalid = true
            } catch (error: ApiException) {
                if (error.errorCode in setOf("DEVICE_REVOKED", "USER_DISABLED", "AUTH_INVALID")) {
                    serverRevokedOrAlreadyInvalid = true
                } else {
                    setFailure(error)
                }
            } catch (error: Throwable) {
                // Keep the only device credential so the user can retry revocation
                // after connectivity returns. Never describe an offline local wipe
                // as a successful server-side logout.
                setFailure(error)
            }
            if (serverRevokedOrAlreadyInvalid) {
                clearLocalState()
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun setServiceActive(value: Boolean) {
        serviceActive = value
    }

    fun reconcileActivityWithService() = scope.launch {
        if (serviceActive) return@launch
        val current = store.load()
        // Activity and a sticky Service can be created back-to-back on the
        // main thread while the encrypted read is suspended on IO. Recheck the
        // process-local service signal before changing the durable run intent.
        if (serviceActive) return@launch
        if (current.desiredRunning || current.agentState in setOf(AgentState.ONLINE, AgentState.STARTING)) {
            val reconciled = current.copy(
                agentState = AgentState.OFFLINE,
                agentMessage = "",
                desiredRunning = false,
            )
            store.save(reconciled)
            publishPersisted(reconciled)
        }
    }

    private suspend fun registerAndEnter(profile: ServerProfile, session: SessionResponse) {
        val current = store.load()
        val activeApi = requireNotNull(api)
        val registration = activeApi.registerDevice(
            name = Build.MODEL.take(120).ifBlank { "Android" },
            installId = current.installId,
            fingerprintHash = installationFingerprint(current.installId),
        )
        // /devices/register atomically binds this existing session to the new
        // device. Keep it instead of creating a redundant second device session.
        val enrolled = current.copy(
            profile = profile,
            deviceId = registration.deviceId,
            deviceCredential = registration.deviceCredential,
            userDisplayName = session.user.displayName,
            username = session.user.username,
            lastConfigVersion = 0,
            syncCapabilityVersion = 0,
            appliedConfigVersion = 0,
            cachedConnections = emptyList(),
            leaseExpiresAt = null,
            agentState = AgentState.OFFLINE,
            agentMessage = "Registered; tunnel is stopped",
            desiredRunning = false,
        )
        store.save(enrolled)
        _uiState.value = AppUiState(screen = AppScreen.HOME, persisted = enrolled, busy = false)
        refreshConnections(silent = true)
    }

    private suspend fun ensureDeviceApi(state: PersistedState): HomeTunnelApi {
        require(state.enrolled) { "This Android device is not enrolled" }
        api?.let { existing ->
            try {
                // The active API can refresh its in-memory session on demand.
                if (existingSessionAvailable(existing)) return existing
            } catch (_: Throwable) {
                existing.clearSession()
            }
        }
        val created = HomeTunnelApi(requireNotNull(state.profile))
        created.deviceLogin(requireNotNull(state.deviceId), requireNotNull(state.deviceCredential))
        api = created
        return created
    }

    private fun existingSessionAvailable(value: HomeTunnelApi): Boolean = value.hasSession()

    private fun publishPersisted(value: PersistedState) {
        _uiState.value = _uiState.value.copy(
            screen = if (value.enrolled) AppScreen.HOME else AppScreen.LOGIN,
            persisted = value,
            connections = value.cachedConnections,
            busy = false,
        )
    }

    private fun setBusy(value: Boolean) {
        _uiState.value = _uiState.value.copy(busy = value, error = if (value) null else _uiState.value.error)
    }

    private fun setFailure(error: Throwable) {
        val message = when (error) {
            is ApiException -> "${error.errorCode}: ${error.message}"
            else -> error.message ?: error.javaClass.simpleName
        }
        _uiState.value = _uiState.value.copy(busy = false, error = message)
    }

    private data class PendingLogin(
        val profile: ServerProfile,
        val username: String,
    )
}
