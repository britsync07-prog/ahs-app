# Analysis Report: iOS/Safari WebAuthn Compatibility & PIN Fallback

**Summary of Core Findings**:
- **iOS Safari Gesture Loss**: Database reads (`await db...`) placed before the WebAuthn API calls inside click event handlers break the synchronous execution flow. iOS Safari invalidates the user activation token, throwing `NotAllowedError`. Pre-loading database configurations into React state and checking them synchronously in click handlers resolves this.
- **RP ID Constraints**: WebAuthn does not support raw IP address hostnames (e.g. `192.168.1.50`). Attempting to register or authenticate results in browser errors. A check for secure context and IP hostnames is required before execution.
- **Fallback & Skipping**: The app must allow skipping biometric enrollment during security setup, pairing, and settings, defaulting to signing with the device's hardware identity key.

---

## 1. Codebase Analysis (Current State)

### 1.1 `PROJECT.md`
- Specifies the interface contract for `useWebAuthn.ts` which includes `checkWebAuthnSupport()`.
- Currently, `checkWebAuthnSupport()` is **missing** from `useWebAuthn.ts`.

### 1.2 `useWebAuthn.ts`
- Lacks `checkWebAuthnSupport()`.
- Uses `window.location.hostname` directly as the Relaying Party ID (RP ID). This works for domains and `localhost`, but throws `SecurityError` or `TypeError` in browsers if the host is a raw IP address (e.g. when testing on a local network).

### 1.3 `App.tsx`
- **User Gesture Breakage during App Unlock**: `handleAppLockUnlock` (triggered by click) awaits `db.isBiometricsEnabled()`, `db.getBiometricCredentialId()`, and `db.getPairingData()`.
- **User Gesture Breakage during Remote Approval**: `handleApproveUnlock` (triggered by click) awaits `db.isBiometricsEnabled()` and `db.getBiometricCredentialId()`.
- **User Gesture Breakage during Pairing Scan**: `handleScan` (triggered asynchronously by camera QR scanner callback) automatically calls `registerBiometric()`. Because it's not a user gesture context, it fails on iOS Safari.
- **Mandatory Biometrics**: In the security setup screen (`setupStep === 'biometric'`), biometrics enrollment is mandatory, and setup cannot be completed if biometrics fail or are unsupported.

### 1.4 `Settings.tsx`
- Only supports "Enroll" or "Update" for biometrics. There is no mechanism to temporarily disable biometrics, remove the biometric credentials, or handle environments where WebAuthn is unsupported.

---

## 2. Detailed Strategy

### R1: iOS/Safari WebAuthn Compatibility
1. **Implement `checkWebAuthnSupport`**:
   - Check if `window.isSecureContext` is true (WebAuthn requires HTTPS/localhost).
   - Check if `window.PublicKeyCredential` is defined.
   - Detect if `window.location.hostname` is a raw IP address (using a regex check like `/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/` for IPv4). If so, return `supported: false` with reason `ip-address`.
   - Call `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` to check if hardware biometric support (FaceID/TouchID/Windows Hello) is present.
2. **Preserve User Gestures**:
   - Query all IndexedDB security settings (biometrics enabled, credential ID, pairing data) during app initialization (`init()`) or on tab changes, storing them in React state.
   - Ensure click handlers (`handleAppLockUnlock` and `handleApproveUnlock`) check the React state values **synchronously** and immediately initiate WebAuthn without any `await` statements beforehand.
3. **Handle Pairing Biometric Prompt**:
   - Remove automatic biometric enrollment from the QR scanner callback (`handleScan`).
   - If pairing completes successfully, and biometrics are supported, display a clean monochrome modal asking the user if they want to enable Biometric Unlock. Clicking "Enroll Biometrics" in this modal provides the necessary direct user gesture.

### R2: Seamless PIN Fallback
1. **Fallback in Remote Unlock Handshake**:
   - If `authenticateBiometric` fails or is cancelled, display the PIN Pad overlay.
   - If the user enters their PIN, verify it against the stored hash and call `finishUnlockApproval` without passing the WebAuthn response. The mobile app will then fallback to signing the nonce using the device's hardware identity private key (`identityPriv`).
