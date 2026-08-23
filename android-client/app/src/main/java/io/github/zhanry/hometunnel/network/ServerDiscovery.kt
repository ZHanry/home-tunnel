package io.github.zhanry.hometunnel.network

import io.github.zhanry.hometunnel.BuildConfig
import io.github.zhanry.hometunnel.model.DiscoveryResponse
import io.github.zhanry.hometunnel.model.ServerProfile
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object ServerDiscovery {
    const val MAXIMUM_DISCOVERY_BYTES = 32 * 1024
    private const val MAXIMUM_CERTIFICATE_CHARS = 16 * 1024
    private val domainLabel = Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
    private val json = Json { ignoreUnknownKeys = true }

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    suspend fun discover(address: String): ServerProfile = withContext(Dispatchers.IO) {
        val requested = normalizeRoot(address)
        val endpoint = requested.resolve("/api/v1/public/config")
        val request = Request.Builder()
            .url(endpoint.toString())
            .header("Accept", "application/json")
            .header("User-Agent", "HomeTunnel-Android/${BuildConfig.VERSION_NAME}")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (response.code in 300..399) {
                throw DiscoveryException("Server configuration redirected; enter the final HTTPS origin")
            }
            if (!response.isSuccessful) {
                throw DiscoveryException("Server discovery returned HTTP ${response.code}")
            }
            val contentLength = response.body?.contentLength() ?: 0
            if (contentLength > MAXIMUM_DISCOVERY_BYTES) {
                throw DiscoveryException("Server configuration is too large")
            }
            val bytes = response.body?.byteStream()?.readLimited(MAXIMUM_DISCOVERY_BYTES)
                ?: throw DiscoveryException("Server configuration is empty")
            if (bytes.isEmpty()) throw DiscoveryException("Server configuration is empty")
            val wire = runCatching { json.decodeFromString<DiscoveryResponse>(bytes.decodeToString()) }
                .getOrElse { throw DiscoveryException("Server configuration is invalid", it) }
            validateProfile(requested, wire)
        }
    }

    internal fun normalizeRoot(value: String): URI {
        var input = value.trim()
        if (!input.contains("://")) input = "https://$input"
        val parsed = runCatching { URI(input) }.getOrNull()
            ?: throw DiscoveryException("Server address must be an HTTPS root origin")
        if (
            !parsed.scheme.equals("https", ignoreCase = true) ||
            parsed.host.isNullOrBlank() ||
            parsed.userInfo != null ||
            parsed.rawQuery != null ||
            parsed.rawFragment != null ||
            (parsed.rawPath.orEmpty() !in setOf("", "/"))
        ) {
            throw DiscoveryException("Server address must be an HTTPS root origin")
        }
        val port = parsed.port
        return URI("https", null, parsed.host.lowercase(Locale.ROOT), port, "/", null, null)
    }

    internal fun validateProfile(requested: URI, wire: DiscoveryResponse): ServerProfile {
        val canonical = normalizeRoot(wire.publicBaseUrl)
        if (!sameOrigin(requested, canonical)) {
            throw DiscoveryException("Server returned a different control-center origin")
        }
        val domain = wire.tunnelDomain.trim().trim('.').lowercase(Locale.ROOT)
        if (domain.length > 253 || !domain.contains('.') ||
            domain.split('.').any { !domainLabel.matches(it) }
        ) {
            throw DiscoveryException("Server returned an invalid tunnel domain")
        }
        val frpsHost = wire.frpsHost.trim()
        if (frpsHost.isEmpty() || frpsHost.length > 253 ||
            frpsHost.any { it.isWhitespace() } || frpsHost.any { it in "/\\" }
        ) {
            throw DiscoveryException("Server returned an invalid FRPS host")
        }
        if (wire.frpsPort !in 1..65535) {
            throw DiscoveryException("Server returned an invalid FRPS port")
        }
        val certificate = wire.frpsTlsCertificatePem?.takeIf { it.isNotBlank() }
            ?: throw DiscoveryException("Server did not publish the managed FRPS certificate")
        if (
            certificate.length > MAXIMUM_CERTIFICATE_CHARS ||
            !certificate.contains("-----BEGIN CERTIFICATE-----") ||
            !certificate.contains("-----END CERTIFICATE-----")
        ) {
            throw DiscoveryException("Server returned an invalid FRPS certificate")
        }
        return ServerProfile(
            publicBaseUrl = canonical.toString(),
            apiBaseUrl = canonical.resolve("/api/v1/").toString(),
            frpsHost = frpsHost,
            frpsPort = wire.frpsPort,
            tunnelDomain = domain,
            frpsTlsCertificatePem = certificate,
        )
    }

    internal fun sameOrigin(left: URI, right: URI): Boolean =
        left.scheme.equals(right.scheme, ignoreCase = true) &&
            left.host.equals(right.host, ignoreCase = true) &&
            effectivePort(left) == effectivePort(right)

    private fun effectivePort(uri: URI): Int = if (uri.port >= 0) uri.port else 443

    private fun java.io.InputStream.readLimited(maximum: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = read(buffer)
            if (read < 0) break
            total += read
            if (total > maximum) throw DiscoveryException("Server configuration is too large")
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }
}

class DiscoveryException(message: String, cause: Throwable? = null) : IOException(message, cause)
