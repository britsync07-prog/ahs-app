import React, { useState, useEffect } from "react";
import { ShieldAlert, Mail, Globe, Lock, Cpu, Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const SecurityCenter: React.FC = () => {
  const [activity, setActivity] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  const [desktopPk, setDesktopPk] = useState<string | null>(null);

  const fetchStats = async (pk: string | null) => {
    try {
      const response = await fetch(`http://localhost:8080/api/vault/stats${pk ? `?public_key=${encodeURIComponent(pk)}` : ''}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (e) {
      console.error("Failed to fetch security stats:", e);
    }
  };

  const fetchActivity = async (pk: string | null) => {
    try {
      const response = await fetch(`http://localhost:8080/api/vault/activity${pk ? `?public_key=${encodeURIComponent(pk)}` : ''}`);
      if (response.ok) {
        const data = await response.json();
        setActivity(data);
      }
    } catch (e) {
      console.error("Failed to fetch security activity:", e);
    }
  };

  useEffect(() => {
    const init = async () => {
      let pk = desktopPk;
      if (!pk) {
        pk = await invoke("get_desktop_public_key");
        setDesktopPk(pk);
      }
      fetchActivity(pk);
      fetchStats(pk);
    };

    init();
    const interval = setInterval(() => {
        fetchActivity(desktopPk);
        fetchStats(desktopPk);
    }, 10000);

    const unlisten = listen<any>("threat-detected", (event) => {
      setActivity(prev => [{
        time: new Date().toISOString(),
        title: event.payload.subject,
        description: event.payload.detail,
        risk: event.payload.risk_level.toLowerCase()
      }, ...prev].slice(0, 50));
      fetchStats(desktopPk);
    });

    return () => {
      clearInterval(interval);
      unlisten.then(f => f());
    };
  }, [desktopPk]);

  const score = stats?.securityScore ?? 98;
  const statusMsg = stats?.statusMessage ?? "Excellent Integrity";
  const modules = stats?.modules ?? {
    email_shield: "Active",
    key_rotation: "Active",
    network_filter: "Monitoring",
    process_isolation: "Active",
    threat_detection: "Real-time"
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Security Center</h2>
          <p className="text-sm text-text-secondary">Comprehensive system integrity and protection status</p>
        </div>
        <div className={`px-4 py-2 rounded-full flex items-center gap-2 ${score > 90 ? 'bg-emerald/10 border-emerald/20 text-emerald' : 'bg-red/10 border-red/20 text-red'}`}>
          <div className={`w-2 h-2 rounded-full animate-pulse ${score > 90 ? 'bg-emerald' : 'bg-red'}`}></div>
          <span className="text-[10px] font-bold uppercase tracking-widest">{score > 90 ? 'System Secure' : 'Attention Required'}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 overflow-y-auto pr-2">
        <div className="col-span-8 space-y-6">
          <div className="p-8 rounded-3xl bg-matte border border-white/5 flex items-center gap-12 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-cyan/5 rounded-full blur-[80px] -mr-32 -mt-32"></div>
             
             <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90">
                  <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                  <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray="364.4" strokeDashoffset={364.4 - (364.4 * score / 100)} strokeLinecap="round" className="text-cyan drop-shadow-[0_0_8px_rgba(0,242,255,0.4)] transition-all duration-1000" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-text-primary">{score}</span>
                  <span className="text-[8px] font-bold uppercase tracking-tighter text-text-tertiary">Score</span>
                </div>
             </div>

             <div className="flex-1">
                <h3 className="text-xl font-bold mb-1 text-text-primary">{statusMsg}</h3>
                <p className="text-sm text-text-secondary mb-4">
                    {score > 90 
                      ? "Your system is operating at maximum security. No major vulnerabilities detected." 
                      : "Recent security events have impacted your integrity score. Review the logs below."}
                </p>
                <div className="flex gap-6">
                   <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald" />
                      <span className="text-xs font-medium text-text-primary">End-to-End Encryption</span>
                   </div>
                   <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald" />
                      <span className="text-xs font-medium text-text-primary">Hardware Authorization</span>
                   </div>
                </div>
             </div>
          </div>

          <div className="p-6 rounded-3xl bg-matte border border-white/5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-text-tertiary">Live Protection Stream</h3>
              <Activity className="w-4 h-4 text-cyan" />
            </div>
            <div className="space-y-4 font-mono text-[11px]">
              {activity.map((log, idx) => (
                <MonitorRow 
                  key={idx}
                  time={log.time.includes('T') ? log.time.split('T')[1].split('.')[0] : log.time} 
                  action={log.title} 
                  status={log.description} 
                  color={log.risk === 'low' ? 'emerald' : log.risk === 'high' ? 'cyan' : 'red'} 
                />
              ))}
              {activity.length === 0 && (
                <div className="py-8 text-center text-text-tertiary uppercase tracking-widest text-[9px]">
                  Waiting for system telemetry...
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-4 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-tertiary px-2">Active Modules</h3>
          <ModuleCard icon={<Mail />} title="Email Shield" status={modules.email_shield} color={modules.email_shield === 'Active' ? 'cyan' : 'text-tertiary'} />
          <ModuleCard icon={<Lock />} title="Key Rotation" status={modules.key_rotation} color="emerald" />
          <ModuleCard icon={<Globe />} title="Network Filter" status={modules.network_filter} color="blue" />
          <ModuleCard icon={<Cpu />} title="Process Isolation" status={modules.process_isolation} color="emerald" />
          <ModuleCard icon={<ShieldAlert />} title="Threat Detection" status={modules.threat_detection} color="cyan" />
          
          <div 
            onClick={async () => {
              try {
                await invoke("lock_vault");
                // Optional: show a notification or redirect to lock screen
              } catch (e) {
                console.error("Emergency wipe failed:", e);
              }
            }}
            className="mt-8 p-4 rounded-2xl bg-red/5 border border-red/20 group cursor-pointer hover:bg-red/10 transition-all active:scale-95"
          >
             <div className="flex items-center gap-3 mb-2">
                <AlertTriangle className="w-4 h-4 text-red" />
                <span className="text-xs font-bold text-red uppercase tracking-wider">Emergency Wipe</span>
             </div>
             <p className="text-[10px] text-text-secondary leading-relaxed">Instantly revoke all session keys and unmount the secure environment.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const MonitorRow = ({ time, action, status, color }: { time: string, action: string, status: string, color: string }) => (
  <div className="flex items-center justify-between py-2 border-b border-white/[0.03]">
    <span className="text-text-tertiary w-16">{time}</span>
    <span className="text-text-secondary flex-1 px-4">{action}</span>
    <span className={`text-${color} font-bold uppercase text-[9px]`}>{status}</span>
  </div>
);

const ModuleCard = ({ icon, title, status, color }: { icon: React.ReactNode, title: string, status: string, color: string }) => (
  <div className="p-4 rounded-2xl bg-graphite/40 border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all">
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-${color}/10 text-${color}`}>
        {icon}
      </div>
      <span className="text-xs font-bold text-text-primary">{title}</span>
    </div>
    <span className={`text-[9px] font-bold uppercase tracking-tighter text-${color}`}>{status}</span>
  </div>
);
