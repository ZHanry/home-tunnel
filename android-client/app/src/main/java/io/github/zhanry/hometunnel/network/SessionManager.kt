package io.github.zhanry.hometunnel.network

import io.github.zhanry.hometunnel.model.RefreshResponse
import io.github.zhanry.hometunnel.model.SessionResponse
import java.time.Clock
import java.time.Instant
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class SessionManager(private val clock: Clock = Clock.systemUTC()) {
    private val refreshMutex = Mutex()

    @Volatile
    private var session: MemorySession? = null

    fun install(value: SessionResponse) {
        session = MemorySession(
            accessToken = value.accessToken,
            refreshToken = value.refreshToken,
            accessExpiresAt = Instant.parse(value.accessExpiresAt),
        )
    }

    fun clear() {
        session = null
    }

    fun hasSession(): Boolean = session != null

    suspend fun accessToken(refresher: suspend (String) -> RefreshResponse): String {
        val current = session ?: throw NoSessionException()
        if (current.accessExpiresAt.isAfter(clock.instant().plusSeconds(60))) return current.accessToken
        return refreshMutex.withLock {
            val afterLock = session ?: throw NoSessionException()
            if (afterLock.accessExpiresAt.isAfter(clock.instant().plusSeconds(60))) {
                return@withLock afterLock.accessToken
            }
            install(refresher(afterLock.refreshToken))
            requireNotNull(session).accessToken
        }
    }

    suspend fun refreshAfterUnauthorized(
        rejectedAccessToken: String,
        refresher: suspend (String) -> RefreshResponse,
    ): String = refreshMutex.withLock {
        val current = session ?: throw NoSessionException()
        if (current.accessToken != rejectedAccessToken &&
            current.accessExpiresAt.isAfter(clock.instant().plusSeconds(5))
        ) {
            return@withLock current.accessToken
        }
        install(refresher(current.refreshToken))
        requireNotNull(session).accessToken
    }

    private fun install(value: RefreshResponse) {
        session = MemorySession(
            accessToken = value.accessToken,
            refreshToken = value.refreshToken,
            accessExpiresAt = Instant.parse(value.accessExpiresAt),
        )
    }

    private data class MemorySession(
        val accessToken: String,
        val refreshToken: String,
        val accessExpiresAt: Instant,
    )
}

class NoSessionException : IllegalStateException("No active control-center session")
