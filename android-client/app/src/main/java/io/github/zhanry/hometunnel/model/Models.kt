package io.github.zhanry.hometunnel.model

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

const val SYNC_CAPABILITY_VERSION = 1

@Serializable
data class ServerProfile(
    @SerialName("public_base_url") val publicBaseUrl: String,
    @SerialName("api_base_url") val apiBaseUrl: String,
    @SerialName("frps_host") val frpsHost: String,
    @SerialName("frps_port") val frpsPort: Int,
    @SerialName("tunnel_domain") val tunnelDomain: String,
    @SerialName("frps_tls_certificate_pem") val frpsTlsCertificatePem: String? = null,
)

@Serializable
data class DiscoveryResponse(
    @SerialName("public_base_url") val publicBaseUrl: String,
    @SerialName("tunnel_domain") val tunnelDomain: String,
    @SerialName("frps_host") val frpsHost: String,
    @SerialName("frps_port") val frpsPort: Int,
    @SerialName("frps_tls_certificate_pem") val frpsTlsCertificatePem: String? = null,
)

@Serializable
data class UserInfo(
    val id: String,
    val username: String,
    @SerialName("display_name") val displayName: String,
    val role: String,
    @SerialName("password_state") val passwordState: String,
)

@Serializable
data class SessionResponse(
    val user: UserInfo,
    @SerialName("password_change_required") val passwordChangeRequired: Boolean = false,
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("csrf_token") val csrfToken: String? = null,
    @SerialName("access_expires_at") val accessExpiresAt: String,
    @SerialName("refresh_expires_at") val refreshExpiresAt: String,
)

@Serializable
data class RefreshResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("access_expires_at") val accessExpiresAt: String,
    @SerialName("refresh_expires_at") val refreshExpiresAt: String? = null,
)

@Serializable
data class DeviceRegistration(
    @SerialName("device_id") val deviceId: String,
    @SerialName("device_credential") val deviceCredential: String,
    @SerialName("config_version") val configVersion: Long,
)

enum class ProxyKind(val wireName: String) {
    HTTP("http"),
    TCP("tcp"),
    UDP("udp"),
    UNKNOWN("unknown");

    companion object {
        fun fromWire(value: String): ProxyKind = when (value.lowercase()) {
            "http" -> HTTP
            "tcp" -> TCP
            "udp" -> UDP
            else -> UNKNOWN
        }
    }
}

@Serializable(with = TunnelConnectionSerializer::class)
data class TunnelConnection(
    val id: String,
    val deviceId: String,
    val name: String,
    val subdomain: String,
    val proxyType: String,
    val remotePort: Int? = null,
    val publicUrl: String? = null,
    val publicEndpoint: String? = null,
    val customDomains: List<String> = emptyList(),
    val localScheme: String = "http",
    val localHost: String = "127.0.0.1",
    val localPort: Int,
    val enabled: Boolean = true,
    val version: Long,
    val state: String = "Pending",
    val appliedVersion: Long = 0,
    val lastErrorCode: String? = null,
    val proxyName: String? = null,
) {
    val kind: ProxyKind get() = ProxyKind.fromWire(proxyType)

    val publicDisplayEndpoint: String
        get() = when {
            kind == ProxyKind.HTTP && !publicUrl.isNullOrBlank() -> publicUrl
            !publicEndpoint.isNullOrBlank() && publicEndpoint.contains("://") -> publicEndpoint
            !publicEndpoint.isNullOrBlank() && kind in setOf(ProxyKind.TCP, ProxyKind.UDP) ->
                "${kind.wireName}://$publicEndpoint"
            else -> publicEndpoint ?: publicUrl.orEmpty()
        }
}

object TunnelConnectionSerializer : KSerializer<TunnelConnection> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("TunnelConnection")

    override fun deserialize(decoder: Decoder): TunnelConnection {
        val jsonDecoder = decoder as? JsonDecoder
            ?: throw SerializationException("TunnelConnection requires JSON")
        val value = jsonDecoder.decodeJsonElement().jsonObject
        val canonicalSeen = value.containsKey("remote_port")
        val remotePort = if (canonicalSeen) {
            value.intOrNull("remote_port")
        } else {
            value.intOrNull("tcp_remote_port")
        }
        return TunnelConnection(
            id = value.requiredString("id"),
            deviceId = value.stringOrEmpty("device_id"),
            name = value.stringOrEmpty("name"),
            subdomain = value.stringOrEmpty("subdomain"),
            proxyType = value.stringOrEmpty("proxy_type").ifBlank { "unknown" },
            remotePort = remotePort,
            publicUrl = value.optionalString("public_url"),
            publicEndpoint = value.optionalString("public_endpoint"),
            customDomains = value["custom_domains"]?.let { element ->
                if (element is JsonNull) emptyList()
                else element.jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull }
            } ?: emptyList(),
            localScheme = value.stringOrEmpty("local_scheme").ifBlank { "http" },
            localHost = value.stringOrEmpty("local_host").ifBlank { "127.0.0.1" },
            localPort = value.intOrNull("local_port") ?: 0,
            enabled = value["enabled"]?.jsonPrimitive?.booleanOrNull ?: false,
            version = value["version"]?.jsonPrimitive?.longOrNull ?: 0,
            state = value.stringOrEmpty("state").ifBlank { "Pending" },
            appliedVersion = value["applied_version"]?.jsonPrimitive?.longOrNull ?: 0,
            lastErrorCode = value.optionalString("last_error_code"),
            proxyName = value.optionalString("proxy_name"),
        )
    }

    override fun serialize(encoder: Encoder, value: TunnelConnection) {
        val jsonEncoder = encoder as? JsonEncoder
            ?: throw SerializationException("TunnelConnection requires JSON")
        jsonEncoder.encodeJsonElement(buildJsonObject {
            put("id", value.id)
            put("device_id", value.deviceId)
            put("name", value.name)
            put("subdomain", value.subdomain)
            put("proxy_type", value.proxyType)
            value.remotePort?.let { put("remote_port", it) } ?: put("remote_port", JsonNull)
            value.publicUrl?.let { put("public_url", it) } ?: put("public_url", JsonNull)
            value.publicEndpoint?.let { put("public_endpoint", it) } ?: put("public_endpoint", JsonNull)
            put("custom_domains", kotlinx.serialization.json.JsonArray(value.customDomains.map(::JsonPrimitive)))
            put("local_scheme", value.localScheme)
            put("local_host", value.localHost)
            put("local_port", value.localPort)
            put("enabled", value.enabled)
            put("version", value.version)
            put("state", value.state)
            put("applied_version", value.appliedVersion)
            value.lastErrorCode?.let { put("last_error_code", it) } ?: put("last_error_code", JsonNull)
            value.proxyName?.let { put("proxy_name", it) } ?: put("proxy_name", JsonNull)
        })
    }
}

