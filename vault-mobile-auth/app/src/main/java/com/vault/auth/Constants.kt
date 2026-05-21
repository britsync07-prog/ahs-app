package com.vault.auth

object Constants {
    // CRITICAL: Replace this with the ACTUAL local IP of your computer running the backend
    // You can find it by running 'ip addr' or 'ifconfig' on Linux/Mac, or 'ipconfig' on Windows.
    private const val DEFAULT_BACKEND_IP = "192.168.0.181" 

    private const val BACKEND_PORT = "8080"
    
    val BASE_URL = "http://$DEFAULT_BACKEND_IP:$BACKEND_PORT"
    val PAIR_URL = "$BASE_URL/api/vault/pair"
    val PUSH_URL = "$BASE_URL/api/vault/push"
    val WS_URL = "ws://$DEFAULT_BACKEND_IP:$BACKEND_PORT/api/ws/connect"
    
    // Decoy Mode Constants
    const val DECOY_KEY_PLACEHOLDER = "DECOY_MODE_ACTIVE_RANDOM_KEY_REQUIRED"

    fun getPairUrl(storedUrl: String?): String = "${storedUrl ?: BASE_URL}/api/vault/pair"
    fun getPushUrl(storedUrl: String?): String = "${storedUrl ?: BASE_URL}/api/vault/push"
    fun getWsUrl(storedUrl: String?): String {
        val base = storedUrl ?: BASE_URL
        val suffix = "/api/ws/connect"
        return if (base.startsWith("http://")) {
            base.replace("http://", "ws://") + suffix
        } else if (base.startsWith("https://")) {
            base.replace("https://", "wss://") + suffix
        } else {
            "ws://$base$suffix"
        }
    }
}
