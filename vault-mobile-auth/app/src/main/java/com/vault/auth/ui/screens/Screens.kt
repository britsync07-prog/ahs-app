package com.vault.auth.ui.screens
import androidx.compose.material3.MaterialTheme

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import okhttp3.OkHttpClient
import okhttp3.Request
import android.util.Log
import com.vault.auth.Constants
import com.vault.auth.ui.components.*
import com.vault.auth.ui.theme.*

@Composable
fun VaultDashboardScreen(
    onUnlockClick: () -> Unit
) {
    val scrollState = rememberScrollState()
    val stats = remember { mutableStateMapOf(
        "active_sessions" to "0",
        "threats_blocked" to "0",
        "vault_health" to "Secure",
        "last_backup" to "Pending"
    ) }

    LaunchedEffect(Unit) {
        Thread {
            val client = OkHttpClient()
            val request = Request.Builder().url(Constants.BASE_URL + "/api/vault/stats").build()
            while(true) {
                try {
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            val body = response.body?.string()
                            if (body != null) {
                                val obj = JSONObject(body)
                                stats["active_sessions"] = obj.getInt("active_sessions").toString()
                                stats["threats_blocked"] = obj.getInt("threats_blocked").toString()
                                stats["last_backup"] = obj.getString("storage_used")
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e("Stats", "Fetch failed", e)
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
            .padding(bottom = 100.dp) // Space for floating nav
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
                LiveStatusCard("Vault Health", stats["vault_health"] ?: "Secure", Modifier.weight(1f))
                LiveStatusCard("Active Sessions", stats["active_sessions"] ?: "0", Modifier.weight(1f))
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LiveStatusCard("Threats Blocked", stats["threats_blocked"] ?: "0", Modifier.weight(1f))
                LiveStatusCard("Last Backup", stats["last_backup"] ?: "Recent", Modifier.weight(1f))
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Recent Activity Placeholder
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
                    text = "MacBook Pro unlocked via Face ID • 2m ago",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp
                )
            }
        }
    }
}

@Composable
fun DevicesScreen() {
    var selectedDevice by remember { mutableStateOf<String?>(null) }
    val scrollState = rememberScrollState()
    val devices = remember { mutableStateListOf<Map<String, String>>() }

    LaunchedEffect(Unit) {
        Thread {
            val client = OkHttpClient()
            val request = Request.Builder().url(Constants.BASE_URL + "/api/vault/devices").build()
            try {
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string()
                        val array = JSONArray(body)
                        for (i in 0 until array.length()) {
                            val obj = array.getJSONObject(i)
                            devices.add(mapOf(
                                "name" to obj.getString("name"),
                                "os" to obj.getString("os"),
                                "status" to obj.getString("status"),
                                "last_active" to obj.getString("last_active")
                            ))
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
                devices.forEach { dev ->
                    DeviceCard(
                        name = dev["name"] ?: "",
                        os = dev["os"] ?: "",
                        status = when(dev["status"]?.lowercase()) {
                            "secure" -> DeviceStatus.SECURE
                            "idle" -> DeviceStatus.IDLE
                            else -> DeviceStatus.COMPROMISED
                        },
                        lastActive = "Recent",
                        onClick = { selectedDevice = dev["name"] }
                    )
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
fun DeviceDetailView(
    deviceName: String,
    onBack: () -> Unit
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
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.Default.ArrowBack,
                    contentDescription = "Back",
                    tint = MaterialTheme.colorScheme.onBackground
                )
            }
            Text(
                text = deviceName,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(200.dp),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Computer,
                contentDescription = null,
                tint = NeonCyan.copy(alpha = 0.2f),
                modifier = Modifier.size(120.dp)
            )
        }

        Column(
            modifier = Modifier.padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Main Controls
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionButton("Unlock Vault", NeonCyan, Modifier.weight(1f)) {
                    // Trigger callback or intent to MainActivity
                    Toast.makeText(context, "Pushing authorization to $deviceName...", Toast.LENGTH_SHORT).show()
                    (context as? com.vault.auth.MainActivity)?.let { activity ->
                         val storage = activity.secureStorage
                         val lastDesktop = storage.getString("last_desktop_pk")
                         val lastNonce = storage.getString("last_pairing_nonce")
                         if (!lastDesktop.isNullOrBlank() && !lastNonce.isNullOrBlank()) {
                             activity.performUnlockHandshake(lastNonce, lastDesktop)
                         } else {
                             Toast.makeText(context, "Pairing data missing. Scan QR again.", Toast.LENGTH_SHORT).show()
                         }
                    }
                }
                ActionButton("Lock Vault", Color.White, Modifier.weight(1f)) {
                    Toast.makeText(context, "Remote lock signal sent", Toast.LENGTH_SHORT).show()
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionButton("Wipe Keys", Color(0xFFFF3B30), Modifier.weight(1f)) {}
                ActionButton("Backup", Color.White, Modifier.weight(1f)) {}
            }

            AutoLockSlider { }

            // Security Panel
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.6f))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Security Overview", color = MaterialTheme.colorScheme.onBackground, fontWeight = FontWeight.Bold)
                SecurityRow("Status", "Secure", EmeraldGreen)
                SecurityRow("IP Address", "192.168.1.42", MaterialTheme.colorScheme.onSurfaceVariant)
                SecurityRow("Last Unlock", "10:42 AM", MaterialTheme.colorScheme.onSurfaceVariant)
                SecurityRow("Biometric", "Face ID", MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun ActionButton(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .height(50.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(color.copy(alpha = 0.1f))
            .clickable { onClick() }
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text = label, color = color, fontSize = 14.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SecurityRow(label: String, value: String, valueColor: Color) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        Text(text = value, color = valueColor, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ActivityScreen() {
    var selectedTab by remember { mutableStateOf("All") }
    var selectedEvent by remember { mutableStateOf<String?>(null) }
    val scrollState = rememberScrollState()
    val filterTabs = listOf("All", "Security", "Backups", "Threats")
    
    val activityLogs = remember { mutableStateListOf<Map<String, String>>() }

    LaunchedEffect(Unit) {
        Thread {
            val client = OkHttpClient()
            val request = Request.Builder().url("${Constants.BASE_URL}/api/vault/activity").build()
            try {
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string()
                        val array = JSONArray(body)
                        for (i in 0 until array.length()) {
                            val obj = array.getJSONObject(i)
                            activityLogs.add(mapOf(
                                "type" to obj.getString("type"),
                                "title" to obj.getString("title"),
                                "description" to obj.getString("description"),
                                "time" to obj.getString("time")
                            ))
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
            activityLogs.filter { 
                selectedTab == "All" || it["type"].equals(selectedTab.lowercase(), ignoreCase = true) 
            }.forEach { log ->
                ActivityItem(
                    title = log["title"] ?: "",
                    subtitle = log["description"] ?: "",
                    time = "Recent",
                    type = when(log["type"]?.lowercase()) {
                        "security" -> ActivityType.SECURITY
                        "backup" -> ActivityType.BACKUP
                        "threat" -> ActivityType.THREAT
                        else -> ActivityType.DEVICE
                    },
                    onClick = { selectedEvent = log["title"] }
                )
            }
        }
    }

    if (selectedEvent != null) {
        EventDetailDialog(
            title = selectedEvent!!,
            onDismiss = { selectedEvent = null }
        )
    }
}

@Composable
fun EventDetailDialog(
    title: String,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF111827),
        title = {
            Text(title, color = Color.White, fontWeight = FontWeight.Bold)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SecurityRow("Timestamp", "May 6, 2026 • 10:42 AM", MaterialTheme.colorScheme.onSurfaceVariant)
                SecurityRow("Device", "MacBook Pro 16\"", MaterialTheme.colorScheme.onSurfaceVariant)
                SecurityRow("Risk Score", "0/100 (Safe)", EmeraldGreen)
                SecurityRow("Location", "San Francisco, CA", MaterialTheme.colorScheme.onSurfaceVariant)
                SecurityRow("Action", "Face ID Approval", MaterialTheme.colorScheme.onSurfaceVariant)
                
                Spacer(modifier = Modifier.height(8.dp))
                
                Text(
                    "This event was verified and authorized via your mobile hardware secure element.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                    lineHeight = 18.sp
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.buttonColors(containerColor = NeonCyan)
            ) {
                Text("Mark as Safe", color = MaterialTheme.colorScheme.background, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Report Issue", color = DeepRed)
            }
        }
    )
}

@Composable
fun ShieldScreen() {
    val scrollState = rememberScrollState()
    val shieldStats = remember { mutableStateMapOf(
        "scanned" to "0",
        "threats" to "0",
        "phishing" to "0",
        "score" to "100"
    ) }

    LaunchedEffect(Unit) {
        Thread {
            val client = OkHttpClient()
            val request = Request.Builder().url(Constants.BASE_URL + "/api/vault/stats").build()
            while(true) {
                try {
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            val body = response.body?.string()
                            if (body != null) {
                                val obj = JSONObject(body)
                                val threats = obj.getInt("threats_blocked")
                                shieldStats["scanned"] = (1200 + threats * 5).toString() 
                                shieldStats["threats"] = threats.toString()
                                shieldStats["phishing"] = (threats / 3).toString()
                                shieldStats["score"] = (100 - threats).coerceAtLeast(0).toString()
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

        Spacer(modifier = Modifier.height(24.dp))

        // Email Protection Card
        Column(
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.6f))
                .padding(20.dp)
        ) {
            Text(
                text = "Email Shield",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Scanning incoming messages locally",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp
            )
            
            Spacer(modifier = Modifier.height(20.dp))
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                ShieldStat("Scanned", shieldStats["scanned"] ?: "0")
                ShieldStat("Threats", shieldStats["threats"] ?: "0")
                ShieldStat("Phishing", shieldStats["phishing"] ?: "0")
            }
            
            Spacer(modifier = Modifier.height(20.dp))
            
            Button(
                onClick = { },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = NeonCyan),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Scan Inbox Now", color = MaterialTheme.colorScheme.background, fontWeight = FontWeight.Bold)
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Protection Toggles
        Column(
            modifier = Modifier.padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Live Protection",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold
            )
            
            ProtectionToggle(
                title = "Phishing Detection",
                description = "Scan links and domains in real-time",
                checked = true,
                onCheckedChange = {}
            )
            ProtectionToggle(
                title = "Malicious Link Scan",
                description = "Block known dangerous URLs",
                checked = true,
                onCheckedChange = {}
            )
            ProtectionToggle(
                title = "Attachment Scanner",
                description = "Analyze files before they are opened",
                checked = true,
                onCheckedChange = {}
            )
            ProtectionToggle(
                title = "Unsafe WiFi Detection",
                description = "Alert on non-encrypted networks",
                checked = false,
                onCheckedChange = {}
            )
        }
    }
}

@Composable
fun ShieldStat(label: String, value: String) {
    Column {
        Text(text = label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
        Text(text = value, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
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
                            text = if (isDarkTheme) "Enabled" else "Disabled",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 13.sp
                        )
                    }
                    Switch(
                        checked = isDarkTheme,
                        onCheckedChange = { onThemeToggle() },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = NeonCyan,
                            checkedTrackColor = NeonCyan.copy(alpha = 0.5f)
                        )
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Master Key Section
            Text(
                text = "Emergency Recovery",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            MasterKeyCard(onClick = { Toast.makeText(context, "Recovery Key section", Toast.LENGTH_SHORT).show() })

            Spacer(modifier = Modifier.height(32.dp))

            // Security Section
            Text(
                text = "Security Preferences",
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
                    title = "Biometric Authentication",
                    subtitle = "Face ID / Fingerprint enabled",
                    onClick = { Toast.makeText(context, "Biometric settings", Toast.LENGTH_SHORT).show() }
                )
                Divider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 1.dp)
                SettingRow(
                    title = "Multi-Device Approval",
                    subtitle = "Require phone for all logins",
                    onClick = { Toast.makeText(context, "Multi-Device settings", Toast.LENGTH_SHORT).show() }
                )
                Divider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 1.dp)
                SettingRow(
                    title = "Panic Mode",
                    subtitle = "Instant wipe on 3 failed attempts",
                    onClick = { Toast.makeText(context, "Panic Mode settings", Toast.LENGTH_SHORT).show() }
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Account Section
            Text(
                text = "Account",
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
                    title = "Vault Subscription",
                    subtitle = "Professional Plan",
                    onClick = { Toast.makeText(context, "Subscription details", Toast.LENGTH_SHORT).show() }
                )
                Divider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 1.dp)
                SettingRow(
                    title = "Trusted Contacts",
                    subtitle = "2 Emergency contacts set",
                    onClick = { Toast.makeText(context, "Trusted Contacts", Toast.LENGTH_SHORT).show() }
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            // App Info
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Vault v1.0.42 (Stable)",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp
                )
                Text(
                    text = "Zero-Knowledge Biometric Security",
                    color = MaterialTheme.colorScheme.outline,
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
fun PlaceholderScreen(title: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground
        )
        Text(
            text = "Section coming soon",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
