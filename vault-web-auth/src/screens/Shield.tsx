import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { getVaultStats, getActivity } from '../services/api';
import { db } from '../lib/db';

export const ShieldScreen: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [threatLogs, setThreatLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const pairingData = await db.getPairingData();
        const identityPK = await db.getIdentityPublicKey();
        
        if (pairingData && identityPK) {
          const [statsData, activityData] = await Promise.all([
            getVaultStats(pairingData.backend_url, identityPK),
            getActivity(pairingData.backend_url, identityPK)
          ]);
          
          setStats(statsData);
          setThreatLogs(activityData.filter((e: any) => e.type === 'threat'));
        }
      } catch (err) {
        console.error('Shield data fetch failed:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 overflow-y-auto">
      <header className="pt-4">
        <h1 className="text-3xl font-black tracking-tight text-text-primary uppercase">Shield</h1>
        <p className="text-text-secondary text-sm">Real-time hardware protection.</p>
      </header>

      <div className="flex flex-col items-center justify-center py-8">
        {/* Threat Score Meter */}
        <div className="relative w-64 h-64 flex items-center justify-center">
          {/* Outer glow */}
          <div className="absolute inset-0 rounded-full bg-neon-cyan/5 blur-3xl" />
          
          {/* Progress track */}
          <svg className="w-full h-full -rotate-90">
            <circle
              cx="128"
              cy="128"
              r="110"
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              className="text-text-secondary/10"
            />
            <circle
              cx="128"
              cy="128"
              r="110"
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              strokeDasharray="691.15"
              strokeDashoffset={691.15 * (1 - (stats?.securityScore || 100) / 100)}
              strokeLinecap="round"
              className="text-neon-cyan drop-shadow-[0_0_12px_#00f3ff]"
            />
          </svg>

          {/* Center Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-neon-cyan/10 rounded-full flex items-center justify-center mb-2 border border-neon-cyan/20">
              <ShieldCheck size={32} className="text-neon-cyan" />
            </div>
            <span className="text-5xl font-black text-text-primary">{stats?.securityScore || '100'}</span>
            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">Safety Score</span>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 w-full">
          <div className="card-base p-5 text-center">
             <h4 className="text-xl font-black text-text-primary">{stats?.threatsBlocked || 0}</h4>
             <p className="text-[10px] font-bold text-text-secondary uppercase">Threats Blocked</p>
          </div>
          <div className="card-base p-5 text-center">
             <h4 className="text-xl font-black text-emerald-green">Secure</h4>
             <p className="text-[10px] font-bold text-text-secondary uppercase">Node Status</p>
          </div>
        </div>
      </div>

      <div className="glass rounded-[32px] p-6 border border-border-subtle mb-12">
        <h4 className="text-[10px] font-black mb-6 text-text-primary uppercase tracking-widest opacity-60">Security Analysis</h4>
        <div className="space-y-6">
          {loading ? (
             <div className="flex justify-center py-4">
                <RefreshCw size={20} className="animate-spin text-text-secondary opacity-30" />
             </div>
          ) : threatLogs.length === 0 ? (
            <div className="flex gap-4 items-start opacity-70">
              <div className="w-2 h-2 rounded-full bg-emerald-green mt-1.5 shrink-0" />
              <p className="text-xs text-text-secondary leading-relaxed font-medium">
                No active threats detected. Your hardware encryption module is maintaining 100% integrity.
              </p>
            </div>
          ) : (
            threatLogs.map((log) => (
              <div key={log.id} className="flex gap-4 items-start">
                <div className="w-2 h-2 rounded-full bg-deep-red mt-1.5 shrink-0 animate-pulse" />
                <div>
                  <p className="text-xs text-text-primary font-bold leading-tight">{log.subject}</p>
                  <p className="text-[10px] text-text-secondary mt-1">{log.detail}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
