import React from 'react';
import { ShieldCheck, ShieldAlert, Zap } from 'lucide-react';

export const ShieldScreen: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
      <header className="pt-4">
        <h1 className="text-3xl font-black tracking-tight text-text-primary uppercase">Shield</h1>
        <p className="text-text-secondary text-sm">Real-time threat detection active.</p>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center py-12">
        {/* Threat Score Meter */}
        <div className="relative w-72 h-72 flex items-center justify-center">
          {/* Outer glow */}
          <div className="absolute inset-0 rounded-full bg-emerald-green/5 blur-3xl" />
          
          {/* Progress track */}
          <svg className="w-full h-full -rotate-90">
            <circle
              cx="144"
              cy="144"
              r="130"
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              className="text-text-secondary/10"
            />
            <circle
              cx="144"
              cy="144"
              r="130"
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              strokeDasharray="816.8"
              strokeDashoffset="163.36" // 80% filled
              strokeLinecap="round"
              className="text-emerald-green drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]"
            />
          </svg>

          {/* Center Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-20 h-20 bg-emerald-green/10 rounded-full flex items-center justify-center mb-2 border border-emerald-green/20">
              <ShieldCheck size={40} className="text-emerald-green" />
            </div>
            <span className="text-5xl font-black text-text-primary">98</span>
            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">Safety Score</span>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-6 w-full">
          {[
            { label: 'Brute Force', icon: ShieldAlert, status: 'Clear' },
            { label: 'Network', icon: Zap, status: 'Secure' },
            { label: 'Process', icon: ShieldCheck, status: 'Normal' },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 glass rounded-2xl flex items-center justify-center">
                <item.icon size={20} className="text-text-secondary" />
              </div>
              <span className="text-[10px] font-bold text-text-secondary uppercase">{item.label}</span>
              <span className="text-xs font-bold text-emerald-green">{item.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass rounded-[32px] p-6 border border-border-subtle">
        <h4 className="text-sm font-bold mb-4 text-text-primary uppercase tracking-widest">Security Insights</h4>
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="w-2 h-2 rounded-full bg-emerald-green mt-1.5 shrink-0" />
            <p className="text-xs text-text-secondary leading-relaxed font-medium">
              No unusual login attempts detected in the last 24 hours. Your security posture is excellent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
