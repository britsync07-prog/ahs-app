package com.vault.auth.ui.components
import androidx.compose.material3.MaterialTheme

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Monitor
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vault.auth.ui.theme.NeonCyan

enum class NavTab(val label: String, val icon: ImageVector) {
    VAULT("Vault", Icons.Default.Lock),
    DEVICES("Devices", Icons.Default.Monitor),
    ACTIVITY("Activity", Icons.Default.History),
    SHIELD("Shield", Icons.Default.Security),
    SETTINGS("Settings", Icons.Default.Settings)
}

@Composable
fun FloatingNavBar(
    selectedTab: NavTab,
    onTabSelected: (NavTab) -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 24.dp),
        contentAlignment = Alignment.BottomCenter
    ) {
        Surface(
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .height(64.dp),
            shape = RoundedCornerShape(32.dp),
            color = Color.Transparent,
            shadowElevation = 8.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
                                MaterialTheme.colorScheme.background.copy(alpha = 1.0f)
                            )
                        )
                    )
                    .padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                NavTab.values().forEach { tab ->
                    val isSelected = selectedTab == tab
                    val iconColor by animateColorAsState(
                        targetValue = if (isSelected) NeonCyan else MaterialTheme.colorScheme.onSurfaceVariant,
                        animationSpec = spring(stiffness = Spring.StiffnessLow)
                    )

                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null
                            ) { onTabSelected(tab) },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = tab.icon,
                            contentDescription = tab.label,
                            tint = iconColor,
                            modifier = Modifier.size(24.dp)
                        )
                        if (isSelected) {
                            Text(
                                text = tab.label,
                                color = NeonCyan,
                                fontSize = 10.sp,
                                modifier = Modifier.padding(top = 2.dp)
                            )
                            // Indicator line
                            Box(
                                modifier = Modifier
                                    .padding(top = 2.dp)
                                    .size(12.dp, 2.dp)
                                    .background(NeonCyan, RoundedCornerShape(1.dp))
                            )
                        }
                    }
                }
            }
        }
    }
}
