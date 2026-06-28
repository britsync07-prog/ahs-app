# Codebase Analysis Report: Mobile WebAuthn & PIN Fallback

**Authors**: Explorer 2 (teamwork_preview_explorer)  
**Location**: `G:\ahs\ahs-app\.agents\explorer_m1_2\analysis.md`  
**Target Subsystem**: `vault-web-auth`  

---

## 1. Executive Summary

This report presents a read-only architectural investigation and recommended resolution strategy for three core requirements in the Web Authentication Node of the Zero-Knowledge Biometric Vault (`vault-web-auth`):
- **R1**: iOS/Safari WebAuthn Compatibility (strict user gesture preservation, secure context enforcement, and Relying Party IP constraints).
- **R2**: Seamless PIN Fallback (biometric cancel/failure handling, automatic lock screen PIN pad default, and backend relay signature fallback).
- **R3**: Optional / Skippable Biometric Enrollment (bypass biometrics during onboarding setup, pairing flows, and settings toggle switches).

A critical finding reveals that the current implementation of WebAuthn triggers is highly prone to failing in Safari due to intermediate `await` calls to IndexedDB (Dexie) within click handlers, which invalidates Safari's strict user activation check. We recommend cache-syncing biometric settings to React state on load to ensure completely synchronous WebAuthn calls inside click event loops.

---

## 2. Codebase Investigation Summary

### 2.1 File Analysis

#### `PROJECT.md`
- Defines the architecture, database schema, interface contract, and layout.
- The interface contract specifies `checkWebAuthnSupport(): () => Promise<{ supported: boolean, reason?: string, message?: string }>`, which evaluates secure context, browser capabilities, raw IP address constraints, and platform authenticator presence.
- Current status: `checkWebAuthnSupport` is defined in the contract but **not yet implemented** in `useWebAuthn.ts`.

#### `vault-web-auth/src/hooks/useWebAuthn.ts`
- Encapsulates biometric registration/authentication using `@simplewebauthn/browser`.
- Leverages local-first challenge and user ID generation.
- Binds Relying Party ID (`rp.id` / `rpId`) dynamically to `window.location.hostname`.
- Vulnerability: `window.location.hostname` returns raw IP addresses if accessed via local dev network (e.g. `192.168.x.x`), which throws a WebAuthn `SecurityError` during invocation.

#### `vault-web-auth/src/App.tsx`
- Controls state machine (`loading` -> `onboarding` -> `security-setup` -> `main`), device pairing, and app lock screens.
- Triggers biometric registration synchronously during security setup, but makes it **mandatory**; failing or canceling biometric registration halts progress and throws an alert.
- Triggers biometric registration during QR-scanning in `handleScan` callback. This callback executes inside the QR library's frame loop, meaning it is **not within a user gesture context**. This throws a `NotAllowedError` in Safari/iOS.
- Queries Dexie DB asynchronously inside the click handlers `handleApproveUnlock` and `handleAppLockUnlock` before triggering `authenticateBiometric`. The intermediate microtask yields reset Safari's user activation state, causing silent WebAuthn blocks.

#### `vault-web-auth/src/screens/Settings.tsx`
- Renders General, Security, and Biometrics settings.
- Currently, the "Biometrics" section only shows enrollment status and lacks the ability to temporarily disable/enable biometrics without wiping the entire application data.

---

## 3. Resolution Strategies

### 3.1 R1: iOS/Safari WebAuthn Compatibility

#### Strict User Activation Gestures
Safari requires that FIDO2 APIs (`navigator.credentials.create` and `navigator.credentials.get`) are invoked in the direct synchronous call stack of a user click. The current code violates this in two places:
1. **Asynchronous DB lookups in click handlers**: In `handleApproveUnlock` and `handleAppLockUnlock`, the code calls `await db.isBiometricsEnabled()` and `await db.getBiometricCredentialId()` before calling the WebAuthn hook.
   - *Strategy*: Pre-load these security parameters from Dexie into React component state variables during app boot and setting changes. When the click occurs, access them synchronously from state and call the WebAuthn API instantly.
