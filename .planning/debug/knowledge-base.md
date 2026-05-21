## audit-security-concurrency-fixes — Implement Ed25519 verification and Coroutine refactor
- **Date:** 2025-05-15
- **Error patterns:** audit, ed25519, coroutines, signature, websocket
- **Root cause:** Desktop skipped signature verification; Mobile used legacy Thread(Runnable) and ECDSA.
- **Fix:** Added Ed25519 verification on Desktop and refactored Mobile to use lifecycleScope and Ed25519.
- **Files changed:** vault-desktop-tauri/src-tauri/src/network.rs, vault-mobile-auth/app/src/main/java/com/vault/auth/MainActivity.kt
---

## magic-unlock-integration-fixes — Align mobile signature verification and preserve relay fields
- **Date:** 2025-05-15
- **Error patterns:** ed25519, ecdsa, push_relay, signature, nonce, security-error
- **Root cause:** Incompatibility between backend crypto and mobile hardware keys (ECDSA vs Ed25519), missing fields in the backend's signaling relay, and lack of UI feedback for security errors on the Desktop.
- **Fix:** Updated handlers.go to use ed25519.Verify, enhanced RelayPush to include signature/nonce, and added security-error listener in App.tsx.
- **Files changed:** vault-backend-go/internal/api/handlers.go, vault-desktop-tauri/src/App.tsx
---

