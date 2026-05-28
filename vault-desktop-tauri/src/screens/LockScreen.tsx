import React, { useState } from "react";
import { Lock, Smartphone, ShieldCheck, Key, ArrowLeft } from "lucide-react";

interface LockScreenProps {
  onUnlockRequest: () => void;
  onOfflineUnlock: (mnemonic: string) => void;
  isWaiting: boolean;
  status: string;
}

export const LockScreen: React.FC<LockScreenProps> = ({ 
  onUnlockRequest, 
  onOfflineUnlock,
  isWaiting,
  status
}) => {
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [mnemonic, setMnemonic] = useState("");

  if (isOfflineMode) {
    return (
      <div className="relative h-screen w-screen bg-pure flex flex-col items-center justify-center overflow-hidden">
        {/* Background Cinematic Blur Effect */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan/10 rounded-full blur-[120px] animate-pulse-slow"></div>
        </div>

        <div className="relative z-10 flex flex-col items-center w-full max-w-xl px-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="mb-6 p-4 rounded-2xl bg-cyan/10 border border-cyan/20">
             <Key className="w-8 h-8 text-cyan" />
          </div>
          
          <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-2">Manual Master Key Unlock</h1>
          <p className="text-text-secondary text-xs font-medium tracking-[0.2em] uppercase mb-8">Offline Decryption Protocol</p>
          
          <div className="w-full relative group">
            <div className="absolute -inset-1 bg-cyan/20 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              placeholder="Paste your 24-word Master Key phrase here..."
              className="relative w-full h-40 bg-graphite/40 border border-border-primary rounded-2xl p-6 text-cyan font-mono text-sm focus:outline-none focus:border-cyan/50 backdrop-blur-md transition-all resize-none"
            />
          </div>

          <div className="flex flex-col gap-4 mt-8 w-full">
            <button
              onClick={() => onOfflineUnlock(mnemonic)}
              disabled={mnemonic.trim().split(/\s+/).length < 12}
              className="w-full py-4 bg-cyan text-pure font-bold rounded-full shadow-[0_0_30px_rgba(0,242,255,0.2)] hover:shadow-[0_0_40px_rgba(0,242,255,0.4)] transition-all disabled:opacity-50 active:scale-95 flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-5 h-5" />
              Confirm & Mount Vault
            </button>
            
            <button 
              onClick={() => setIsOfflineMode(false)}
              className="group flex items-center justify-center gap-2 text-text-tertiary text-[10px] font-bold uppercase tracking-[0.2em] hover:text-text-secondary transition-colors py-2"
            >
              <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
              Back to Biometric Unlock
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen bg-pure flex flex-col items-center justify-center overflow-hidden">
      {/* Background Cinematic Blur Effect */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan/10 rounded-full blur-[120px] animate-pulse-slow"></div>
        <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-blue/5 rounded-full blur-[100px]"></div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Vault Symbol */}
        <div className="relative mb-12">
          <div className={`p-8 rounded-3xl bg-graphite/40 border border-border-primary shadow-2xl backdrop-blur-md transition-all duration-700 ${isWaiting ? 'scale-110' : 'scale-100'}`}>
            <Lock className={`w-24 h-24 ${isWaiting ? 'text-cyan animate-pulse' : 'text-text-secondary'}`} strokeWidth={1} />
          </div>
          
          {/* Signal Pulse Animation */}
          {isWaiting && (
            <div className="absolute inset-0 -z-10 flex items-center justify-center">
              <div className="absolute w-full h-full bg-cyan/20 rounded-3xl animate-ping opacity-50"></div>
              <div className="absolute w-full h-full bg-cyan/10 rounded-3xl animate-ping [animation-delay:400ms] opacity-30"></div>
            </div>
          )}
        </div>

        <h1 className="text-4xl font-bold text-text-primary tracking-tight mb-2">
          {isWaiting ? "Authorizing" : "AHS Locked"}
        </h1>
        <p className="text-text-secondary text-sm font-medium tracking-widest uppercase mb-12">
          {status || "Secure environment inactive"}
        </p>

        {!isWaiting ? (
          <div className="flex flex-col items-center gap-8">
            <button
              onClick={onUnlockRequest}
              className="group relative px-12 py-4 bg-transparent transition-all duration-300 active:scale-95"
            >
              {/* Button Glow Effect */}
              <div className="absolute inset-0 bg-cyan/20 rounded-full blur-xl group-hover:bg-cyan/40 transition-all duration-500"></div>
              
              <div className="relative px-12 py-4 rounded-full bg-cyan text-pure font-bold flex items-center gap-3 shadow-[0_0_30px_rgba(0,242,255,0.4)] group-hover:shadow-[0_0_50px_rgba(0,242,255,0.6)] transition-all duration-500">
                <ShieldCheck className="w-5 h-5" />
                Request Unlock
              </div>
            </button>

            <button 
              onClick={() => setIsOfflineMode(true)}
              className="text-text-tertiary text-[10px] font-bold uppercase tracking-[0.2em] hover:text-text-secondary transition-colors"
            >
              Unlock Offline via Master Key
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div className="flex items-center gap-4 px-6 py-3 rounded-2xl bg-matte-lighter border border-border-primary backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
              <Smartphone className="w-5 h-5 text-cyan animate-bounce" />
              <span className="text-text-primary font-medium text-sm">Check your mobile device</span>
            </div>
            
            <div className="flex gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan/40 animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 rounded-full bg-cyan/40 animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 rounded-full bg-cyan/40 animate-bounce"></div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="absolute bottom-12 text-text-tertiary text-[10px] tracking-[0.2em] uppercase font-bold">
        Zero-Knowledge Biometric Security Layer v1.0
      </div>
    </div>
  );
};