2. **Asynchronous execution in scan callbacks**: In `handleScan`, biometrics registration is triggered automatically from the camera's decoding thread.
   - *Strategy*: Defer the pairing and biometric registration step. Introduce a **Pairing Confirmation Screen** overlay containing "Enable Biometrics & Pair" and "Use PIN Only & Pair" buttons. This provides a direct, clean user gesture.

#### Secure Context & Hostname Validity
- *Strategy*: Implement `checkWebAuthnSupport()` in `useWebAuthn.ts` to verify `window.isSecureContext === true` and that `window.location.hostname` is not an IP address (using regex `/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/` and checking for IPv6 colons).
- If it fails, report the failure code (`insecure-context` or `ip-address`) and appropriate message, prompting the user to use a local hostname like `macbook.local` (mDNS) or an HTTPS tunnel (e.g., Ngrok).

### 3.2 R2: Seamless PIN Fallback

#### Cancellation & Failure Handling
- If WebAuthn fails (e.g., user cancels the face/fingerprint dialog), catch `NotAllowedError` or cancellation substrings. Instantly open the `<PinPad>` component on top of the screen.

#### Autoprompt Logic (Unsupported/Disabled Biometrics)
- If biometrics are disabled (`biometricsEnabled === false`) or unsupported (`isWebAuthnSupported === false`), the app should bypass the biometric lock screen button.
- *Strategy*: Initialize `showPinFallback(true)` automatically during startup checks if biometrics are unavailable, making the PIN input overlay appear immediately.

#### Cryptographic Signature Fallback
- If the user unlocks using PIN, the WebAuthn response is absent.
- In `finishUnlockApproval`, when `webauthnResponse` is missing, the code falls back to generating an Ed25519 signature using the mobile hardware-identity private key (`identityPriv`). The backend supports this fallback, allowing secure authentication even without biometric hardware keys.

### 3.3 R3: Optional / Skippable Biometric Enrollment

#### Skippable Onboarding (Security Setup)
- Add a "Skip Biometrics (PIN Only)" button on the biometric registration screen.
- Clicking this bypasses `registerBiometric()`, sets `biometrics_enabled` to `false` in Dexie, and completes the setup using the PIN hash alone.

#### Skippable Workstation Pairing
- The new Pairing Confirmation Screen allows the user to choose "Use PIN Only & Pair", which completely bypasses the registration of a new WebAuthn credential for that workstation.

#### Settings Toggle
- Add a toggle switch in `Settings.tsx` named "Use Biometrics for Unlock".
- This allows the user to enable/disable biometric verification on demand. If toggled off, the lock screens will automatically display the PIN pad directly.

---

## 4. Code Change Recommendations

Here are the precise recommended code modifications to resolve the issues (without directly editing the files).

### 4.1 Changes to `vault-web-auth/src/hooks/useWebAuthn.ts`

Insert the `checkWebAuthnSupport` function and export it:

```typescript
// Insert before registerBiometric
const checkWebAuthnSupport = useCallback(async () => {
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'insecure-context',
      message: 'WebAuthn requires a secure context (HTTPS or localhost).',
    };
  }

  if (typeof window.PublicKeyCredential === 'undefined') {
    return {
      supported: false,
      reason: 'unsupported-browser',
      message: 'WebAuthn is not supported by this browser.',
    };
  }

  const hostname = window.location.hostname;
  const isIpAddress = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname) || hostname.includes(':');
  if (isIpAddress) {
    return {
      supported: false,
      reason: 'ip-address',
      message: 'WebAuthn Relying Party ID cannot be a raw IP address. Please use a domain name or local mDNS hostname (e.g., macbook.local).',
    };
  }

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return {
        supported: false,
        reason: 'no-platform-authenticator',
        message: 'No biometric platform authenticator (Touch ID/Face ID) detected.',
      };
    }
  } catch (err: any) {
    return {
      supported: false,
      reason: 'authenticator-check-error',
      message: `Failed to check platform authenticator: ${err.message || err}`,
    };
  }

  return { supported: true };
}, []);

// Expose in return object
return { registerBiometric, authenticateBiometric, checkWebAuthnSupport };
```

### 4.2 Changes to `vault-web-auth/src/App.tsx`

