package io.github.zhanry.hometunnel.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.zhanry.hometunnel.model.PersistedState
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

class SecureStateStore(context: Context) {
    companion object {
        private const val KEY_ALIAS = "home_tunnel_android_state_v1"
        private const val STATE_DIRECTORY = "home_tunnel"
        private const val STATE_FILE = "state.enc"
        private val MAGIC = byteArrayOf('H'.code.toByte(), 'T'.code.toByte(), 'A'.code.toByte(), 1)
    }

    private val noBackupRoot = File(context.noBackupFilesDir, STATE_DIRECTORY)
    private val stateFile = File(noBackupRoot, STATE_FILE)
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = false
    }
    private val mutex = Mutex()
    private var cached: PersistedState? = null

    suspend fun load(): PersistedState = mutex.withLock {
        cached?.let { return@withLock it }
        withContext(Dispatchers.IO) {
            ensureDirectory()
            val loaded = if (!stateFile.exists()) {
                PersistedState()
            } else {
                runCatching {
                    val plaintext = decrypt(stateFile.readBytes())
                    json.decodeFromString<PersistedState>(plaintext.decodeToString())
                }.getOrElse { error ->
                    preserveDamagedState()
                    throw StateUnavailableException("Encrypted device state could not be read; re-enrollment is required", error)
                }
            }
            cached = loaded
            loaded
        }
    }

    suspend fun save(value: PersistedState) = mutex.withLock {
        withContext(Dispatchers.IO) {
            ensureDirectory()
            val encrypted = encrypt(json.encodeToString(PersistedState.serializer(), value).encodeToByteArray())
            val temporary = File(noBackupRoot, ".state-${System.nanoTime()}.tmp")
            try {
                FileOutputStream(temporary).use { stream ->
                    stream.write(encrypted)
                    stream.fd.sync()
                }
                protectFile(temporary)
                if (!temporary.renameTo(stateFile)) {
                    stateFile.delete()
                    if (!temporary.renameTo(stateFile)) throw IllegalStateException("Unable to replace encrypted state")
                }
                protectFile(stateFile)
                cached = value
            } finally {
                temporary.delete()
            }
        }
    }

    suspend fun update(transform: (PersistedState) -> PersistedState): PersistedState = mutex.withLock {
        withContext(Dispatchers.IO) {
            val current = cached ?: loadUnlocked()
            val next = transform(current)
            writeUnlocked(next)
            cached = next
            next
        }
    }

    suspend fun clear(): PersistedState = mutex.withLock {
        withContext(Dispatchers.IO) {
            stateFile.delete()
            noBackupRoot.listFiles()?.forEach { file ->
                if (file.name.startsWith("runtime") || file.name.startsWith(".state-")) file.deleteRecursively()
            }
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
            PersistedState().also { cached = it }
        }
    }

    fun runtimeDirectory(): File = File(noBackupRoot, "runtime")

    private fun loadUnlocked(): PersistedState {
        ensureDirectory()
        if (!stateFile.exists()) return PersistedState()
        return runCatching {
            json.decodeFromString<PersistedState>(decrypt(stateFile.readBytes()).decodeToString())
        }.getOrElse { error ->
            preserveDamagedState()
            throw StateUnavailableException("Encrypted device state could not be read; re-enrollment is required", error)
        }
    }

    private fun writeUnlocked(value: PersistedState) {
        ensureDirectory()
        val encrypted = encrypt(json.encodeToString(PersistedState.serializer(), value).encodeToByteArray())
        val temporary = File(noBackupRoot, ".state-${System.nanoTime()}.tmp")
        try {
            FileOutputStream(temporary).use { stream ->
                stream.write(encrypted)
                stream.fd.sync()
            }
            protectFile(temporary)
            if (!temporary.renameTo(stateFile)) {
                stateFile.delete()
                if (!temporary.renameTo(stateFile)) throw IllegalStateException("Unable to replace encrypted state")
            }
            protectFile(stateFile)
        } finally {
            temporary.delete()
        }
    }

    private fun ensureDirectory() {
        if (!noBackupRoot.exists() && !noBackupRoot.mkdirs()) {
            throw IllegalStateException("Unable to create secure state directory")
        }
        noBackupRoot.setReadable(false, false)
        noBackupRoot.setWritable(false, false)
        noBackupRoot.setExecutable(false, false)
        noBackupRoot.setReadable(true, true)
        noBackupRoot.setWritable(true, true)
        noBackupRoot.setExecutable(true, true)
    }

    private fun protectFile(file: File) {
        file.setReadable(false, false)
        file.setWritable(false, false)
        file.setExecutable(false, false)
        file.setReadable(true, true)
        file.setWritable(true, true)
    }

    private fun preserveDamagedState() {
        if (!stateFile.exists()) return
        val damaged = File(noBackupRoot, "$STATE_FILE.damaged-${System.currentTimeMillis()}")
        stateFile.renameTo(damaged)
    }

    private fun encrypt(plaintext: ByteArray): ByteArray {
        val iv = ByteArray(12).also(SecureRandom()::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, stateKey(), GCMParameterSpec(128, iv))
        val encrypted = cipher.doFinal(plaintext)
        return ByteArrayOutputStream(MAGIC.size + 1 + iv.size + encrypted.size).use { output ->
            output.write(MAGIC)
            output.write(iv.size)
            output.write(iv)
            output.write(encrypted)
            output.toByteArray()
        }
    }

    private fun decrypt(payload: ByteArray): ByteArray {
        if (payload.size < MAGIC.size + 1 + 12 + 16 || !payload.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) {
            throw IllegalArgumentException("Encrypted state header is invalid")
        }
        val ivLength = payload[MAGIC.size].toInt() and 0xff
        if (ivLength !in 12..16 || payload.size <= MAGIC.size + 1 + ivLength) {
            throw IllegalArgumentException("Encrypted state IV is invalid")
        }
        val ivStart = MAGIC.size + 1
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, stateKey(), GCMParameterSpec(128, payload.copyOfRange(ivStart, ivStart + ivLength)))
        return cipher.doFinal(payload.copyOfRange(ivStart + ivLength, payload.size))
    }

    private fun stateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }
}

fun installationFingerprint(installId: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest("HomeTunnel-Android\n$installId".encodeToByteArray())
    return digest.joinToString("") { "%02x".format(it) }
}

class StateUnavailableException(message: String, cause: Throwable) : IllegalStateException(message, cause)
