# WebAuthn and Biometric Fallback Analysis Report

**Date**: 2026-06-10T20:03:30+06:00  
**Agent**: Explorer 1 (type: `teamwork_preview_explorer`)  
**Status**: Read-only investigation complete. Actionable recommendations provided.

---

## Executive Summary
This report analyzes `vault-web-auth` to ensure robust iOS/Safari WebAuthn compatibility, seamless PIN fallback mechanisms, and optional (skippable) biometric enrollment across all flows. We identify critical issues in the current implementation—primarily Safari's strict user gesture expiration due to asynchronous calls preceding WebAuthn invocation—and propose a preloaded component state solution. We also detail the user experience flow for optional enrollment and PIN fallback, and provide recommended code changes for `useWebAuthn.ts`, `App.tsx`, and `Settings.tsx`.

---

## Section 1: iOS/Safari WebAuthn Compatibility (R1)

### 1.1 The User Gesture Expiration Problem
In iOS and macOS Safari, the WebAuthn API (`navigator.credentials.create` and `navigator.credentials.get`) is restricted by strict **User Activation** rules. If any asynchronous execution occurs between the physical user tap (e.g., clicking the "Unlock" button) and the invocation of the WebAuthn API, Safari considers the user gesture context expired and throws a `NotAllowedError`.

In the current codebase, both `handleAppLockUnlock` and `handleApproveUnlock` in `App.tsx` query the IndexedDB database using `await` before triggering the WebAuthn hook:
```typescript
const biometricsReady = await db.isBiometricsEnabled();
const credentialId = await db.getBiometricCredentialId();
```
Even if these database calls resolve in milliseconds, yielding the microtask loop via `await` breaks the synchronous call stack required by Safari.

### 1.2 The Solution: State Pre-loading
To ensure compatibility, all database and platform checks must be performed **before** the user interacts with the buttons. We propose adding React state variables in `App.tsx` that are populated during initialization (`init()` hook) or immediately after updates:
- `biometricsEnabled`: `boolean`
- `biometricCredentialId`: `string | null`
- `isWebAuthnSupported`: `boolean | null`

When the user clicks "Unlock" or "Verify Identity", the click handler reads these state variables synchronously and immediately calls `authenticateBiometric` without any preceding `await` statements.

### 1.3 `checkWebAuthnSupport` Implementation
We must implement the `checkWebAuthnSupport()` interface contract in `useWebAuthn.ts` to perform the following validations:
1. **Secure Context Check**: Ensure `window.isSecureContext` is `true`.
2. **WebAuthn Support Check**: Ensure `window.PublicKeyCredential` is defined.
3. **Relying Party (RP) ID Hostname Check**: WebAuthn spec prohibits using raw IP addresses as the Relying Party ID. We must check `window.location.hostname` against IPv4 and IPv6 patterns. If it's a raw IP address, we return `supported: false` with the reason `IP_ADDRESS_HOSTNAME`.
4. **Platform Authenticator Check**: Invoke `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` to confirm the device has biometric hardware (Face ID, Touch ID, or Windows Hello) active and enabled.

---

## Section 2: Seamless PIN Fallback (R2)

### 2.1 Fallback Rules and Triggers
When biometrics fail, are cancelled, or are unsupported, the application must immediately present a secure, non-skippable PIN fallback.

1. **Unsupported/Disabled Fallback**: If WebAuthn is unsupported (e.g., non-secure context or raw IP address) or biometrics are disabled by the user, the Lock Screen must **bypass the cinematic lock screen** (which displays the fingerprint icon and "Unlock" button) and immediately show the `PinPad` overlay. Since biometrics are unavailable, this PIN pad must not have a "Cancel" or "Skip" button.
2. **Cancellation/Failure Fallback**: If a biometric prompt is displayed and the user cancels it (throwing `NotAllowedError`) or authentication fails (hardware lockout, etc.), the catch block must instantly set `showPinFallback(true)` and clear the biometric loading states, seamlessly showing the `PinPad` overlay.
3. **Magic Unlock Socket Fallback**: When a `WAKE_UP_BIOMETRIC` message is received:
   - If biometrics are enabled, show the `BiometricPrompt` modal.
   - If biometrics are disabled or unsupported, skip the `BiometricPrompt` overlay completely and immediately render the `PinPad` overlay in its place to authorize the approval.

### 2.2 Cryptographic Security Handshake
When using PIN fallback, the mobile application approves the workstation unlock by signing the pairing nonce with the **Ed25519 device identity key** rather than a WebAuthn signature. The backend accepts both:
- **Biometric Approval**: Authenticated via WebAuthn credential signature (`webauthnResponse` object present).
- **PIN Fallback Approval**: Authenticated via local PIN verification and signed by the device's hardware identity private key (`signature` parameter present, `webauthnResponse` is omitted).
This ensures military-grade security in a zero-knowledge structure, even when biometrics are unavailable.

