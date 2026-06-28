# Handoff Report — explorer_m1_3

## 1. Observation

1. **Missing WebAuthn Compatibility Check**:
   - `G:\ahs\ahs-app\PROJECT.md` specifies:
     ```markdown
     21: ## Interface Contracts
     22: ### `useWebAuthn` API
     23: - `checkWebAuthnSupport()`: `() => Promise<{ supported: boolean, reason?: string, message?: string }>`
     ```
   - In `G:\ahs\ahs-app\vault-web-auth\src\hooks\useWebAuthn.ts`, there is no implementation or export for `checkWebAuthnSupport()`.
2. **IP Hostname Violation in RP ID**:
   - In `G:\ahs\ahs-app\vault-web-auth\src\hooks\useWebAuthn.ts` lines 27 and 67, the RP ID is configured using:
     ```typescript
     27:         id: window.location.hostname,
     ...
     67:     rpId: window.location.hostname,
     ```
   - WebAuthn standards prohibit raw IP addresses as RP IDs.
3. **Database Await Statements inside User Gesture Callback**:
   - In `G:\ahs\ahs-app\vault-web-auth\src\App.tsx` lines 380–384 (App Lock click handler):
     ```typescript
     380:   const handleAppLockUnlock = async () => {
     381:     const biometricsReady = await db.isBiometricsEnabled();
     382:     const credentialId = await db.getBiometricCredentialId();
     383:     const pairingData = await db.getPairingData();
     ```
   - In `G:\ahs\ahs-app\vault-web-auth\src\App.tsx` lines 457–462 (Approve Unlock click handler):
     ```typescript
     457:   const handleApproveUnlock = async () => {
     458:     if (!pairingData || !identityPK) return;
     459:     
     460:     const biometricsReady = await db.isBiometricsEnabled();
     461:     const credentialId = await db.getBiometricCredentialId();
     ```
   - In iOS Safari, awaiting IndexedDB reads between the user click gesture and calling WebAuthn methods causes `NotAllowedError` due to user gesture loss.
4. **Missing Gesture Context in Pairing Scan**:
   - In `G:\ahs\ahs-app\vault-web-auth\src\App.tsx` lines 324–336 (inside `handleScan` callback):
     ```typescript
     324:       console.log('Requesting biometric enrollment during pairing...');
     325:       let biometricData;
     326:       try {
     327:         biometricData = await registerBiometric('User');
     ```
   - This registration runs inside the camera QR scanner loop callback, which has no user gesture context, causing WebAuthn to fail on iOS Safari.

---

## 2. Logic Chain

1. **R1: iOS/Safari WebAuthn Compatibility**:
   - Because raw IP addresses as RP IDs throw exceptions (Observation 2), and because there is no browser compatibility check (Observation 1), we must implement `checkWebAuthnSupport()` to check secure context, browser capabilities, and IP-address hosts.
   - Because `await db...` calls yield the main thread (Observation 3), they invalidate the active user activation token in iOS Safari. Therefore, pre-fetching the DB settings into state on mount ensures these checks run synchronously in the click handler.
   - Because `handleScan` lacks user activation (Observation 4), removing `registerBiometric()` from `handleScan` and placing it behind a post-pairing user prompt solves the issue.
2. **R2: Seamless PIN Fallback**:
   - If biometrics fail or are disabled, the UI must fallback to the PIN Pad. If the user completes PIN authentication, the app can call `finishUnlockApproval` without a WebAuthn response, signing the nonce with the device's hardware identity key.
3. **R3: Optional / Skippable Biometrics**:
   - During security setup and post-pairing, the user must have options to skip enrollment (PIN-only flow).
   - In `Settings.tsx`, adding a toggle to disable biometric unlock and a button to remove biometric credentials allows the user to opt-out of biometrics at any time.

---

## 3. Caveats

- **Self-Signed Certificates**: Testing HTTPS locally requires trusting a self-signed certificate on the iOS device (using `mkcert` or a proxy). Without this, the iOS browser will reject the connection as insecure and fail WebAuthn checks.
- **Hardware Limitations**: Simulating FaceID/TouchID in desktop simulators may require enabling biometric enrollment in the simulator settings.

---

## 4. Conclusion

The iOS Safari WebAuthn compatibility issues are caused by (a) asynchronous database calls breaking the user activation gesture chain, (b) raw IP hostnames violating the WebAuthn RP ID specification, and (c) automatic biometric registration from non-gesture QR scan callbacks. 
Implementing a robust `checkWebAuthnSupport()` check, refactoring the click handlers to use pre-fetched state values, and separating biometric enrollment from scanning will solve the compatibility issues while keeping the PIN fallback and optional setup fully intact.

---

## 5. Verification Method

1. **Build and Test**:
   - Run the Vite build to ensure there are no compilation errors:
     ```powershell
     npm run build
     ```
2. **Manual Inspection**:
   - Inspect `G:\ahs\ahs-app\vault-web-auth\src\hooks\useWebAuthn.ts` to confirm `checkWebAuthnSupport()` is defined and exported.
   - Inspect `G:\ahs\ahs-app\vault-web-auth\src\App.tsx` and check that `handleAppLockUnlock` and `handleApproveUnlock` do not contain any `await db...` calls before calling `authenticateBiometric`.
3. **Localtunnel verification**:
   - Run `npx localtunnel --port 5173` and load the HTTPS URL on an iOS device. Verify FaceID/TouchID activates correctly on button tap.
