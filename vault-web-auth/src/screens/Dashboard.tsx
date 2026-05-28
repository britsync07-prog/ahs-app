import React from 'react';
import { Wifi, WifiOff, LogOut } from 'lucide-react';
import { SecurityHeroCard } from '../components/dashboard/SecurityHeroCard';
import { QuickActionButtons } from '../components/dashboard/QuickActionButtons';
import { LiveStatusGrid } from '../components/dashboard/LiveStatusGrid';

interface DashboardProps {
  status: 'Locked' | 'Unlocked' | 'Unpaired';
  isConnected: boolean;
  onUnlock: () => void;
  onPair: () => void;
  onClear: () => void;
  loading: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  status,
  isConnected,
  onUnlock,
  onPair,
  onClear,
  loading
}) => {
  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <header className="flex items-center justify-between pt-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`absolute -inset-1 rounded-full blur-[4px] ${isConnected ? 'bg-emerald-green/40' : 'bg-deep-red/40'}`} />
            <div className={`relative w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-green' : 'bg-deep-red'}`} />
          </div>
          <h1 className="text-xl font-black tracking-tight flex items-center gap-2 text-text-primary">
            SECURE <span className="text-neon-cyan">VAULT</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          {isConnected ? (
            <Wifi size={18} className="text-emerald-green" />
          ) : (
            <WifiOff size={18} className="text-deep-red" />
          )}
          <button 
            onClick={onClear}
            className="p-2 rounded-xl text-text-secondary hover:text-text-primary transition-colors bg-text-secondary/5 border border-border-subtle"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Main Content Scrollable Area */}
      <div className="flex-1 space-y-8 pb-12">
        <SecurityHeroCard status={status} />
        
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] px-2 opacity-50">
            Quick Actions
          </h3>
          <QuickActionButtons 
            status={status} 
            onUnlock={onUnlock} 
            onLockAll={() => alert('All devices locked')} 
            onPair={onPair}
            loading={loading}
          />
        </div>

        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] px-2 opacity-50">
            Live Monitoring
          </h3>
          <LiveStatusGrid />
        </div>

        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] px-2 opacity-50">
            Recent Activity
          </h3>
          <div className="card-base p-6 border-dashed border-border-subtle bg-text-secondary/5">
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
              <p className="text-sm font-medium text-text-primary">
                MacBook Pro unlocked via Biometrics • 2m ago
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