#### A. Add State Caching Variables
```typescript
  // Caching settings in state to preserve iOS user gestures
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricCredentialId, setBiometricCredentialId] = useState<string | null>(null);
  const [isWebAuthnSupported, setIsWebAuthnSupported] = useState<boolean | null>(null);
  
  // Pairing stage gesture gap fix
  const [pendingPairingPayload, setPendingPairingPayload] = useState<any | null>(null);
```

#### B. Cache Values on Boot
Replace the `init()` method (around lines 60-115) to cache biometric settings and perform the support check:
```typescript
    async function init() {
      console.log('[DEBUG] Initializing Secure Vault DB...');
      try {
        await db.robustOpen();
        
        const [pk, pin, salt, pd, bioEnabled, bioCredId] = await Promise.all([
          db.getIdentityPublicKey(),
          db.getPinHash(),
          db.getPinSalt(),
          db.getPairingData(),
          db.isBiometricsEnabled(),
          db.getBiometricCredentialId(),
        ]);
        
        setIdentityPK(pk);
        setPairingData(pd);
        setBiometricsEnabled(bioEnabled);
        setBiometricCredentialId(bioCredId);

        // Perform support check
        const support = await checkWebAuthnSupport();
        setIsWebAuthnSupported(support.supported);

        if (!pk) {
          setState('onboarding');
          // (Asynchronously generate and save identity keys...)
        } else if (!pin || !salt) {
          setState('security-setup');
        } else {
          setState('main');
          setVaultStatus(pd ? 'Locked' : 'Unpaired');
          setIsAppLocked(true);
          
          // Seamless PIN Fallback: default straight to PIN if biometrics are disabled or unsupported
          if (!bioEnabled || !support.supported) {
            setShowPinFallback(true);
          }
        }
      } catch (e: any) {
        console.error('[CRITICAL] DB Initialization failed:', e);
      }
    }
```

#### C. Modify Gestures in Handshake & Lock Triggers
Modify `handleAppLockUnlock` and `handleApproveUnlock` to run synchronously without internal asynchronous DB lookups:
```typescript
  const handleAppLockUnlock = useCallback(async () => {
    // Read directly from cached state (completely synchronous!)
    if (!biometricsEnabled || !biometricCredentialId || !pairingData) {
      console.log('[DEBUG] Biometrics disabled or not enrolled. Showing PIN Pad.');
      setShowPinFallback(true);
      return;
    }

    setBiometricStatus('Waiting for Biometric Prompt...');
    setIsProcessing(true);
    try {
      await authenticateBiometric(biometricCredentialId, pairingData.pairing_nonce);
      setIsAppLocked(false);
      setShowPinFallback(false);
      setBiometricStatus('');
    } catch (err: any) {
      console.error('[DEBUG] App lock biometric failed:', err);
      setBiometricStatus(`Biometric Failed: ${err.message || 'Unknown'}`);
      setShowPinFallback(true); // Seamless fallback
    } finally {
      setIsProcessing(false);
    }
  }, [biometricsEnabled, biometricCredentialId, pairingData, authenticateBiometric]);

  const handleApproveUnlock = useCallback(async () => {
    if (!pairingData || !identityPK) return;
    
    // Read directly from cached state (completely synchronous!)
    if (!biometricsEnabled || !biometricCredentialId) {
      console.log('[DEBUG] Biometrics not enrolled, falling back to PIN.');
      setShowPinFallback(true);
      return;
    }

    setIsProcessing(true);
    try {
      const webauthnResp = await authenticateBiometric(biometricCredentialId, pairingData.pairing_nonce);
      await finishUnlockApproval(pairingData.pairing_nonce, pairingData.desktop_public_key, webauthnResp);
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.message?.includes('cancelled')) {
        console.warn('[DEBUG] Biometric auth cancelled, showing PIN fallback.');
        setShowPinFallback(true);
        setBiometricPending(false);
      } else {
        console.error('[DEBUG] Biometric error:', err);
        setShowPinFallback(true);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [pairingData, identityPK, biometricsEnabled, biometricCredentialId, authenticateBiometric, finishUnlockApproval]);
```

