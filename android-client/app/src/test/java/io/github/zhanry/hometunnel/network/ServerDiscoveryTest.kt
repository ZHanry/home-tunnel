package io.github.zhanry.hometunnel.network

import io.github.zhanry.hometunnel.model.DiscoveryResponse
import java.net.URI
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import org.junit.Test

class ServerDiscoveryTest {
    @Test
    fun `normalizes only an HTTPS root origin`() {
        assertEquals("https://console.example.com/", ServerDiscovery.normalizeRoot("console.example.com").toString())
        assertEquals("https://console.example.com:8443/", ServerDiscovery.normalizeRoot("https://console.example.com:8443/").toString())
        assertFailsWith<DiscoveryException> { ServerDiscovery.normalizeRoot("http://console.example.com") }
        assertFailsWith<DiscoveryException> { ServerDiscovery.normalizeRoot("https://user@console.example.com") }
        assertFailsWith<DiscoveryException> { ServerDiscovery.normalizeRoot("https://console.example.com/api") }
        assertFailsWith<DiscoveryException> { ServerDiscovery.normalizeRoot("https://console.example.com/?next=other") }
    }

    @Test
    fun `rejects a discovered origin mismatch and malformed trust fields`() {
        val requested = URI("https://console.example.com/")
        val valid = DiscoveryResponse(
            publicBaseUrl = "https://console.example.com",
            tunnelDomain = "tunnel.example.com",
            frpsHost = "frps.example.com",
            frpsPort = 7000,
            frpsTlsCertificatePem = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n",
        )
        val profile = ServerDiscovery.validateProfile(requested, valid)
        assertEquals("https://console.example.com/api/v1/", profile.apiBaseUrl)
        assertFailsWith<DiscoveryException> {
            ServerDiscovery.validateProfile(requested, valid.copy(publicBaseUrl = "https://other.example.com"))
        }
        assertFailsWith<DiscoveryException> {
            ServerDiscovery.validateProfile(requested, valid.copy(tunnelDomain = "bad_domain"))
        }
        assertFailsWith<DiscoveryException> {
            ServerDiscovery.validateProfile(requested, valid.copy(frpsHost = "frps.example.com/path"))
        }
        assertFailsWith<DiscoveryException> {
            ServerDiscovery.validateProfile(requested, valid.copy(frpsPort = 0))
        }
        assertFailsWith<DiscoveryException> {
            ServerDiscovery.validateProfile(requested, valid.copy(frpsTlsCertificatePem = null))
        }
        assertFailsWith<DiscoveryException> {
            ServerDiscovery.validateProfile(requested, valid.copy(frpsTlsCertificatePem = "not a certificate"))
        }
    }
}
