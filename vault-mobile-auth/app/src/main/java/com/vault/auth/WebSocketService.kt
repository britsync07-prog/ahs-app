package com.vault.auth

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class WebSocketService : Service() {
    private val TAG = "WebSocketService"
    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private val binder = LocalBinder()
    private var messageListener: ((String) -> Unit)? = null
    
    private var currentWsUrl: String? = null
    private var currentPublicKey: String? = null
    private val reconnectHandler = Handler(Looper.getMainLooper())
    private var reconnectAttempt = 0

    inner class LocalBinder : Binder() {
        fun getService(): WebSocketService = this@WebSocketService
    }

    override fun onBind(intent: Intent?): IBinder {
        return binder
    }

    override fun onCreate() {
        super.onCreate()
        client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun setListener(listener: (String) -> Unit) {
        this.messageListener = listener
    }

    fun connect(wsUrl: String, publicKey: String) {
        this.currentWsUrl = wsUrl
        this.currentPublicKey = publicKey
        
        Log.d(TAG, "Connecting to $wsUrl")
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket Opened")
                reconnectAttempt = 0
                
                // Register mobile identity
                val registerMsg = JSONObject().apply {
                    put("type", "mobile_register")
                    put("public_key", publicKey)
                }
                webSocket.send(registerMsg.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "Received message: $text")
                try {
                    val json = JSONObject(text)
                    if (json.optString("type") == "push_relay") {
                        val encryptedBlob = json.optString("encrypted_blob")
                        if (encryptedBlob.isNotEmpty()) {
                            // Run on main thread to be safe for UI interactions in MainActivity
                            Handler(Looper.getMainLooper()).post {
                                messageListener?.invoke(encryptedBlob)
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing message", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket Closing: $code / $reason")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket Failure: ${t.message}")
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        reconnectAttempt++
        val delay = (Math.min(reconnectAttempt * 2, 30) * 1000).toLong() // Exponential backoff up to 30s
        Log.d(TAG, "Scheduling reconnect in ${delay/1000}s (Attempt $reconnectAttempt)")
        reconnectHandler.postDelayed({
            val url = currentWsUrl
            val pk = currentPublicKey
            if (url != null && pk != null) {
                connect(url, pk)
            }
        }, delay)
    }

    override fun onDestroy() {
        super.onDestroy()
        webSocket?.close(1000, "Service destroyed")
        reconnectHandler.removeCallbacksAndMessages(null)
    }
}
