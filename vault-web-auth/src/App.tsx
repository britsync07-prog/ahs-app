import { useState, useEffect } from 'react';
import { 
  Shield, 
  RefreshCw,
} from 'lucide-react';
import { Scanner } from './components/Scanner';
import { BiometricPrompt } from './components/BiometricPrompt';
import { FloatingNavBar } from './components/FloatingNavBar';
import { Dashboard } from './screens/Dashboard';
import { ShieldScreen } from './screens/Shield';
import { ActivityScreen } from './screens/Activity';
import { SettingsScreen } from './screens/Settings';
import { db, type PairingData } from './lib/db';
import * as crypto from './lib/crypto';
import { pairDevice, sendUnlockApproval } from './services/api';
import { useWebSocket } from './hooks/useWebSocket';
import { useWebAuthn } from './hooks/useWebAuthn';

type AppState = 'loading' | 'onboarding' | 'main' | 'pairing';

function App() {
  const [state, setState] = useState<AppState>('loading');
  const [activeTab, setActiveTab] = useState('vault');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [identityPK, setIdentityPK] = useState<string | null>(null);
  const [pairingData, setPairingData] = useState<PairingData | null>(null);
  const [biometricPending, setBiometricPending] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [vaultStatus, setVaultStatus] = useState<'Locked' | 'Unlocked' | 'Unpaired'>('Unpaired');
  const [isDarkTheme, setIsDarkTheme] = useState(false);

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

  const { authenticateBiometric } = useWebAuthn();

  useEffect(() => {
    async function init() {
      const pk = await db.getIdentityPublicKey();
      const pd = await db.getPairingData();
      
      setIdentityPK(pk);
      setPairingData(pd);

      if (!pk) {
        setState('onboarding');
      } else {
        setState('main');
        setVaultStatus(pd ? 'Locked' : 'Unpaired');
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!lastMessage) return;

    async function handleMessage() {
      if (lastMessage === 'WAKE_UP_BIOMETRIC') {
        setBiometricPending(true);
        return;
      }

      // Check if it's an encrypted master key push (long base64 string)
      if (typeof lastMessage === 'string' && lastMessage.length > 50) {
        try {
          const xPriv = await db.getXPrivateKey();
          if (xPriv) {
            const masterKey = await crypto.decryptMasterKey(lastMessage, xPriv);
            await db.saveMasterKey(masterKey);
            setVaultStatus('Locked');
            console.log('Master key received and saved.');
          }
        } catch (err) {
          console.error('Failed to decrypt pushed master key', err);
        }
      }

      // Handle other object-based messages if any
      if (typeof lastMessage === 'object') {
        const msg = lastMessage as any;
        if (msg.action === 'VAULT_STATUS_CHANGE') {
          setVaultStatus(msg.status);
        }
      }
    }

    handleMessage();
  }, [lastMessage]);

  const handleOnboardingNext = async () => {
    if (onboardingStep < 2) {
      setOnboardingStep(onboardingStep + 1);
    } else {
      setIsProcessing(true);
      try {
        const { publicKey, privateKey } = await crypto.generateIdentity();
        const { privateKey: xPriv } = crypto.generateX25519KeyPair();
        
        const pkB64 = await crypto.exportPublicKey(publicKey);
        const xPrivB64 = crypto.uint8ArrayToBase64(xPriv);

        await db.saveIdentity(pkB64, privateKey);
        await db.saveXPrivateKey(xPrivB64);
        
        setIdentityPK(pkB64);
        setState('main');
      } catch (err) {
        console.error('Identity generation failed', err);
        alert('Failed to generate secure identity.');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleScan = async (decodedText: string) => {
    setState('main');
    setIsProcessing(true);
    try {
      const payload = JSON.parse(decodedText);
      const { backend_url, desktop_public_key, desktop_x_public_key, pairing_nonce } = payload;
      
      const identityPriv = await db.getIdentityPrivateKey();
      const xPriv = await db.getXPrivateKey();
      
      if (!identityPK || !identityPriv || !xPriv) throw new Error('Identity not found');

      const signature = await crypto.signData(identityPriv, pairing_nonce);
      
      const result = await pairDevice(
        backend_url,
        desktop_public_key,
        identityPK,
        crypto.uint8ArrayToBase64(crypto.x25519.getPublicKey(crypto.base64ToUint8Array(xPriv))),
        pairing_nonce,
        signature
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
    } catch (err: any) {
      console.error('Pairing failed', err);
      alert(`Pairing failed: ${err.message || 'Unknown error'}\n\nCheck if your backend is accessible and your computer is connected to the same network if using a local URL.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveUnlock = async () => {
    if (!pairingData || !identityPK) return;
    setIsProcessing(true);
    try {
      await authenticateBiometric();
      const masterKey = await db.getMasterKey();
      const identityPriv = await db.getIdentityPrivateKey();
      if (!masterKey || !identityPriv) throw new Error('Missing keys');

      const encryptedBlob = await crypto.encryptForDesktop(masterKey, pairingData.desktop_x_public_key);
      const signature = await crypto.signData(identityPriv, pairingData.pairing_nonce);

      await sendUnlockApproval(
        pairingData.backend_url,
        pairingData.desktop_public_key,
        identityPK,
        pairingData.pairing_nonce,
        signature,
        encryptedBlob
      );

      setBiometricPending(false);
      setVaultStatus('Unlocked');
    } catch (err: any) {
      console.error('Unlock failed', err);
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

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans flex flex-col overflow-hidden transition-colors duration-300">
      {/* Content Rendering based on Tab */}
      <div className="flex-1 flex flex-col overflow-y-auto pb-32">
        {activeTab === 'vault' && (
          <Dashboard 
            status={vaultStatus}
            isConnected={isConnected}
            onUnlock={handleApproveUnlock}
            onPair={() => setState('pairing')}
            onClear={() => {
              if (confirm('Clear local data?')) {
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
              <h1 className="text-3xl font-black tracking-tight">DEVICES</h1>
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
          onDeny={() => setBiometricPending(false)}
          loading={isProcessing}
        />
      )}

      {isProcessing && !biometricPending && (
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