2. **Bypass Biometrics when Disabled**:
   - If biometrics are disabled or unsupported, bypass the biometric prompt on remote unlock requests (`WAKE_UP_BIOMETRIC`) and show the PIN Pad directly.

### R3: Optional/Skippable Biometric Enrollment
1. **Onboarding / Security Setup**:
   - Add a "Skip / PIN Only" button to the biometric enrollment screen. Clicking this hashes and saves the PIN and completes setup with `biometricsEnabled = false`.
2. **Pairing**:
   - Complete pairing with the device's hardware identity key. Provide a post-pairing prompt to enroll biometrics, which can be skipped or closed.
3. **Settings Screen**:
   - Modify the settings screen to show dynamic options based on support and enrollment:
     - **Unsupported**: Show a greyed-out info message stating why biometrics are unsupported (e.g. insecure context, raw IP address).
     - **Not Enrolled**: Show an "Enroll" button.
     - **Enrolled**: Show a "Biometric Unlock" toggle switch, an "Update" button, and a "Remove" button to clear biometric data.

---

## 3. Recommended Code Changes

### 3.1 `vault-web-auth/src/hooks/useWebAuthn.ts`
Add the `checkWebAuthnSupport` function and include it in the return statement:

```typescript
  const checkWebAuthnSupport = useCallback(async () => {
    if (!window.isSecureContext) {
      return { 
        supported: false, 
        reason: 'insecure-context', 
        message: 'WebAuthn requires a secure context (HTTPS or localhost).' 
      };
    }
    if (typeof window.PublicKeyCredential === 'undefined') {
      return { 
        supported: false, 
        reason: 'not-supported', 
        message: 'WebAuthn is not supported on this browser.' 
      };
    }
    const hostname = window.location.hostname;
    const isIPAddress = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname) || (hostname.startsWith('[') && hostname.endsWith(']'));
    if (isIPAddress) {
      return { 
        supported: false, 
        reason: 'ip-address', 
        message: 'WebAuthn does not support raw IP address hostnames. Please access via localhost or a domain name.' 
      };
    }
    try {
      const platformAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!platformAvailable) {
        return { 
          supported: false, 
          reason: 'platform-authenticator-unavailable', 
          message: 'No platform biometric authenticator is available on this device.' 
        };
      }
    } catch (err: any) {
      return { 
        supported: false, 
        reason: 'platform-check-failed', 
        message: `Failed to check platform authenticator availability: ${err.message}` 
      };
    }
    return { supported: true };
  }, []);
```

### 3.2 `vault-web-auth/src/App.tsx`
1. **Add new state variables**:
```typescript
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricCredentialId, setBiometricCredentialId] = useState<string | null>(null);
  const [webauthnSupported, setWebauthnSupported] = useState<boolean | null>(null);
  const [webauthnSupportReason, setWebauthnSupportReason] = useState<string | undefined>(undefined);
  const [showPostPairingBiometricPrompt, setShowPostPairingBiometricPrompt] = useState(false);
```

2. **Update initialization logic (`init()` inside `useEffect`)**:
```typescript
        const [pk, pin, salt, pd, bioEnabled, bioCredId] = await Promise.all([
          db.getIdentityPublicKey(),
          db.getPinHash(),
          db.getPinSalt(),
          db.getPairingData(),
          db.isBiometricsEnabled(),
          db.getBiometricCredentialId()
        ]);
        
        setIdentityPK(pk);
        setPairingData(pd);
        
        const support = await checkWebAuthnSupport();
        setWebauthnSupported(support.supported);
        setWebauthnSupportReason(support.reason);
        
        if (!support.supported) {
          setBiometricsEnabled(false);
          setBiometricCredentialId(null);
        } else {
          setBiometricsEnabled(bioEnabled);
          setBiometricCredentialId(bioCredId);
        }
```

