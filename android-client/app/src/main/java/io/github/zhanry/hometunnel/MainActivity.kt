package io.github.zhanry.hometunnel

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import io.github.zhanry.hometunnel.ui.HomeTunnelApp
import io.github.zhanry.hometunnel.ui.theme.HomeTunnelTheme

class MainActivity : AppCompatActivity() {
    private val repository
        get() = (application as HomeTunnelApplication).repository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            HomeTunnelTheme {
                HomeTunnelApp(repository = repository)
            }
        }
    }
}
