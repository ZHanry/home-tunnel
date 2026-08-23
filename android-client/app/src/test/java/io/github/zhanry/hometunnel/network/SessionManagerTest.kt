package io.github.zhanry.hometunnel.network

import io.github.zhanry.hometunnel.model.RefreshResponse
import io.github.zhanry.hometunnel.model.SessionResponse
import io.github.zhanry.hometunnel.model.UserInfo
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlin.test.assertEquals
import org.junit.Test

class SessionManagerTest {
    @Test
    fun `concurrent callers perform exactly one refresh`() = runTest {
        val now = Instant.parse("2026-08-23T00:00:00Z")
        val manager = SessionManager(Clock.fixed(now, ZoneOffset.UTC))
        manager.install(
            SessionResponse(
                user = UserInfo("u", "user", "User", "user", "normal"),
                accessToken = "expired-access",
                refreshToken = "refresh-a",
                accessExpiresAt = now.minusSeconds(1).toString(),
                refreshExpiresAt = now.plusSeconds(3600).toString(),
            ),
        )
        val refreshes = AtomicInteger()
        val values = List(32) {
            async {
                manager.accessToken { presented ->
                    assertEquals("refresh-a", presented)
                    refreshes.incrementAndGet()
                    RefreshResponse(
                        accessToken = "fresh-access",
                        refreshToken = "refresh-b",
                        accessExpiresAt = now.plusSeconds(900).toString(),
                    )
                }
            }
        }.awaitAll()
        assertEquals(1, refreshes.get())
        assertEquals(setOf("fresh-access"), values.toSet())
    }

    @Test
    fun `a late unauthorized response reuses the token already refreshed by another call`() = runTest {
        val now = Instant.parse("2026-08-23T00:00:00Z")
        val manager = SessionManager(Clock.fixed(now, ZoneOffset.UTC))
        manager.install(
            SessionResponse(
                user = UserInfo("u", "user", "User", "user", "normal"),
                accessToken = "access-a",
                refreshToken = "refresh-a",
                accessExpiresAt = now.plusSeconds(10).toString(),
                refreshExpiresAt = now.plusSeconds(3600).toString(),
            ),
        )
        val refreshes = AtomicInteger()
        val first = manager.refreshAfterUnauthorized("access-a") {
            refreshes.incrementAndGet()
            RefreshResponse("access-b", "refresh-b", now.plusSeconds(900).toString())
        }
        val late = manager.refreshAfterUnauthorized("access-a") {
            refreshes.incrementAndGet()
            error("must not reuse the rotated refresh token")
        }
        assertEquals("access-b", first)
        assertEquals("access-b", late)
        assertEquals(1, refreshes.get())
    }
}
