import React, { useState, useEffect } from 'react';
import { Palette, Shield, Key, Bell, Globe, ChevronRight, Fingerprint, RefreshCw, Eye, EyeOff, Copy, Check, X, Lock, Server, Sparkles, Edit3, Save } from 'lucide-react';
import { db } from '../lib/db';
import { useWebAuthn } from '../hooks/useWebAuthn';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

interface SettingsProps {
  isDarkTheme: boolean;
  onThemeToggle: () => void;
  biometricsEnabled: boolean;
  onBiometricsChange: () => Promise<void>;
}

export const SettingsScreen: React.FC<SettingsProps> = ({ 
  isDarkTheme, 
  onThemeToggle,
  biometricsEnabled,
  onBiometricsChange
}) => {
  const [webAuthnSupport, setWebAuthnSupport] = useState<{ supported: boolean; reason?: string; details?: string } | null>(null);
  const [hasBiometricEnrollment, setHasBiometricEnrollment] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const { registerBiometric, checkWebAuthnSupport } = useWebAuthn();

  const [activeModal, setActiveModal] = useState<'master_recovery' | 'vault_config' | null>(null);
  const [recoveryTab, setRecoveryTab] = useState<'words' | 'raw'>('words');
  
  const [masterKey, setMasterKey] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  
  const [showMasterKey, setShowMasterKey] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedWords, setCopiedWords] = useState(false);
  
  const [pairingData, setPairingData] = useState<any>(null);
  const [identityPK, setIdentityPK] = useState<string | null>(null);

  // Mnemonic input/editing state
  const [isEditingMnemonic, setIsEditingMnemonic] = useState(false);
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [mnemonicError, setMnemonicError] = useState<string | null>(null);

  useEffect(() => {
    checkWebAuthnSupport().then(setWebAuthnSupport);
    db.getBiometricCredentialId().then((credId) => {
      setHasBiometricEnrollment(!!credId);
    });
  }, [biometricsEnabled]);

  useEffect(() => {
    if (activeModal === 'master_recovery') {
      db.getMasterKey().then(setMasterKey);
      db.getMnemonic().then((m) => {
        setMnemonic(m);
        if (m) setMnemonicInput(m);
      });
    } else if (activeModal === 'vault_config') {
      db.getPairingData().then(setPairingData);
      db.getIdentityPublicKey().then(setIdentityPK);
    }
  }, [activeModal]);

  const handleCopyMasterKey = () => {
    if (masterKey) {
      navigator.clipboard.writeText(masterKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleCopyMnemonic = () => {
    if (mnemonic) {
      navigator.clipboard.writeText(mnemonic);
      setCopiedWords(true);
      setTimeout(() => setCopiedWords(false), 2000);
    }
  };

  const handleGenerateNew24Words = () => {
    const newMnemonic = generateMnemonic(wordlist, 256); // 256 bits entropy = 24 words
    setMnemonicInput(newMnemonic);
    setMnemonicError(null);
  };

  const handleSaveMnemonic = async () => {
    const trimmed = mnemonicInput.trim().toLowerCase();
    if (!trimmed) {
      setMnemonicError('Please enter or generate your 24-word recovery phrase.');
      return;
    }
    const words = trimmed.split(/\s+/);
    if (words.length !== 24 && words.length !== 12) {
      setMnemonicError(`Invalid word count (${words.length} words). Phrase must be 24 words (or 12 words).`);
      return;
    }
    if (!validateMnemonic(trimmed, wordlist)) {
      setMnemonicError('Invalid BIP-39 phrase or spelling. Please verify each word against standard BIP-39 wordlist.');
      return;
    }
    await db.saveMnemonic(trimmed);
    setMnemonic(trimmed);
    setIsEditingMnemonic(false);
    setMnemonicError(null);
  };

  const handleRegisterBiometrics = async () => {
    setIsRegistering(true);
    try {
      const biometricData = await registerBiometric('User');
      if (biometricData) {
        await db.setBiometricCredentialId(biometricData.id);
        await db.setBiometricPublicKey(biometricData.publicKey);
        await db.setBiometricsEnabled(true);
        
        const identityPK = await db.getIdentityPublicKey();
        const pairingData = await db.getPairingData();
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

        setHasBiometricEnrollment(true);
        await onBiometricsChange();
        alert('Biometrics successfully registered!');
      }
    } catch (err: any) {
      console.error(err);
      alert(`Registration failed: ${err.message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleRemoveBiometrics = async () => {
    if (confirm('Are you sure you want to remove biometric authentication?')) {
      await db.setBiometricsEnabled(false);
      await db.setBiometricCredentialId('');
      await db.setBiometricPublicKey('');
      
      setHasBiometricEnrollment(false);
      await onBiometricsChange();
      alert('Biometrics removed successfully.');
    }
  };

  const handleToggleBiometrics = async () => {
    const nextVal = !biometricsEnabled;
    await db.setBiometricsEnabled(nextVal);
    await onBiometricsChange();
  };

  const sections = [
    {
      title: 'General',
      items: [
        { label: 'Appearance', icon: Palette, color: 'text-purple-500', isToggle: true },
        { label: 'Notifications', icon: Bell, color: 'text-yellow-500', action: () => alert('Notifications are managed automatically for security events.') },
        { label: 'Language', icon: Globe, color: 'text-blue-500', action: () => alert('Language set to System Default (English).') },
      ]
    },
    {
      title: 'Security',
      items: [
        { label: 'Vault Configuration', icon: Shield, color: 'text-neon-cyan', action: () => setActiveModal('vault_config') },
        { label: 'Master Recovery Key (24 Words)', icon: Key, color: 'text-emerald-green', action: () => setActiveModal('master_recovery') },
      ]
    }
  ];

  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 relative">
      <header className="pt-4">
        <h1 className="text-3xl font-black tracking-tight text-text-primary uppercase">Settings</h1>
        <p className="text-text-secondary text-sm">Manage your security preferences.</p>
      </header>

      <div className="flex-1 space-y-8 pb-12">
        {sections.map((section) => (
          <div key={section.title} className="space-y-4">
            <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] px-2 opacity-50">
              {section.title}
            </h3>
            <div className="card-base overflow-hidden">
              {section.items.map((item: any, index: number) => (
                <div 
                  key={item.label}
                  onClick={item.isToggle ? onThemeToggle : item.action}
                  className={`w-full flex items-center justify-between p-5 hover:bg-text-secondary/5 active:bg-text-secondary/10 transition-colors cursor-pointer ${
                    index !== section.items.length - 1 ? 'border-b border-border-subtle' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl bg-text-secondary/5 flex items-center justify-center border border-border-subtle ${item.color}`}>
                      <item.icon size={20} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-text-primary">{item.label}</span>
                      {item.isToggle && (
                        <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
                          {isDarkTheme ? 'Dark Mode' : 'Light Mode'}
                        </span>
                      )}
                    </div>
                  </div>
                  {item.isToggle ? (
                    <div className={`w-12 h-6 rounded-full transition-colors relative ${isDarkTheme ? 'bg-neon-cyan' : 'bg-text-secondary/30'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isDarkTheme ? 'left-7' : 'left-1'}`} />
                    </div>
                  ) : (
                    <ChevronRight size={18} className="text-text-secondary opacity-30" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Biometrics Section */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] px-2 opacity-50">
            Biometrics
          </h3>
          <div className="card-base overflow-hidden p-5">
            {webAuthnSupport && !webAuthnSupport.supported && (
              <div className="text-text-secondary opacity-60 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-text-secondary/5 flex items-center justify-center border border-border-subtle text-text-secondary">
                    <Fingerprint size={20} />
                  </div>
                  <span className="font-bold text-sm">Biometric Unlock Unsupported</span>
                </div>
                <p className="text-xs pt-1">
                  {webAuthnSupport.details || 'Biometrics are not supported in this environment.'}
                </p>
              </div>
            )}

            {webAuthnSupport?.supported && hasBiometricEnrollment && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-text-secondary/5 flex items-center justify-center border border-border-subtle text-neon-cyan">
                      <Fingerprint size={20} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-text-primary">Biometric Unlock</span>
                      <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
                        Use FaceID/TouchID to unlock
                      </span>
                    </div>
                  </div>
                  <div 
                    onClick={handleToggleBiometrics}
                    className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${biometricsEnabled ? 'bg-neon-cyan' : 'bg-text-secondary/30'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${biometricsEnabled ? 'left-7' : 'left-1'}`} />
                  </div>
                </div>

                <div className="flex gap-4 pt-2">
                  <button
                    onClick={handleRegisterBiometrics}
                    disabled={isRegistering}
                    className="flex-1 py-2 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 active:scale-[0.98] transition-all rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer"
                  >
                    {isRegistering ? <RefreshCw size={12} className="animate-spin mx-auto" /> : 'Update'}
                  </button>
                  <button
                    onClick={handleRemoveBiometrics}
                    className="flex-1 py-2 bg-deep-red/10 text-deep-red hover:bg-deep-red/20 active:scale-[0.98] transition-all rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

            {webAuthnSupport?.supported && !hasBiometricEnrollment && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-text-secondary/5 flex items-center justify-center border border-border-subtle text-text-secondary">
                    <Fingerprint size={20} />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-text-primary">Not Enrolled</span>
                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
                      Enroll biometrics for faster access
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleRegisterBiometrics}
                  disabled={isRegistering}
                  className="px-4 py-2 bg-neon-cyan text-black hover:bg-neon-cyan/85 active:scale-[0.98] transition-all rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  {isRegistering ? <RefreshCw size={12} className="animate-spin mx-auto" /> : 'Enroll'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 space-y-4">
          <button 
            onClick={() => {
              if (confirm('Permanently wipe all security keys and identity?')) {
                db.clearAll().then(() => window.location.reload());
              }
            }}
            className="w-full h-16 rounded-[28px] bg-deep-red/10 border border-deep-red/20 text-deep-red font-bold text-sm uppercase tracking-widest active:scale-[0.98] transition-all cursor-pointer"
          >
            Reset All Data
          </button>
          <p className="text-center text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em] opacity-40">
            Vault Mobile Auth v1.2.0
          </p>
        </div>
      </div>

      {/* --- MASTER RECOVERY MODAL --- */}
      {activeModal === 'master_recovery' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-xl card-base p-6 space-y-6 relative border border-border-subtle bg-surface-primary shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <button 
              onClick={() => { setActiveModal(null); setShowMasterKey(false); setShowMnemonic(false); setIsEditingMnemonic(false); }}
              className="absolute top-5 right-5 p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-text-secondary/10 transition-all cursor-pointer"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-4 pt-2">
              <div className="w-12 h-12 rounded-2xl bg-emerald-green/10 flex items-center justify-center border border-emerald-green/20 text-emerald-green">
                <Key size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-text-primary">Master Recovery Center</h2>
                <p className="text-xs text-text-secondary">Vault master key & 24-word recovery phrase</p>
              </div>
            </div>

            {/* Navigation Tabs inside Modal */}
            <div className="flex bg-text-secondary/10 p-1 rounded-xl gap-1">
              <button
                onClick={() => setRecoveryTab('words')}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  recoveryTab === 'words' ? 'bg-surface-primary text-emerald-green shadow' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Sparkles size={14} /> 24-Word Recovery Phrase
              </button>
              <button
                onClick={() => setRecoveryTab('raw')}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  recoveryTab === 'raw' ? 'bg-surface-primary text-neon-cyan shadow' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Key size={14} /> Cryptographic String
              </button>
            </div>

            {/* TAB 1: 24-WORD RECOVERY PHRASE VIEW */}
            {recoveryTab === 'words' && (
              <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                <div className="p-4 rounded-2xl bg-text-secondary/5 border border-border-subtle space-y-1 text-xs text-text-secondary">
                  <div className="flex items-center gap-2 font-bold text-text-primary text-sm">
                    <Lock size={16} className="text-emerald-green" />
                    BIP-39 Master Mnemonic Seed
                  </div>
                  <p>
                    Your 24-word master recovery phrase is the ultimate key to restore your encrypted vault on any device. Keep these words offline and strictly private.
                  </p>
                </div>

                {mnemonic && !isEditingMnemonic ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[260px] overflow-y-auto p-1 pr-2">
                      {mnemonic.split(/\s+/).map((word, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-3 rounded-xl bg-black/60 border border-border-subtle font-mono text-xs text-emerald-green">
                          <span className="text-[10px] font-bold text-text-secondary w-5 text-right opacity-60">{idx + 1}.</span>
                          <span className="font-bold tracking-wide">{showMnemonic ? word : '•••••'}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={() => setShowMnemonic(!showMnemonic)}
                        className="flex-1 py-3 rounded-xl bg-text-secondary/10 hover:bg-text-secondary/20 active:scale-[0.98] transition-all text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer text-text-primary"
                      >
                        {showMnemonic ? <EyeOff size={16} /> : <Eye size={16} />}
                        {showMnemonic ? 'Hide Words' : 'Reveal 24 Words'}
                      </button>
                      <button
                        onClick={handleCopyMnemonic}
                        className="flex-1 py-3 rounded-xl bg-emerald-green/20 text-emerald-green hover:bg-emerald-green/30 active:scale-[0.98] transition-all text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {copiedWords ? <Check size={16} /> : <Copy size={16} />}
                        {copiedWords ? 'Copied!' : 'Copy 24 Words'}
                      </button>
                    </div>

                    <button
                      onClick={() => { setIsEditingMnemonic(true); setMnemonicInput(mnemonic); }}
                      className="w-full py-2.5 text-text-secondary hover:text-text-primary text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer opacity-70 hover:opacity-100 transition-all"
                    >
                      <Edit3 size={14} /> Update / Edit Saved Words
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                        {mnemonic ? 'Edit Your 24-Word Master Phrase' : 'Input or Generate 24 Master Recovery Words'}
                      </label>
                      <textarea
                        value={mnemonicInput}
                        onChange={(e) => setMnemonicInput(e.target.value)}
                        placeholder="Enter your 24 words separated by spaces (e.g. apple banana cherry...)"
                        rows={4}
                        className="w-full p-4 rounded-xl bg-black/60 border border-border-subtle font-mono text-xs text-text-primary focus:outline-none focus:border-emerald-green transition-all resize-none"
                      />
                      {mnemonicError && (
                        <p className="text-xs text-deep-red font-semibold">{mnemonicError}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleGenerateNew24Words}
                        className="flex-1 py-3 rounded-xl bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 active:scale-[0.98] transition-all text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Sparkles size={16} /> Generate 24 Words
                      </button>
                      <button
                        onClick={handleSaveMnemonic}
                        className="flex-1 py-3 rounded-xl bg-emerald-green text-black font-black hover:bg-emerald-green/90 active:scale-[0.98] transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Save size={16} /> Save 24 Words
                      </button>
                    </div>

                    {mnemonic && (
                      <button
                        onClick={() => setIsEditingMnemonic(false)}
                        className="w-full py-2 text-text-secondary text-xs font-bold uppercase tracking-wider cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: RAW CRYPTOGRAPHIC STRING VIEW */}
            {recoveryTab === 'raw' && (
              <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                <div className="p-4 rounded-2xl bg-text-secondary/5 border border-border-subtle space-y-1 text-xs text-text-secondary">
                  <div className="flex items-center gap-2 font-bold text-text-primary text-sm">
                    <Server size={16} className="text-neon-cyan" />
                    AES-256 Master Key String
                  </div>
                  <p>
                    This is the derived binary cryptographic key used by WebCrypto and paired sessions to perform real-time vault decryption.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <label className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">Stored Master Key String</label>
                  {masterKey ? (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl bg-black/60 border border-border-subtle font-mono text-xs break-all text-neon-cyan tracking-wide min-h-[60px] flex items-center justify-center text-center">
                        {showMasterKey ? masterKey : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setShowMasterKey(!showMasterKey)}
                          className="flex-1 py-3 rounded-xl bg-text-secondary/10 hover:bg-text-secondary/20 active:scale-[0.98] transition-all text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer text-text-primary"
                        >
                          {showMasterKey ? <EyeOff size={16} /> : <Eye size={16} />}
                          {showMasterKey ? 'Hide Key' : 'Reveal Key'}
                        </button>
                        <button
                          onClick={handleCopyMasterKey}
                          className="flex-1 py-3 rounded-xl bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 active:scale-[0.98] transition-all text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {copiedKey ? <Check size={16} /> : <Copy size={16} />}
                          {copiedKey ? 'Copied!' : 'Copy Key'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 rounded-xl bg-deep-red/10 border border-deep-red/20 text-center space-y-2">
                      <p className="font-bold text-sm text-deep-red">No Cryptographic Key Found</p>
                      <p className="text-xs text-text-secondary">
                        This companion is currently unpaired. Pair with your Desktop Vault to retrieve and store your master key.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-border-subtle">
              <button
                onClick={() => { setActiveModal(null); setShowMasterKey(false); setShowMnemonic(false); setIsEditingMnemonic(false); }}
                className="w-full py-3 rounded-xl bg-text-secondary/10 hover:bg-text-secondary/20 font-bold text-xs uppercase tracking-wider text-text-primary transition-all cursor-pointer"
              >
                Close Recovery Center
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- VAULT CONFIGURATION MODAL --- */}
      {activeModal === 'vault_config' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg card-base p-6 space-y-6 relative border border-border-subtle bg-surface-primary shadow-2xl">
            <button 
              onClick={() => setActiveModal(null)}
              className="absolute top-5 right-5 p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-text-secondary/10 transition-all cursor-pointer"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-4 pt-2">
              <div className="w-12 h-12 rounded-2xl bg-neon-cyan/10 flex items-center justify-center border border-neon-cyan/20 text-neon-cyan">
                <Shield size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-text-primary">Vault Configuration</h2>
                <p className="text-xs text-text-secondary">System identity & relay configuration</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-text-secondary/5 border border-border-subtle space-y-1">
                <div className="text-[10px] font-black text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <Server size={12} className="text-neon-cyan" /> Backend Relay URL
                </div>
                <div className="font-mono font-bold text-text-primary truncate">
                  {pairingData?.backend_url || 'https://auth-relay.securevault.local (Default)'}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-text-secondary/5 border border-border-subtle space-y-1">
                <div className="text-[10px] font-black text-text-secondary uppercase tracking-wider">
                  Companion Hardware Public Key
                </div>
                <div className="font-mono text-[11px] text-text-secondary break-all">
                  {identityPK || 'Generating identity...'}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-text-secondary/5 border border-border-subtle space-y-1">
                <div className="text-[10px] font-black text-text-secondary uppercase tracking-wider">
                  Paired Workstation Desktop PK
                </div>
                <div className="font-mono text-[11px] text-text-secondary break-all">
                  {pairingData?.desktop_public_key || 'Unpaired'}
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-3 rounded-xl bg-text-secondary/10 hover:bg-text-secondary/20 font-bold text-xs uppercase tracking-wider text-text-primary transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
