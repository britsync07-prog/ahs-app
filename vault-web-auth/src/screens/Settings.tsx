import React, { useState, useEffect } from 'react';
import { Palette, Shield, Key, Bell, Globe, ChevronRight, Fingerprint, RefreshCw } from 'lucide-react';
import { db } from '../lib/db';
import { useWebAuthn } from '../hooks/useWebAuthn';

interface SettingsProps {
  isDarkTheme: boolean;
  onThemeToggle: () => void;
}

export const SettingsScreen: React.FC<SettingsProps> = ({ isDarkTheme, onThemeToggle }) => {
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const { registerBiometric } = useWebAuthn();

  useEffect(() => {
    db.isBiometricsEnabled().then(setBiometricsEnabled);
  }, []);

  const handleRegisterBiometrics = async () => {
    setIsRegistering(true);
    try {
      const credentialId = await registerBiometric('User');
      if (credentialId) {
        await db.setBiometricCredentialId(credentialId);
        await db.setBiometricsEnabled(true);
        setBiometricsEnabled(true);
        alert('Biometrics successfully registered!');
      }
    } catch (err: any) {
      console.error(err);
      alert(`Registration failed: ${err.message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const sections = [
    {
      title: 'General',
      items: [
        { label: 'Appearance', icon: Palette, color: 'text-purple-500', isToggle: true },
        { label: 'Notifications', icon: Bell, color: 'text-yellow-500' },
        { label: 'Language', icon: Globe, color: 'text-blue-500' },
      ]
    },
    {
      title: 'Security',
      items: [
        { label: 'Vault Configuration', icon: Shield, color: 'text-neon-cyan' },
        { label: 'Master Recovery Key', icon: Key, color: 'text-emerald-green' },
      ]
    },
    {
      title: 'Biometrics',
      items: [
        { 
          label: biometricsEnabled ? 'Identity Enrolled' : 'Not Enrolled', 
          icon: Fingerprint, 
          color: 'text-neon-cyan',
          isButton: true,
          action: handleRegisterBiometrics,
          buttonText: biometricsEnabled ? 'Update' : 'Enroll'
        },
      ]
    }
  ];

  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
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
                  onClick={item.isToggle ? onThemeToggle : (item.isButton ? item.action : undefined)}
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
                  ) : item.isButton ? (
                    <div className="px-4 py-1.5 bg-neon-cyan/10 text-neon-cyan rounded-lg text-[10px] font-black uppercase tracking-widest">
                      {isRegistering ? <RefreshCw size={12} className="animate-spin" /> : item.buttonText}
                    </div>
                  ) : (
                    <ChevronRight size={18} className="text-text-secondary opacity-30" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="pt-4 space-y-4">
          <button 
            onClick={() => {
              if (confirm('Permanently wipe all security keys and identity?')) {
                db.clearAll().then(() => window.location.reload());
              }
            }}
            className="w-full h-16 rounded-[28px] bg-deep-red/10 border border-deep-red/20 text-deep-red font-bold text-sm uppercase tracking-widest active:scale-[0.98] transition-all"
          >
            Reset All Data
          </button>
          <p className="text-center text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em] opacity-40">
            Vault Mobile Auth v1.2.0
          </p>
        </div>
      </div>
    </div>
  );
};