private fun JsonObject.requiredString(name: String): String =
    optionalString(name) ?: throw SerializationException("Missing $name")

private fun JsonObject.stringOrEmpty(name: String): String = optionalString(name).orEmpty()

private fun JsonObject.optionalString(name: String): String? =
    get(name)?.takeUnless { it is JsonNull }?.jsonPrimitive?.contentOrNull

private fun JsonObject.intOrNull(name: String): Int? =
    get(name)?.takeUnless { it is JsonNull }?.jsonPrimitive?.intOrNull

@Serializable
data class ConnectionListResponse(val items: List<TunnelConnection>)

@Serializable
data class LeaseInfo(
    val lease: String,
    @SerialName("expires_at") val expiresAt: String,
    @SerialName("config_version") val configVersion: Long,
) {
    fun expiryInstant(): Instant = Instant.parse(expiresAt)
}

@Serializable
data class SyncResponse(
    @SerialName("device_id") val deviceId: String,
    @SerialName("full_sync") val fullSync: Boolean,
    @SerialName("from_config_version") val fromConfigVersion: Long = 0,
    @SerialName("target_config_version") val targetConfigVersion: Long,
    val connections: List<TunnelConnection>,
    @SerialName("content_hash") val contentHash: String,
    val lease: LeaseInfo? = null,
    @SerialName("server_time") val serverTime: String,
)

@Serializable
enum class AgentState {
    @SerialName("Offline") OFFLINE,
    @SerialName("Starting") STARTING,
    @SerialName("Online") ONLINE,
    @SerialName("Degraded") DEGRADED,
    @SerialName("Error") ERROR,
    @SerialName("ExpiredStop") EXPIRED,
    @SerialName("Revoked") REVOKED,
}

@Serializable
data class PersistedState(
    val installId: String = UUID.randomUUID().toString().replace("-", ""),
    val profile: ServerProfile? = null,
    val deviceId: String? = null,
    val deviceCredential: String? = null,
    val userDisplayName: String? = null,
    val username: String? = null,
    val lastConfigVersion: Long = 0,
    val syncCapabilityVersion: Int = 0,
    val appliedConfigVersion: Long = 0,
    val cachedConnections: List<TunnelConnection> = emptyList(),
    val leaseExpiresAt: String? = null,
    val agentState: AgentState = AgentState.OFFLINE,
    val agentMessage: String = "",
    val desiredRunning: Boolean = false,
) {
    val enrolled: Boolean
        get() = profile != null && !deviceId.isNullOrBlank() && !deviceCredential.isNullOrBlank()

    val syncRequestConfigVersion: Long
        get() = if (syncCapabilityVersion < SYNC_CAPABILITY_VERSION) 0 else lastConfigVersion

    fun leaseExpiry(): Instant? = leaseExpiresAt?.let {
        runCatching { Instant.parse(it) }.getOrNull()
    }
}

object SyncMerger {
    fun merge(current: PersistedState, response: SyncResponse): PersistedState {
        val connections = if (response.fullSync) response.connections else current.cachedConnections
        return current.copy(
            lastConfigVersion = if (response.fullSync) response.targetConfigVersion else current.lastConfigVersion,
            syncCapabilityVersion = if (response.fullSync) SYNC_CAPABILITY_VERSION else current.syncCapabilityVersion,
            cachedConnections = connections,
            leaseExpiresAt = response.lease?.expiresAt ?: current.leaseExpiresAt,
        )
    }
}

@Serializable
data class ApiErrorBody(
    @SerialName("error_code") val errorCode: String = "HTTP_ERROR",
    val message: String = "Request failed",
    @SerialName("request_id") val requestId: String? = null,
)

class ApiException(
    val statusCode: Int,
    val errorCode: String,
    override val message: String,
) : Exception(message)
