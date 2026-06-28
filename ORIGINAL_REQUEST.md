# Original User Request

## Initial Request — 2026-06-10T20:00:28+06:00

# Teamwork Project Prompt — Final

Implement robust WebAuthn biometric (Face ID/Touch ID) authentication with seamless PIN fallback on iOS/Android for the zero-knowledge vault web authentication node, and provide clear local testing guidelines.

Working directory: G:\ahs\ahs-app\vault-web-auth
Integrity mode: development

## Requirements

### R1. iOS/Safari Compatible WebAuthn Implementation
Ensure that WebAuthn registration and authentication work flawlessly on iOS (Safari/WKWebView). This includes handling strict user activation (gesture) requirements, validating WebAuthn compatibility, and resolving RP ID constraints (e.g. handling IP address hostnames).

### R2. Seamless PIN Fallback
If biometric authentication is cancelled, fails, or is unsupported on the current device/browser, the application must immediately and seamlessly fall back to the secure PIN pad verification without blocking the user.

### R3. Optional/Skippable Biometric Setup
During the security setup (onboarding/pairing), if biometric enrollment fails or if biometrics are not supported by the client browser/context, allow the user to complete setup using PIN-only mode. Provide a clear warning/explanation when biometrics fail or are unsupported.

### R4. Local Testing & Verification Guide
Provide a detailed markdown guide showing how to test mobile biometrics (both iOS and Android) locally, covering secure context (HTTPS) requirements, local hostname resolution (avoiding IP addresses), and tools like ngrok/localtunnel.

## Acceptance Criteria

### WebAuthn & Biometrics
- [ ] Browser support and hardware biometric availability are checked using `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` before prompting.
- [ ] Users can register biometrics during the setup flow if supported, or fall back to PIN setup if unsupported/cancelled.
- [ ] WebSocket-triggered unlocks display a user prompt that triggers WebAuthn on click, preserving user gesture context.

### PIN Fallback
- [ ] If WebAuthn fails (e.g., `NotAllowedError`, cancellation), the PIN pad is shown immediately.
- [ ] If WebAuthn is unsupported on the browser/device, the app skips the biometric prompt and goes directly to PIN verification.

### Documentation
- [ ] A testing guide `TESTING_MOBILE.md` is added to the project, explaining HTTPS setup, domain name usage (avoiding IP addresses), and testing on Android/iOS.
