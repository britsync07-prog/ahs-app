import React from "react";
import { Cloud, History, RefreshCcw, HardDrive, FileDown, AlertCircle, Info, ChevronRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";

export const RecoveryCenter: React.FC = () => {
  const [mnemonic, setMnemonic] = React.useState<string | null>(null);
  const [isRevealing, setIsRevealing] = React.useState(false);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState<any>(null);
  const [backupSettings, setBackupSettings] = React.useState(() => {
    const saved = localStorage.getItem('vault_backup_settings');
    return saved ? JSON.parse(saved) : {
      wifiOnly: true,
      delta: true,
      background: true
    };
  });

  const fetchStats = React.useCallback(async () => {
    try {
      const data = await invoke<any>("get_recovery_stats");
      setStats(data);
    } catch (e) {
      console.error("Failed to fetch recovery stats:", e);
    }
  }, []);

  React.useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  React.useEffect(() => {
    localStorage.setItem('vault_backup_settings', JSON.stringify(backupSettings));
  }, [backupSettings]);

  const toggleBackup = (key: string) => {
    setBackupSettings((prev: any) => ({ ...prev, [key]: !prev[key] }));
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTimeAgo = (timestamp: number) => {
    if (!timestamp) return "Never";
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const handleReveal = async () => {
    setIsRevealing(true);
    setError(null);
    try {
      const result = await invoke<string>("get_master_mnemonic");
      setMnemonic(result);
    } catch (e) {
      console.error("Reveal failed:", e);
      setError(String(e));
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsRevealing(false);
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Backup & Recovery</h2>
          <p className="text-sm text-text-secondary">Disaster recovery and cloud synchronization management</p>
        </div>
        <div className="px-4 py-2 rounded-lg bg-blue/10 border border-blue/20 flex items-center gap-2">
          <Cloud className="w-3 h-3 text-blue" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue">Cloud Sync Active</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 overflow-y-auto pr-2 pb-12">
        {/* Top Section: Sync Stats */}
        <div className="col-span-12 grid grid-cols-4 gap-6">
          <SyncStat 
            icon={<RefreshCcw />} 
            label="Last Backup" 
            value={formatTimeAgo(stats?.last_sync)} 
            sub="Auto-sync active" 
            color="emerald" 
          />
          <SyncStat 
            icon={<HardDrive />} 
            label="Cloud Storage" 
            value={formatSize(stats?.total_size)} 
            sub={`of 50 GB used`} 
            color="cyan" 
          />
          <SyncStat 
            icon={<History />} 
            label="Version History" 
            value={`${stats?.retention_days || 30} Days`} 
            sub="Retention period" 
            color="blue" 
          />
          <SyncStat 
            icon={<Cloud />} 
            label="Sync Integrity" 
            value={stats?.integrity || "Verified"} 
            sub="AES-256 Checksum" 
            color="emerald" 
          />
        </div>

        {/* Data Controls Section */}
        <div className="col-span-12 space-y-4">
           <h3 className="text-xs font-bold uppercase tracking-widest text-text-tertiary px-2">Synchronization Controls</h3>
           
           <div className="grid grid-cols-2 gap-6">
             <div className="p-6 rounded-3xl bg-graphite/40 border border-white/5 space-y-5">
                <ControlToggle 
                  label="WiFi Only Backup" 
                  description="Prevents synchronization when connected to cellular or metered networks to save data."
                  checked={backupSettings.wifiOnly} 
                  onToggle={() => toggleBackup('wifiOnly')}
                />
                <ControlToggle 
                  label="Delta Compression" 
                  description="Only uploads changed parts of files, drastically reducing sync time and bandwidth."
                  checked={backupSettings.delta} 
                  onToggle={() => toggleBackup('delta')}
                />
                <ControlToggle 
                  label="Background Sync" 
                  description="Continue uploading files even when the vault window is minimized or inactive."
                  checked={backupSettings.background} 
                  onToggle={() => toggleBackup('background')}
                />
             </div>

             <div className="p-6 rounded-3xl bg-cyan/5 border border-cyan/10">
                <h4 className="text-sm font-bold text-text-primary mb-1">Manual Cloud Refresh</h4>
                <p className="text-xs text-text-secondary mb-4">Force an immediate synchronization of all dirty file chunks and the global index to the secure cloud relay.</p>
                <button 
                  onClick={async () => {
                    setIsSyncing(true);
                    try {
                      await invoke("sync_now");
                      alert("AHS index synchronized successfully.");
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setIsSyncing(false);
                    }
                  }} 
                  disabled={isSyncing}
                  className="w-full py-4 rounded-xl bg-cyan text-pure font-bold text-sm shadow-[0_0_20px_rgba(0,242,255,0.2)] flex items-center justify-center gap-3 disabled:opacity-50 transition-all hover:scale-[1.01] active:scale-[0.98]"
                >
                  {isSyncing ? (
                    <div className="w-5 h-5 border-2 border-pure border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <RefreshCcw className="w-5 h-5" />
                  )}
                  Sync Now
                </button>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};

const SyncStat = ({ icon, label, value, sub, color }: { icon: React.ReactNode, label: string, value: string, sub: string, color: string }) => (
  <div className="p-6 rounded-2xl bg-matte border border-white/5 flex flex-col gap-2">
    <div className={`text-${color} opacity-60`}>
      {icon}
    </div>
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className="text-xl font-bold text-text-primary">{value}</p>
      <p className={`text-[9px] font-bold uppercase tracking-tighter text-${color}`}>{sub}</p>
    </div>
  </div>
);

const ControlToggle = ({ label, description, checked, onToggle }: { label: string, description: string, checked: boolean, onToggle: () => void }) => {
  const [showInfo, setShowInfo] = React.useState(false);

  return (
    <div className="flex items-center justify-between relative group/toggle">
      <div className="flex items-center gap-2">
        <span 
          className="text-xs font-medium text-text-secondary group-hover/toggle:text-text-primary transition-colors cursor-pointer"
          onClick={onToggle}
        >
          {label}
        </span>
        <div 
          className="relative"
          onMouseEnter={() => setShowInfo(true)}
          onMouseLeave={() => setShowInfo(false)}
        >
          <Info size={10} className="text-text-tertiary cursor-help hover:text-cyan transition-colors" />
          
          <AnimatePresence>
            {showInfo && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute z-[100] left-0 bottom-full mb-2 w-40 p-3 rounded-xl bg-graphite border border-white/10 shadow-2xl pointer-events-none"
              >
                <p className="text-[9px] leading-relaxed text-text-primary font-medium">
                  {description}
                </p>
                <div className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-graphite"></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      <div 
        className={`w-7 h-3.5 rounded-full relative transition-all duration-300 cursor-pointer ${checked ? 'bg-cyan shadow-[0_0_10px_rgba(0,242,255,0.2)]' : 'bg-graphite'}`}
        onClick={onToggle}
      >
         <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-pure transition-all duration-300 ease-out ${checked ? 'left-[15px]' : 'left-0.5'}`}></div>
      </div>
    </div>
  );
};
