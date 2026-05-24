import React, { useEffect, useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { SecurityHeroCard } from '../components/dashboard/SecurityHeroCard';
import { QuickActionButtons } from '../components/dashboard/QuickActionButtons';
import { LiveStatusGrid } from '../components/dashboard/LiveStatusGrid';
import { getVaultStats, getActivity } from '../services/api';
import { db } from '../lib/db';

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
  const [stats, setStats] = useState<any>(null);
  const [latestEvent, setLatestEvent] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchDashboardData() {
    try {
      const pairingData = await db.getPairingData();
      const identityPK = await db.getIdentityPublicKey();
      
      if (pairingData && identityPK) {
        const [statsData, activityData] = await Promise.all([
          getVaultStats(pairingData.backend_url, identityPK),
          getActivity(pairingData.backend_url, identityPK)
        ]);
        
        setStats(statsData);
        
        if (activityData && activityData.length > 0) {
          const latest = activityData.sort((a: any, b: any) => 
            new Date(b.time).getTime() - new Date(a.time).getTime()
          )[0];
          setLatestEvent(latest);
        }
      }
    } catch (err) {
      console.error('Dashboard data fetch failed:', err);
    }
  }

  useEffect(() => {
    fetchDashboardData();
    // Poll for stats every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setTimeout(() => setRefreshing(false), 1000);
  };

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
          <button 
            onClick={handleManualRefresh}
            className={`p-2 rounded-xl text-text-secondary hover:text-text-primary transition-all bg-text-secondary/5 border border-border-subtle ${refreshing ? 'rotate-180' : ''}`}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={onClear}
            className="p-2 rounded-xl text-text-secondary hover:text-text-primary transition-colors bg-text-secondary/5 border border-border-subtle"
          >
            <LogOut size={16} />
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
            onLockAll={() => alert('Remote Lock All Delivered')} 
            onPair={onPair}
            loading={loading}
          />
        </div>

        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] px-2 opacity-50">
            Live Monitoring
          </h3>
          <LiveStatusGrid stats={stats} />
        </div>

        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] px-2 opacity-50">
            Recent Activity
          </h3>
          <div className="card-base p-6 border-dashed border-border-subtle bg-text-secondary/5">
            {latestEvent ? (
              <div className="flex items-center gap-4 animate-in fade-in duration-700">
                <div className={`w-1.5 h-1.5 rounded-full ${latestEvent.type === 'threat' ? 'bg-deep-red' : 'bg-neon-cyan'} animate-pulse`} />
                <p className="text-sm font-medium text-text-primary">
                  {latestEvent.subject} • {new Date(latestEvent.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ) : (
              <p className="text-xs text-text-secondary italic text-center py-2 opacity-50">
                No recent activity found.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
