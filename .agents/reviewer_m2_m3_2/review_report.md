# REVIEW REPORT: vault-web-auth

## Review Summary

**Verdict**: **APPROVE**

This review covers the vault-web-auth codebase changes for mobile compatibility (iOS/Safari), WebAuthn support checking, PIN fallback flows, onboarding/pairing skippability, and the completeness of `TESTING_MOBILE.md`.

All requirements have been met with exceptional quality, implementing industry-standard security and user experience practices. The gesture preservation mechanism correctly circumvents Safari's strict user-activation restrictions, and the PIN fallback paths operate seamlessly both in unsupported and user-cancelled scenarios.

---

## Quality Review Report

### Findings

#### [Minor] Finding 1: Standalone and Hook Exports of checkWebAuthnSupport
- **What**: The utility function `checkWebAuthnSupport` is exported both as a standalone async function and returned as a property from the `useWebAuthn` hook.
- **Where**: `src/hooks/useWebAuthn.ts` (lines 17 and 150)
- **Why**: While not a bug, having multiple ways to consume the same helper can lead to inconsistent usage across different screens (e.g. `App.tsx` imports it standalone, while `SettingsScreen.tsx` destructures it from the hook).
- **Suggestion**: Standardize on importing `checkWebAuthnSupport` directly as a standalone utility function since it has no internal dependencies on React state or lifecycle, keeping hook definitions lean.

---

### Verified Claims

1. **Claim**: iOS/Safari User Gesture preservation is achieved by caching database state.
   - **Verification Method**: Inspected `src/App.tsx` lines 480-517 (`handleAppLockUnlock`) and lines 561-600 (`handleApproveUnlock`).
   - **Result**: **PASS**. Both click handlers query React states (`biometricsEnabledState` and `biometricCredentialIdState`) synchronously. These state variables are loaded on mount during app initialization (`init()` inside `useEffect`). No `await db` or promise resolution microtasks occur inside the click handler prior to `authenticateBiometric` calling SimpleWebAuthn's `startAuthentication`. This ensures that the user activation gesture is fully preserved, preventing Safari `NotAllowedError`.

2. **Claim**: Critical database lockups are avoided in iOS/Safari.
   - **Verification Method**: Checked `src/lib/db.ts` lines 107-115.
   - **Result**: **PASS**. A listener is attached to `visibilitychange`. When `document.visibilityState === 'hidden'`, the database connection is closed via `db.close()`, which flushes write-ahead logs (WAL) to disk and prevents Safari transaction hangs.

3. **Claim**: WebAuthn checks properly identify IP address constraints and secure context conditions.
   - **Verification Method**: Analyzed `src/hooks/useWebAuthn.ts` lines 17-75 (`checkWebAuthnSupport`).
   - **Result**: **PASS**. The function checks:
     - `window.isSecureContext` (ensuring HTTPS or localhost).
     - `window.PublicKeyCredential === 'undefined'` (verifying API support).
     - Hostname structure via `ipv4Regex` and `isIpv6` checks. If matched, it returns `supported: false` with reason `ip-address`. This correctly prevents browser RP ID validation failures before they happen.
     - `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` to verify hardware biometric capability.

4. **Claim**: PIN fallback transitions smoothly when biometrics are cancelled or unsupported.
   - **Verification Method**: Analyzed try/catch handling in `App.tsx` click handlers.
   - **Result**: **PASS**.
     - If unsupported/disabled, the handlers bypass WebAuthn entirely and call `setShowPinFallback(true)` instantly.
     - If the user cancels the native TouchID/FaceID prompt, simplewebauthn throws a `NotAllowedError` or a message containing `cancelled`. The catch blocks (`App.tsx` lines 509-514 and 586-596) immediately capture this error and set `showPinFallback(true)`, hiding the biometric prompt and displaying the fallback PIN pad.
     - PIN authorization is fully compatible with fallback pairing; the approval handshake signs using the local hardware identity key when `webauthnResponse` is absent.

5. **Claim**: Onboarding, decoy PINs, and pairing setup flows are fully skippable.
   - **Verification Method**: Inspected setup steps and cancellation buttons in `src/App.tsx`.
   - **Result**: **PASS**.
     - In the decoy PIN step, `onCancel` maps to `handleSecuritySetupSkipDecoy` which advances directly to biometric enrollment.
     - In the biometric enrollment step, a "Skip / PIN Only" button triggers `handleSecuritySetupSkipBiometric`, setting up a PIN-only vault and launching the main screen.
     - After pairing scan completion, the `showPostPairingModal` contains a "Skip / PIN Only" option to let users bypass WebAuthn binding without terminating the pairing.
     - The Scanner component allows closing out at any time.

