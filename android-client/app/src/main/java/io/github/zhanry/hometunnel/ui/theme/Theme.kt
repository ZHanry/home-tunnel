package io.github.zhanry.hometunnel.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF006B60),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF9EF2E1),
    onPrimaryContainer = Color(0xFF00201C),
    secondary = Color(0xFF4A635E),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFCDE8E1),
    onSecondaryContainer = Color(0xFF06201B),
    tertiary = Color(0xFF805600),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFDDA4),
    onTertiaryContainer = Color(0xFF281800),
    background = Color(0xFFF6FAF8),
    onBackground = Color(0xFF171D1B),
    surface = Color(0xFFF6FAF8),
    onSurface = Color(0xFF171D1B),
    surfaceVariant = Color(0xFFDBE5E1),
    onSurfaceVariant = Color(0xFF3F4946),
    outline = Color(0xFF6F7976),
    error = Color(0xFFBA1A1A),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF82D5C5),
    onPrimary = Color(0xFF003730),
    primaryContainer = Color(0xFF005047),
    onPrimaryContainer = Color(0xFF9EF2E1),
    secondary = Color(0xFFB1CCC5),
    onSecondary = Color(0xFF1C3530),
    secondaryContainer = Color(0xFF334B46),
    onSecondaryContainer = Color(0xFFCDE8E1),
    tertiary = Color(0xFFFFBA46),
    onTertiary = Color(0xFF442C00),
    tertiaryContainer = Color(0xFF614000),
    onTertiaryContainer = Color(0xFFFFDDA4),
    background = Color(0xFF0E1513),
    onBackground = Color(0xFFDEE4E1),
    surface = Color(0xFF0E1513),
    onSurface = Color(0xFFDEE4E1),
    surfaceVariant = Color(0xFF3F4946),
    onSurfaceVariant = Color(0xFFBEC9C5),
    outline = Color(0xFF89938F),
    error = Color(0xFFFFB4AB),
)

@Composable
fun HomeTunnelTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
