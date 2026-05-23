import React from 'react';
import { Power, Lock, Plus } from 'lucide-react';

interface QuickActionButtonsProps {
  status: 'Locked' | 'Unlocked' | 'Unpaired';
  onUnlock: () => void;
  onLockAll: () => void;
  onPair: () => void;
  loading: boolean;
}

export const QuickActionButtons: React.FC<QuickActionButtonsProps> = ({ 
  status, 
  onUnlock, 
  onLockAll, 
  onPair,
  loading 
}) => {
  if (status === 'Unpaired') {
    return (
      <button
        onClick={onPair}
        className="w-full h-16 bg-neon-cyan text-black rounded-3xl font-bold text-lg active:scale-[0.98] transition-all flex items-center justify-center space-x-3 shadow-[0_0_30px_rgba(0,243,255,0.3)]"
      >
        <Plus size={24} />
        <span>Pair New Device</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <button
        onClick={onUnlock}
        disabled={status === 'Unlocked' || loading}
        className="group relative w-full h-20 overflow-hidden rounded-[30px] active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-electric-blue to-neon-cyan transition-transform group-hover:scale-105" />
        <div className="relative flex items-center justify-center gap-4 text-white font-bold text-xl">
          <Power size={28} className="drop-shadow-lg" />
          <span>{status === 'Unlocked' ? 'System Unlocked' : 'Unlock Computer'}</span>
        </div>
      </button>

      <button
        onClick={onLockAll}
        className="w-full h-14 rounded-[24px] border border-deep-red/30 bg-deep-red/5 text-deep-red font-bold text-sm uppercase tracking-widest active:scale-[0.98] transition-all flex items-center justify-center gap-2 hover:bg-deep-red/10"
      >
        <Lock size={18} />
        <span>Lock All Devices</span>
      </button>
    </div>
  );
};