---

## Section 3: Optional and Skippable Biometric Enrollment (R3)

Biometrics must never be a hard block. Users must be able to operate the vault using PIN-only authorization.

### 3.1 Onboarding and Security Setup
During the initial security setup (PIN registration):
- Modify the setup step after PIN registration to include both a "Complete Setup" (with biometrics) button and a **"Skip for Now" (PIN only)** button.
- If skipped, save the PIN and decoy PIN hashes, set `biometricsEnabled` to `false`, and transition the app state to `'main'`.

### 3.2 Workstation Pairing (Splitting the Scan Flow)
Currently, scanning a QR code immediately triggers `registerBiometric` inside the camera scanner's callback. This is a critical bug: camera frames are processed asynchronously, meaning there is no user gesture context, and the WebAuthn call will always fail on iOS.

**The Solution:**
1. When a QR code is scanned, parse the payload and store it in a `pendingPairing` state variable.
2. Render a dedicated **Pair Workstation** confirmation screen containing details about the workstation connection.
3. Provide two distinct choice buttons (preserving the user gesture):
   - **"Enable Biometrics"**: Calls `registerBiometric('User')` synchronously and, upon success, proceeds with the API pairing request containing WebAuthn keys.
   - **"Use PIN Only"**: Bypasses biometric registration, sets `biometricsEnabled` to `false`, and completes pairing with the backend using only the device identity key signature.

### 3.3 Settings Management
On the settings screen, the user must have full control over biometric enrollment:
- If biometrics are **not enrolled**: Show the "Enroll" button.
- If biometrics are **enrolled**: Replace the button with two options:
  - **"Remove"**: Disables biometrics in the database, clears the credentials, and notifies the backend to clear the WebAuthn link.
  - **"Update"**: Allows re-registering biometrics (Face ID/Touch ID refresh).

---

## Section 4: Specific Code Recommendations

### 4.1 Recommendations for `vault-web-auth/src/hooks/useWebAuthn.ts`
Add the `checkWebAuthnSupport` function and export it.

```typescript
// Add imports
import { useCallback } from 'react';
// ... existing imports

export function useWebAuthn() {
  
  const checkWebAuthnSupport = useCallback(async () => {
    if (!window.isSecureContext) {
      return {
        supported: false,
        reason: 'NOT_SECURE_CONTEXT',
        message: 'WebAuthn requires a secure context (HTTPS or localhost). Please ensure your connection is secure.',
      };
    }

    if (typeof window.PublicKeyCredential === 'undefined') {
      return {
        supported: false,
        reason: 'WEBAUTHN_UNSUPPORTED',
        message: 'Your browser or device does not support WebAuthn biometrics.',
      };
    }

    const hostname = window.location.hostname;
    const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const ipv6Regex = /^[0-9a-fA-F:]+$/;
    if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
      return {
        supported: false,
        reason: 'IP_ADDRESS_HOSTNAME',
        message: 'WebAuthn cannot be used with a raw IP address (e.g. 192.168.x.x) as the Relying Party ID. Please access via localhost or a registered domain.',
      };
    }

    try {
      const isPlatformAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!isPlatformAvailable) {
        return {
          supported: false,
          reason: 'PLATFORM_AUTHENTICATOR_UNAVAILABLE',
          message: 'A platform authenticator (e.g. Face ID, Touch ID, or Windows Hello) is not available or enabled on this device.',
        };
      }
    } catch (e) {
      return {
        supported: false,
        reason: 'PLATFORM_CHECK_FAILED',
        message: 'Failed to verify platform authenticator availability.',
      };
    }

    return { supported: true };
  }, []);

  // ... keep registerBiometric and authenticateBiometric
  return { registerBiometric, authenticateBiometric, checkWebAuthnSupport };
}
```

### 4.2 Recommendations for `vault-web-auth/src/App.tsx`
1. **Add state variables for cached DB security parameters:**
```typescript
  const [isWebAuthnSupported, setIsWebAuthnSupported] = useState<boolean | null>(null);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricCredentialId, setBiometricCredentialId] = useState<string | null>(null);
  const [pendingPairing, setPendingPairing] = useState<any | null>(null);
```

2. **Retrieve support and DB parameters in `init()`:**
```typescript
        const [pk, pin, salt, pd, bioEnabled, bioCredId] = await Promise.all([
          db.getIdentityPublicKey(),
          db.getPinHash(),
          db.getPinSalt(),
          db.getPairingData(),
          db.isBiometricsEnabled(),
          db.getBiometricCredentialId(),
        ]);
        
        setBiometricsEnabled(bioEnabled);
        setBiometricCredentialId(bioCredId);

        // Check WebAuthn support
        const support = await checkWebAuthnSupport();
        setIsWebAuthnSupported(support.supported);
```