3. **Update click handlers to use preloaded state synchronously**:
```typescript
  const handleAppLockUnlock = async () => {
    // Synchronous checks from state (preserves user gesture)
    if (!webauthnSupported || !biometricsEnabled || !biometricCredentialId || !pairingData) {
      const reason = !webauthnSupported ? 'WebAuthn unsupported' : (!biometricsEnabled ? 'Biometrics disabled' : 'Biometrics not paired');
      console.log(`[DEBUG] Biometrics unavailable: ${reason}. Switching to PIN fallback.`);
      setBiometricStatus(`Biometrics Unavailable: ${reason}`);
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

  const handleApproveUnlock = useCallback(async () => {
    if (!pairingData || !identityPK) return;
    
    // Synchronous check (preserves user gesture)
    if (!webauthnSupported || !biometricsEnabled || !biometricCredentialId) {
      console.log('[DEBUG] Biometrics not enrolled/supported, jumping directly to PIN fallback.');
      setShowPinFallback(true);
      return;
    }

    setIsProcessing(true);
    try {
      console.log('[DEBUG] Triggering biometric for approval...');
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
  }, [pairingData, identityPK, biometricsEnabled, biometricCredentialId, webauthnSupported, authenticateBiometric, finishUnlockApproval]);
```

4. **Update `WAKE_UP_BIOMETRIC` message handler**:
```typescript
      if (lastMessage === 'WAKE_UP_BIOMETRIC' && pairingData) {
        if (webauthnSupported && biometricsEnabled && biometricCredentialId) {
          setBiometricPending(true);
        } else {
          setShowPinFallback(true);
        }
        console.log('Magic Unlock requested. Waiting for user gesture...');
        return;
      }
```

5. **Modify `handleScan` to separate pairing and biometric registration**:
```typescript
  const handleScan = async (decodedText: string) => {
    console.log('Scanner detected text:', decodedText);
    setState('main');
    setIsProcessing(true);
    try {
      let payload;
      try {
        payload = JSON.parse(decodedText);
      } catch (e) {
        throw new Error('Invalid QR code format. Not a valid JSON payload.');
      }

      console.log('Parsed QR payload:', payload);
      const { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce } = payload;
      
      const identityPriv = await db.getIdentityPrivateKey();
      const xPriv = await db.getXPrivateKey();
      
      if (!identityPK || !identityPriv || !xPriv) {
        throw new Error('Local security identity not found. Please regenerate identity in Settings.');
      }

      console.log('Signing pairing request...');
      const signature = await crypto.signData(identityPriv, pairing_nonce);
      
      console.log('Sending pairing request to backend:', backend_url);
      const result = await pairDevice(
        backend_url,
        desktop_public_key,
        identityPK,
        crypto.uint8ArrayToBase64(crypto.x25519.getPublicKey(crypto.base64ToUint8Array(xPriv))),
        pairing_nonce,
        signature,
        undefined, // Skip registering WebAuthn during scan
        undefined
      );

      console.log('Pairing successful result:', result);

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

      // Show post-pairing biometric prompt if supported
      if (webauthnSupported) {
        setShowPostPairingBiometricPrompt(true);
      }
    } catch (err: any) {
      console.error('Pairing failed:', err);
      alert(`Pairing failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };
