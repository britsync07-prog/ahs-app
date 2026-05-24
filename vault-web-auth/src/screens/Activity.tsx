import React, { useEffect, useState } from 'react';
import { Unlock, Smartphone, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import { getActivity } from '../services/api';
import { db } from '../lib/db';

export const ActivityScreen: React.FC = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const pairingData = await db.getPairingData();
        const identityPK = await db.getIdentityPublicKey();
        
        if (pairingData && identityPK) {
          const data = await getActivity(pairingData.backend_url, identityPK);
          // Sort by time descending and map to UI format
          const mapped = data.sort((a: any, b: any) => 
            new Date(b.time).getTime() - new Date(a.time).getTime()
          ).map((e: any) => ({
            id: e.id,
            title: e.subject,
            subtitle: e.detail,
            time: formatTime(e.time),
            icon: getIcon(e.type),
            color: getColor(e.risk, e.type)
          }));
          setEvents(mapped);
        }
      } catch (err) {
        console.error('Failed to fetch activity:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const getIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'security': return Unlock;
      case 'threat': return AlertTriangle;
      case 'sync': return RefreshCw;
      case 'pair': return Smartphone;
      default: return ShieldCheck;
    }
  };

  const getColor = (risk: string, type: string) => {
    if (type === 'threat' || risk === 'high' || risk === 'critical') return 'text-deep-red';
    if (type === 'security') return 'text-neon-cyan';
    if (type === 'pair') return 'text-emerald-green';
    return 'text-text-secondary';
  };

  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
      <header className="pt-4">
        <h1 className="text-3xl font-black tracking-tight text-text-primary uppercase">Activity</h1>
        <p className="text-text-secondary text-sm">Review recent security events.</p>
      </header>

      <div className="flex-1 space-y-4 pb-12">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="animate-spin text-neon-cyan" size={32} />
          </div>
        ) : events.length === 0 ? (
          <div className="card-base p-12 text-center space-y-2 opacity-50">
            <p className="font-bold text-text-primary uppercase tracking-widest text-xs">No Events Recorded</p>
            <p className="text-[10px] text-text-secondary uppercase">Your security log is clear.</p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="card-base p-5 flex items-center justify-between group active:scale-[0.98] transition-all">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl bg-text-secondary/5 flex items-center justify-center border border-border-subtle ${event.color}`}>
                  <event.icon size={24} />
                </div>
                <div>
                  <h4 className="font-bold text-text-primary text-sm leading-tight">{event.title}</h4>
                  <p className="text-[10px] text-text-secondary uppercase tracking-widest font-black opacity-60 mt-1">{event.subtitle}</p>
                </div>
              </div>
              <span className="text-[10px] font-black text-text-secondary opacity-40 whitespace-nowrap ml-4">{event.time}</span>
            </div>
          ))
        )}
        
        {!loading && events.length > 0 && (
          <button className="w-full py-4 text-[10px] font-black text-text-secondary opacity-40 uppercase tracking-[0.3em] hover:opacity-100 transition-opacity">
            End of History
          </button>
        )}
      </div>
    </div>
  );
};