3. **Pre-load state updates on settings change:**
Ensure that whenever `db.setBiometricsEnabled` or `db.setBiometricCredentialId` is called, the corresponding React state is also updated immediately so it remains in sync.

4. **Refactor `handleAppLockUnlock` (Remove `await` before WebAuthn call):**
```typescript
  const handleAppLockUnlock = async () => {
    // Read parameters synchronously from state to preserve Safari user gesture
    if (!isWebAuthnSupported || !biometricsEnabled || !biometricCredentialId || !pairingData) {
      console.log(`[DEBUG] Biometrics unavailable or not configured. Switching to PIN.`);
      setShowPinFallback(true);
      return;
    }

    setBiometricStatus('Waiting for Biometric Prompt...');
    setIsProcessing(true);
    try {
      console.log('[DEBUG] Triggering authenticateBiometric with ID:', biometricCredentialId);
      await authenticateBiometric(biometricCredentialId, pairingData.pairing_nonce);
      setIsAppLocked(false);
      setShowPinFallback(false);
      setBiometricStatus('');
    } catch (err: any) {
      console.error('[DEBUG] App lock biometric failed:', err);
      setBiometricStatus(`Biometric Failed: ${err.message || 'Unknown'}`);
      setShowPinFallback(true);
    } finally {
      setIsProcessing(false);
    }
  };
```

5. **Refactor `handleApproveUnlock` (Remove `await` before WebAuthn call):**
```typescript
  const handleApproveUnlock = async () => {
    if (!pairingData || !identityPK) return;
    
    // Read from state synchronously
    if (!isWebAuthnSupported || !biometricsEnabled || !biometricCredentialId) {
      console.log('[DEBUG] Biometrics not enrolled or supported, jumping directly to PIN fallback.');
      setShowPinFallback(true);
      return;
    }

    setIsProcessing(true);
    try {
      console.log('[DEBUG] Triggering biometric for approval...');
      const webauthnResp = await authenticateBiometric(biometricCredentialId, pairingData.pairing_nonce);
      await finishUnlockApproval(pairingData.pairing_nonce, pairingData.desktop_public_key, webauthnResp);
      console.log('[DEBUG] handleApproveUnlock: Biometric handshake completed.');
    } catch (err: any) {
      console.warn('[DEBUG] Biometric auth failed or cancelled, showing PIN fallback:', err);
      setShowPinFallback(true);
      setBiometricPending(false);
    } finally {
      setIsProcessing(false);
    }
  };
```

6. **Implement `handleSecuritySetupSkipBiometric` for optional onboarding:**
```typescript
  const handleSecuritySetupSkipBiometric = async () => {
    setIsProcessing(true);
    try {
      if (!tempPin) throw new Error('PIN setup missing.');
      
      const salt = crypto.generateRandomSalt();
      const saltB64 = crypto.uint8ArrayToBase64(salt);
      const pinHash = await crypto.hashPin(tempPin, salt);
      
      await db.savePinHash(pinHash, saltB64);
      
      if (tempDecoyPin) {
        const decoyHash = await crypto.hashPin(tempDecoyPin, salt);
        await db.saveDecoyPinHash(decoyHash);
      }
      
      await db.setBiometricsEnabled(false);
      await db.setBiometricCredentialId('');
      await db.setBiometricPublicKey('');
      
      setBiometricsEnabled(false);
      setBiometricCredentialId(null);
      
      setState('main');
      setIsAppLocked(false);
      alert('Security Setup Complete! Vault configured with PIN protection.');
    } catch (err: any) {
      alert(`Setup failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };
