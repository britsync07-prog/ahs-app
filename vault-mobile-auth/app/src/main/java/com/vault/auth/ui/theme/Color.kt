package com.vault.auth.ui.theme
import androidx.compose.material3.MaterialTheme

import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.Composable

// Dark Mode Colors
val PureBlack = Color(0xFF000000)
val Graphite = Color(0xFF1C1C1E)
val DarkNavy = Color(0xFF0A0A14)
val SurfaceGray = Color(0xFF121212)
val DarkTextPrimary = Color(0xFFF2F2F7)
val DarkTextSecondary = Color(0xFF8E8E93)
val DarkTextTertiary = Color(0xFF636366)

// Light Mode Colors
val LightBackground = Color(0xFFF2F2F7)
val LightSurface = Color(0xFFFFFFFF)
val LightTextPrimary = Color(0xFF000000)
val LightTextSecondary = Color(0xFF636366)
val LightTextTertiary = Color(0xFF8E8E93)
val LightBorder = Color(0xFFD1D1D6)

// Accents
val NeonCyan = Color(0xFF00F2FF)
val AppleBlue = Color(0xFF007AFF)
val EmeraldGreen = Color(0xFF00E676)
val ElectricBlue = Color(0xFF2979FF)
val DeepRed = Color(0xFFFF1744)

// Standardized Aliases (to be used in components)
val TextPrimary @Composable get() = if (androidx.compose.foundation.isSystemInDarkTheme()) DarkTextPrimary else LightTextPrimary
val TextSecondary @Composable get() = if (androidx.compose.foundation.isSystemInDarkTheme()) DarkTextSecondary else LightTextSecondary
