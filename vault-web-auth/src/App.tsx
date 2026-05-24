import { useState, useEffect, useCallback } from 'react';
import { 
  Shield, 
  RefreshCw,
  Fingerprint,
} from 'lucide-react';
import { Scanner } from './components/Scanner';
import { BiometricPrompt } from './components/BiometricPrompt';
import { FloatingNavBar } from './components/FloatingNavBar';
import { PinPad } from './components/PinPad';
import { Dashboard } from './screens/Dashboard';
import { ShieldScreen } from './screens/Shield';
import { ActivityScreen } from './screens/Activity';
import { SettingsScreen } from './screens/Settings';
import { db, type PairingData } from './lib/db';
import * as crypto from './lib/crypto';
import { pairDevice, sendUnlockApproval } from './services/api';
import { useWebSocket } from './hooks/useWebSocket';
import { useWebAuthn } from './hooks/useWebAuthn';

type AppState = 'loading' | 'onboarding' | 'security-setup' | 'main' | 'pairing';

function App() {
  const [state, setState] = useState<AppState>('loading');
  const [activeTab, setActiveTab] = useState('vault');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [identityPK, setIdentityPK] = useState<string | null>(null);
  const [pairingData, setPairingData] = useState<PairingData | null>(null);
  
  // App Lock State (Mirrors 'isAppLocked' in native)
  const [isAppLocked, setIsAppLocked] = useState(true);
  const [showPinFallback, setShowPinFallback] = useState(false);
  const [biometricPending, setBiometricPending] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState<string>('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [vaultStatus, setVaultStatus] = useState<'Locked' | 'Unlocked' | 'Unpaired'>('Unpaired');
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  
  // Setup state (Mirrors 'showSetup' and 'setupPin' in native)
  const [setupStep, setSetupStep] = useState<'pin' | 'decoy_pin' | 'biometric'>('pin');
  const [tempPin, setTempPin] = useState<string | null>(null);
  const [tempDecoyPin, setTempDecoyPin] = useState<string | null>(null);

  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkTheme]);

  const { isConnected, lastMessage } = useWebSocket(
    pairingData?.backend_url || null,
    identityPK
  );

  const { authenticateBiometric, registerBiometric } = useWebAuthn();

  useEffect(() => {
    async function init() {
      const pk = await db.getIdentityPublicKey();
      const pin = await db.getPinHash();
      const pd = await db.getPairingData();
      
      setIdentityPK(pk);
      setPairingData(pd);

      if (!pk) {
        setState('onboarding');
        // NATIVE MIRROR: Generate identity key pair immediately on launch/onboarding start
        (async () => {
          try {
            const { publicKey, privateKey } = await crypto.generateIdentity();
            const { privateKey: xPriv } = crypto.generateX25519KeyPair();
            const pkB64 = await crypto.exportPublicKey(publicKey);
            const xPrivB64 = crypto.uint8ArrayToBase64(xPriv);
            await db.saveIdentity(pkB64, privateKey);
            await db.saveXPrivateKey(xPrivB64);
            setIdentityPK(pkB64);
            console.log('Hardware identity generated on launch.');
          } catch (e) {
            console.error('Initial identity generation failed', e);
          }
        })();
      } else if (!pin) {
        setState('security-setup');
      } else {
        setState('main');
        setVaultStatus(pd ? 'Locked' : 'Unpaired');
        // Initial state is LOCKED until user biometric/PINs in
        setIsAppLocked(true);
      }
    }
    init();
  }, []);

  const finishUnlockApproval = useCallback(async (nonce: string, desktopPK: string) => {
    const masterKey = await db.getMasterKey();
    const identityPriv = await db.getIdentityPrivateKey();
    if (!masterKey || !identityPriv || !pairingData) throw new Error('Missing keys');

    const encryptedBlob = await crypto.encryptForDesktop(masterKey, pairingData.desktop_x_public_key);
    const signature = await crypto.signData(identityPriv, nonce);

    await sendUnlockApproval(
      pairingData.backend_url,
      desktopPK,
      identityPK!,
      nonce,
      signature,
      encryptedBlob
    );

    setBiometricPending(false);
    setVaultStatus('Unlocked');
  }, [pairingData, identityPK]);

  useEffect(() => {
    if (!lastMessage) return;

    async function handleMessage() {
      // 1. WAKE_UP_BIOMETRIC: Remote trigger for biometric approval (Magic Unlock)
      if (lastMessage === 'WAKE_UP_BIOMETRIC' && pairingData) {
        setBiometricPending(true);
        // NATIVE MIRROR: On web, we CANNOT trigger biometric immediately from a socket message 
        // as it requires a direct user gesture. We show the prompt and wait for user click.
        console.log('Magic Unlock requested. Waiting for user gesture...');
        return;
      }

      // 2. MASTER KEY PUSH: SETUP FLOW
      if (typeof lastMessage === 'string' && lastMessage.length > 50) {
        try {
          const xPriv = await db.getXPrivateKey();
          if (xPriv) {
            const masterKey = await crypto.decryptMasterKey(lastMessage, xPriv);
            await db.saveMasterKey(masterKey);
            // After receiving key, move to security setup (PIN + Biometric enrollment)
            setState('security-setup');
            console.log('Master key received and saved. Moving to security setup.');
          }
        } catch (err) {
          console.error('Failed to decrypt pushed master key', err);
        }
      }

      // 3. STATUS SYNC
      if (typeof lastMessage === 'object') {
        const msg = lastMessage as any;
        if (msg.action === 'VAULT_STATUS_CHANGE') {
          setVaultStatus(msg.status);
        }
      }
    }

    handleMessage();
  }, [lastMessage, pairingData]);

  const handleOnboardingNext = async () => {
    if (onboardingStep < 2) {
      setOnboardingStep(onboardingStep + 1);
    } else {
      // Identity is already generated in init() or onboarding start.
      // Move to main and wait for pairing to trigger security setup.
      setState('main');
      setVaultStatus('Unpaired');
    }
  };

  const handleSecuritySetupPin = async (pin: string) => {
    setTempPin(pin);
    setSetupStep('decoy_pin');
  };

  const handleSecuritySetupDecoyPin = async (pin: string) => {
    setTempDecoyPin(pin);
    setSetupStep('biometric');
  };

  const handleSecuritySetupSkipDecoy = () => {
    setSetupStep('biometric');
  };

  const handleSecuritySetupBiometric = async () => {
    setIsProcessing(true);
    console.log('[DEBUG] Starting handleSecuritySetupBiometric');
    try {
      if (!tempPin) {
        console.error('[DEBUG] tempPin is missing during biometric enrollment');
        throw new Error('PIN setup missing. Please restart setup.');
      }
      
      // Mandatory Enrollment
      console.log('[DEBUG] Starting mandatory biometric enrollment...');
      const credentialId = await registerBiometric('User');
      
      if (!credentialId) {
        throw new Error('Biometric registration failed to return a credential.');
      }

      console.log('[DEBUG] Saving biometric settings...');
      await db.setBiometricCredentialId(credentialId);
      await db.setBiometricsEnabled(true);
      console.log('[DEBUG] Biometric settings saved with ID:', credentialId);

      // Save PIN Hash using Salt + SHA-256 (Native Mirror)
      console.log('[DEBUG] Calculating and saving PIN hash...');
      const salt = crypto.generateRandomSalt();
      const saltB64 = crypto.uint8ArrayToBase64(salt);
      const pinHash = await crypto.hashPin(tempPin, salt);
      
      await db.savePinHash(pinHash, saltB64);
      console.log('[DEBUG] PIN hash and salt saved successfully');

      if (tempDecoyPin) {
        console.log('[DEBUG] Saving decoy PIN hash...');
        const decoyHash = await crypto.hashPin(tempDecoyPin, salt);
        await db.saveDecoyPinHash(decoyHash);
        console.log('[DEBUG] Decoy PIN saved');
      }

      // FINAL VERIFICATION before moving to main
      const verifyHash = await db.getPinHash();
      const verifySalt = await db.getPinSalt();
      if (!verifyHash || !verifySalt) {
        throw new Error('Persistence check failed: PIN hash/salt missing after save');
      }

      console.log('[DEBUG] Security setup verified in DB. Finishing...');
      setState('main');
      setIsAppLocked(false);
      
      alert('Security Setup Complete! Biometrics and PIN are now active.');
    } catch (err: any) {
      console.error('[DEBUG] Security setup failed', err);
      alert(`Security setup failed: ${err.message || 'Unknown error'}. Biometrics are required.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScan = async (decodedText: string) => {
    console.log('Scanner detected text:', decodedText);
    setState('main');
    setIsProcessing(true);
    try {
      const payload = JSON.parse(decodedText);
      const { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce } = payload;
      
      const identityPriv = await db.getIdentityPrivateKey();
      const xPriv = await db.getXPrivateKey();
      
      if (!identityPK || !identityPriv || !xPriv) throw new Error('Identity not found');

      const signature = await crypto.signData(identityPriv, pairing_nonce);
      
      // Native calls 'pairWithDesktop' which uses WebSocket to receive master key
      await pairDevice(
        backend_url,
        desktop_public_key,
        identityPK,
        crypto.uint8ArrayToBase64(crypto.x25519.getPublicKey(crypto.base64ToUint8Array(xPriv))),
        pairing_nonce,
        signature
      );

      setPairingData({
        backend_url,
        desktop_public_key,
        desktop_x_public_key,
        pairing_nonce,
      });
      
      // We stay in 'main' and wait for WebSocket to push the master key, 
      // which will then trigger state transition to 'security-setup'.
    } catch (err: any) {
      console.error('Pairing failed:', err);
      alert(`Pairing failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAppLockUnlock = async () => {
    const biometricsReady = await db.isBiometricsEnabled();
    const credentialId = await db.getBiometricCredentialId();
    
    console.log('[DEBUG] Unlock check:', { biometricsReady, hasCredential: !!credentialId });

    // NATIVE MIRROR: If biometrics aren't ready, we don't even try - go straight to PIN.
    if (!biometricsReady || !credentialId) {
      const reason = !biometricsReady ? 'Biometrics disabled in DB' : 'Credential ID missing';
      console.log(`[DEBUG] Biometrics not enrolled (${reason}). Switching to PIN pad.`);
      setBiometricStatus(`Biometrics Unavailable: ${reason}`);
      setShowPinFallback(true);
      return;
    }

    setBiometricStatus('Waiting for Biometric Prompt...');
    setIsProcessing(true);
    try {
      // Direct, targeted call using the saved credentialId
      console.log('[DEBUG] Triggering authenticateBiometric with ID:', credentialId);
      await authenticateBiometric(credentialId);
      setIsAppLocked(false);
      setShowPinFallback(false);
      setBiometricStatus('');
    } catch (err: any) {
      console.error('[DEBUG] App lock biometric failed:', err);
      setBiometricStatus(`Biometric Failed: ${err.message || 'Unknown'}`);
      // Fallback instantly if cancelled or errored
      setShowPinFallback(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAppLockPin = async (pin: string) => {
    setIsProcessing(true);
    console.log('[DEBUG] handleAppLockPin triggered');
    try {
      const storedHash = await db.getPinHash();
      const saltB64 = await db.getPinSalt();
      
      console.log('[DEBUG] PIN Verification State:', {
        hasStoredHash: !!storedHash,
        storedHashLength: storedHash?.length,
        hasSalt: !!saltB64,
        saltB64: saltB64 // Explicitly log salt for debugging persistence
      });

      if (!storedHash || !saltB64) {
        console.error('[DEBUG] Security state invalid - missing hash or salt');
        alert('security state invalid. please reset all data');
        return;
      }
      
      const salt = crypto.base64ToUint8Array(saltB64);
      const pinHash = await crypto.hashPin(pin, salt);
      
      if (pinHash === storedHash) {
        console.log('[DEBUG] PIN matches stored hash');
        setIsAppLocked(false);
        setShowPinFallback(false);
      } else {
        const decoyHash = await db.getDecoyPinHash();
        console.log('[DEBUG] PIN mismatch, checking decoy');
        if (decoyHash && pinHash === decoyHash) {
          console.warn('[DEBUG] DECOY PIN ENTERED');
          setIsAppLocked(false);
          setShowPinFallback(false);
        } else {
          alert('Invalid PIN');
        }
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveUnlock = async () => {
    if (!pairingData || !identityPK) return;
    
    const biometricsReady = await db.isBiometricsEnabled();
    const credentialId = await db.getBiometricCredentialId();

    console.log('[DEBUG] Approve Unlock check:', { biometricsReady, hasCredential: !!credentialId });

    if (!biometricsReady || !credentialId) {
      console.log('[DEBUG] Biometrics not enrolled, jumping directly to PIN fallback.');
      setShowPinFallback(true);
      return;
    }

    setIsProcessing(true);
    try {
      console.log('[DEBUG] Triggering biometric for approval...');
      await authenticateBiometric(credentialId);
      await finishUnlockApproval(pairingData.pairing_nonce, pairingData.desktop_public_key);
    } catch (err: any) {
      console.warn('[DEBUG] Biometric auth failed, showing PIN fallback:', err);
      setShowPinFallback(true);
      setBiometricPending(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const showBiometricDebug = async () => {
    const enabled = await db.isBiometricsEnabled();
    const credId = await db.getBiometricCredentialId();
    const hasPin = !!(await db.getPinHash());
    const hasSalt = !!(await db.getPinSalt());
    
    alert(`BIOMETRIC DEBUG:\nEnabled: ${enabled}\nCredID: ${credId ? (credId.substring(0, 10) + '...') : 'NULL'}\nHas PIN: ${hasPin}\nHas Salt: ${hasSalt}`);
  };

  const handlePinUnlockHandshake = async (pin: string) => {
    if (!pairingData) return;
    setIsProcessing(true);
    try {
      const storedHash = await db.getPinHash();
      const saltB64 = await db.getPinSalt();
      if (!storedHash || !saltB64) throw new Error('Security setup incomplete');
      
      const salt = crypto.base64ToUint8Array(saltB64);
      const pinHash = await crypto.hashPin(pin, salt);

      let isAuthorized = pinHash === storedHash;
      if (!isAuthorized) {
        const decoyHash = await db.getDecoyPinHash();
        if (decoyHash && pinHash === decoyHash) {
          isAuthorized = true;
          console.warn('DECOY PIN ENTERED');
        }
      }

      if (isAuthorized) {
        await finishUnlockApproval(pairingData.pairing_nonce, pairingData.desktop_public_key);
        setShowPinFallback(false);
      } else {
        alert('Invalid PIN. Please try again.');
      }
    } catch (err: any) {
      console.error('PIN unlock failed', err);
      alert(`Unlock failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (state === 'loading') return null;

  if (state === 'onboarding') {
    return (
      <div className="min-h-screen bg-background text-text-primary flex flex-col p-8 font-sans transition-all duration-500">
        <div className="flex-1 flex flex-col items-center justify-center space-y-12">
          {onboardingStep === 0 && (
            <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="relative inline-block">
                <div className="absolute -inset-4 bg-neon-cyan/20 rounded-full blur-3xl"></div>
                <Shield size={100} className="relative text-neon-cyan" />
              </div>
              <div className="space-y-4">
                <h1 className="text-4xl font-black tracking-tight">Privacy First.</h1>
                <p className="text-text-secondary text-lg max-w-xs mx-auto">Your encryption keys never leave your device. Fully hardware-backed security.</p>
              </div>
            </div>
          )}

          {onboardingStep === 1 && (
            <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="flex justify-center gap-4">
                <div className="p-6 glass rounded-3xl border border-border-subtle flex flex-col items-center space-y-2">
                  <Shield size={32} className="text-neon-cyan" />
                  <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Mobile</span>
                </div>
                <div className="p-6 glass rounded-3xl border border-border-subtle flex flex-col items-center space-y-2">
                  <Shield size={32} className="text-neon-cyan/40" />
                  <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Desktop</span>
                </div>
              </div>
              <div className="space-y-4">
                <h1 className="text-4xl font-black tracking-tight">Magic Pairing.</h1>
                <p className="text-text-secondary text-lg max-w-xs mx-auto">Scan a QR code on your workstation to securely link your devices in seconds.</p>
              </div>
            </div>
          )}

          {onboardingStep === 2 && (
            <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="relative inline-block">
                <div className="absolute -inset-4 bg-neon-cyan/20 rounded-full blur-3xl"></div>
                <RefreshCw size={100} className="relative text-neon-cyan animate-[spin_3s_linear_infinite]" />
              </div>
              <div className="space-y-4">
                <h1 className="text-4xl font-black tracking-tight">Identity.</h1>
                <p className="text-text-secondary text-lg max-w-xs mx-auto">Generate your unique cryptographic identity. Protected by your biometrics.</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="flex justify-center space-x-2">
            {[0, 1, 2].map(i => (
              <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${onboardingStep === i ? 'w-8 bg-neon-cyan shadow-[0_0_8px_rgba(0,243,255,0.5)]' : 'w-2 bg-text-secondary/20'}`}></div>
            ))}
          </div>
          
          <button 
            onClick={handleOnboardingNext}
            disabled={isProcessing}
            className="w-full bg-neon-cyan text-black h-16 rounded-3xl font-black text-lg shadow-neon-glow active:scale-95 transition-all flex items-center justify-center space-x-2"
          >
            {isProcessing ? (
              <RefreshCw className="animate-spin" />
            ) : (
              <span>{onboardingStep === 2 ? 'Generate Identity' : 'Continue'}</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'security-setup') {
    if (setupStep === 'pin') {
      return (
        <PinPad 
          title="Security PIN"
          subtitle="Set a 5-digit PIN for secure recovery access."
          onComplete={handleSecuritySetupPin}
        />
      );
    }
    
    if (setupStep === 'decoy_pin') {
      return (
        <PinPad 
          title="Decoy PIN (Optional)"
          subtitle="Set a 5-digit decoy PIN to open a fake vault under duress, or skip."
          onComplete={handleSecuritySetupDecoyPin}
          onCancel={handleSecuritySetupSkipDecoy}
        />
      );
    }

    return (
      <div className="min-h-screen bg-background text-text-primary flex flex-col p-8 font-sans animate-in fade-in duration-500">
        <div className="flex-1 flex flex-col items-center justify-center space-y-12">
          <div className="text-center space-y-6">
            <div className="relative inline-block">
              <div className="absolute -inset-4 bg-neon-cyan/20 rounded-full blur-3xl"></div>
              <Fingerprint size={100} className="relative text-neon-cyan animate-pulse" />
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-black tracking-tight uppercase">Biometrics.</h1>
              <p className="text-text-secondary text-lg max-w-xs mx-auto">Enable hardware-backed biometric authentication.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <button 
            onClick={handleSecuritySetupBiometric}
            disabled={isProcessing}
            className="w-full bg-neon-cyan text-black h-16 rounded-3xl font-black text-lg shadow-neon-glow active:scale-95 transition-all flex items-center justify-center space-x-2"
          >
            {isProcessing ? <RefreshCw className="animate-spin" /> : <span>Complete Setup</span>}
          </button>
        </div>
      </div>
    );
  }

  // CINEMATIC LOCK SCREEN (Mirrors Native)
  if (isAppLocked) {
    return (
      <div className="min-h-screen bg-background text-text-primary flex flex-col items-center justify-center p-8 transition-all duration-700">
        <div className="flex flex-col items-center text-center space-y-12">
          <div className="relative">
             <div className="absolute -inset-8 bg-neon-cyan/10 rounded-full blur-3xl animate-pulse" />
             <Fingerprint size={120} className="text-neon-cyan relative" strokeWidth={1} />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-3xl font-black tracking-tight uppercase">Vault Locked</h1>
            <p className="text-text-secondary text-sm font-bold tracking-[0.2em] uppercase opacity-60">Identity Verification Required</p>
            {biometricStatus && (
              <p className="text-neon-cyan text-[10px] font-black uppercase tracking-widest animate-pulse mt-4 bg-neon-cyan/5 py-2 px-4 rounded-full border border-neon-cyan/20">
                {biometricStatus}
              </p>
            )}
          </div>

          <div className="flex flex-col w-full gap-3">
            <button 
              onClick={handleAppLockUnlock}
              disabled={isProcessing}
              className="w-full py-5 bg-neon-cyan text-black rounded-full font-black uppercase tracking-widest shadow-neon-glow active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              <Shield size={20} />
              Unlock Vault
            </button>
            
            <button 
              onClick={() => setShowPinFallback(true)}
              className="w-full py-4 text-text-secondary font-bold text-[10px] uppercase tracking-[0.2em] hover:text-text-primary transition-colors"
            >
              Or Use Security PIN
            </button>

            <button 
              onClick={showBiometricDebug}
              className="mt-4 px-4 py-2 border border-neon-cyan/20 rounded-full text-[8px] font-bold text-neon-cyan/40 uppercase tracking-widest hover:bg-neon-cyan/5 transition-all"
            >
              Biometric Debug
            </button>
          </div>
        </div>

        {showPinFallback && (
          <PinPad 
            title="Verify PIN"
            subtitle="Please enter your security PIN."
            onComplete={handleAppLockPin}
            onCancel={() => setShowPinFallback(false)}
          />
        )}

        <div className="absolute bottom-12 text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] opacity-40">
           Hardware Encrypted Node v1.2
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans flex flex-col overflow-hidden transition-colors duration-300">
      <div className="flex-1 flex flex-col overflow-y-auto pb-32">
        {activeTab === 'vault' && (
          <Dashboard 
            status={vaultStatus}
            isConnected={isConnected}
            onUnlock={() => {
              if (pairingData) {
                // Magic Unlock handshake
                handleApproveUnlock();
              } else {
                setState('pairing');
              }
            }}
            onPair={() => setState('pairing')}
            onClear={() => {
              if (confirm('Permanently wipe all security keys and identity?')) {
                db.clearAll().then(() => window.location.reload());
              }
            }}
            loading={isProcessing}
          />
        )}
        {activeTab === 'shield' && <ShieldScreen />}
        {activeTab === 'activity' && <ActivityScreen />}
        {activeTab === 'settings' && (
          <SettingsScreen 
            isDarkTheme={isDarkTheme}
            onThemeToggle={() => setIsDarkTheme(!isDarkTheme)}
          />
        )}
        {activeTab === 'devices' && (
          <div className="flex-1 p-6 space-y-8 animate-in fade-in duration-500">
            <header className="pt-4">
              <h1 className="text-3xl font-black tracking-tight uppercase">Devices</h1>
              <p className="text-text-secondary text-sm">Manage paired workstations.</p>
            </header>
            <div className="glass rounded-[32px] p-6 border border-border-subtle">
              <p className="text-text-secondary text-center italic py-8">No secondary devices paired.</p>
            </div>
          </div>
        )}
      </div>

      <FloatingNavBar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Overlays */}
      {state === 'pairing' && (
        <Scanner 
          onScan={handleScan}
          onClose={() => setState('main')}
        />
      )}

      {biometricPending && (
        <BiometricPrompt 
          onApprove={handleApproveUnlock}
          onDeny={() => {
            setBiometricPending(false);
            setShowPinFallback(true);
          }}
          onPinFallback={() => {
            setBiometricPending(false);
            setShowPinFallback(true);
          }}
          loading={isProcessing}
        />
      )}

      {showPinFallback && !isAppLocked && (
        <PinPad 
          title="Verify PIN"
          subtitle="Hardware Identity Verification required."
          onComplete={handlePinUnlockHandshake}
          onCancel={() => setShowPinFallback(false)}
          loading={isProcessing}
        />
      )}

      {isProcessing && !biometricPending && !showPinFallback && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass border border-border-subtle p-8 rounded-[40px] flex flex-col items-center space-y-4">
            <div className="relative">
              <div className="absolute inset-0 bg-neon-cyan/20 rounded-full blur-xl animate-pulse" />
              <RefreshCw className="text-neon-cyan animate-spin relative" size={40} />
            </div>
            <p className="text-sm font-black tracking-[0.2em] uppercase text-text-secondary">Securing...</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