```

7. **Implement `handleConfirmPairing` to split scanning and WebAuthn enrollment:**
```typescript
  const handleConfirmPairing = async (enableBio: boolean) => {
    if (!pendingPairing) return;
    setIsProcessing(true);
    try {
      const { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce } = pendingPairing;
      const identityPriv = await db.getIdentityPrivateKey();
      const xPriv = await db.getXPrivateKey();
      
      if (!identityPK || !identityPriv || !xPriv) {
        throw new Error('Local security identity not found. Please regenerate identity in Settings.');
      }

      let biometricData = null;
      if (enableBio) {
        biometricData = await registerBiometric('User');
        if (biometricData) {
          await db.setBiometricCredentialId(biometricData.id);
          await db.setBiometricPublicKey(biometricData.publicKey);
          await db.setBiometricsEnabled(true);
          setBiometricsEnabled(true);
          setBiometricCredentialId(biometricData.id);
        } else {
          throw new Error('Biometric registration failed.');
        }
      } else {
        await db.setBiometricsEnabled(false);
        setBiometricsEnabled(false);
        setBiometricCredentialId(null);
      }

      const signature = await crypto.signData(identityPriv, pairing_nonce);
      const result = await pairDevice(
        backend_url,
        desktop_public_key,
        identityPK,
        crypto.uint8ArrayToBase64(crypto.x25519.getPublicKey(crypto.base64ToUint8Array(xPriv))),
        pairing_nonce,
        signature,
        biometricData?.id,
        biometricData?.publicKey
      );

      const newPairingData: PairingData = {
        backend_url,
        desktop_public_key,
        desktop_x_public_key,
        pairing_nonce,
      };

      await db.savePairingData(newPairingData);
      setPairingData(newPairingData);
      setVaultStatus('Locked');
      
      if (result.encrypted_master_key) {
        const masterKey = await crypto.decryptMasterKey(result.encrypted_master_key, xPriv);
        await db.saveMasterKey(masterKey);
      }
      
      setPendingPairing(null);
      alert('Pairing complete!');
    } catch (err: any) {
      alert(`Pairing failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };
```

8. **Update Lock Screen rendering to handle PIN-only state natively:**
```typescript
  if (isAppLocked) {
    const forcePinOnly = !isWebAuthnSupported || !biometricsEnabled;
    
    if (forcePinOnly || showPinFallback) {
      return (
        <PinPad 
          title="Verify PIN"
          subtitle={forcePinOnly ? "Biometrics unavailable. Enter PIN to unlock." : "Please enter your security PIN."}
          onComplete={handleAppLockPin}
          onCancel={forcePinOnly ? undefined : () => setShowPinFallback(false)}
        />
      );
    }

    return (
      <div className="min-h-screen bg-background text-text-primary flex flex-col items-center justify-center p-8 transition-all duration-700">
        {/* Cinematic Lock Screen */}
      </div>
    );
  }
```

### 4.3 Recommendations for `vault-web-auth/src/screens/Settings.tsx`
1. **Pass `biometricsEnabled` and a set handler as props or let settings manage its local state and sync it.**
2. **Implement toggle and remove capability:**
```typescript
  const handleRemoveBiometrics = async () => {
    if (confirm('Are you sure you want to disable biometrics? You will need to enter your PIN to approve requests.')) {
      setIsRegistering(true);
      try {
        await db.setBiometricsEnabled(false);
        await db.setBiometricCredentialId('');
        await db.setBiometricPublicKey('');
        
        // Notify backend of the biometric removal
        const identityPK = await db.getIdentityPublicKey();
        const pairingData = await db.getPairingData();
        if (identityPK && pairingData) {
          await fetch(`${pairingData.backend_url}/api/web/register-webauthn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mobile_public_key: identityPK,
              webauthn_id: null,
              webauthn_pubkey: null,
            }),
          });
        }
        
        setBiometricsEnabled(false);
        alert('Biometrics successfully removed.');
      } catch (err: any) {
        alert(`Failed to remove biometrics: ${err.message}`);
      } finally {
        setIsRegistering(false);
      }
    }
  };
```

3. **Update section configuration to reflect the toggle/remove action:**
```typescript
    {
      title: 'Biometrics',
      items: [
        { 
          label: biometricsEnabled ? 'Identity Enrolled' : 'Not Enrolled', 
          icon: Fingerprint, 
          color: 'text-neon-cyan',
          isButton: true,
          action: biometricsEnabled ? handleRemoveBiometrics : handleRegisterBiometrics,
          buttonText: biometricsEnabled ? 'Remove' : 'Enroll'
        },
        ...(biometricsEnabled ? [{
          label: 'Update Biometrics',
          icon: Fingerprint,
          color: 'text-neon-cyan/50',
          isButton: true,
          action: handleRegisterBiometrics,
          buttonText: 'Update'
        }] : [])
      ]
    }
```

---

## Section 5: Mobile Testing Guidelines (TESTING_MOBILE.md)
*Note: A complete testing guidelines documentation file has been successfully written and placed at `vault-web-auth/TESTING_MOBILE.md`.*

The guidelines cover:
1. **Secure Context & Hostname Constraints**: Technical details on why standard IP address links fail WebAuthn.
2. **Workflows**:
   - **Ngrok Tunneling** for physical iOS & Android testing.
   - **Android Chrome Port Forwarding** via USB.
   - **iOS Simulator** configurations using macOS Safari inspector.
3. **Step-by-Step Test Cases** for:
   - Onboarding and skippable biometrics.
   - Pairing with biometrics vs. PIN-only.
   - Safari user gesture preservation checks.
   - Failure and lock-screen fallback testing.
