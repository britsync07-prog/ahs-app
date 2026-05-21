package com.vault.auth

import android.Manifest
import android.os.Bundle
import android.widget.Toast
import android.util.Base64
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.edit
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.ComposeView
import androidx.fragment.app.FragmentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import kotlin.random.Random
import com.google.crypto.tink.subtle.X25519
import com.google.crypto.tink.subtle.AesGcmJce
import com.google.crypto.tink.subtle.Random as TinkRandom

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import com.vault.auth.ui.components.FloatingNavBar
import com.vault.auth.ui.components.NavTab
import com.vault.auth.ui.screens.*
import com.vault.auth.ui.theme.*
import com.vault.auth.ui.components.OnboardingScreen
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.Icons

class MainActivity : FragmentActivity() {
    
    val cryptoManager = CryptoManager()
    private val client = OkHttpClient()
    lateinit var secureStorage: SecureStorageManager
    private var webSocketService: WebSocketService? = null
    private var isBound = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as WebSocketService.LocalBinder
            webSocketService = binder.getService()
            isBound = true
            
            webSocketService?.setListener { encryptedBlob ->
                handleIncomingSignal(encryptedBlob)
            }
            
            startWebSocket()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            isBound = false
            webSocketService = null
        }
    }

    private fun startWebSocket() {
        val pubKey = Base64.encodeToString(cryptoManager.getPublicKey(), Base64.NO_WRAP)
        val wsUrl = Constants.getWsUrl(secureStorage.getString("backend_url"))
        webSocketService?.connect(wsUrl, pubKey)
    }

    private fun handleIncomingSignal(encryptedBlob: String) {
        Log.d("MainActivity", "Received signaling blob: $encryptedBlob")
        
        if (encryptedBlob == "WAKE_UP_BIOMETRIC") {
            // MAGIC UNLOCK: Remote trigger for biometric approval
            val lastDesktop = secureStorage.getString("last_desktop_pk")
            val lastNonce = secureStorage.getString("last_pairing_nonce")
            
            if (!lastDesktop.isNullOrBlank() && !lastNonce.isNullOrBlank()) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Unlock Request from Workstation", Toast.LENGTH_SHORT).show()
                    authenticateForUnlock(
                        nonceToSign = lastNonce,
                        onSuccess = { signature ->
                            if (signature != null) {
                                Thread {
                                    val result = sendUnlockApproval(lastDesktop, lastNonce, signature)
                                    runOnUiThread {
                                        result.fold(
                                            onSuccess = { 
                                                Toast.makeText(this@MainActivity, "Desktop Unlocked!", Toast.LENGTH_LONG).show()
                                            },
                                            onFailure = { 
                                                Toast.makeText(this@MainActivity, "Unlock Failed: ${it.message}", Toast.LENGTH_SHORT).show()
                                            }
                                        )
                                    }
                                }.start()
                            }
                        },
                        onFailure = {
                            runOnUiThread { Toast.makeText(this@MainActivity, "Unlock Denied", Toast.LENGTH_SHORT).show() }
                        }
                    )
                }
            }
        } else {
            // SETUP FLOW: Decrypt Master Key transferred from Desktop
            try {
                val masterKeyB64 = decryptKeyFromDesktop(encryptedBlob)
                if (masterKeyB64 != null) {
                    runOnUiThread {
                        pendingOnboardingAesKey = masterKeyB64
                        showSetup = true
                    }
                }
            } catch (e: Exception) {
                Log.e("MainActivity", "Failed to decrypt setup blob", e)
            }
        }
    }

    private fun decryptKeyFromDesktop(encryptedB64: String): String? {
        return try {
            val data = Base64.decode(encryptedB64, Base64.NO_WRAP)
            // Payload format: 32 bytes Desktop X25519 PK + 12 bytes Nonce + Ciphertext (which includes 16 bytes tag)
            if (data.size < 32 + 12 + 16) return null
            
            val desktopXPK = data.sliceArray(0 until 32)
            val encrypted = data.sliceArray(32 until data.size)
            
            // 1. Get mobile X25519 private key
            val mobilePriv = cryptoManager.getOrGenerateXKeyPair(secureStorage)
            
            // 2. Compute shared secret
            val sharedSecret = X25519.computeSharedSecret(mobilePriv, desktopXPK)
            
            // 3. Decrypt
            val cipher = AesGcmJce(sharedSecret)
            val decrypted = cipher.decrypt(encrypted, null)
            
            Base64.encodeToString(decrypted, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e("MainActivity", "Decryption failed", e)
            null
        }
    }

    // Class-level state for accessibility from methods
    private var isAppLocked by mutableStateOf(true)
    private var onboardingComplete by mutableStateOf(false)
    private var scannerEnabled by mutableStateOf(false)
    private var pendingOnboardingAesKey by mutableStateOf<String?>(null)
    private var showSetup by mutableStateOf(false)
    private var setupPin by mutableStateOf("")
    private var decoyPin by mutableStateOf("")
    private var selectedTab by mutableStateOf(NavTab.VAULT)
    private var isDarkTheme by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        secureStorage = SecureStorageManager(this)

        // Bind to WebSocketService
        Intent(this, WebSocketService::class.java).also { intent ->
            bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }

        // 1. Generate Mobile Identity on Launch
        cryptoManager.getOrGenerateKeyPair()

        val requestPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted: Boolean ->
            if (isGranted) {
                startScanner()
            }
        }

        setContentView(
            ComposeView(this).apply {
                setContent {
                    VaultTheme(darkTheme = isDarkTheme) {
                        // Sync initial state from secure storage once
                        LaunchedEffect(Unit) {
                            onboardingComplete = secureStorage.getBoolean("onboarding_complete", false)
                            isDarkTheme = secureStorage.getBoolean("is_dark_theme", false)
                        }

                        var pendingOnboardingQr by remember { mutableStateOf<String?>(null) }
                        var setupComplete by remember { mutableStateOf(isSecuritySetupComplete()) }

                        Scaffold(
                            bottomBar = {
                                if (onboardingComplete && !isAppLocked) {
                                    FloatingNavBar(
                                        selectedTab = selectedTab,
                                        onTabSelected = { selectedTab = it }
                                    )
                                }
                            }
                        ) { padding ->
                            Box(modifier = Modifier.padding(padding)) {
                                if (!onboardingComplete) {
                                    OnboardingScreen(onFinished = {
                                        secureStorage.saveBoolean("onboarding_complete", true)
                                        onboardingComplete = true
                                    })
                                } else if (isAppLocked) {
                            // Cinematic Lock Screen
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(MaterialTheme.colorScheme.background),
                                contentAlignment = Alignment.Center
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Icon(
                                        imageVector = Icons.Default.Fingerprint,
                                        contentDescription = null,
                                        tint = NeonCyan,
                                        modifier = Modifier.size(80.dp)
                                    )
                                    Spacer(modifier = Modifier.height(24.dp))
                                    Text(
                                        "Vault Locked",
                                        color = MaterialTheme.colorScheme.onBackground,
                                        style = MaterialTheme.typography.headlineSmall
                                    )
                                    Spacer(modifier = Modifier.height(48.dp))
                                    Button(
                                        onClick = {
                                            authenticateForUnlock(
                                                onSuccess = { _ -> isAppLocked = false },
                                                onFailure = { /* Handle retry or PIN */ }
                                            )
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = NeonCyan)
                                    ) {
                                        Text("Unlock Vault", color = MaterialTheme.colorScheme.background, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        } else {
                                    Crossfade(targetState = selectedTab, label = "ScreenTransition") { tab ->
                                        when (tab) {
                                            NavTab.VAULT -> VaultDashboardScreen(
                                                onUnlockClick = { 
                                                    val lastDesktop = secureStorage.getString("last_desktop_pk")
                                                    val lastNonce = secureStorage.getString("last_pairing_nonce")
                                                    
                                                    if (!lastDesktop.isNullOrBlank() && !lastNonce.isNullOrBlank()) {
                                                        // Direct Magic Unlock if already paired
                                                        performUnlockHandshake(lastNonce, lastDesktop)
                                                    } else {
                                                        // Otherwise scan to pair
                                                        scannerEnabled = true 
                                                    }
                                                }
                                            )
                                            NavTab.DEVICES -> DevicesScreen()
                                            NavTab.ACTIVITY -> ActivityScreen()
                                            NavTab.SHIELD -> ShieldScreen()
                                            NavTab.SETTINGS -> SettingsScreen(
                                                isDarkTheme = isDarkTheme,
                                                onThemeToggle = {
                                                    isDarkTheme = !isDarkTheme
                                                    secureStorage.saveBoolean("is_dark_theme", isDarkTheme)
                                                }
                                            )
                                        }
                                    }

                                    if (scannerEnabled) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxSize()
                                                .background(MaterialTheme.colorScheme.background)
                                        ) {
                                            CameraPreview { result ->
                                                if (scannerEnabled) {
                                                    val payload = parseDesktopPayload(result)
                                                    val nonce = payload?.second ?: ""
                                                    val onboardingAesKey = payload?.third

                                                    if (nonce.isBlank()) {
                                                        scannerEnabled = false
                                                        Toast.makeText(this@MainActivity, "Invalid Vault QR", Toast.LENGTH_SHORT).show()
                                                        return@CameraPreview
                                                    }

                                                    // Persist for Magic Unlock
                                                    val finalDesktopPk = payload?.first ?: result
                                                    val finalDesktopXpk = payload?.fourth ?: ""
                                                    secureStorage.saveString("last_desktop_pk", finalDesktopPk)
                                                    secureStorage.saveString("last_desktop_xpk", finalDesktopXpk)
                                                    secureStorage.saveString("last_pairing_nonce", nonce)
                                                    if (payload?.fifth != null) {
                                                        secureStorage.saveString("backend_url", payload.fifth)
                                                    }
                                                    
                                                    pendingOnboardingQr = result

                                                    if (!setupComplete || onboardingAesKey != null) {
                                                        scannerEnabled = false
                                                        if (!onboardingAesKey.isNullOrBlank()) {
                                                            pendingOnboardingAesKey = onboardingAesKey
                                                            showSetup = true
                                                        } else if (!setupComplete) {
                                                            // SECONDARY DEVICE FLOW: Pair first, then wait for AES key via WebSocket
                                                            pairWithDesktop(finalDesktopPk, nonce) { paired ->
                                                                    if (paired) {
                                                                        runOnUiThread {
                                                                            Toast.makeText(this@MainActivity, "Paired! Waiting for Master Key...", Toast.LENGTH_LONG).show()
                                                                        }
                                                                    }
                                                            }
                                                        } else {
                                                            performUnlockHandshake(nonce, finalDesktopPk)
                                                        }
                                                    } else {
                                                        scannerEnabled = false
                                                        performUnlockHandshake(nonce, finalDesktopPk)
                                                    }
                                                }
                                            }
                                            
                                            IconButton(
                                                onClick = { scannerEnabled = false },
                                                modifier = Modifier.padding(16.dp).align(Alignment.TopEnd)
                                            ) {
                                                Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Important UI Overlays (Setup Dialogs, etc.)
                        if (showSetup) {
                            AlertDialog(
                                onDismissRequest = {},
                                containerColor = MaterialTheme.colorScheme.surface,
                                title = {
                                    Text(
                                        text = "Security Setup Required",
                                        color = MaterialTheme.colorScheme.onBackground,
                                        fontWeight = FontWeight.Bold
                                    )
                                },
                                text = {
                                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Text(
                                            "First-time setup: add PIN and enable biometric unlock.",
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                        OutlinedTextField(
                                            value = setupPin,
                                            onValueChange = { if (it.length <= 5 && it.all(Char::isDigit)) setupPin = it },
                                            label = { Text("Set 5-digit PIN") },
                                            singleLine = true,
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                        OutlinedTextField(
                                            value = decoyPin,
                                            onValueChange = { if (it.length <= 5 && it.all(Char::isDigit)) decoyPin = it },
                                            label = { Text("Decoy PIN (Optional)") },
                                            singleLine = true,
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                        Text(
                                            "A decoy PIN opens an innocent fake vault if you are under duress.",
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            fontSize = 10.sp
                                        )
                                    }
                                },
                                confirmButton = {
                                    Button(
                                        onClick = {
                                            if (setupPin.length == 5 && !pendingOnboardingAesKey.isNullOrBlank()) {
                                                val optionalDecoy = decoyPin.takeIf { it.length == 5 }
                                                saveSetup(setupPin, pendingOnboardingAesKey!!, optionalDecoy)
                                                
                                                // Setup is complete. We already paired during the initial scan.
                                                // No need to pair again (which would fail as nonce is consumed).
                                                setupBiometricPrompt()
                                                showSetup = false
                                                setupComplete = true
                                                setupPin = ""
                                                decoyPin = ""
                                                scannerEnabled = false
                                                pendingOnboardingQr = null
                                                Toast.makeText(this@MainActivity, "Setup Complete!", Toast.LENGTH_SHORT).show()
                                            } else {
                                                Toast.makeText(this@MainActivity, "Setup failed. Re-scan desktop QR.", Toast.LENGTH_SHORT).show()
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E)),
                                    ) {
                                        Text("Complete Setup", color = Color.Black, fontWeight = FontWeight.Bold)
                                    }
                                },
                                dismissButton = {
                                    OutlinedButton(onClick = {
                                        scannerEnabled = true
                                    }) {
                                        Text("Keep Scanning")
                                    }
                                }
                            )
                        }
                    }
                }
            }
        )
        
        requestPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    private fun startScanner() {
        // Logic handled in Composable
    }

    fun setupBiometricPrompt() {
        val biometricManager = BiometricManager.from(this)
        val canUse = biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        ) == BiometricManager.BIOMETRIC_SUCCESS

        if (!canUse) return

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Set up biometric unlock")
            .setSubtitle("Use fingerprint or face ID for vault approval")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            .build()

        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {}
        )
        prompt.authenticate(promptInfo)
    }

    private fun saveSetup(pin: String, aesKeyB64: String, decoyPin: String? = null) {
        val normalized = aesKeyB64.trim()
        if (normalized.isBlank() || normalized.equals("null", ignoreCase = true)) return
        val decoded = try { Base64.decode(normalized, Base64.NO_WRAP) } catch (_: Exception) { null }
        if (decoded == null || decoded.size != 32) return

        val salt = ByteArray(16).also { Random.Default.nextBytes(it) }
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(salt)
        val hash = digest.digest(pin.toByteArray())

        secureStorage.saveString("pin_hash", Base64.encodeToString(hash, Base64.NO_WRAP))
        secureStorage.saveString("pin_salt", Base64.encodeToString(salt, Base64.NO_WRAP))
        secureStorage.saveString("aes_key_b64", normalized)
        secureStorage.saveBoolean("security_setup_complete", true)

        if (decoyPin != null) {
            val decoyDigest = MessageDigest.getInstance("SHA-256")
            decoyDigest.update(salt)
            val decoyHash = decoyDigest.digest(decoyPin.toByteArray())
            secureStorage.saveString("decoy_pin_hash", Base64.encodeToString(decoyHash, Base64.NO_WRAP))
        }
    }

    private fun isSecuritySetupComplete(): Boolean {
        val key = secureStorage.getString("aes_key_b64")
        return secureStorage.getBoolean("security_setup_complete", false) &&
            !key.isNullOrBlank() &&
            !key.equals("null", ignoreCase = true)
    }

    private fun verifyPin(pin: String): Boolean {
        val storedHash = secureStorage.getString("pin_hash") ?: return false
        val salt = secureStorage.getString("pin_salt")?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return false

        val isPrimary = checkHash(pin, salt, storedHash)

        // Plausible Deniability: Check Decoy PIN
        val decoyHash = secureStorage.getString("decoy_pin_hash")
        if (decoyHash != null) {
            if (checkHash(pin, salt, decoyHash)) {
                Log.w("VaultAuth", "DECOY PIN ENTERED. Entering decoy mode.")
                enterDecoyMode()
                return true
            }
        }

        return isPrimary
    }

    private fun enterDecoyMode() {
        secureStorage.saveBoolean("decoy_mode_active", true)
        // Use a specific placeholder that indicates decoy status
        secureStorage.saveString("aes_key_b64", Constants.DECOY_KEY_PLACEHOLDER)
    }

    private fun checkHash(pin: String, salt: ByteArray, stored: String): Boolean {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(salt)
        val candidate = digest.digest(pin.toByteArray())
        return Base64.encodeToString(candidate, Base64.NO_WRAP) == stored
    }


    fun performUnlockHandshake(nonce: String, desktopPubKey: String) {
        runOnUiThread { Toast.makeText(this@MainActivity, "Biometric required to sign...", Toast.LENGTH_SHORT).show() }
        authenticateForUnlock(
            nonceToSign = nonce,
            onSuccess = { signature ->
                if (signature != null) {
                    Thread {
                        val result = sendUnlockApproval(desktopPubKey, nonce, signature)
                        runOnUiThread {
                            result.fold(
                                onSuccess = { 
                                    Toast.makeText(this@MainActivity, "Unlock Signal Sent!", Toast.LENGTH_LONG).show()
                                },
                                onFailure = { 
                                    Toast.makeText(this@MainActivity, "Error: ${it.message}", Toast.LENGTH_LONG).show()
                                }
                            )
                        }
                    }.start()
                }
            },
            onFailure = {
                runOnUiThread { Toast.makeText(this@MainActivity, "Biometric Auth Failed", Toast.LENGTH_SHORT).show() }
            }
        )
    }

    private fun authenticateForUnlock(nonceToSign: String? = null, onSuccess: (String?) -> Unit, onFailure: () -> Unit) {
        val biometricManager = BiometricManager.from(this)
        val canUse = biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG
        ) == BiometricManager.BIOMETRIC_SUCCESS

        if (!canUse) {
            onFailure()
            return
        }

        try {
            val keyPair = cryptoManager.getOrGenerateKeyPair()
            val signer = java.security.Signature.getInstance("SHA256withECDSA")
            signer.initSign(keyPair.private)

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle(if (nonceToSign != null) "Authorize Vault Unlock" else "Unlock Vault App")
                .setSubtitle(if (nonceToSign != null) "Confirming hardware identity for secure mount" else "Biometric verification required")
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build()

            val prompt = BiometricPrompt(
                this,
                ContextCompat.getMainExecutor(this),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (nonceToSign == null) {
                            onSuccess(null)
                            return
                        }
                        
                        val cryptoObject = result.cryptoObject
                        val signature = cryptoObject?.signature
                        if (signature != null) {
                            signature.update(nonceToSign.toByteArray())
                            val signed = signature.sign()
                            onSuccess(Base64.encodeToString(signed, Base64.NO_WRAP))
                        } else {
                            onFailure()
                        }
                    }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        onFailure()
                    }
                    override fun onAuthenticationFailed() {
                        onFailure()
                    }
                }
            )
            
            if (nonceToSign != null) {
                prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(signer))
            } else {
                prompt.authenticate(promptInfo)
            }
        } catch (e: Exception) {
            Log.e("VaultAuth", "Signature init failed", e)
            onFailure()
        }
    }

    private fun sendUnlockApproval(desktopPublicKey: String, pairingNonce: String, signature: String): Result<Boolean> {
        val aesKeyB64 = secureStorage.getString("aes_key_b64")?.trim() ?: return Result.failure(Exception("AES Key Missing"))
        if (aesKeyB64.equals("null", ignoreCase = true) || aesKeyB64.isBlank()) return Result.failure(Exception("AES Key Empty"))
        
        val mobilePubKey = Base64.encodeToString(cryptoManager.getPublicKey(), Base64.NO_WRAP)
        val desktopXPK = secureStorage.getString("last_desktop_xpk") ?: ""
        val backendUrl = secureStorage.getString("backend_url")
        
        if (pairingNonce.isBlank()) return Result.failure(Exception("Invalid session data"))

        // ZERO-KNOWLEDGE: Encrypt the AES key for the desktop workstation before it leaves the device
        val encryptedKey = if (desktopXPK.isNotBlank()) {
            try {
                encryptKeyForDesktop(aesKeyB64, desktopXPK)
            } catch (e: Exception) {
                Log.e("VaultAuth", "ECIES Encryption failed", e)
                null
            }
        } else null

        val json = JSONObject().apply {
            put("target_public_key", desktopPublicKey) // REFACTORED
            put("mobile_public_key", mobilePubKey)
            put("pairing_nonce", pairingNonce)
            put("signature", signature)
            if (encryptedKey != null) {
                put("encrypted_blob", encryptedKey) // REFACTORED
            } else {
                throw Exception("Secure transport unavailable: Desktop X25519 public key missing.")
            }
        }

        val body = json.toString().toRequestBody("application/json".toMediaType())
        val pushUrl = Constants.getPushUrl(backendUrl)
        val request = Request.Builder().url(pushUrl).post(body).build()

        return try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    Result.success(true)
                } else {
                    Result.failure(Exception("Server error: ${response.code}"))
                }
            }
        } catch (e: IOException) {
            Result.failure(Exception("Network unreachable. Check connection."))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun pairWithDesktop(desktopPublicKey: String, pairingNonce: String, onResult: (Boolean) -> Unit) {
        if (pairingNonce.isBlank()) {
            Log.e("VaultAuth", "Pairing failed: Nonce missing")
            onResult(false)
            return
        }

        val backendUrl = secureStorage.getString("backend_url")

        // 2. Sign the nonce to prove ownership of the mobile public key
        authenticateForUnlock(
            nonceToSign = pairingNonce,
            onSuccess = { signature ->
                if (signature == null) {
                    onResult(false)
                    return@authenticateForUnlock
                }

                val mobilePubKey = Base64.encodeToString(cryptoManager.getPublicKey(), Base64.NO_WRAP)
                val mobileXPub = Base64.encodeToString(cryptoManager.getXPublicKey(secureStorage), Base64.NO_WRAP)
                
                val json = JSONObject().apply {
                    put("desktop_public_key", desktopPublicKey)
                    put("mobile_public_key", mobilePubKey)
                    put("mobile_x_public_key", mobileXPub)
                    put("pairing_nonce", pairingNonce)
                    put("signature", signature)
                }

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val url = Constants.getPairUrl(backendUrl)
                val request = Request.Builder().url(url).post(body).build()

                client.newCall(request).enqueue(object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        Log.e("VaultAuth", "Pairing Request Failed: ${e.message}", e)
                        runOnUiThread { onResult(false) }
                    }

                    override fun onResponse(call: Call, response: Response) {
                        val responseBody = response.body?.string()
                        if (response.isSuccessful) {
                            Log.i("VaultAuth", "Pairing Successful: $responseBody")
                            runOnUiThread { onResult(true) }
                        } else {
                            Log.e("VaultAuth", "Pairing Rejected by Server: Code ${response.code} - $responseBody")
                            runOnUiThread { onResult(false) }
                        }
                    }
                })
            },
            onFailure = {
                onResult(false)
            }
        )
    }

    private fun parseDesktopPayload(raw: String): Quintuple<String, String, String?, String?, String?>? {
        return try {
            val json = JSONObject(raw)
            val pk = json.optString("desktop_public_key")
            val xpk = json.optString("desktop_x_public_key")
            val nonce = json.optString("pairing_nonce")
            val url = json.optString("backend_url").takeIf { it.isNotBlank() }
            val aesRaw = json.optString("aes_key_b64").trim()
            val aes = aesRaw.takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) }
            if (pk.isNotBlank() && nonce.isNotBlank()) Quintuple(pk, nonce, aes, xpk, url) else null
        } catch (_: Exception) {
            null
        }
    }

    private fun encryptKeyForDesktop(aesKeyB64: String, desktopXPKB64: String): String {
        val desktopXPK = Base64.decode(desktopXPKB64, Base64.NO_WRAP)
        val aesKeyBytes = Base64.decode(aesKeyB64, Base64.NO_WRAP)

        // 1. Generate ephemeral mobile X25519 key
        val mobilePriv = X25519.generatePrivateKey()
        val mobilePub = X25519.publicFromPrivate(mobilePriv)

        // 2. Derive shared secret
        val sharedSecret = X25519.computeSharedSecret(mobilePriv, desktopXPK)

        // 3. Encrypt AES key using Shared Secret as wrapper key
        val cipher = AesGcmJce(sharedSecret)
        val nonce = TinkRandom.randBytes(12)
        // Tink's AesGcmJce.encrypt returns nonce + ciphertext + tag
        // We want to be explicit for the Rust side: 32 bytes Mobile PK + 12 bytes Nonce + Ciphertext
        val encryptedData = cipher.encrypt(aesKeyBytes, null)
        
        // Tink prepends the 12-byte nonce
        val finalPayload = ByteArray(32 + encryptedData.size)
        System.arraycopy(mobilePub, 0, finalPayload, 0, 32)
        System.arraycopy(encryptedData, 0, finalPayload, 32, encryptedData.size)

        return Base64.encodeToString(finalPayload, Base64.NO_WRAP)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isBound) {
            unbindService(connection)
            isBound = false
        }
    }
}

