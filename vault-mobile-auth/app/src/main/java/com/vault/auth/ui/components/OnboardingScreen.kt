package com.vault.auth.ui.components
import androidx.compose.material3.MaterialTheme

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vault.auth.ui.theme.NeonCyan

data class OnboardingPage(
    val title: String,
    val description: String,
    val animationContent: @Composable () -> Unit
)

@Composable
fun OnboardingScreen(
    onFinished: () -> Unit
) {
    var currentPage by remember { mutableStateOf(0) }
    
    val pages = listOf(
        OnboardingPage(
            "Absolute Ownership",
            "Your files should belong only to you. Zero-knowledge means even we can't see your data.",
            { ShardAnimation() }
        ),
        OnboardingPage(
            "Magic Unlock",
            "Your phone is the key. Unlock your computer with a simple biometric tap.",
            { SignalBeamAnimation() }
        ),
        OnboardingPage(
            "Military Grade",
            "AES-256 encryption protects your data before it ever leaves your device.",
            { EncryptionAnimation() }
        ),
        OnboardingPage(
            "Recovery Key",
            "Your 24-word Master Key is your ultimate fail-safe. Store it offline, safely.",
            { KeyAnimation() }
        ),
        OnboardingPage(
            "Ready to Secure",
            "Connect your first computer to start your journey into complete privacy.",
            { FinalOnboardingAction(onFinished) }
        )
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Animation Area
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Crossfade(targetState = currentPage, label = "OnboardingAnim") { pageIndex ->
                    pages[pageIndex].animationContent()
                }
            }

            // Text Area
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(vertical = 32.dp)
            ) {
                Text(
                    text = pages[currentPage].title,
                    color = MaterialTheme.colorScheme.onBackground,
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = pages[currentPage].description,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    lineHeight = 24.sp
                )
            }

            // Navigation Area
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 32.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Page Indicators
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pages.indices.forEach { index ->
                        Box(
                            modifier = Modifier
                                .size(if (index == currentPage) 24.dp else 8.dp, 8.dp)
                                .clip(CircleShape)
                                .background(if (index == currentPage) NeonCyan else Color(0xFF2C2C2E))
                        )
                    }
                }

                if (currentPage < pages.size - 1) {
                    IconButton(
                        onClick = { currentPage++ },
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(NeonCyan)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ArrowForward,
                            contentDescription = "Next",
                            tint = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ShardAnimation() {
    val infiniteTransition = rememberInfiniteTransition(label = "Shard")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(10000, easing = LinearEasing)),
        label = "Rotation"
    )
    
    Box(
        modifier = Modifier
            .size(200.dp),
        contentAlignment = Alignment.Center
    ) {
        // Encrypted shards visualization
        (0..5).forEach { i ->
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .offset(x = (i * 10).dp, y = (i * 5).dp)
                    .background(NeonCyan.copy(alpha = 0.2f), RoundedCornerShape(8.dp))
            )
        }
    }
}

@Composable
fun SignalBeamAnimation() {
    // Basic signal pulse animation
    Box(contentAlignment = Alignment.Center) {
        (1..3).forEach { i ->
            val infiniteTransition = rememberInfiniteTransition(label = "Signal")
            val scale by infiniteTransition.animateFloat(
                initialValue = 1f,
                targetValue = 2.5f,
                animationSpec = infiniteRepeatable(
                    animation = tween(2000, delayMillis = i * 500),
                    repeatMode = RepeatMode.Restart
                ),
                label = "Scale"
            )
            val alpha by infiniteTransition.animateFloat(
                initialValue = 0.5f,
                targetValue = 0f,
                animationSpec = infiniteRepeatable(
                    animation = tween(2000, delayMillis = i * 500),
                    repeatMode = RepeatMode.Restart
                ),
                label = "Alpha"
            )
            
            Box(
                modifier = Modifier
                    .size(60.dp)
                    .scale(scale)
                    .clip(CircleShape)
                    .background(NeonCyan.copy(alpha = alpha))
            )
        }
    }
}

@Composable
fun EncryptionAnimation() {
    // Shield/Lock animation placeholder
    Box(
        modifier = Modifier
            .size(120.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(
                Brush.linearGradient(
                    colors = listOf(NeonCyan.copy(alpha = 0.2f), Color.Transparent)
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Text("🔒", fontSize = 60.sp)
    }
}

@Composable
fun KeyAnimation() {
    Text("📝", fontSize = 80.sp)
}

@Composable
fun FinalOnboardingAction(onFinished: () -> Unit) {
    Button(
        onClick = onFinished,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        colors = ButtonDefaults.buttonColors(containerColor = NeonCyan),
        shape = RoundedCornerShape(12.dp)
    ) {
        Text("Get Started", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
    }
}

// Extension to help with animations
private fun Modifier.scale(scale: Float) = this.then(
    Modifier.graphicsLayer(scaleX = scale, scaleY = scale)
)
