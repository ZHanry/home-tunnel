package io.github.zhanry.hometunnel

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import io.github.zhanry.hometunnel.repository.HomeTunnelRepository
import io.github.zhanry.hometunnel.ui.HomeTunnelApp
import io.github.zhanry.hometunnel.ui.theme.HomeTunnelTheme

class MainActivity : AppCompatActivity() {
    private val repository: HomeTunnelRepository
        get() = (application as HomeTunnelApplication).repository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository.reconcileActivityWithService()
        enableEdgeToEdge()
        setContent {
            HomeTunnelTheme {
                HomeTunnelApp(
                    repository = repository,
                    notificationPermissionRequired = Build.VERSION.SDK_INT >= 33 &&
                        ContextCompat.checkSelfPermission(
                            this,
                            Manifest.permission.POST_NOTIFICATIONS,
                        ) != PackageManager.PERMISSION_GRANTED,
                )
            }
        }
    }
}
