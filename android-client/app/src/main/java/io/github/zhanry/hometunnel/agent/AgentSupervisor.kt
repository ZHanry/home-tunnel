package io.github.zhanry.hometunnel.agent

import android.content.Context
import android.util.Log
import io.github.zhanry.hometunnel.model.LeaseInfo
import io.github.zhanry.hometunnel.model.ServerProfile
import io.github.zhanry.hometunnel.model.SyncResponse
import io.github.zhanry.hometunnel.model.TunnelConnection
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class AgentSupervisor(
    context: Context,
    private val runtimeDirectory: File,
    private val scope: CoroutineScope,
    private val clock: Clock = Clock.systemUTC(),
) {
    companion object {
        private const val TAG = "HomeTunnelAgent"
        private const val AGENT_FILE = "libhometunnel_agent.so"
        private const val STARTUP_STABILITY_MILLIS = 3_000L
    }

    private val mutex = Mutex()
    private val runner = NativeAgentRunner(resolveAgent(context), runtimeDirectory, scope)
    private var process: ManagedAgentProcess? = null
    private var lastKnownGood: File? = null
    private var lastTrust: AgentTrustProfile? = null
    private var leaseExpiresAt: Instant? = null
    private var restartFailures = 0
    private var nextRestartAt: Instant? = null

    init {
        secureDirectory(runtimeDirectory)
        lastKnownGood = runtimeDirectory.listFiles()
            ?.filter { it.isFile && it.name.startsWith("lkg-") && it.name.endsWith(".toml") }
            ?.maxByOrNull { it.lastModified() }
    }

    suspend fun apply(
        profile: ServerProfile,
        deviceId: String,
        response: SyncResponse,
        completeConnections: List<TunnelConnection>,
    ): AgentApplyResult = mutex.withLock {
        val lease = response.lease ?: throw AgentApplyException("Control center omitted the lease required to apply configuration")
        val expiry = lease.expiryInstant()
        if (!LeasePolicy.usableForApply(expiry, clock.instant())) {
            stopInternal()
            throw AgentApplyException("Lease is expired or too close to expiry")
        }
        val ca = writeTrustedCa(profile)
        val trust = AgentTrustProfile.from(profile, completeConnections, ca?.sha256)
        val rendered = AgentConfigRenderer.render(
            profile = profile,
            deviceId = deviceId,
            lease = lease,
            connections = completeConnections,
            trustedCaPath = ca?.file?.absolutePath,
        )
        val pending = File.createTempFile("pending-", ".toml", runtimeDirectory)
        protectFile(pending)
        FileOutputStream(pending).use { stream ->
            stream.write(rendered.encodeToByteArray())
            stream.fd.sync()
        }
        val previousLkg = lastKnownGood
        val previousTrust = lastTrust
        val previousExpiry = leaseExpiresAt
        try {
            runner.verify(pending, trust)
            stopInternal()
            val started = try {
                runner.start(pending, trust)
            } catch (startError: Throwable) {
                restore(previousLkg, previousTrust, previousExpiry)
                throw startError
            }
            process = started
            delay(STARTUP_STABILITY_MILLIS)
            if (!started.isAlive()) {
                val summary = started.exitSummary()
                process = null
                restore(previousLkg, previousTrust, previousExpiry)
                throw AgentApplyException("Managed Agent exited during startup${summary?.let { ": $it" }.orEmpty()}")
            }
            val lkg = File(runtimeDirectory, "lkg-${response.targetConfigVersion}.toml")
            if (lkg.exists()) lkg.delete()
            if (!pending.renameTo(lkg)) {
                stopInternal()
                restore(previousLkg, previousTrust, previousExpiry)
                throw AgentApplyException("Unable to promote last-known-good configuration")
            }
            protectFile(lkg)
            if (previousLkg != null && previousLkg != lkg) secureDelete(previousLkg)
            lastKnownGood = lkg
            lastTrust = trust
            leaseExpiresAt = expiry
            restartFailures = 0
            nextRestartAt = null
            AgentApplyResult(
                appliedVersion = response.targetConfigVersion,
                leaseExpiresAt = expiry,
                activeConnections = completeConnections.count { it.enabled },
            )
        } catch (error: Throwable) {
            if (pending.exists()) secureDelete(pending)
            if (error is AgentApplyException) throw error
            throw AgentApplyException(sanitize(error.message ?: error.javaClass.simpleName), error)
        }
    }

    suspend fun tick(): AgentRuntimeStatus = mutex.withLock {
        val now = clock.instant()
        val expiry = leaseExpiresAt
        if (expiry != null && LeasePolicy.expired(expiry, now)) {
            stopInternal()
            return@withLock AgentRuntimeStatus.Expired
        }
        val active = process
        if (active?.isAlive() == true) return@withLock AgentRuntimeStatus.Online
        if (active != null) {
            process = null
            restartFailures += 1
            val delaySeconds = (1 shl restartFailures.coerceAtMost(5)).toLong()
            nextRestartAt = now.plusSeconds(delaySeconds)
        }
        val lkg = lastKnownGood
        val trust = lastTrust
        if (lkg == null || trust == null || expiry == null) return@withLock AgentRuntimeStatus.Offline
        if (restartFailures > 5) return@withLock AgentRuntimeStatus.Error("Managed Agent exceeded the restart limit")
        if (nextRestartAt?.isAfter(now) == true) return@withLock AgentRuntimeStatus.Degraded("Managed Agent restart is delayed")
        return@withLock runCatching {
            process = runner.start(lkg, trust)
            AgentRuntimeStatus.Online
        }.getOrElse {
            restartFailures += 1
            nextRestartAt = now.plusSeconds((1 shl restartFailures.coerceAtMost(5)).toLong())
            AgentRuntimeStatus.Degraded("Managed Agent restart failed")
        }
    }

    suspend fun stop() = mutex.withLock { stopInternal() }

    suspend fun clearSensitiveRuntime() = mutex.withLock {
        stopInternal()
        runtimeDirectory.listFiles()?.forEach(::secureDelete)
        lastKnownGood = null
        lastTrust = null
        leaseExpiresAt = null
    }

    fun isAgentPackaged(): Boolean = runner.agentAvailable

    private suspend fun restore(config: File?, trust: AgentTrustProfile?, expiry: Instant?) {
        if (config == null || trust == null || expiry == null || !LeasePolicy.usableForApply(expiry, clock.instant())) return
        if (!config.isFile) return
        runCatching {
            process = runner.start(config, trust)
            lastKnownGood = config
            lastTrust = trust
            leaseExpiresAt = expiry
        }.onFailure { Log.w(TAG, "AGENT_ROLLBACK_FAILED") }
    }

    private suspend fun stopInternal() {
        process?.stop()
        process = null
    }

    private fun writeTrustedCa(profile: ServerProfile): TrustedCa? {
        val pem = profile.frpsTlsCertificatePem?.takeIf { it.isNotBlank() } ?: return null
        val file = File(runtimeDirectory, "frps-ca.pem")
        file.writeText(pem, Charsets.UTF_8)
        protectFile(file)
        val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
        return TrustedCa(file, digest.joinToString("") { "%02x".format(it) })
    }

    private data class TrustedCa(val file: File, val sha256: String)
}

