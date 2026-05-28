import React, { useState, useEffect } from 'react';
import { Delete, ShieldCheck } from 'lucide-react';

interface PinPadProps {
  title: string;
  subtitle: string;
  onComplete: (pin: string) => void;
  onCancel?: () => void;
  error?: string | null;
  loading?: boolean;
}

export const PinPad: React.FC<PinPadProps> = ({
  title,
  subtitle,
  onComplete,
  onCancel,
  error,
  loading
}) => {
  const [pin, setPin] = useState('');
  const maxLength = 5;

  useEffect(() => {
    if (pin.length === maxLength) {
      onComplete(pin);
      // We don't clear here immediately to show the filled dots
    }
  }, [pin, onComplete]);

  // Reset pin if error changes (meaning a new attempt is needed)
  useEffect(() => {
    if (error) {
      setTimeout(() => setPin(''), 1000);
    }
  }, [error]);

  const handleNumber = (num: string) => {
    if (pin.length < maxLength && !loading) {
      setPin(prev => prev + num);
    }
  };

  const handleDelete = () => {
    if (pin.length > 0 && !loading) {
      setPin(prev => prev.slice(0, -1));
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-background flex flex-col items-center animate-in fade-in duration-500 overflow-hidden">
      {/* Header */}
      <div className="w-full p-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 glass rounded-xl flex items-center justify-center">
            <ShieldCheck size={20} className="text-neon-cyan" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight uppercase">Security</h2>
          </div>
        </div>
        {onCancel && (
          <button 
            onClick={onCancel}
            className="px-6 py-2 glass rounded-full text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-text-primary transition-colors"
          >
            Skip
          </button>
        )}
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center px-8 space-y-12 max-w-sm">
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-black tracking-tight text-text-primary uppercase">{title}</h1>
          <p className="text-text-secondary text-sm px-4">{subtitle}</p>
        </div>

        {/* Pin Dots */}
        <div className="flex gap-4 mb-8">
          {[...Array(maxLength)].map((_, i) => (
            <div 
              key={i} 
              className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${
                i < pin.length 
                  ? 'bg-neon-cyan border-neon-cyan shadow-[0_0_10px_rgba(0,243,255,0.5)] scale-110' 
                  : 'border-text-secondary/30 scale-100'
              } ${error && i < pin.length ? 'bg-deep-red border-deep-red shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-shake' : ''}`}
            />
          ))}
        </div>

        {error && (
          <p className="text-deep-red text-xs font-bold uppercase tracking-widest animate-in fade-in slide-in-from-top-2">
            {error}
          </p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-6 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleNumber(num.toString())}
              disabled={loading}
              className="w-full aspect-square rounded-2xl glass text-2xl font-black text-text-primary hover:bg-neon-cyan hover:text-black active:scale-90 transition-all shadow-lg"
            >
              {num}
            </button>
          ))}
          <div /> {/* Spacer */}
          <button
            onClick={() => handleNumber('0')}
            disabled={loading}
            className="w-full aspect-square rounded-2xl glass text-2xl font-black text-text-primary hover:bg-neon-cyan hover:text-black active:scale-90 transition-all shadow-lg"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="w-full aspect-square rounded-2xl flex items-center justify-center text-text-secondary hover:text-deep-red active:scale-90 transition-all"
          >
            <Delete size={32} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="pb-12 animate-pulse flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan" />
          <span className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.3em]">Verifying...</span>
        </div>
      )}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-shake {
          animation: shake 0.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
