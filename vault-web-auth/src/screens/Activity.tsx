import React from 'react';
import { Lock, Unlock, Smartphone, RefreshCw, AlertTriangle } from 'lucide-react';

export const ActivityScreen: React.FC = () => {
  const events = [
    { id: 1, type: 'unlock', title: 'Workstation Unlocked', time: '2m ago', device: 'Main Workstation', icon: Unlock, color: 'text-neon-cyan' },
    { id: 2, type: 'lock', title: 'Vault Auto-Locked', time: '1h ago', device: 'System', icon: Lock, color: 'text-text-secondary' },
    { id: 3, type: 'sync', title: 'Keys Synchronized', time: '3h ago', device: 'Cloud Sync', icon: RefreshCw, color: 'text-electric-blue' },
    { id: 4, type: 'pair', title: 'New Device Paired', time: 'Yesterday', device: 'MacBook Pro', icon: Smartphone, color: 'text-emerald-green' },
    { id: 5, type: 'alert', title: 'Failed Attempt', time: '2 days ago', device: 'Unknown', icon: AlertTriangle, color: 'text-deep-red' },
  ];

  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
      <header className="pt-4">
        <h1 className="text-3xl font-black tracking-tight text-text-primary uppercase">Activity</h1>
        <p className="text-text-secondary text-sm">Review recent security events.</p>
      </header>

      <div className="flex-1 space-y-4 pb-12">
        {events.map((event) => (
          <div key={event.id} className="card-base p-5 flex items-center justify-between group active:scale-[0.98] transition-all">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl bg-text-secondary/5 flex items-center justify-center border border-border-subtle ${event.color}`}>
                <event.icon size={24} />
              </div>
              <div>
                <h4 className="font-bold text-text-primary">{event.title}</h4>
                <p className="text-xs text-text-secondary uppercase tracking-widest font-bold opacity-60">{event.device}</p>
              </div>
            </div>
            <span className="text-xs font-bold text-text-secondary opacity-40 whitespace-nowrap">{event.time}</span>
          </div>
        ))}
        
        <button className="w-full py-4 text-[10px] font-black text-text-secondary opacity-40 uppercase tracking-[0.3em] hover:opacity-100 transition-opacity">
          View All History
        </button>
      </div>
    </div>
  );
};
