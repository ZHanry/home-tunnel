package io.github.zhanry.hometunnel

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import io.github.zhanry.hometunnel.ui.HomeTunnelApp
import io.github.zhanry.hometunnel.ui.theme.HomeTunnelTheme

class MainActivity : AppCompatActivity() {
    private val repository
        get() = (application as HomeTunnelApplication).repository

    override fun onResume() {
        super.onResume()
        repository.refreshConnections(silent = true)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) { delay(30_000); repository.refreshConnections(silent = true) }
            }
        }
        setContent {
            HomeTunnelTheme {
                HomeTunnelApp(repository = repository)
            }
        }
    }
}
