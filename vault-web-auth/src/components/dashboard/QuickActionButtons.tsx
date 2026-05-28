import { Fingerprint, Shield, Plus } from 'lucide-react';

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
        className="w-full h-16 bg-neon-cyan text-black rounded-[32px] font-black text-sm uppercase tracking-[0.2em] active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-xl shadow-neon-cyan/20"
      >
        <Plus size={24} />
        <span>Pair New Device</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Primary Action Button (Magic Unlock) */}
      <button
        onClick={onUnlock}
        disabled={status === 'Unlocked' || loading}
        className="group relative w-full h-20 overflow-hidden rounded-[32px] active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 shadow-xl shadow-neon-cyan/10"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-electric-blue to-neon-cyan transition-transform group-hover:scale-105" />
        <div className="relative flex items-center justify-center gap-4 text-white font-black text-sm uppercase tracking-[0.2em]">
          <Fingerprint size={32} className="drop-shadow-lg" />
          <span>{status === 'Unlocked' ? 'System Accessible' : 'Unlock Computer'}</span>
        </div>
      </button>

      {/* Secondary Action Button (Emergency Lock) */}
      <button
        onClick={onLockAll}
        className="w-full h-14 rounded-[28px] border border-deep-red/30 bg-deep-red/5 text-deep-red font-bold text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] transition-all flex items-center justify-center gap-2 hover:bg-deep-red/10"
      >
        <Shield size={18} />
        <span>Lock All Devices</span>
      </button>
    </div>
  );
};