data class AgentApplyResult(
    val appliedVersion: Long,
    val leaseExpiresAt: Instant,
    val activeConnections: Int,
)

sealed interface AgentRuntimeStatus {
    data object Offline : AgentRuntimeStatus
    data object Online : AgentRuntimeStatus
    data object Expired : AgentRuntimeStatus
    data class Degraded(val message: String) : AgentRuntimeStatus
    data class Error(val message: String) : AgentRuntimeStatus
}

class AgentApplyException(message: String, cause: Throwable? = null) : IOException(message, cause)

internal object LeasePolicy {
    fun expired(expiry: Instant, now: Instant): Boolean = !now.isBefore(expiry)
    fun usableForApply(expiry: Instant, now: Instant): Boolean = expiry.isAfter(now.plusSeconds(60))
}

private class NativeAgentRunner(
    private val agent: File,
    private val runtimeDirectory: File,
    private val scope: CoroutineScope,
) {
    val agentAvailable: Boolean get() = agent.isFile && agent.canExecute()

    suspend fun verify(config: File, trust: AgentTrustProfile) = withContext(Dispatchers.IO) {
        ensureAvailable()
        val process = processBuilder("verify", config, trust).start()
        val output = process.inputStream.bufferedReader().use { reader ->
            val completed = process.waitFor(12, TimeUnit.SECONDS)
            if (!completed) {
                process.destroyForcibly()
                throw AgentApplyException("Managed Agent verification timed out")
            }
            reader.readText()
        }
        if (process.exitValue() != 0) {
            throw AgentApplyException("Managed Agent rejected configuration: ${sanitize(output)}")
        }
    }

    suspend fun start(config: File, trust: AgentTrustProfile): ManagedAgentProcess = withContext(Dispatchers.IO) {
        ensureAvailable()
        val process = processBuilder("run", config, trust).start()
        ManagedAgentProcess(process, scope)
    }

    private fun processBuilder(command: String, config: File, trust: AgentTrustProfile): ProcessBuilder {
        val arguments = mutableListOf(
            agent.absolutePath,
            command,
            "--config", config.absolutePath,
            "--server", trust.server,
            "--port", trust.port.toString(),
            "--domain", trust.domain,
        )
        trust.tlsCaSha256?.takeIf { it.isNotBlank() }?.let {
            arguments += listOf("--tls-ca-sha256", it)
        }
        if (trust.allowedCustomDomains.isNotEmpty()) {
            arguments += listOf("--allow-custom-domains", trust.allowedCustomDomains.joinToString(","))
        }
        if (trust.allowedTcpPorts.isNotEmpty()) {
            arguments += listOf("--allow-tcp-ports", trust.allowedTcpPorts.joinToString(","))
        }
        if (trust.allowedUdpPorts.isNotEmpty()) {
            arguments += listOf("--allow-udp-ports", trust.allowedUdpPorts.joinToString(","))
        }
        return ProcessBuilder(arguments)
            .directory(runtimeDirectory)
            .redirectErrorStream(true)
            .also { builder ->
                builder.environment().remove("http_proxy")
                builder.environment().remove("HTTP_PROXY")
            }
    }

    private fun ensureAvailable() {
        if (!agentAvailable) throw AgentApplyException("Managed Agent is missing from this APK")
    }
}

