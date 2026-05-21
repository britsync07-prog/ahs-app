# Vault Requirements - Phone as Key

## Backend
- **BACKEND-01:** Verify and enhance 'Relay' endpoint and Hub for mobile connections.
- **BACKEND-02:** Fix unused imports/variables in Go backend.

## Mobile
- **MOBILE-SECURE-STORAGE:** Implement `SecureStorageManager` using `EncryptedSharedPreferences`.
- **MOBILE-WS-SIGNALING:** Implement `WebSocketService` for background signaling.
- **MOBILE-MAIN-UI:** Update `MainActivity` to handle setup and unlock signals.
- **MOBILE-WARNINGS:** Fix unused variable warnings in Kotlin.

## Desktop
- **DESKTOP-QR-PAYLOAD:** Ensure QR code contains necessary signal server URL and session ID.
- **DESKTOP-WARNINGS:** Fix unused variable warnings in Desktop.

## Workflows
- **SETUP-FLOW:** Desktop QR -> Mobile Scan -> Mobile becomes Key -> Desktop shows 24 words.
- **UNLOCK-FLOW:** Desktop Click -> Mobile Notification (via WS) -> Biometric Approve -> Desktop Unlocks.
