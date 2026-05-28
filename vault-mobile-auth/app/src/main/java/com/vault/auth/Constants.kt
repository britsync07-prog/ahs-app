package com.vault.auth

object Constants {
    // Production Domain
    private const val PRODUCTION_DOMAIN = "ahs.mayfairmarketing.online"

    val BASE_URL = "https://$PRODUCTION_DOMAIN"
    val PAIR_URL = "$BASE_URL/api/vault/pair"
    val PUSH_URL = "$BASE_URL/api/vault/push"
    val WS_URL = "wss://$PRODUCTION_DOMAIN/api/ws/connect"
    
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