private class ManagedAgentProcess(
    private val process: Process,
    scope: CoroutineScope,
) {
    @Volatile
    private var lastOutput: String? = null
    private val outputJob: Job = scope.launch(Dispatchers.IO) {
        runCatching {
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    if (!isActive) return@forEach
                    lastOutput = sanitize(line)
                }
            }
        }
    }

    fun isAlive(): Boolean = process.isAlive

    fun exitSummary(): String? = lastOutput

    suspend fun stop() = withContext(Dispatchers.IO) {
        outputJob.cancel()
        if (!process.isAlive) return@withContext
        process.destroy()
        if (!process.waitFor(8, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            process.waitFor(2, TimeUnit.SECONDS)
        }
    }
}

private fun resolveAgent(context: Context): File {
    val nativeDirectory = File(context.applicationInfo.nativeLibraryDir).canonicalFile
    val candidate = File(nativeDirectory, "libhometunnel_agent.so").canonicalFile
    if (candidate.parentFile != nativeDirectory) throw AgentApplyException("Managed Agent path escaped nativeLibraryDir")
    return candidate
}

private fun secureDirectory(directory: File) {
    if (!directory.exists() && !directory.mkdirs()) throw AgentApplyException("Unable to create Agent runtime directory")
    directory.setReadable(false, false)
    directory.setWritable(false, false)
    directory.setExecutable(false, false)
    directory.setReadable(true, true)
    directory.setWritable(true, true)
    directory.setExecutable(true, true)
}

private fun protectFile(file: File) {
    file.setReadable(false, false)
    file.setWritable(false, false)
    file.setExecutable(false, false)
    file.setReadable(true, true)
    file.setWritable(true, true)
}

private fun secureDelete(file: File) {
    if (!file.exists()) return
    if (file.isFile && file.length() in 1..(1024L * 1024L)) {
        runCatching { file.writeBytes(ByteArray(file.length().toInt())) }
    }
    file.deleteRecursively()
}

private fun sanitize(value: String): String {
    val singleLine = value.replace('\r', ' ').replace('\n', ' ').trim()
    val withoutTokens = singleLine.replace(Regex("[A-Za-z0-9_-]{24,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}"), "[redacted]")
    return withoutTokens.take(512)
}
