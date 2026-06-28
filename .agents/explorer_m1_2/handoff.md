# Handoff Report: Mobile WebAuthn & PIN Fallback Analysis

**Working Directory**: `G:\ahs\ahs-app\.agents\explorer_m1_2`  
**Handoff Type**: Hard (Task complete)

---

## 1. Observation

During my investigation of the `vault-web-auth` codebase, I made the following key observations:

1. **Relying Party Hostname Validation**  
   In `vault-web-auth/src/hooks/useWebAuthn.ts` lines 27 and 67, the Relying Party ID is set using `window.location.hostname`:
   ```typescript
   id: window.location.hostname,
   ```
   *Tool Result*: WebAuthn specifications state that the Relying Party ID must be a valid domain name and cannot be a raw IP address (e.g. `192.168.1.100`), which is commonly used during local network mobile testing.

2. **Asynchronous Delays in User Gestures**  
   In `vault-web-auth/src/App.tsx` lines 380-413 and 457-495, user-initiated buttons for unlock and lock approvals call asynchronous IndexedDB queries before calling WebAuthn APIs:
   ```typescript
   const handleApproveUnlock = async () => {
     // ...
     const biometricsReady = await db.isBiometricsEnabled();
     const credentialId = await db.getBiometricCredentialId();
     // ...
     const webauthnResp = await authenticateBiometric(credentialId, pairingData.pairing_nonce);
   ```
   *Tool Result*: Modern browser engines (specifically WebKit/Safari on iOS) strictly enforce user activation context. Any asynchronous yielding (e.g. `await` statements) prior to the call to `navigator.credentials.get` will invalidate the gesture token and cause a `NotAllowedError`.

3. **QR Code Scanning Gesture Gap**  
   In `vault-web-auth/src/App.tsx` lines 300-337, scanning a QR code immediately registers biometrics within the camera's decoding callback thread:
   ```typescript
   const handleScan = async (decodedText: string) => {
     // ...
     try {
       biometricData = await registerBiometric('User');
   ```
   *Tool Result*: The QR decoder callback is invoked asynchronously in a non-gesture stack. Invoking `registerBiometric` directly inside this thread triggers a prompt rejection in Safari/iOS.

4. **Mandatory Biometrics in Security Setup**  
   In `vault-web-auth/src/App.tsx` lines 224-298, the security setup forces biometric enrollment and alerts a blocking error on failure:
   ```typescript
   const handleSecuritySetupBiometric = async () => {
     // ...
     const biometricData = await registerBiometric('User');
     if (!biometricData) {
       throw new Error('Biometric registration failed to return a credential.');
     }
     // ...
   } catch (err: any) {
     alert(`Security setup failed: ${err.message || 'Unknown error'}. Biometrics are required.`);
   }
   ```
   *Tool Result*: This locks out any device that lacks a platform authenticator or is running in an insecure context.

5. **Settings Biometrics Control**  
   In `vault-web-auth/src/screens/Settings.tsx` lines 72-82, the biometrics section only displays enrollment state:
   ```typescript
   { 
     label: biometricsEnabled ? 'Identity Enrolled' : 'Not Enrolled', 
     icon: Fingerprint, 
     color: 'text-neon-cyan',
     isButton: true,
     action: handleRegisterBiometrics,
     buttonText: biometricsEnabled ? 'Update' : 'Enroll'
   }
   ```
   *Tool Result*: There is no toggling or configuration switch to turn biometrics on/off for unlocking the app.

---

## 2. Logic Chain

1. **iOS WebAuthn compatibility requires strict gesture context**: Safari rejects FIDO2 calls if a microtask boundary occurs between user interaction and invocation. Since `App.tsx` awaits IndexedDB queries within `handleApproveUnlock` and `handleAppLockUnlock` (Observation 2), the gesture token expires. Pre-loading these credential details into React state upon application boot or update eliminates these intermediate awaits and preserves the gesture.
2. **Scan callback is not a gesture**: `handleScan` runs inside the HTML5-QR-Code decoder callback thread (Observation 3). Therefore, registering biometrics inside it fails. Splitting this operation by introducing a confirmation overlay with a user button click preserves the gesture.
3. **RP ID Constraints prevent raw IP testing**: Since Relying Party ID is bound to `window.location.hostname` (Observation 1), using a local dev IP address throws errors. Setting up a validation utility to check for IP hostnames allows the client to abort gracefully and prompt the user to use domain names or tunnels (e.g. Ngrok) to satisfy the RP ID constraint.
4. **Skippable Setup prevents bricking**: The onboarding flow requires biometric registration (Observation 4). Adding a "Skip" action that saves only the PIN configurations to Dexie resolves this blocker for unsupported devices.
5. **Settings toggle supports PIN fallback preference**: By adding a toggle switch in settings (Observation 5) linked to `db.setBiometricsEnabled(boolean)`, users can disable biometrics. If disabled, the lock screen should default to displaying the PIN pad directly.

---

## 3. Caveats

- **Mock Verification**: This analysis is read-only and relies on architectural analysis and common WebAuthn standard behaviors. The recommendations have not been executed on a live device.
- **HTTPS Requirements**: Even with proper domain names (e.g. `.local`), WebAuthn will fail if the connection is not served over HTTPS. Tunnels like Ngrok are assumed to provide SSL termination for physical testing.

---

## 4. Conclusion

The current WebAuthn implementation in `vault-web-auth` will fail on iOS/Safari due to asynchronous database yields within click handlers and registration attempts in background camera scan loops. 
To resolve this:
- Cache biometric credentials and enrollment state in React state on boot to ensure synchronous FIDO2 calls.
- Introduce a Pairing Confirmation overlay to preserve user gesture context during scanning.
- Implement the `checkWebAuthnSupport` helper in `useWebAuthn.ts` to detect IP addresses and insecure contexts.
- Add "Skip" buttons in the setup and pairing flows, and a toggle switch in Settings to enable seamless PIN fallbacks.

---

## 5. Verification Method

To verify these changes:
1. Run `npm run dev` in `vault-web-auth`.
2. Inspect `vault-web-auth/TESTING_MOBILE.md` for specific manual tests.
3. Verify that **Test Case 1** (Skippable Biometrics), **Test Case 2 & 3** (Pairing Confirmation screen), and **Test Case 4** (Safari User Gesture Preservation) pass successfully.
4. Check console output on Safari iOS Web Inspector for any occurrences of `NotAllowedError` during lock/unlock prompts.
