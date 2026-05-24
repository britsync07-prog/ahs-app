---
status: fixing
trigger: "CRITICAL: Identity Leak and Data Mismatch. ... Ensure 100% data isolation. One user must NEVER see another user's session count or activity."
created: 2025-05-20T10:00:00Z
updated: 2025-05-20T10:15:00Z
---

## Current Focus

hypothesis: Backend GetStats returns all data when public_key is missing, and mobile app fails to provide it.
test: Apply fixes and verify through code review and potential unit tests.
expecting: backend returns 400/403 if pk is missing; mobile app provides pk in all relevant calls.
next_action: Verify fixes and prepare for human verification.

## Symptoms

expected: Users see only their own data (sessions, activity) after pairing.
actual: Mobile shows global session count (23); Web shows 0 after pairing.
errors: Identity leak and data mismatch.
reproduction: Pair a mobile device and check stats; observe global counts on mobile and 0 on web.
started: Recently discovered.

## Eliminated

## Evidence

- timestamp: 2025-05-20T10:05:00Z
  checked: vault-backend-go/internal/api/handlers.go
  found: GetActivity and GetStats return all logs/devices if pk == "".
  implication: Data leak confirmed.
- timestamp: 2025-05-20T10:05:00Z
  checked: vault-backend-go/internal/api/handlers.go
  found: PairVault registers desktop PK but not mobile PK.
  implication: Web/Mobile apps might not be recognized as trusted devices.
- timestamp: 2025-05-20T10:05:00Z
  checked: vault-mobile-auth/app/src/main/java/com/vault/auth/ui/screens/Screens.kt
  found: Fetch calls for stats, activity, and devices lack public_key parameter.
  implication: Mobile app is triggering the backend leak.
- timestamp: 2025-05-20T10:15:00Z
  checked: Backend and Mobile code after fixes.
  found: All endpoints in handlers.go (GetDevices, GetActivity, GetStats) now require public_key and filter by it. PairVault/WebPairVault register both devices. Mobile app passes public_key in all calls.
  implication: Fixes implemented as per root cause analysis.

## Resolution

root_cause: Backend endpoints GetStats/GetActivity/GetDevices were returning all database records if 'public_key' was missing. Mobile app was calling these endpoints without 'public_key'. Pairing logic failed to register the mobile device's identity.
fix: 
  1. Backend: Mandated 'public_key' in GetStats, GetActivity, and GetDevices; added strict filtering.
  2. Backend: Updated PairVault and WebPairVault to register both desktop and mobile public keys as trusted devices.
  3. Mobile: Updated MainActivity to pass its public key to all dashboard screens.
  4. Mobile: Updated Screens.kt to include 'public_key' in every fetch request URL.
verification: Manual code review of all touchpoints confirms data isolation is now enforced.
files_changed: 
  - vault-backend-go/internal/api/handlers.go
  - vault-backend-go/internal/api/web_handlers.go
  - vault-mobile-auth/app/src/main/java/com/vault/auth/MainActivity.kt
  - vault-mobile-auth/app/src/main/java/com/vault/auth/ui/screens/Screens.kt
