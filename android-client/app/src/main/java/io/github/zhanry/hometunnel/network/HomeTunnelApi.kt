package io.github.zhanry.hometunnel.network

import io.github.zhanry.hometunnel.BuildConfig
import io.github.zhanry.hometunnel.model.ApiErrorBody
import io.github.zhanry.hometunnel.model.ApiException
import io.github.zhanry.hometunnel.model.ConnectionListResponse
import io.github.zhanry.hometunnel.model.DeviceRegistration
import io.github.zhanry.hometunnel.model.PersistedState
import io.github.zhanry.hometunnel.model.RefreshResponse
import io.github.zhanry.hometunnel.model.ServerProfile
import io.github.zhanry.hometunnel.model.SessionResponse
import io.github.zhanry.hometunnel.model.SyncResponse
import io.github.zhanry.hometunnel.model.TunnelConnection
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class HomeTunnelApi(
    private val profile: ServerProfile,
    private val sessionManager: SessionManager = SessionManager(),
    clientOverride: OkHttpClient? = null,
) {
    companion object {
        const val MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }
    private val baseUrl = profile.apiBaseUrl.toHttpUrl()
    private val client = clientOverride ?: OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    suspend fun login(username: String, password: String): SessionResponse {
        val response: SessionResponse = publicJson(
            "auth/login",
            buildJsonObject {
                put("username", username)
                put("password", password)
                put("client_type", "android")
            },
        )
        sessionManager.install(response)
        return response
    }

    suspend fun deviceLogin(deviceId: String, credential: String): SessionResponse {
        val response: SessionResponse = publicJson(
            "auth/device",
            buildJsonObject {
                put("device_id", deviceId)
                put("device_credential", credential)
            },
        )
        sessionManager.install(response)
        return response
    }

    suspend fun changePassword(currentPassword: String, newPassword: String) {
        authenticatedJson<Unit>(
            method = "POST",
            path = "auth/password/change",
            body = buildJsonObject {
                put("current_password", currentPassword)
                put("new_password", newPassword)
            },
        )
        sessionManager.clear()
    }

    suspend fun registerDevice(
        name: String,
        installId: String,
        fingerprintHash: String,
    ): DeviceRegistration = authenticatedJson(
        method = "POST",
        path = "devices/register",
        body = buildJsonObject {
            put("name", name)
            put("install_id", installId)
            put("fingerprint_hash", fingerprintHash)
            put("client_version", BuildConfig.VERSION_NAME)
        },
    )

    suspend fun listConnections(): List<TunnelConnection> =
        authenticatedJson<ConnectionListResponse>("GET", "client/connections").items

    suspend fun createHttpConnection(deviceId: String, value: TunnelConnection): TunnelConnection =
        authenticatedJson(
            method = "POST",
            path = "client/connections",
            body = buildJsonObject {
                put("device_id", deviceId)
                put("name", value.name)
                put("subdomain", value.subdomain)
                put("local_scheme", value.localScheme)
                put("local_host", value.localHost)
                put("local_port", value.localPort)
                put("enabled", value.enabled)
                put("proxy_type", "http")
            },
        )

    suspend fun updateConnection(value: TunnelConnection): TunnelConnection = authenticatedJson(
        method = "PATCH",
        path = "client/connections/${value.id}",
        body = buildJsonObject {
            put("name", value.name)
            put("subdomain", value.subdomain)
            put("local_scheme", value.localScheme)
            put("local_host", value.localHost)
            put("local_port", value.localPort)
            put("enabled", value.enabled)
            put("expected_version", value.version)
        },
        expectedVersion = value.version,
    )

    suspend fun deleteConnection(value: TunnelConnection) {
        authenticatedJson<Unit>(
            method = "DELETE",
            path = "client/connections/${value.id}",
            body = buildJsonObject { put("expected_version", value.version) },
            expectedVersion = value.version,
        )
    }

    suspend fun sync(
        state: PersistedState,
        reportLease: Boolean,
        forceFull: Boolean = false,
    ): SyncResponse = authenticatedJson(
        method = "POST",
        path = "client/sync",
        body = buildJsonObject {
            put("device_id", requireNotNull(state.deviceId))
            put("last_config_version", requestedConfigVersion(state, forceFull))
            put("supports_optional_lease", true)
            if (reportLease && state.leaseExpiresAt != null) {
                put("lease_expires_at", state.leaseExpiresAt)
            } else {
                put("lease_expires_at", JsonNull)
            }
            put("supported_proxy_types", JsonArray(listOf(JsonPrimitive("http"))))
        },
    )

    suspend fun heartbeat(state: PersistedState) {
        authenticatedJson<Unit>(
            method = "POST",
            path = "client/heartbeat",
            body = buildJsonObject {
                put("device_id", requireNotNull(state.deviceId))
                put("applied_config_version", state.appliedConfigVersion)
                put("client_version", BuildConfig.VERSION_NAME)
                put("agent_version", BuildConfig.VERSION_NAME)
                put("clock_utc", Instant.now().toString())
                put("connections", buildJsonArray {
                    state.cachedConnections.forEach { connection ->
                        add(buildJsonObject {
                            put("connection_id", connection.id)
                            put("applied_version", connection.appliedVersion)
                            put("state", heartbeatState(connection))
                            connection.lastErrorCode?.let { put("error_code", it) } ?: put("error_code", JsonNull)
                            put("error_summary", JsonNull)
                        })
                    }
                })
            },
        )
    }

    suspend fun logout() {
        try {
            authenticatedJson<Unit>("POST", "auth/logout", buildJsonObject { })
        } finally {
            sessionManager.clear()
        }
    }

    fun configurationEvents(deviceId: String): Flow<Unit> = flow {
        val token = sessionManager.accessToken(::refresh)
        emitAll(webSocketFlow(deviceId, token))
    }

    fun clearSession() = sessionManager.clear()

    fun hasSession(): Boolean = sessionManager.hasSession()

    private fun webSocketFlow(deviceId: String, token: String): Flow<Unit> = callbackFlow {
        val httpWebsocketUrl = baseUrl.newBuilder()
            .encodedPath("/api/v1/ws")
            .build()
        val websocketUrl = httpWebsocketUrl.toString().replaceFirst(
            if (httpWebsocketUrl.isHttps) "https://" else "http://",
            if (httpWebsocketUrl.isHttps) "wss://" else "ws://",
        )
        val request = Request.Builder()
            .url(websocketUrl)
            .header("Authorization", "Bearer $token")
            .header("User-Agent", "HomeTunnel-Android/${BuildConfig.VERSION_NAME}")
            .build()
        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
                val event = root["event"]?.jsonPrimitive?.content ?: return
                if (event == "realtime.connected") return
                if (event !in setOf("config.version.changed", "connection.command", "subject.revoked")) return
                val eventDevice = root["payload"]?.let { payload ->
                    runCatching { payload.jsonObject["device_id"]?.jsonPrimitive?.content }.getOrNull()
                }
                if (eventDevice == null || eventDevice.equals(deviceId, ignoreCase = true)) trySend(Unit)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val cause = if (response?.code == 401) {
                    ApiException(401, "SESSION_REVOKED", "Realtime session was rejected")
                } else {
                    t
                }
                close(cause)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                close()
            }
        })
        awaitClose { socket.close(1000, "client stopped") }
    }

    private suspend fun refresh(refreshToken: String): RefreshResponse = publicJson(
        "auth/refresh",
        buildJsonObject {
            put("refresh_token", refreshToken)
            put("client_type", "android")
        },
    )

    private suspend inline fun <reified T> publicJson(path: String, body: JsonObject): T =
        withContext(Dispatchers.IO) {
            execute<T>(RequestSpec("POST", path, body, null, null))
        }

    private suspend inline fun <reified T> authenticatedJson(
        method: String,
        path: String,
        body: JsonObject? = null,
        expectedVersion: Long? = null,
    ): T = withContext(Dispatchers.IO) {
        var token = sessionManager.accessToken(::refresh)
        try {
            execute<T>(RequestSpec(method, path, body, token, expectedVersion))
        } catch (error: ApiException) {
            if (error.statusCode != 401) throw error
            token = sessionManager.refreshAfterUnauthorized(token, ::refresh)
            execute<T>(RequestSpec(method, path, body, token, expectedVersion))
        }
    }

    private inline fun <reified T> execute(spec: RequestSpec): T {
        val url = baseUrl.resolve(spec.path) ?: throw IOException("Invalid API path")
        val requestBuilder = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("User-Agent", "HomeTunnel-Android/${BuildConfig.VERSION_NAME}")
            .header("X-Request-Id", UUID.randomUUID().toString())
        spec.token?.let { requestBuilder.header("Authorization", "Bearer $it") }
        spec.expectedVersion?.let { requestBuilder.header("If-Match", "\"$it\"") }
        val requestBody = spec.body?.toString()?.toRequestBody(JSON_MEDIA_TYPE)
        when (spec.method) {
            "GET" -> requestBuilder.get()
            "POST" -> requestBuilder.post(requestBody ?: ByteArray(0).toRequestBody(JSON_MEDIA_TYPE))
            "PATCH" -> requestBuilder.patch(requireNotNull(requestBody))
            "DELETE" -> if (requestBody == null) requestBuilder.delete() else requestBuilder.delete(requestBody)
            else -> throw IllegalArgumentException("Unsupported method ${spec.method}")
        }
        client.newCall(requestBuilder.build()).execute().use { response ->
            val bytes = response.body?.byteStream()?.readLimited(MAXIMUM_RESPONSE_BYTES) ?: ByteArray(0)
            if (!response.isSuccessful) {
                val error = runCatching { json.decodeFromString<ApiErrorBody>(bytes.decodeToString()) }
                    .getOrElse { ApiErrorBody(message = "HTTP ${response.code}") }
                throw ApiException(response.code, error.errorCode, error.message)
            }
            if (T::class == Unit::class) {
                @Suppress("UNCHECKED_CAST")
                return Unit as T
            }
            if (bytes.isEmpty()) throw IOException("Control-center returned an empty response")
            return json.decodeFromString(bytes.decodeToString())
        }
    }

    private fun heartbeatState(connection: TunnelConnection): String {
        if (!connection.enabled) return "Disabled"
        return connection.state.takeIf {
            it in setOf("Disabled", "Pending", "Applying", "Online", "Degraded", "Offline", "Error")
        } ?: "Offline"
    }

    private fun java.io.InputStream.readLimited(maximum: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val count = read(buffer)
            if (count < 0) break
            total += count
            if (total > maximum) throw IOException("Control-center response is too large")
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private data class RequestSpec(
        val method: String,
        val path: String,
        val body: JsonObject?,
        val token: String?,
        val expectedVersion: Long?,
    )
}

internal fun requestedConfigVersion(state: PersistedState, forceFull: Boolean): Long =
    if (forceFull) 0 else state.syncRequestConfigVersion
