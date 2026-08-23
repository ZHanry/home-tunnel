package io.github.zhanry.hometunnel.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.Manifest
import android.content.pm.PackageManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.zhanry.hometunnel.HomeTunnelApplication
import io.github.zhanry.hometunnel.MainActivity
import io.github.zhanry.hometunnel.R
import io.github.zhanry.hometunnel.agent.AgentRuntimeStatus
import io.github.zhanry.hometunnel.agent.AgentSupervisor
import io.github.zhanry.hometunnel.model.AgentState
import io.github.zhanry.hometunnel.model.ApiException
import io.github.zhanry.hometunnel.repository.HomeTunnelRepository
import io.github.zhanry.hometunnel.repository.SyncBundle
import java.time.Instant
import kotlin.math.min
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class TunnelService : Service() {
    companion object {
        private const val ACTION_START = "io.github.zhanry.hometunnel.action.START"
        private const val ACTION_STOP = "io.github.zhanry.hometunnel.action.STOP"
        private const val ACTION_SYNC = "io.github.zhanry.hometunnel.action.SYNC"
        private const val CHANNEL_ID = "home_tunnel_active"
        private const val NOTIFICATION_ID = 3100

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, TunnelService::class.java).setAction(ACTION_START),
            )
        }

        fun stop(context: Context) {
            context.startService(Intent(context, TunnelService::class.java).setAction(ACTION_STOP))
        }

        fun sync(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, TunnelService::class.java).setAction(ACTION_SYNC),
            )
        }
    }

    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(serviceJob + Dispatchers.Main.immediate)
    private val syncSignals = Channel<Unit>(Channel.CONFLATED)
    private lateinit var repository: HomeTunnelRepository
    private lateinit var supervisor: AgentSupervisor
    private var tunnelJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        repository = (application as HomeTunnelApplication).repository
        repository.setServiceActive(true)
        supervisor = AgentSupervisor(this, repository.store.runtimeDirectory(), scope)
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, notification(AgentState.STARTING, 0))
        scope.launch {
            repository.uiState.collect { ui ->
                if (Build.VERSION.SDK_INT < 33 ||
                    ContextCompat.checkSelfPermission(this@TunnelService, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                ) {
                    NotificationManagerCompat.from(this@TunnelService).notify(
                        NOTIFICATION_ID,
                        notification(ui.persisted.agentState, ui.persisted.cachedConnections.count { it.enabled }),
                    )
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_STOP -> {
                scope.launch { stopTunnel(userInitiated = true) }
                START_NOT_STICKY
            }
            ACTION_SYNC -> {
                ensureTunnelRunning()
                syncSignals.trySend(Unit)
                START_NOT_STICKY
            }
            ACTION_START -> {
                ensureTunnelRunning()
                START_NOT_STICKY
            }
            null -> {
                // A reverse tunnel is restored only after another explicit
                // user action. Android process death therefore cannot race an
                // Activity reconciliation or resurrect a tunnel after Stop.
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
                START_NOT_STICKY
            }
            else -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
                START_NOT_STICKY
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        repository.setServiceActive(false)
        tunnelJob?.cancel()
        runBlocking(Dispatchers.IO) { supervisor.stop() }
        serviceJob.cancel()
        super.onDestroy()
    }

    private fun ensureTunnelRunning() {
        if (tunnelJob?.isActive == true) return
        tunnelJob = scope.launch { runTunnel() }
    }

    private suspend fun runTunnel() {
        repository.markServiceState(AgentState.STARTING, getString(R.string.status_waiting), desiredRunning = true)
        if (!supervisor.isAgentPackaged()) {
            repository.markServiceState(AgentState.ERROR, getString(R.string.status_agent_missing), desiredRunning = false)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        try {
            coroutineScope {
            var forceFullSync = true
            launch {
                while (true) {
                    delay(3 * 60 * 1_000L)
                    syncSignals.trySend(Unit)
                }
            }
            launch {
                while (true) {
                    delay(30_000L)
                    runCatching { repository.heartbeat() }
                }
            }
            launch {
                while (true) {
                    delay(5_000L)
                    when (val status = supervisor.tick()) {
                        AgentRuntimeStatus.Offline -> Unit
                        AgentRuntimeStatus.Expired -> {
                            repository.markServiceState(AgentState.EXPIRED, getString(R.string.status_expired))
                            syncSignals.trySend(Unit)
                        }
                        is AgentRuntimeStatus.Degraded ->
                            repository.markServiceState(AgentState.DEGRADED, status.message)
                        is AgentRuntimeStatus.Error ->
                            repository.markServiceState(AgentState.ERROR, status.message)
                        AgentRuntimeStatus.Online -> {
                            val current = repository.currentState()
                            if (current.agentState != AgentState.ONLINE) {
                                repository.markServiceState(AgentState.ONLINE, current.agentMessage)
                            }
                        }
                    }
                }
            }
            launch { realtimeLoop() }
            syncSignals.trySend(Unit)
            for (signal in syncSignals) {
                try {
                    synchronizeAndApply(forceFullSync)
                    forceFullSync = false
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: ApiException) {
                    if (isRecoverableSessionFailure(error)) {
                        try {
                            repository.reauthenticateDevice()
                            syncSignals.trySend(Unit)
                            continue
                        } catch (deviceLoginError: ApiException) {
                            if (isTerminalDeviceFailure(deviceLoginError)) {
                                supervisor.stop()
                                repository.markServiceState(
                                    AgentState.REVOKED,
                                    deviceLoginError.message,
                                    desiredRunning = false,
                                )
                                throw TerminalRevocation
                            }
                            repository.markServiceState(AgentState.DEGRADED, safeMessage(deviceLoginError))
                            continue
                        } catch (deviceLoginError: Throwable) {
                            repository.markServiceState(AgentState.DEGRADED, safeMessage(deviceLoginError))
                            continue
                        }
                    }
                    if (isTerminalDeviceFailure(error)) {
                        supervisor.stop()
                        repository.markServiceState(AgentState.REVOKED, error.message, desiredRunning = false)
                        throw TerminalRevocation
                    }
                    repository.markServiceState(AgentState.DEGRADED, safeMessage(error))
                } catch (error: Throwable) {
                    repository.markServiceState(AgentState.DEGRADED, safeMessage(error))
                }
            }
            }
        } catch (_: TerminalRevocation) {
            // The exception cancels every heartbeat/poll/realtime child before the
            // foreground service is removed. State is persisted before it is thrown.
            supervisor.stop()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private suspend fun synchronizeAndApply(forceFull: Boolean) {
        val before = repository.currentState()
        val expiry = before.leaseExpiry()
        val reportLease = shouldReportLease(before.agentState, expiry, Instant.now())
        if (before.agentState != AgentState.ONLINE) {
            repository.markServiceState(AgentState.STARTING, getString(R.string.status_syncing))
        }
        val bundle = repository.synchronize(reportLease, forceFull)
        val needsApply = shouldApplySync(bundle.response)
        if (needsApply) apply(bundle) else repository.markServiceState(AgentState.ONLINE, before.agentMessage)
        repository.refreshConnections(silent = true)
    }

    private suspend fun apply(bundle: SyncBundle) {
        val profile = requireNotNull(bundle.state.profile)
        val deviceId = requireNotNull(bundle.state.deviceId)
        val complete = bundle.state.cachedConnections
        val result = supervisor.apply(profile, deviceId, bundle.response.copy(connections = complete), complete)
        repository.markApplied(bundle, result.activeConnections)
    }

    private suspend fun realtimeLoop() {
        var backoffSeconds = 1L
        while (true) {
            try {
                repository.configurationEvents()
                    .catch { throw it }
                    .collect { syncSignals.trySend(Unit) }
                backoffSeconds = 1L
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: ApiException) {
                if (error.statusCode == 401) {
                    val reauthenticated = runCatching { repository.reauthenticateDevice() }.isSuccess
                    if (reauthenticated) {
                        backoffSeconds = 1L
                        continue
                    }
                }
            } catch (_: Throwable) {
                // The periodic sync remains the safety net.
            }
            val jitterMillis = Random.nextLong(0, backoffSeconds * 500L + 1)
            delay(backoffSeconds * 500L + jitterMillis)
            backoffSeconds = min(60L, backoffSeconds * 2)
        }
    }

    private suspend fun stopTunnel(userInitiated: Boolean) {
        // Persist the user's stop decision before process teardown. If Android
        // kills the service during cleanup, a null-intent restart will observe
        // desiredRunning=false and cannot resurrect the tunnel.
        repository.markServiceState(
            AgentState.OFFLINE,
            if (userInitiated) getString(R.string.status_stopped_by_user) else getString(R.string.status_offline),
            desiredRunning = false,
        )
        tunnelJob?.cancel()
        tunnelJob = null
        supervisor.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_channel_description)
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification(state: AgentState, activeConnections: Int): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, TunnelService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val syncIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, TunnelService::class.java).setAction(ACTION_SYNC),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val text = when (state) {
            AgentState.ONLINE -> resources.getQuantityString(
                R.plurals.notification_online,
                activeConnections,
                activeConnections,
            )
            AgentState.DEGRADED, AgentState.ERROR, AgentState.EXPIRED, AgentState.REVOKED ->
                getString(R.string.notification_degraded)
            else -> getString(R.string.notification_starting)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_home_tunnel)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(0, getString(R.string.notification_sync), syncIntent)
            .addAction(0, getString(R.string.notification_stop), stopIntent)
            .build()
    }

    private fun safeMessage(error: Throwable): String = when (error) {
        is ApiException -> "${error.errorCode}: ${error.message}"
        else -> error.message?.replace('\r', ' ')?.replace('\n', ' ')?.take(256)
            ?: error.javaClass.simpleName
    }
}

internal fun shouldApplySync(response: io.github.zhanry.hometunnel.model.SyncResponse): Boolean =
    response.fullSync || response.lease != null

internal fun shouldReportLease(state: AgentState, expiry: Instant?, now: Instant): Boolean =
    state == AgentState.ONLINE && expiry != null && expiry.isAfter(now.plusSeconds(15 * 60))

internal fun isRecoverableSessionFailure(error: ApiException): Boolean =
    error.errorCode == "SESSION_REVOKED" ||
        (error.statusCode == 401 && error.errorCode !in setOf("AUTH_INVALID", "DEVICE_REVOKED", "USER_DISABLED"))

internal fun isTerminalDeviceFailure(error: ApiException): Boolean =
    error.errorCode in setOf("AUTH_INVALID", "DEVICE_REVOKED", "USER_DISABLED") || error.statusCode == 423

private data object TerminalRevocation : RuntimeException()