```

6. **Add `handleSecuritySetupSkipBiometric` and `handleEnableBiometricsPostPairing`**:
```typescript
  const handleSecuritySetupSkipBiometric = async () => {
    setIsProcessing(true);
    try {
      if (!tempPin) throw new Error('PIN setup missing. Please restart setup.');
      await db.setBiometricsEnabled(false);
      
      const salt = crypto.generateRandomSalt();
      const saltB64 = crypto.uint8ArrayToBase64(salt);
      const pinHash = await crypto.hashPin(tempPin, salt);
      await db.savePinHash(pinHash, saltB64);
      
      if (tempDecoyPin) {
        const decoyHash = await crypto.hashPin(tempDecoyPin, salt);
        await db.saveDecoyPinHash(decoyHash);
      }
      
      // Read-back verification
      const [vHash, vSalt] = await Promise.all([db.getPinHash(), db.getPinSalt()]);
      if (!vHash || !vSalt) throw new Error('Device Storage Failure');
      
      setBiometricsEnabled(false);
      setBiometricCredentialId(null);
      setState('main');
      setIsAppLocked(false);
      alert('Security Setup Complete! Protected by PIN.');
    } catch (err: any) {
      alert(`Setup failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEnableBiometricsPostPairing = async () => {
    setIsProcessing(true);
    try {
      const biometricData = await registerBiometric('User');
      if (biometricData) {
        await db.setBiometricCredentialId(biometricData.id);
        await db.setBiometricPublicKey(biometricData.publicKey);
        await db.setBiometricsEnabled(true);
        
        setBiometricsEnabled(true);
        setBiometricCredentialId(biometricData.id);

        if (identityPK && pairingData) {
          await fetch(`${pairingData.backend_url}/api/web/register-webauthn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mobile_public_key: identityPK,
              webauthn_id: biometricData.id,
              webauthn_pubkey: biometricData.publicKey,
            }),
          });
        }
        alert('Biometrics successfully registered!');
      }
    } catch (err: any) {
      alert(`Biometric enrollment failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setShowPostPairingBiometricPrompt(false);
    }
  };
```

### 3.3 `vault-web-auth/src/screens/Settings.tsx`
Modify `SettingsScreen` to support toggling, re-enrolling, and disabling biometrics.

```typescript
// Add new states and load on mount
  const [webauthnSupported, setWebauthnSupported] = useState<boolean | null>(null);
  const [supportReason, setSupportReason] = useState<string>('');
  const [hasBiometricKey, setHasBiometricKey] = useState(false);

  useEffect(() => {
    db.isBiometricsEnabled().then(setBiometricsEnabled);
    db.getBiometricCredentialId().then((id) => setHasBiometricKey(!!id));
    checkWebAuthnSupport().then((support) => {
      setWebauthnSupported(support.supported);
      if (support.reason) setSupportReason(support.reason);
    });
  }, [checkWebAuthnSupport]);
```

Update sections items definition:
```typescript
    {
      title: 'Biometrics',
      items: !webauthnSupported ? [
        {
          label: 'Biometrics Unsupported',
          icon: Fingerprint,
          color: 'text-text-secondary/40',
          isInfo: true,
          infoText: supportReason === 'insecure-context' 
            ? 'Requires HTTPS' 
            : supportReason === 'ip-address' 
            ? 'IP hostnames block WebAuthn' 
            : 'Unsupported'
        }
      ] : hasBiometricKey ? [
        {
          label: 'Biometric Unlock',
          icon: Fingerprint,
          color: 'text-neon-cyan',
          isToggle: true,
          isBiometricToggle: true,
          toggleValue: biometricsEnabled,
          action: async () => {
            const nextVal = !biometricsEnabled;
            await db.setBiometricsEnabled(nextVal);
            setBiometricsEnabled(nextVal);
          }
        },
        {
          label: 'Update Biometric Key',
          icon: Fingerprint,
          color: 'text-neon-cyan',
          isButton: true,
          action: handleRegisterBiometrics,
          buttonText: 'Update'
        },
        {
          label: 'Remove Biometric Key',
          icon: Fingerprint,
          color: 'text-deep-red',
          isButton: true,
          action: async () => {
            if (confirm('Remove biometric key and fallback to PIN?')) {
              await db.setBiometricCredentialId('');
              await db.setBiometricPublicKey('');
              await db.setBiometricsEnabled(false);
              setBiometricsEnabled(false);
              setHasBiometricKey(false);
              alert('Biometric key removed.');
            }
          },
          buttonText: 'Remove'
        }
      ] : [
        {
          label: 'Biometrics Not Enrolled',
          icon: Fingerprint,
          color: 'text-neon-cyan',
          isButton: true,
          action: handleRegisterBiometrics,
          buttonText: 'Enroll'
        }
      ]
    }
```

---

## 4. Testing Guidelines (`TESTING_MOBILE.md`)

A draft of the testing guidelines has been placed in `.agents/explorer_m1_3/proposed_TESTING_MOBILE.md`. The implementer should copy this file to `G:\ahs\ahs-app\vault-web-auth\TESTING_MOBILE.md`.
It covers:
1. Secure Context & Local Network Hosting (HTTPS options using local tunnels vs mkcert).
2. Verifying iOS/Safari User Gesture Preservation.
3. Testing PIN Fallback scenarios (biometrics disabled, user cancels prompt, unsupported environment).
4. Mobile Debugging Tools (Safari Web Inspector on iOS).
