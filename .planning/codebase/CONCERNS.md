# Codebase Concerns

**Analysis Date:** 2025-05-22

## Tech Debt

**Hardcoded Dummy Data in UI:**
- Issue: Numerous UI components in both web and mobile auth projects use hardcoded strings and placeholder stats instead of fetching real data from the backend.
- Files:
  - `vault-web-auth/src/screens/Dashboard.tsx` (Recent activity placeholder)
  - `vault-web-auth/src/components/dashboard/LiveStatusGrid.tsx` (Hardcoded stats array)
  - `vault-web-auth/src/screens/Activity.tsx` (Static events list)
  - `vault-mobile-auth/app/src/main/java/com/vault/auth/ui/components/SecurityHeroCard.kt` (Static status and encryption labels)
  - `vault-mobile-auth/app/src/main/java/com/vault/auth/ui/screens/Screens.kt` (Placeholders in Dashboard, Device Detail, and Event Dialog)
- Impact: Users see fake security information, which undermines trust and renders the monitoring features useless.
- Fix approach: Replace static arrays and strings with API calls to `/api/vault/stats`, `/api/vault/activity`, and `/api/vault/devices`.

## Missing Critical Features

**Backend Support for UI Elements:**
- Problem: Some UI features (especially in the Mobile "Shield" screen) have no corresponding backend implementation.
- Blocks: Real-time phishing detection, email scanning, and WiFi security monitoring.
- Details:
  - **IP Address tracking:** `vault-backend-go/internal/api/handlers.go:RegisterDevice` does not capture or return the device's IP address, but the UI expects it in `DeviceDetailView`.
  - **Biometric Type:** UI shows "Face ID", but backend does not store what type of biometric was used for authorization.
  - **Shield Stats:** Mobile UI shows "Scanned" and "Phishing" counts, but `GetStats` only returns total "threatsBlocked".
  - **Protection Toggles:** UI has toggles for "Phishing Detection", "Malicious Link Scan", etc., but the backend has no endpoint to persist or synchronize these settings.

## Performance Bottlenecks

**Mobile Stats Polling:**
- Problem: `vault-mobile-auth/app/src/main/java/com/vault/auth/ui/screens/Screens.kt` uses `Thread.sleep(10000)` in a loop for multiple screens (Dashboard, Shield) to fetch stats.
- Files: `vault-mobile-auth/app/src/main/java/com/vault/auth/ui/screens/Screens.kt`
- Cause: Redundant polling threads for stats that could be centralized or handled via WebSocket.
- Improvement path: Centralize stats fetching in a ViewModel or use the existing WebSocket connection to push updates from the backend.

## Test Coverage Gaps

**Frontend Data Integrity:**
- What's not tested: Validation of UI state when API returns empty or malformed data.
- Files: `vault-web-auth/src/screens/Dashboard.tsx`, `vault-mobile-auth/app/src/main/java/com/vault/auth/ui/screens/Screens.kt`
- Risk: UI might crash or continue showing dummy data if the API fails, as error handling is minimal (logs to console/Logcat).
- Priority: Medium

---

# Audit Report: Hardcoded Data vs Backend Support

## 1. vault-web-auth (Web)

| UI Element | File:Line | Backend Support | Recommendation |
|------------|-----------|-----------------|----------------|
| MacBook Pro unlocked... | `Dashboard.tsx:77` | `GetActivity` | **Real** - Fetch from API |
| Vault Health: 100% | `LiveStatusGrid.tsx:6` | `GetStats.securityScore` | **Real** - Map to score |
| Sessions: 1 Active | `LiveStatusGrid.tsx:7` | `GetStats.activeSessions` | **Real** - Map to API |
| Threats: 0 Blocked | `LiveStatusGrid.tsx:8` | `GetStats.threatsBlocked` | **Real** - Map to API |
| Backup: Synced | `LiveStatusGrid.tsx:9` | `GetStats.statusMessage` | **Real** - Map to API |
| Recent Activity List | `Activity.tsx:5-11` | `GetActivity` | **Real** - Fetch from API |

## 2. vault-mobile-auth (Mobile)

| UI Element | File:Line | Backend Support | Recommendation |
|------------|-----------|-----------------|----------------|
| AES-256 Military... | `SecurityHeroCard.kt:85` | None (Static) | **Keep** (Label) |
| Cloud Sync Active | `SecurityHeroCard.kt:97` | `GetStats.storageUsed` | **Real** - Toggle if > 0 |
| MacBook Pro unlocked... | `Screens.kt:113` | `GetActivity` | **Real** - Fetch from API |
| IP Address: 192.168.1.42| `Screens.kt:254` | None | **Removed** (or implement in BE) |
| Last Unlock: 10:42 AM | `Screens.kt:255` | `GetDevices.last_active` | **Real** - Map to API |
| Biometric: Face ID | `Screens.kt:256` | None | **Removed** |
| Timestamp: May 6, 2026 | `Screens.kt:378` | `GetActivity.time` | **Real** - Map to API |
| Location: San Francisco | `Screens.kt:381` | None | **Removed** |
| Scanned / Phishing | `Screens.kt:457-459` | None | **Removed** |
| Protection Toggles | `Screens.kt:491-512` | None | **Removed** |

*Concerns audit: 2025-05-22*
