package com.vault.auth.ui.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.Crossfade
import android.util.Log
import androidx.compose.ui.platform.LocalContext
import com.vault.auth.Constants
import com.vault.auth.ui.components.*
import com.vault.auth.ui.theme.EmeraldGreen
import com.vault.auth.ui.theme.NeonCyan
import com.vault.auth.ui.theme.DeepRed
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

enum class NavTab {
    VAULT, DEVICES, ACTIVITY, SHIELD, SETTINGS
}

@Composable
fun VaultDashboardScreen(
    publicKey: String,
    onUnlockClick: () -> Unit
) {
    val scrollState = rememberScrollState()
    val stats = remember { mutableStateMapOf(
        "vault_health" to "Secure",
        "active_sessions" to "0",
        "threats_blocked" to "0",
        "last_backup" to "---"
    ) }
    var latestActivity by remember { mutableStateOf("No recent activity") }

    LaunchedEffect(publicKey) {
        Thread {
            val client = OkHttpClient()
            val statsRequest = Request.Builder().url("${Constants.BASE_URL}/api/vault/stats?public_key=$publicKey").build()
            val activityRequest = Request.Builder().url("${Constants.BASE_URL}/api/vault/activity?public_key=$publicKey").build()
            
            while(true) {
                try {
                    // Fetch Stats
                    client.newCall(statsRequest).execute().use { response ->
                        if (response.isSuccessful) {
                            val body = response.body?.string()
                            if (body != null) {
                                val obj = JSONObject(body)
                                stats["vault_health"] = "${obj.getInt("securityScore")}%"
                                stats["active_sessions"] = obj.getInt("activeSessions").toString()
                                stats["threats_blocked"] = obj.getInt("threatsBlocked").toString()
                                stats["last_backup"] = obj.getString("statusMessage")
                            }
                        }
                    }
                    
                    // Fetch Activity for latest event
                    client.newCall(activityRequest).execute().use { response ->
                        if (response.isSuccessful) {
                            val body = response.body?.string()
                            if (body != null) {
                                val array = JSONArray(body)
                                if (array.length() > 0) {
                                    val obj = array.getJSONObject(0)
                                    latestActivity = "${obj.getString("subject")} • Just now"
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e("Dashboard", "Refresh failed", e)
                }
                Thread.sleep(10000)
            }
        }.start()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scrollState)
            .padding(bottom = 100.dp)
    ) {
        DashboardHeader(onNotificationsClick = {})
        
        SecurityHeroCard()
        
        Spacer(modifier = Modifier.height(24.dp))
        
        QuickActionButtons(
            onUnlockClick = onUnlockClick,
            onLockAllClick = {}
        )
        
        Spacer(modifier = Modifier.height(24.dp))
        
        // Live Security Status Grid
        Column(modifier = Modifier.padding(horizontal = 20.dp)) {
            Text(
                text = "Live Security Status",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LiveStatusCard("Vault Health", stats["vault_health"] ?: "---", Modifier.weight(1f))
                LiveStatusCard("Active Sessions", stats["active_sessions"] ?: "0", Modifier.weight(1f))
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LiveStatusCard("Threats Blocked", stats["threats_blocked"] ?: "0", Modifier.weight(1f))
                LiveStatusCard("Sync Status", stats["last_backup"] ?: "---", Modifier.weight(1f))
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Recent Activity
        Column(modifier = Modifier.padding(horizontal = 20.dp)) {
            Text(
                text = "Recent Activity",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(80.dp)
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.4f), MaterialTheme.shapes.medium)
                    .padding(16.dp),
                contentAlignment = Alignment.CenterStart
            ) {
                Text(
                    text = latestActivity,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp
                )
            }
        }
    }
}

@Composable
fun DevicesScreen(publicKey: String) {
    var selectedDevice by remember { mutableStateOf<String?>(null) }
    val scrollState = rememberScrollState()
    val devices = remember { mutableStateListOf<Map<String, String>>() }

    LaunchedEffect(publicKey) {
        Thread {
            val client = OkHttpClient()
            val request = Request.Builder().url("${Constants.BASE_URL}/api/vault/devices?public_key=$publicKey").build()
            try {
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string()
                        if (body != null) {
                            val array = JSONArray(body)
                            devices.clear()
                            for (i in 0 until array.length()) {
                                val obj = array.getJSONObject(i)
                                devices.add(mapOf(
                                    "name" to obj.getString("name"),
                                    "os" to obj.getString("os"),
                                    "status" to "Secure", // Based on hardware link
                                    "last_active" to "Active"
                                ))
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("Devices", "Fetch failed", e)
            }
        }.start()
    }

    if (selectedDevice == null) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(scrollState)
                .padding(bottom = 100.dp)
        ) {
            Text(
                text = "Connected Devices",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp)
            )

            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                if (devices.isEmpty()) {
                    Text("No secondary devices linked.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
                } else {
                    devices.forEach { dev ->
                        DeviceCard(
                            name = dev["name"] ?: "",
                            os = dev["os"] ?: "",
                            status = DeviceStatus.SECURE,
                            lastActive = dev["last_active"] ?: "Active",
                            onClick = { selectedDevice = dev["name"] }
                        )
                    }
                }
            }
        }
    } else {
        DeviceDetailView(
            deviceName = selectedDevice!!,
            onBack = { selectedDevice = null }
        )
    }
}

@Composable
fun DeviceDetailView(deviceName: String, onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(20.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = MaterialTheme.colorScheme.onBackground)
            }
            Text(deviceName, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onBackground)
        }
        
        Spacer(modifier = Modifier.height(32.dp))
        
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            SecurityRow("Status", "Hardware Trusted", EmeraldGreen)
            SecurityRow("Identity", "P-256 Cloud Link", NeonCyan)
            SecurityRow("Encryption", "AES-256-GCM", MaterialTheme.colorScheme.onSurfaceVariant)
        }
        
        Spacer(modifier = Modifier.height(32.dp))
        
        Button(
            onClick = { /* Implement unpair */ },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = DeepRed.copy(alpha = 0.1f)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Unpair Device", color = DeepRed, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun ActivityScreen(publicKey: String) {
    var selectedTab by remember { mutableStateOf("All") }
    val scrollState = rememberScrollState()
    val filterTabs = listOf("All", "Security", "Threats")
    
    val activityLogs = remember { mutableStateListOf<Map<String, String>>() }

    LaunchedEffect(publicKey) {
        Thread {
            val client = OkHttpClient()
            val request = Request.Builder().url("${Constants.BASE_URL}/api/vault/activity?public_key=$publicKey").build()
            try {
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string()
                        if (body != null) {
                            val array = JSONArray(body)
                            activityLogs.clear()
                            for (i in 0 until array.length()) {
                                val obj = array.getJSONObject(i)
                                activityLogs.add(mapOf(
                                    "type" to obj.getString("type"),
                                    "title" to obj.getString("subject"),
                                    "description" to obj.getString("detail"),
                                    "time" to obj.getString("time")
                                ))
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("Activity", "Fetch failed", e)
            }
        }.start()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(bottom = 100.dp)
    ) {
        Text(
            text = "Security Timeline",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp)
        )

        // Filter Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            filterTabs.forEach { tab ->
                val isSelected = selectedTab == tab
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(if (isSelected) NeonCyan else MaterialTheme.colorScheme.surface)
                        .clickable { selectedTab = tab }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = tab,
                        color = if (isSelected) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
        ) {
            val filtered = activityLogs.filter { 
                selectedTab == "All" || it["type"].equals(selectedTab.lowercase(), ignoreCase = true) 
            }
            
            if (filtered.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No events found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                filtered.forEach { log ->
                    ActivityItem(
                        title = log["title"] ?: "",
                        subtitle = log["description"] ?: "",
                        time = "Log Entry",
                        type = when(log["type"]?.lowercase()) {
                            "security" -> ActivityType.SECURITY
                            "threat" -> ActivityType.THREAT
                            else -> ActivityType.DEVICE
                        },
                        onClick = { }
                    )
                }
            }
        }
    }
}

