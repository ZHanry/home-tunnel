package io.github.zhanry.hometunnel.model

import kotlinx.serialization.json.Json
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import org.junit.Test

class TunnelConnectionTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `canonical remote port wins including explicit zero`() {
        val canonical = json.decodeFromString<TunnelConnection>(
            """{"id":"1","proxy_type":"udp","remote_port":20001,"tcp_remote_port":10001,"local_port":53,"version":1}""",
        )
        val zero = json.decodeFromString<TunnelConnection>(
            """{"id":"2","proxy_type":"tcp","remote_port":0,"tcp_remote_port":10001,"local_port":22,"version":1}""",
        )
        assertEquals(20001, canonical.remotePort)
        assertEquals(0, zero.remotePort)
    }

    @Test
    fun `legacy TCP remote port is accepted only when canonical field is absent`() {
        val legacy = json.decodeFromString<TunnelConnection>(
            """{"id":"1","proxy_type":"tcp","tcp_remote_port":10001,"public_endpoint":"edge.example.com:10001","local_port":22,"version":1}""",
        )
        assertEquals(10001, legacy.remotePort)
        assertEquals("tcp://edge.example.com:10001", legacy.publicDisplayEndpoint)
        assertFalse(json.encodeToString(TunnelConnection.serializer(), legacy).contains("tcp_remote_port"))
    }

    @Test
    fun `unknown proxy type remains unknown and never falls through to HTTP`() {
        val value = json.decodeFromString<TunnelConnection>(
            """{"id":"1","proxy_type":"stcp","local_port":22,"enabled":true,"version":1}""",
        )
        assertEquals(ProxyKind.UNKNOWN, value.kind)
    }
}
