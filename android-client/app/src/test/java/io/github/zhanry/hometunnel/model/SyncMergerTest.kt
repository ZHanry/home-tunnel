package io.github.zhanry.hometunnel.model

import io.github.zhanry.hometunnel.network.requestedConfigVersion
import io.github.zhanry.hometunnel.service.shouldApplySync
import io.github.zhanry.hometunnel.service.shouldReportLease
import io.github.zhanry.hometunnel.service.isRecoverableSessionFailure
import io.github.zhanry.hometunnel.service.isTerminalDeviceFailure
import java.time.Instant
import kotlin.test.assertEquals
import org.junit.Test

class SyncMergerTest {
    private val cached = TunnelConnection(
        id = "cached",
        deviceId = "device",
        name = "Cached",
        subdomain = "cached",
        proxyType = "http",
        localPort = 8080,
        version = 7,
    )

    @Test
    fun `unchanged sync never replaces cached connections with the empty wire list`() {
        val state = PersistedState(
            lastConfigVersion = 7,
            syncCapabilityVersion = SYNC_CAPABILITY_VERSION,
            cachedConnections = listOf(cached),
        )
        val response = SyncResponse(
            deviceId = "device",
            fullSync = false,
            fromConfigVersion = 7,
            targetConfigVersion = 7,
            connections = emptyList(),
            contentHash = "hash",
            serverTime = "2026-08-23T00:00:00Z",
        )
        assertEquals(listOf(cached), SyncMerger.merge(state, response).cachedConnections)
    }

    @Test
    fun `a restarted service forces full sync even when a current cache exists`() {
        val state = PersistedState(
            lastConfigVersion = 7,
            syncCapabilityVersion = SYNC_CAPABILITY_VERSION,
            cachedConnections = listOf(cached),
        )
        assertEquals(7, requestedConfigVersion(state, forceFull = false))
        assertEquals(0, requestedConfigVersion(state, forceFull = true))
    }

    @Test
    fun `unchanged sync without a lease never triggers an invalid apply`() {
        val unchanged = SyncResponse(
            deviceId = "device",
            fullSync = false,
            targetConfigVersion = 7,
            connections = emptyList(),
            contentHash = "hash",
            serverTime = "2026-08-23T00:00:00Z",
        )
        assertEquals(false, shouldApplySync(unchanged))
        assertEquals(
            true,
            shouldApplySync(
                unchanged.copy(
                    lease = LeaseInfo("signed", "2026-08-24T00:00:00Z", 7),
                ),
            ),
        )
    }

    @Test
    fun `online agent with a far lease reports it and avoids needless renewal`() {
        val now = Instant.parse("2026-08-23T00:00:00Z")
        assertEquals(true, shouldReportLease(AgentState.ONLINE, now.plusSeconds(16 * 60), now))
        assertEquals(false, shouldReportLease(AgentState.ONLINE, now.plusSeconds(15 * 60), now))
        assertEquals(false, shouldReportLease(AgentState.DEGRADED, now.plusSeconds(60 * 60), now))
        assertEquals(false, shouldReportLease(AgentState.ONLINE, null, now))
    }

    @Test
    fun `expired sessions reauthenticate but rejected device credentials terminate`() {
        assertEquals(
            true,
            isRecoverableSessionFailure(ApiException(401, "SESSION_REVOKED", "expired")),
        )
        assertEquals(
            false,
            isTerminalDeviceFailure(ApiException(401, "SESSION_REVOKED", "expired")),
        )
        assertEquals(
            true,
            isTerminalDeviceFailure(ApiException(401, "AUTH_INVALID", "credential rejected")),
        )
        assertEquals(
            true,
            isTerminalDeviceFailure(ApiException(423, "DEVICE_REVOKED", "revoked")),
        )
    }

    @Test
    fun `full sync atomically replaces cache and advances capability marker`() {
        val next = cached.copy(id = "next", version = 8)
        val merged = SyncMerger.merge(
            PersistedState(cachedConnections = listOf(cached)),
            SyncResponse(
                deviceId = "device",
                fullSync = true,
                targetConfigVersion = 8,
                connections = listOf(next),
                contentHash = "hash",
                serverTime = "2026-08-23T00:00:00Z",
            ),
        )
        assertEquals(8, merged.lastConfigVersion)
        assertEquals(SYNC_CAPABILITY_VERSION, merged.syncCapabilityVersion)
        assertEquals(listOf(next), merged.cachedConnections)
    }
}