#### D. Implement Skippable Security Setup
Add `handleSecuritySetupSkipBiometric` and update the view to render the skip option:
```typescript
  const handleSecuritySetupSkipBiometric = async () => {
    setIsProcessing(true);
    try {
      if (!tempPin) throw new Error('PIN setup missing. Please restart setup.');

      await db.setBiometricsEnabled(false);
      setBiometricsEnabled(false);
      setBiometricCredentialId(null);

      const salt = crypto.generateRandomSalt();
      const saltB64 = crypto.uint8ArrayToBase64(salt);
      const pinHash = await crypto.hashPin(tempPin, salt);
      await db.savePinHash(pinHash, saltB64);
      
      if (tempDecoyPin) {
        const decoyHash = await crypto.hashPin(tempDecoyPin, salt);
        await db.saveDecoyPinHash(decoyHash);
      }

      setState('main');
      setIsAppLocked(false);
      alert('Security Setup Complete! Protected by PIN.');
    } catch (err: any) {
      alert(`Setup failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };
```

#### E. Defer QR Pairing Scan via Confirmation screen
Modify `handleScan` to cache payload and create the pairing methods:
```typescript
  const handleScan = async (decodedText: string) => {
    try {
      const payload = JSON.parse(decodedText);
      setPendingPairingPayload(payload);
      setState('main');
    } catch (err: any) {
      alert('Invalid QR code format.');
    }
  };

  const handlePairWithBiometrics = async () => {
    if (!pendingPairingPayload) return;
    setIsProcessing(true);
    try {
      const { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce } = pendingPairingPayload;
      const identityPriv = await db.getIdentityPrivateKey();
      const xPriv = await db.getXPrivateKey();
      if (!identityPK || !identityPriv || !xPriv) throw new Error('Identity keys missing.');

      const support = await checkWebAuthnSupport();
      if (!support.supported) throw new Error(support.message);

      const biometricData = await registerBiometric('User');
      if (!biometricData) throw new Error('Failed to generate biometric key.');

      await db.setBiometricCredentialId(biometricData.id);
      await db.setBiometricPublicKey(biometricData.publicKey);
      await db.setBiometricsEnabled(true);
      setBiometricsEnabled(true);
      setBiometricCredentialId(biometricData.id);

      const signature = await crypto.signData(identityPriv, pairing_nonce);
      const result = await pairDevice(
        backend_url,
        desktop_public_key,
        identityPK,
        crypto.uint8ArrayToBase64(crypto.x25519.getPublicKey(crypto.base64ToUint8Array(xPriv))),
        pairing_nonce,
        signature,
        biometricData.id,
        biometricData.publicKey
      );

      const pd = { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce };
      await db.savePairingData(pd);
      setPairingData(pd);
      setVaultStatus('Locked');

      if (result.encrypted_master_key) {
        const masterKey = await crypto.decryptMasterKey(result.encrypted_master_key, xPriv);
        await db.saveMasterKey(masterKey);
      }
      setPendingPairingPayload(null);
      alert('Paired successfully with Biometrics!');
    } catch (err: any) {
      alert(`Pairing failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePairWithPinOnly = async () => {
    if (!pendingPairingPayload) return;
    setIsProcessing(true);
    try {
      const { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce } = pendingPairingPayload;
      const identityPriv = await db.getIdentityPrivateKey();
      const xPriv = await db.getXPrivateKey();
      if (!identityPK || !identityPriv || !xPriv) throw new Error('Identity keys missing.');

      await db.setBiometricsEnabled(false);
      setBiometricsEnabled(false);
      setBiometricCredentialId(null);

      const signature = await crypto.signData(identityPriv, pairing_nonce);
      const result = await pairDevice(
        backend_url,
        desktop_public_key,
        identityPK,
        crypto.uint8ArrayToBase64(crypto.x25519.getPublicKey(crypto.base64ToUint8Array(xPriv))),
        pairing_nonce,
        signature
      );

      const pd = { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce };
      await db.savePairingData(pd);
      setPairingData(pd);
      setVaultStatus('Locked');

      if (result.encrypted_master_key) {
        const masterKey = await crypto.decryptMasterKey(result.encrypted_master_key, xPriv);
        await db.saveMasterKey(masterKey);
      }
      setPendingPairingPayload(null);
      alert('Paired successfully with PIN Only!');
    } catch (err: any) {
      alert(`Pairing failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };
```

Render the new confirmation screen overlay:
```typescript
  {/* Add to the top of component rendering if pendingPairingPayload is set */}
  {pendingPairingPayload && (
    <div className="fixed inset-0 z-[150] bg-background flex flex-col p-8 items-center justify-center space-y-12">
      <div className="text-center space-y-6">
        <div className="relative inline-block">
          <div className="absolute -inset-4 bg-neon-cyan/20 rounded-full blur-3xl" />
          <Shield size={100} className="relative text-neon-cyan animate-pulse" />
        </div>
        <h1 className="text-3xl font-black uppercase">Link Workstation</h1>
        <p className="text-text-secondary text-sm max-w-xs mx-auto">
          Choose a secure verification method to complete device linking.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <button
          onClick={handlePairWithBiometrics}
          disabled={isProcessing}
          className="w-full h-16 bg-neon-cyan text-black rounded-3xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all shadow-neon-glow"
        >
          Enable Biometrics & Pair
        </button>
        <button
          onClick={handlePairWithPinOnly}
          disabled={isProcessing}
          className="w-full h-16 bg-text-secondary/10 text-text-primary rounded-3xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all"
        >
          Use PIN Only & Pair
        </button>
        <button
          onClick={() => setPendingPairingPayload(null)}
          className="w-full text-center text-text-secondary text-xs uppercase tracking-widest font-black"
        >
          Cancel
        </button>
      </div>
    </div>
  )}
```

### 4.3 Changes to `vault-web-auth/src/screens/Settings.tsx`

Add a state for credential presence and render the switch:

```typescript
  const [hasCredential, setHasCredential] = useState(false);

  useEffect(() => {
    Promise.all([
      db.isBiometricsEnabled(),
      db.getBiometricCredentialId(),
    ]).then(([enabled, credId]) => {
      setBiometricsEnabled(enabled);
      setHasCredential(!!credId);
    });
  }, []);

  const handleToggleBiometrics = async () => {
    if (biometricsEnabled) {
      await db.setBiometricsEnabled(false);
      setBiometricsEnabled(false);
    } else {
      if (hasCredential) {
        await db.setBiometricsEnabled(true);
        setBiometricsEnabled(true);
      } else {
        await handleRegisterBiometrics();
      }
    }
  };

  // Sections config:
  {
    title: 'Biometrics',
    items: [
      { 
        label: hasCredential ? 'Biometric Enrollment' : 'Not Enrolled', 
        icon: Fingerprint, 
        color: 'text-neon-cyan',
        isButton: true,
        action: handleRegisterBiometrics,
        buttonText: hasCredential ? 'Re-enroll' : 'Enroll'
      },
      ...(hasCredential ? [{
        label: 'Use Biometrics for Unlock',
        icon: Shield,
        color: 'text-neon-cyan',
        isToggle: true,
        toggled: biometricsEnabled,
        action: handleToggleBiometrics
      }] : [])
    ]
  }
```

---

## 5. Mobile Testing Guidelines & Verification

A draft for testing guidelines has been successfully created and saved to `G:\ahs\ahs-app\vault-web-auth\TESTING_MOBILE.md`. 

### Verification Commands & Methods
1. **Local Server Launch**:
   Run `npm run dev -- --host` inside `vault-web-auth` to start Vite and bind it to the local interface.
2. **Secure Context & Origin Check**:
   Validate via simulator/mobile Safari:
   ```javascript
   console.log('Secure context:', window.isSecureContext);
   console.log('WebAuthn support:', typeof window.PublicKeyCredential !== 'undefined');
   ```
3. **Gesture Preservation Check**:
   In iOS Safari, verify that tapping "Verify Identity" immediately triggers the native Face ID / Touch ID prompt without yielding a console error code `NotAllowedError`.
4. **Verification of PIN Fallback**:
   Cancel the biometric prompt or block camera access. The `<PinPad>` should render instantly. Verify that submitting the 5-digit PIN sends the signature and finishes pairing/unlock.
