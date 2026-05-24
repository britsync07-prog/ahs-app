---
status: verifying
trigger: "The web app was just deployed to a new domain 'ahs-app.pages.dev'. The user reports that on their phone, clicking 'Unlock Vault' goes straight to the PIN pad and never shows the FaceID/Fingerprint prompt. Investigate App.tsx, useWebAuthn.ts, db.ts, and BiometricPrompt.tsx."
created: 2025-05-20T10:00:00Z
updated: 2025-05-20T10:45:00Z
---

## Current Focus

hypothesis: Biometric enrollment was failing silently or state was not properly verified, leading to a PIN-only fallback.
test: Verifying mandatory enrollment and enhanced logging.
expecting: Users are forced to enroll biometrics or see clear errors, and diagnostic info is visible on the lock screen.
next_action: Request human verification on the new domain.

## Symptoms

expected: Clicking 'Unlock Vault' should show the FaceID/Fingerprint prompt if biometrics are enabled.
actual: Clicking 'Unlock Vault' goes straight to the PIN pad.
errors: None reported, but suspect silent failure or state mismatch.
reproduction: 1. Deploy app to a new domain. 2. Attempt to enroll/use biometrics on mobile. 3. Observe fallback to PIN.
started: After deployment to ahs-app.pages.dev.

## Eliminated

## Evidence

- timestamp: 2024-05-20T10:15:00Z
  checked: vault-web-auth/src/App.tsx
  found: handleAppLockUnlock falls back to PIN if isBiometricsEnabled() or getBiometricCredentialId() is false/null. handleSecuritySetupBiometric only warns if registration fails.
  implication: Users can end up in a PIN-only state if biometric registration fails silently.

- timestamp: 2024-05-20T10:20:00Z
  checked: vault-web-auth/src/hooks/useWebAuthn.ts
  found: residentKey: 'preferred' is used.
  implication: This might trigger Passkey UI instead of local platform auth.

## Resolution

root_cause: Biometric enrollment was not mandatory during setup, allowing users to proceed with only a PIN if WebAuthn failed (likely due to domain-specific configuration or user gesture issues). Additionally, 'preferred' residentKey setting could trigger iCloud Passkey UI instead of local hardware binding.
fix: Made biometric enrollment mandatory in setup, added diagnostic status to the lock screen, and optimized WebAuthn settings for local hardware binding (residentKey: 'discouraged').
verification: Self-verified code changes. Requires manual test on the new domain to confirm specific hardware behavior.
files_changed: [vault-web-auth/src/App.tsx, vault-web-auth/src/hooks/useWebAuthn.ts]
