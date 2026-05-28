package com.vault.auth.ui.components
import androidx.compose.material3.MaterialTheme

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vault.auth.ui.theme.EmeraldGreen
import com.vault.auth.ui.theme.NeonCyan

@Composable
fun ThreatScoreMeter(score: Int) {
    val animatedScore by animateIntAsState(
        targetValue = score,
        animationSpec = tween(durationMillis = 1500, easing = FastOutSlowInEasing),
        label = "ScoreAnimation"
    )

    val color = when {
        score < 30 -> EmeraldGreen
        score < 70 -> Color(0xFFFFD60A)
        else -> Color(0xFFFF3B30)
    }

    Box(
        modifier = Modifier
            .size(240.dp)
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val strokeWidth = 14.dp.toPx()
            
            // Background Arc
            drawArc(
                color = Color(0xFF1C1C1E),
                startAngle = 135f,
                sweepAngle = 270f,
                useCenter = false,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
            )

            // Progress Arc
            drawArc(
                brush = Brush.sweepGradient(
                    0.0f to color.copy(alpha = 0.5f),
                    0.5f to color,
                    1.0f to color.copy(alpha = 0.5f)
                ),
                startAngle = 135f,
                sweepAngle = (animatedScore / 100f) * 270f,
                useCenter = false,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
            )
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "$animatedScore",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 48.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Security Score",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = when {
                    score < 30 -> "EXCELLENT"
                    score < 70 -> "MODERATE"
                    else -> "CRITICAL"
                },
                color = color,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.sp
            )
        }
    }
}
