package io.github.zhanry.hometunnel.agent

import io.github.zhanry.hometunnel.model.LeaseInfo
import io.github.zhanry.hometunnel.model.ProxyKind
import io.github.zhanry.hometunnel.model.ServerProfile
import io.github.zhanry.hometunnel.model.TunnelConnection
import java.util.Locale

object AgentConfigRenderer {
    fun render(
        profile: ServerProfile,
        deviceId: String,
        lease: LeaseInfo,
        connections: List<TunnelConnection>,
        trustedCaPath: String?,
    ): String = buildString {
        appendLine("serverAddr = ${toml(profile.frpsHost)}")
        appendLine("serverPort = ${profile.frpsPort}")
        appendLine("user = ${toml(deviceId)}")
        appendLine("loginFailExit = true")
        appendLine("transport.tls.enable = true")
        appendLine("transport.tls.disableCustomTLSFirstByte = true")
        if (!trustedCaPath.isNullOrBlank()) {
            appendLine("transport.tls.trustedCaFile = ${toml(trustedCaPath)}")
            appendLine("transport.tls.serverName = ${toml(profile.frpsHost)}")
        }
        appendLine("transport.heartbeatInterval = 30")
        appendLine("transport.heartbeatTimeout = 90")
        appendLine("metadatas.home_tunnel_lease = ${toml(lease.lease)}")
        appendLine("log.to = \"console\"")
        appendLine("log.level = \"info\"")

        connections.filter { it.enabled }.forEach { connection ->
            require(connection.localPort in 1..65535) { "Connection ${connection.id} has an invalid local port" }
            require(validLocalHost(connection.localHost)) { "Connection ${connection.id} has an invalid local host" }
            appendLine()
            appendLine("[[proxies]]")
            appendLine("name = ${toml(proxyName(connection))}")
            when (connection.kind) {
                ProxyKind.HTTP -> {
                    require(validSubdomain(connection.subdomain)) { "Connection ${connection.id} has an invalid subdomain" }
                    appendLine("type = \"http\"")
                    val domains = listOf("${connection.subdomain}.${profile.tunnelDomain}") + connection.customDomains
                    appendLine("customDomains = [${domains.joinToString(", ") { toml(it) }}]")
                }
                ProxyKind.TCP, ProxyKind.UDP -> throw IllegalArgumentException(
                    "Android Experimental supports HTTP connections only; ${connection.kind.wireName.uppercase(Locale.ROOT)} connection ${connection.id} was enabled",
                )
                ProxyKind.UNKNOWN -> throw IllegalArgumentException(
                    "Connection ${connection.id} has unsupported proxy type ${connection.proxyType}",
                )
            }
            appendLine("transport.useEncryption = true")
            appendLine("transport.useCompression = true")
            if (connection.kind != ProxyKind.UDP) {
                appendLine("healthCheck.type = \"tcp\"")
                appendLine("healthCheck.timeoutSeconds = 3")
                appendLine("healthCheck.intervalSeconds = 10")
            }
            if (connection.kind == ProxyKind.HTTP && connection.localScheme == "https") {
                appendLine("[proxies.plugin]")
                appendLine("type = \"http2https\"")
                appendLine("localAddr = ${toml("${connection.localHost}:${connection.localPort}")}")
                appendLine("hostHeaderRewrite = ${toml(connection.localHost)}")
            } else {
                appendLine("localIP = ${toml(connection.localHost)}")
                appendLine("localPort = ${connection.localPort}")
            }
        }
    }

    internal fun toml(value: String): String = buildString(value.length + 2) {
        append('"')
        value.forEach { character ->
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\r', '\n' -> Unit
                else -> append(character)
            }
        }
        append('"')
    }

    private fun proxyName(connection: TunnelConnection): String =
        connection.proxyName?.takeIf { it.isNotBlank() }
            ?: "ht_${connection.id.replace("-", "")}_v${connection.version}"

    private fun validSubdomain(value: String): Boolean =
        Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$").matches(value)

    private fun validLocalHost(value: String): Boolean {
        val host = value.trim()
        return host.isNotEmpty() && host.length <= 253 && host.none { it.isWhitespace() || it in "/\\" }
    }
}

data class AgentTrustProfile(
    val server: String,
    val port: Int,
    val domain: String,
    val allowedCustomDomains: List<String>,
    val allowedTcpPorts: List<Int>,
    val allowedUdpPorts: List<Int>,
    val tlsCaSha256: String?,
) {
    companion object {
        fun from(
            profile: ServerProfile,
            connections: List<TunnelConnection>,
            tlsCaSha256: String?,
        ): AgentTrustProfile = AgentTrustProfile(
            server = profile.frpsHost,
            port = profile.frpsPort,
            domain = profile.tunnelDomain,
            allowedCustomDomains = connections.asSequence()
                .filter { it.enabled && it.kind == ProxyKind.HTTP }
                .flatMap { it.customDomains.asSequence() }
                .map { it.trim().trim('.').lowercase(Locale.ROOT) }
                .filter { it.isNotEmpty() }
                .distinct()
                .sorted()
                .toList(),
            allowedTcpPorts = connections.asSequence()
                .filter { it.enabled && it.kind == ProxyKind.TCP }
                .mapNotNull { it.remotePort }
                .distinct()
                .sorted()
                .toList(),
            allowedUdpPorts = connections.asSequence()
                .filter { it.enabled && it.kind == ProxyKind.UDP }
                .mapNotNull { it.remotePort }
                .distinct()
                .sorted()
                .toList(),
            tlsCaSha256 = tlsCaSha256,
        )
    }
}
