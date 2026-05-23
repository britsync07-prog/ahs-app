import React from 'react';
import { Fingerprint, X } from 'lucide-react';

interface BiometricPromptProps {
  onApprove: () => void;
  onDeny: () => void;
  loading: boolean;
}

export const BiometricPrompt: React.FC<BiometricPromptProps> = ({ onApprove, onDeny, loading }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
      {/* Cinematic backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-md animate-in fade-in duration-500" 
        onClick={onDeny}
      />
      
      <div className="relative w-full max-w-sm glass-dark rounded-[40px] p-8 shadow-2xl border border-white/10 animate-in zoom-in-95 duration-300 flex flex-col items-center">
        <button 
          onClick={onDeny}
          className="absolute top-6 right-6 p-2 text-white/40 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="mt-4 mb-8 relative">
          {/* Animated Biometric Ring */}
          <div className="absolute inset-0 rounded-full border-2 border-neon-cyan/20 animate-ping opacity-20" />
          <div className="absolute -inset-2 rounded-full border border-neon-cyan/10 animate-pulse" />
          
          <div className="relative w-24 h-24 bg-neon-cyan/10 rounded-full flex items-center justify-center border border-neon-cyan/30 shadow-[0_0_30px_rgba(0,243,255,0.1)]">
            <Fingerprint 
              size={48} 
              className={`text-neon-cyan transition-all duration-500 ${loading ? 'animate-pulse scale-90' : ''}`} 
            />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-center mb-2">Biometric Unlock</h2>
        <p className="text-white/50 text-center mb-8 text-sm px-4">
          Confirm your identity to authorize the vault unlock request for your workstation.
        </p>

        <button
          onClick={onApprove}
          disabled={loading}
          className="w-full h-16 bg-white text-black rounded-2xl font-bold text-lg active:scale-95 transition-all flex items-center justify-center space-x-2 shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:bg-neon-cyan hover:shadow-neon-glow"
        >
          {loading ? (
            <div className="w-6 h-6 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <span>Confirm Identity</span>
          )}
        </button>
        
        <button
          onClick={onDeny}
          className="mt-4 text-white/40 text-sm font-medium hover:text-white transition-colors"
        >
          Cancel Request
        </button>
      </div>
    </div>
  );
};