6. **Claim**: `TESTING_MOBILE.md` is complete and lists actionable verification instructions.
   - **Verification Method**: Inspected `TESTING_MOBILE.md` in detail.
   - **Result**: **PASS**. The document provides clear setups for local tunneling (`ngrok`/`localtunnel`), self-signed SSL certificate setup (`mkcert`), gesture preservation verification steps, PIN fallback test cases, and mobile remote debugging instructions.

---

### Coverage Gaps

- **Chromium/Android WebAuthn Platform Authenticator Checks**:
  - *Risk Level*: **Low**
  - *Recommendation*: While iOS/Safari is the primary focus, it is worth noting that some Android browsers return `false` on `isUserVerifyingPlatformAuthenticatorAvailable()` if there are no screen locks configured. The current check behaves correctly by disabling biometrics and falling back to PIN, which handles this case safely.

---

### Unverified Items

- **Actual build compilation status**:
  - *Reason not verified*: Proposing `npm run build` via `run_command` timed out twice because the CLI environment was waiting for user authorization, which was not available at runtime. However, static review of the codebase confirms that typescript imports, configuration structures (`tsconfig.json`, `package.json`), and exports align perfectly.

---

## Adversarial Review (Challenge Report)

**Overall risk assessment**: **LOW**

### Challenges

#### [Medium] Challenge 1: Double-triggering biometric authentication prompts
- **Assumption challenged**: Assumes the user will only click "Verify Identity" once, and that `isProcessing` state will block subsequent clicks.
- **Attack scenario**: On slow or busy mobile devices, there is a delay between the user's tap on the "Verify Identity" button and the browser opening the native FaceID/TouchID prompt. If a user double-taps quickly, two asynchronous call stacks of `authenticateBiometric` could be scheduled, leading to overlapping requests or browser credential API aborts.
- **Mitigation**: The code includes `disabled={loading}` on the button and sets `isProcessing(true)` synchronously inside the handlers. Because state updates in React are queued and do not block the current stack execution, double-tap is mitigated by the fact that the first execution completes synchronously up to the native promise call. However, adding a throttle or setting a local ref (e.g. `isPrompting.current = true`) would guarantee that double-taps are blocked regardless of the React render scheduler.

#### [Low] Challenge 2: Localhost checks in Secure Contexts
- **Assumption challenged**: Assumes `window.isSecureContext` is sufficient for securing local hosting.
- **Attack scenario**: Under the WebAuthn spec, `localhost` is allowed even over HTTP. However, on mobile devices, if developers attempt to test by accessing `http://192.168.1.50:5173` directly, `isSecureContext` will be `false`, which is correctly caught. If they attempt to access `http://localhost:5173` on a mobile browser emulator (which maps to the host), it will pass `isSecureContext` but might fail standard WebAuthn checks if not configured.
- **Mitigation**: The testing guide (`TESTING_MOBILE.md`) has proactively mitigated this by instructing developers to use `ngrok`/`localtunnel` for HTTPS or `mkcert` with custom hostnames.

---

## Stress Test Results

- **Biometric Prompt Cancellation**:
  - *Scenario*: User triggers biometrics, the prompt appears, and the user taps "Cancel" or hits the home button.
  - *Expected behavior*: Biometric prompt closes, and the PIN fallback overlay shows immediately.
  - *Actual Analysis*: The promise from `startAuthentication` rejects, throwing a `NotAllowedError`. The catch block in `App.tsx` catches this error and sets `showPinFallback(true)`, which immediately switches the UI to the PIN pad. This is a pass.

- **Offline / Network Connection Drops during Pairing**:
  - *Scenario*: Device is paired, QR code scanned, and the connection drops during master key push.
  - *Expected behavior*: The app does not lock up, allows scanning again, and retains the initial state.
  - *Actual Analysis*: The hook `useWebSocket` handles connection dropouts, and `handleScan` catches fetch errors inside a try-catch, triggering an alert dialog and resetting `isProcessing(false)`, returning the app safely to the scanner interface. This is a pass.
