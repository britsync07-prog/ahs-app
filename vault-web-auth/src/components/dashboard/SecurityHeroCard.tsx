import React from 'react';
import { Lock, Unlock, ShieldCheck } from 'lucide-react';

interface SecurityHeroCardProps {
  status: 'Locked' | 'Unlocked' | 'Unpaired';
}

export const SecurityHeroCard: React.FC<SecurityHeroCardProps> = ({ status }) => {
  const isProtected = status !== 'Unpaired';
  const isUnlocked = status === 'Unlocked';

  return (
    <div className="relative overflow-hidden card-base p-8">
      {/* Decorative background elements */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-green/5 rounded-full blur-[80px]" />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-neon-cyan/5 rounded-full blur-[80px]" />
      
      <div className="relative flex flex-col items-center py-6">
        <div className="relative mb-6">
          {isProtected && (
            <div className={`absolute inset-0 rounded-full blur-2xl ${isUnlocked ? 'bg-neon-cyan/20' : 'bg-emerald-green/20'} animate-pulse`} />
          )}
          
          <div className={`relative w-24 h-24 rounded-full flex items-center justify-center border ${
            isUnlocked ? 'border-neon-cyan/30 bg-neon-cyan/10' : 
            isProtected ? 'border-emerald-green/30 bg-emerald-green/10' : 'border-text-primary/10 bg-text-secondary/5'
          }`}>
            {isUnlocked ? (
              <Unlock size={40} className="text-neon-cyan drop-shadow-[0_0_10px_rgba(0,243,255,0.5)]" />
            ) : isProtected ? (
              <Lock size={40} className="text-emerald-green animate-pulse drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            ) : (
              <ShieldCheck size={40} className="text-text-secondary opacity-20" />
            )}
          </div>
        </div>

        <h2 className="text-sm font-bold text-text-secondary uppercase tracking-[0.2em] mb-1">
          Vault Status
        </h2>
        <p className={`text-3xl font-bold tracking-tight ${
          isUnlocked ? 'text-neon-cyan' : isProtected ? 'text-emerald-green' : 'text-text-secondary opacity-40'
        }`}>
          {isUnlocked ? 'Accessible' : isProtected ? 'Protected' : 'Not Configured'}
        </p>
        
        {isProtected && (
          <div className="mt-4 flex items-center gap-2 px-4 py-1.5 rounded-full bg-text-secondary/5 border border-border-subtle">
            <div className={`w-1.5 h-1.5 rounded-full ${isUnlocked ? 'bg-neon-cyan shadow-[0_0_8px_rgba(0,243,255,0.8)]' : 'bg-emerald-green shadow-[0_0_8px_rgba(16,185,129,0.8)]'}`} />
            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
              {isUnlocked ? 'Live Session Active' : 'AES-256 Hardware Encrypted'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
