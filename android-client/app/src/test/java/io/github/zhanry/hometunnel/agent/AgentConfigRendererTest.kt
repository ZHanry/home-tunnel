package io.github.zhanry.hometunnel.agent

import io.github.zhanry.hometunnel.model.LeaseInfo
import io.github.zhanry.hometunnel.model.ServerProfile
import io.github.zhanry.hometunnel.model.TunnelConnection
import java.time.Instant
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class AgentConfigRendererTest {
    private val profile = ServerProfile(
        publicBaseUrl = "https://console.example.com/",
        apiBaseUrl = "https://console.example.com/api/v1/",
        frpsHost = "frps.example.com",
        frpsPort = 7000,
        tunnelDomain = "tunnel.example.com",
    )
    private val lease = LeaseInfo("signed-lease", "2026-08-24T00:00:00Z", 3)

    @Test
    fun `renders the restricted managed HTTP template and CA pin`() {
        val config = AgentConfigRenderer.render(
            profile,
            "11111111-1111-4111-8111-111111111111",
            lease,
            listOf(
                TunnelConnection(
                    id = "1111-2222",
                    deviceId = "device",
                    name = "Camera",
                    subdomain = "camera",
                    proxyType = "http",
                    publicUrl = "https://camera.tunnel.example.com",
                    customDomains = listOf("home.example.net"),
                    localScheme = "https",
                    localHost = "nas.lan",
                    localPort = 8443,
                    enabled = true,
                    version = 3,
                ),
            ),
            "/data/user/0/app/no_backup/frps-ca.pem",
        )
        assertContains(config, "serverAddr = \"frps.example.com\"")
        assertContains(config, "transport.tls.trustedCaFile = \"/data/user/0/app/no_backup/frps-ca.pem\"")
        assertContains(config, "metadatas.home_tunnel_lease = \"signed-lease\"")
        assertContains(config, "customDomains = [\"camera.tunnel.example.com\", \"home.example.net\"]")
        assertContains(config, "type = \"http2https\"")
        assertContains(config, "localAddr = \"nas.lan:8443\"")
    }

    @Test
    fun `unknown enabled types fail closed while disabled records are omitted`() {
        val unknown = TunnelConnection(
            id = "unknown",
            deviceId = "device",
            name = "Unknown",
            subdomain = "unknown",
            proxyType = "stcp",
            localPort = 22,
            enabled = true,
            version = 1,
        )
        assertFailsWith<IllegalArgumentException> {
            AgentConfigRenderer.render(profile, "device", lease, listOf(unknown), null)
        }
        val disabled = AgentConfigRenderer.render(profile, "device", lease, listOf(unknown.copy(enabled = false)), null)
        assertFalse(disabled.contains("[[proxies]]"))
    }

    @Test
    fun `enabled TCP and UDP records fail closed locally`() {
        for (kind in listOf("tcp", "udp")) {
            val connection = TunnelConnection(
                id = kind,
                deviceId = "device",
                name = kind,
                subdomain = kind,
                proxyType = kind,
                remotePort = 10001,
                localPort = 22,
                enabled = true,
                version = 1,
            )
            assertFailsWith<IllegalArgumentException> {
                AgentConfigRenderer.render(profile, "device", lease, listOf(connection), null)
            }
        }
    }

    @Test
    fun `trust allowlists are protocol separated and exclude disabled records`() {
        val values = listOf(
            TunnelConnection("http", "d", "web", "web", "http", customDomains = listOf("HOME.example.net"), localPort = 80, version = 1),
            TunnelConnection("tcp", "d", "ssh", "ssh", "tcp", remotePort = 10001, localPort = 22, version = 1),
            TunnelConnection("udp", "d", "dns", "dns", "udp", remotePort = 20001, localPort = 53, version = 1),
            TunnelConnection("off", "d", "off", "off", "tcp", remotePort = 10002, localPort = 22, enabled = false, version = 1),
        )
        val trust = AgentTrustProfile.from(profile, values, "a".repeat(64))
        assertEquals(listOf("home.example.net"), trust.allowedCustomDomains)
        assertEquals(listOf(10001), trust.allowedTcpPorts)
        assertEquals(listOf(20001), trust.allowedUdpPorts)
    }

    @Test
    fun `lease expiry policy stops exactly at expiry`() {
        val expiry = Instant.parse("2026-08-23T01:00:00Z")
        assertFalse(LeasePolicy.expired(expiry, expiry.minusMillis(1)))
        assertTrue(LeasePolicy.expired(expiry, expiry))
        assertFalse(LeasePolicy.usableForApply(expiry, expiry.minusSeconds(60)))
        assertTrue(LeasePolicy.usableForApply(expiry, expiry.minusSeconds(61)))
    }
}
