---
status: verifying
trigger: "Android-Specific Biometric and PIN failure on 'ahs-app.pages.dev'. Symptoms: 1. No biometric prompt (Face/Finger) appears on Android when clicking 'Unlock Vault'. 2. PIN entry says 'security state invalid. please reset all data' even after a successful setup."
created: 2025-05-19T10:00:00Z
updated: 2025-05-19T10:15:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "Android Chrome may fail to trigger biometric prompts when 'transports: [internal]' is specified if the authenticator isn't strictly identified as such. PIN state invalid issues are likely due to race conditions in IndexedDB initialization or silent failures during the sequential saving of security parameters."
  confirming_evidence:
    - "User reports no prompt on Android."
    - "Code review identified sequential, un-verified DB writes."
    - "db.init() lacked race condition protection."
  falsification_test: "Removing 'transports: [internal]' and adding setup verification should resolve the issues or at least provide clear diagnostic logs if they persist."
  fix_rationale: "Making transports optional allows browser flexibility. Synchronizing DB init and adding setup verification ensures security state consistency."
  blind_spots: "Cannot test on real Android hardware; variations in manufacturer-specific WebAuthn implementations."

next_action: request_human_verification

## Symptoms

expected: Biometric prompt should appear on Android; PIN should work after setup.
actual: No biometric prompt; PIN says 'security state invalid'.
errors: "security state invalid. please reset all data"
reproduction: "1. Setup vault on Android. 2. Try to unlock with biometrics. 3. Try to unlock with PIN."
started: Always broken on Android.

## Eliminated

## Evidence

- timestamp: 2025-05-19T10:10:00Z
  checked: vault-web-auth/src/hooks/useWebAuthn.ts
  found: authenticateBiometric explicitly enforced transports: ['internal'].
  implication: This can be too restrictive for some Android Chrome versions.
- timestamp: 2025-05-19T10:12:00Z
  checked: vault-web-auth/src/lib/db.ts
  found: db.init() could be called concurrently, leading to multiple IndexedDB open requests.
  implication: Potential race conditions in data persistence.
- timestamp: 2025-05-19T10:14:00Z
  checked: vault-web-auth/src/App.tsx
  found: handleSecuritySetupBiometric did not verify that PIN/Salt were persisted before completing setup.
  implication: Could lead to "invalid security state" if writes failed silently.

## Resolution

root_cause: WebAuthn 'internal' transport restriction on Android and potential race conditions/persistence gaps in IndexedDB usage during security setup.
fix: Relaxed WebAuthn transports, synchronized DB initialization, and added post-setup persistence verification.
verification:
files_changed: [vault-web-auth/src/App.tsx, vault-web-auth/src/hooks/useWebAuthn.ts, vault-web-auth/src/lib/db.ts]