// Helper for 5 return values
data class Quintuple<out A, out B, out C, out D, out E>(
    val first: A,
    val second: B,
    val third: C,
    val fourth: D,
    val fifth: E
)

@Composable
private fun RowScope.ManagerMetric(title: String, value: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF111827)),
        modifier = Modifier.weight(1f)
    ) {
        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = Color(0xFF94A3B8), style = MaterialTheme.typography.labelSmall)
            Text(value, color = Color.White, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun CameraPreview(onBarcodeScanned: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    
    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val executor = ContextCompat.getMainExecutor(ctx)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val scanner = BarcodeScanning.getClient()
                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                imageAnalysis.setAnalyzer(executor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage != null) {
                        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                        scanner.process(image)
                            .addOnSuccessListener { barcodes ->
                                for (barcode in barcodes) {
                                    barcode.rawValue?.let { onBarcodeScanned(it) }
                                }
                            }
                            .addOnCompleteListener { imageProxy.close() }
                    }
                }

                val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
                try {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(lifecycleOwner, cameraSelector, preview, imageAnalysis)
                } catch (e: Exception) {
                    Log.e("CameraPreview", "Use case binding failed", e)
                }
            }, executor)
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}

class CryptoManager {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias = "vault_identity"

    fun getOrGenerateKeyPair(): KeyPair {
        val existing = keyStore.getEntry(alias, null)
        if (existing != null) {
            val cert = keyStore.getCertificate(alias)
            val pub = cert.publicKey
            val priv = keyStore.getKey(alias, null)
            return KeyPair(pub, priv as java.security.PrivateKey)
        }

        val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA512)
            .setUserAuthenticationRequired(true) // HARDENED: Mandate biometrics for use
            .setInvalidatedByBiometricEnrollment(true) // HARDENED: Wipe on new fingerprint/face
            .build()
        kpg.initialize(spec)
        return kpg.generateKeyPair()
    }

    fun getPublicKey(): ByteArray {
        val keyPair = getOrGenerateKeyPair()
        return keyPair.public.encoded
    }

    // Stable X25519 for ECIES
    fun getOrGenerateXKeyPair(secureStorage: SecureStorageManager): ByteArray {
        val storedX = secureStorage.getString("x_private_key")
        if (storedX != null) {
            return Base64.decode(storedX, Base64.NO_WRAP)
        }
        val newPriv = com.google.crypto.tink.subtle.X25519.generatePrivateKey()
        secureStorage.saveString("x_private_key", Base64.encodeToString(newPriv, Base64.NO_WRAP))
        return newPriv
    }

    fun getXPublicKey(secureStorage: SecureStorageManager): ByteArray {
        val priv = getOrGenerateXKeyPair(secureStorage)
        return com.google.crypto.tink.subtle.X25519.publicFromPrivate(priv)
    }
}
