import React from 'react';
import { Activity, Users, ShieldAlert, CloudUpload } from 'lucide-react';

interface LiveStatusGridProps {
  stats: {
    securityScore: number;
    activeSessions: number;
    threatsBlocked: number;
    statusMessage: string;
  } | null;
}

export const LiveStatusGrid: React.FC<LiveStatusGridProps> = ({ stats }) => {
  const displayStats = [
    { 
      label: 'Vault Health', 
      value: stats ? `${stats.securityScore}%` : '---', 
      icon: Activity, 
      color: 'text-emerald-green' 
    },
    { 
      label: 'Sessions', 
      value: stats ? `${stats.activeSessions} Active` : '---', 
      icon: Users, 
      color: 'text-neon-cyan' 
    },
    { 
      label: 'Threats', 
      value: stats ? `${stats.threatsBlocked} Blocked` : '---', 
      icon: ShieldAlert, 
      color: 'text-deep-red' 
    },
    { 
      label: 'Status', 
      value: stats ? stats.statusMessage : '---', 
      icon: CloudUpload, 
      color: 'text-electric-blue' 
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 w-full">
      {displayStats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="card-base p-5 flex flex-col gap-3">
            <div className={`w-10 h-10 rounded-2xl bg-text-secondary/5 flex items-center justify-center border border-border-subtle ${stat.color}`}>
              <Icon size={20} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest opacity-60">{stat.label}</p>
              <p className="text-lg font-bold text-text-primary">{stat.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
