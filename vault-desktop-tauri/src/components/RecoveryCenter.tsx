import React from "react";
import { Cloud, History, RefreshCcw, HardDrive, Info, Key, Copy, CheckCircle2, ShieldAlert, X, Eye, Database, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";

interface RecoveryCenterProps {
  onRevealMasterKey: () => void;
  revealedMnemonic: string | null;
  onClearRevealedMnemonic: () => void;
}

export const RecoveryCenter: React.FC<RecoveryCenterProps> = ({ onRevealMasterKey, revealedMnemonic, onClearRevealedMnemonic }) => {
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [stats, setStats] = React.useState<any>(null);
  const [copied, setCopied] = React.useState(false);
  const [isPurging, setIsPurging] = React.useState(false);
  const [purgeResult, setPurgeResult] = React.useState<string | null>(null);
  const [showPurgeConfirm, setShowPurgeConfirm] = React.useState(false);
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

  const handleCopy = () => {
    if (revealedMnemonic) {
      navigator.clipboard.writeText(revealedMnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const words = revealedMnemonic ? revealedMnemonic.split(" ") : [];

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
                      console.error("Sync failed:", e);
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

        {/* Master Key Section */}
        <div className="col-span-12 space-y-4 mt-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-tertiary px-2">Master Recovery Key</h3>
          <div className="p-6 rounded-3xl bg-amber-500/5 border border-amber-500/10">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text-primary">24-Word Master Key</h4>
                  <p className="text-[10px] text-text-tertiary">Phone authorization required to reveal</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-text-secondary mb-5 leading-relaxed">
              Your master key is the <span className="text-amber-500 font-bold">only way</span> to recover your vault if you lose your phone.
              For security, your phone must authorize each reveal.
            </p>
            <button
              onClick={onRevealMasterKey}
              className="w-full py-4 rounded-xl bg-amber-600 text-pure font-bold text-sm shadow-[0_0_20px_rgba(217,119,6,0.2)] flex items-center justify-center gap-3 transition-all hover:scale-[1.01] active:scale-[0.98]"
            >
              <Eye className="w-5 h-5" />
              Reveal Master Key
            </button>
          </div>
        </div>

        {/* Orphaned Blobs Section */}
        <div className="col-span-12 space-y-4 mt-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-tertiary px-2">Cloud Storage Maintenance</h3>
          <div className="p-6 rounded-3xl bg-rose-500/5 border border-rose-500/10">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-text-primary">Purge Orphaned Cloud Blobs</h4>
                <p className="text-[10px] text-text-tertiary">Remove unreferenced files from Google Drive</p>
              </div>
            </div>
            <p className="text-xs text-text-secondary mb-5 leading-relaxed">
              Over time, deleted files may leave behind orphaned encrypted blobs in your cloud storage.
              This scans Google Drive for blobs not referenced by any vault index and removes them.
            </p>
            {purgeResult && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-500 font-medium">
                {purgeResult}
              </div>
            )}
            <button
              onClick={() => setShowPurgeConfirm(true)}
              disabled={isPurging}
              className="w-full py-4 rounded-xl bg-rose-600 text-pure font-bold text-sm shadow-[0_0_20px_rgba(225,29,72,0.2)] flex items-center justify-center gap-3 disabled:opacity-50 transition-all hover:scale-[1.01] active:scale-[0.98]"
            >
              {isPurging ? (
                <div className="w-5 h-5 border-2 border-pure border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Trash2 className="w-5 h-5" />
              )}
              {isPurging ? "Purging..." : "Scan & Purge Orphaned Blobs"}
            </button>
          </div>
        </div>
      </div>

      {/* Purge Confirmation Modal */}
      <AnimatePresence>
        {showPurgeConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md flex items-center justify-center p-8"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="max-w-md w-full bg-matte rounded-3xl border border-rose-500/20 p-8 shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-rose-500/10">
                  <ShieldAlert className="w-5 h-5 text-rose-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">Confirm Purge</h3>
                  <p className="text-[10px] text-text-tertiary">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-xs text-text-secondary mb-6 leading-relaxed">
                This will scan Google Drive for encrypted blobs not referenced by your vault index
                and permanently delete them. Only blobs with no matching local or backend reference
                will be removed. Your active files are safe.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setIsPurging(true);
                    setShowPurgeConfirm(false);
                    setPurgeResult(null);
                    try {
                      const result = await invoke<string>("cleanup_orphaned_blobs");
                      setPurgeResult(result);
                    } catch (e) {
                      setPurgeResult(`Error: ${e}`);
                    } finally {
                      setIsPurging(false);
                    }
                  }}
                  className="flex-1 py-4 rounded-xl bg-rose-600 text-pure font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
                >
                  <Trash2 className="w-4 h-4" />
                  Yes, Purge Orphans
                </button>
                <button
                  onClick={() => setShowPurgeConfirm(false)}
                  className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-text-secondary font-bold text-sm hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Master Key Reveal Modal */}
      <AnimatePresence>
        {revealedMnemonic && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md flex items-center justify-center p-8"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="max-w-2xl w-full bg-matte rounded-3xl border border-amber-500/20 p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/10">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">Your Master Recovery Key</h3>
                    <p className="text-[10px] text-text-tertiary">Never share these words with anyone</p>
                  </div>
                </div>
                <button
                  onClick={onClearRevealedMnemonic}
                  className="p-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-text-primary transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mb-8">
                {words.map((word, i) => (
                  <div
                    key={i}
                    className="bg-pure/40 border border-white/5 rounded-xl p-3 flex items-center gap-2"
                  >
                    <span className="text-[9px] font-bold text-text-tertiary w-3 shrink-0">{i + 1}</span>
                    <span className="text-xs font-bold text-text-primary tracking-wide">{word}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCopy}
                  className="flex-1 py-4 rounded-xl bg-amber-600 text-pure font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy to Clipboard
                    </>
                  )}
                </button>
                <button
                  onClick={onClearRevealedMnemonic}
                  className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-text-secondary font-bold text-sm hover:bg-white/10 transition-all"
                >
                  Close
                </button>
              </div>

              <p className="mt-4 text-[10px] text-amber-500/70 text-center font-medium">
                For your security, this key was shown only after phone authorization.
                Store it offline — never digitally.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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