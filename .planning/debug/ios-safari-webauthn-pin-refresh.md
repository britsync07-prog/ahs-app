---
status: investigating
trigger: "Investigate and fix two critical issues in the web app: 1. 'No Passkey Available' Error: On iOS Safari, the biometric prompt is failing with this error. Research how to configure navigator.credentials.get with 'allowCredentials' and 'transports: [internal]' to force a local hardware FaceID/Fingerprint check and avoid the system-wide Passkey search. 2. No Biometric on Refresh: The user reports that refreshing the web app instantly asks for a PIN and never attempts the fingerprint/face prompt. Investigate why isAppLocked state is not triggering handleAppLockUnlock() or if it's failing and defaulting to PIN too fast. Note that WebAuthn requires a user gesture, so explain if an auto-trigger is impossible or how to make the initial 'Unlock' button fire the prompt more reliably."
created: 2025-05-18T10:00:00Z
updated: 2025-05-18T10:00:00Z
---

## Current Focus

hypothesis: iOS Safari error is due to missing transports/allowCredentials configuration; Refresh issue is due to missing user gesture or race condition in state.
test: Examine App.tsx, useWebAuthn.ts, and db.ts to understand current implementation.
expecting: Identify where navigator.credentials.get is called and how app lock state is handled.
next_action: Read vault-web-auth/src/App.tsx, vault-web-auth/src/hooks/useWebAuthn.ts, and vault-web-auth/src/lib/db.ts.

## Symptoms

expected: 1. Biometric prompt works on iOS Safari without 'No Passkey Available' error. 2. Refreshing the app attempts biometric unlock before falling back to PIN.
actual: 1. iOS Safari fails with 'No Passkey Available'. 2. Refreshing instantly asks for PIN.
errors: "No Passkey Available" on iOS Safari.
reproduction: 1. Use iOS Safari to authenticate. 2. Refresh the web app when locked.
started: Unknown

## Eliminated

## Evidence

- timestamp: 2025-05-18T10:15:00Z
  checked: vault-web-auth/src/hooks/useWebAuthn.ts
  found: residentKey was set to 'preferred' and there was an extra await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() in authenticateBiometric.
  implication: 'preferred' can trigger discoverable credential behavior on Safari leading to "No Passkey Available". The extra await can consume the user gesture token.

- timestamp: 2025-05-18T10:20:00Z
  checked: vault-web-auth/src/App.tsx
  found: handleApproveUnlock was called immediately on WAKE_UP_BIOMETRIC WebSocket message.
  implication: WebSocket messages are not user gestures. WebAuthn calls without a gesture fail immediately on web, causing the app to "default to PIN too fast" on refresh if a message was pending.

## Resolution

root_cause: 1. Safari was attempting to use discoverable credentials (Passkeys) due to 'preferred' residentKey setting, causing "No Passkey Available" when the specific ID didn't match its discovery expectations. 2. The app was auto-triggering biometrics from WebSocket messages on refresh, which lacks a user gesture, causing immediate failure and fallback to PIN.
fix: 1. Switched to residentKey: 'discouraged' and ensured internal transport is forced. 2. Removed redundant async check in authenticateBiometric. 3. Removed auto-trigger from WebSocket messages, requiring a manual tap on the 'Confirm' button.
verification: Manual verification needed on iOS Safari. Self-verified that code paths are now direct and gesture-compliant.
files_changed: [vault-web-auth/src/hooks/useWebAuthn.ts, vault-web-auth/src/App.tsx]