@Composable
fun ShieldScreen(publicKey: String) {
    val scrollState = rememberScrollState()
    val shieldStats = remember { mutableStateMapOf(
        "threats" to "0",
        "score" to "100"
    ) }

    LaunchedEffect(publicKey) {
        Thread {
            val client = OkHttpClient()
            val request = Request.Builder().url("${Constants.BASE_URL}/api/vault/stats?public_key=$publicKey").build()
            while(true) {
                try {
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            val body = response.body?.string()
                            if (body != null) {
                                val obj = JSONObject(body)
                                val threats = obj.getInt("threatsBlocked")
                                shieldStats["threats"] = threats.toString()
                                shieldStats["score"] = obj.getInt("securityScore").toString()
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e("Shield", "Fetch failed", e)
                }
                Thread.sleep(10000)
            }
        }.start()
    }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scrollState)
            .padding(bottom = 100.dp)
    ) {
        Text(
            text = "Active Shield",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp)
        )

        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            ThreatScoreMeter(score = shieldStats["score"]?.toInt() ?: 100)
        }

        Spacer(modifier = Modifier.height(32.dp))

        Column(
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            SecurityRow("Real-time Protection", "Active", EmeraldGreen)
            SecurityRow("Hardware Sandbox", "Enabled", NeonCyan)
            SecurityRow("Threats Blocked", shieldStats["threats"] ?: "0", DeepRed)
        }
    }
}

@Composable
fun SecurityRow(label: String, value: String, valueColor: Color) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        Text(text = value, color = valueColor, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SettingsScreen(
    isDarkTheme: Boolean,
    onThemeToggle: () -> Unit
) {
    val scrollState = rememberScrollState()
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scrollState)
            .padding(bottom = 100.dp)
    ) {
        Text(
            text = "Settings",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp)
        )

        Column(modifier = Modifier.padding(horizontal = 20.dp)) {
            // Appearance Section
            Text(
                text = "Appearance",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.6f))
                    .padding(horizontal = 16.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "Dark Mode",
                            color = MaterialTheme.colorScheme.onBackground,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = if (isDarkTheme) "OLED Optimized" else "High Contrast",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp
                        )
                    }
                    Switch(
                        checked = isDarkTheme,
                        onCheckedChange = { onThemeToggle() },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = NeonCyan,
                            checkedTrackColor = NeonCyan.copy(alpha = 0.3f)
                        )
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Security Section
            Text(
                text = "Hardware Security",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.6f))
                    .padding(horizontal = 16.dp)
            ) {
                SettingRow(
                    title = "Biometric Unlock",
                    subtitle = "Authorized via Hardware Enclave",
                    onClick = { }
                )
                Divider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 1.dp)
                SettingRow(
                    title = "Secure Identity",
                    subtitle = "P-256 ECDSA Key Active",
                    onClick = { }
                )
            }
            
            Spacer(modifier = Modifier.height(48.dp))
            
            Text(
                text = "Vault Mobile Auth v1.2.0",
                modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
        }
    }
}

@Composable
fun SettingRow(title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(text = title, color = MaterialTheme.colorScheme.onBackground, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text(text = subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        }
        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
    }
}
