import React, { useState, useEffect } from "react";
import { Shield, LayoutDashboard, Database, Activity, Smartphone, Key, Settings, Lock, Bell, HardDrive, Cpu, Sun, Moon, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@tauri-apps/api/core";
import { VaultExplorer } from "../components/VaultExplorer";
import { SecurityCenter } from "../components/SecurityCenter";
import { RecoveryCenter } from "../components/RecoveryCenter";
import { AutoLockSettings } from "../components/AutoLockSettings";
import { DeviceManagement } from "../components/DeviceManagement";

interface DashboardProps {
  onLock: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

type TabType = 'dashboard' | 'vault' | 'shield' | 'devices' | 'recovery' | 'settings';

export const Dashboard: React.FC<DashboardProps> = ({ onLock, theme, onToggleTheme }) => {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [stats, setStats] = useState({
    filesProtected: 0,
    threatsBlocked: 0,
    activeSessions: 0,
    storageUsed: "0 GB"
  });
  const [sessionStartTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState("00:00:00");
  
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('vault_settings');
    return saved ? JSON.parse(saved) : {
      ramIsolation: true,
      noTempFiles: true,
      wipeKeys: true,
      zeroize: true,
      isolation: true,
      forensics: true,
      notifications: true,
      backupAlerts: true,
      deviceWarnings: true
    };
  });

  useEffect(() => {
    localStorage.setItem('vault_settings', JSON.stringify(settings));
  }, [settings]);

  const toggleSetting = (key: string) => {
    setSettings((prev: any) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - sessionStartTime) / 1000);
      const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      setElapsedTime(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionStartTime]);

  const [desktopPk, setDesktopPk] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        let pk = desktopPk;
        if (!pk) {
          pk = await invoke("get_desktop_public_key");
          setDesktopPk(pk);
        }

        // 1. Fetch backend security stats
        const response = await fetch(`http://localhost:8080/api/vault/stats${pk ? `?public_key=${encodeURIComponent(pk)}` : ''}`);
        
        // 2. Fetch local file count (Real-time from shared state)
        const localFiles = await invoke<any[]>("list_vault_files").catch(() => []);
        
        if (response.ok) {
          const data = await response.json();
          const filesArray = Array.isArray(localFiles) ? localFiles : [];
          
          const isBlacklisted = (name: string) => {
            const n = name.toLowerCase();
            return (
              n.startsWith(".") ||
              n === "thumbs.db" ||
              n.startsWith("~$") ||
              n.includes(".trashinfo") ||
              n === "desktop.ini"
            );
          };

          // Merge local file count into stats
          setStats({
            ...data,
            filesProtected: filesArray.filter(f => f.kind === 'RegularFile' && !isBlacklisted(f.name)).length,
            totalFolders: Math.max(0, filesArray.filter(f => f.kind === 'Directory' && !isBlacklisted(f.name)).length - 1)
          });
        }
      } catch (e) {
        console.error("Failed to fetch dashboard stats:", e);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); 
    return () => clearInterval(interval);
  }, [desktopPk]);

  return (
    <div className="flex h-screen w-screen bg-pure text-text-primary overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 hover:w-64 transition-all duration-300 bg-matte border-r border-border-primary flex flex-col py-8 group z-50 overflow-x-hidden">
        <div className="mb-12 px-6 flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-cyan/10 shrink-0">
            <Shield className="w-8 h-8 text-cyan" />
          </div>
          <span className="text-2xl font-black tracking-widest text-cyan opacity-0 group-hover:opacity-100 transition-opacity">AHS</span>
        </div>
        
        <nav className="flex-1 flex flex-col gap-4 w-full px-4">
          <NavItem 
            icon={<LayoutDashboard />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')}
          />
          <NavItem 
            icon={<Database />} 
            label="AHS" 
            active={activeTab === 'vault'} 
            onClick={() => setActiveTab('vault')}
          />
          <NavItem 
            icon={<Activity />} 
            label="Shield" 
            active={activeTab === 'shield'} 
            onClick={() => setActiveTab('shield')}
          />
          <NavItem 
            icon={<Smartphone />} 
            label="Devices" 
            active={activeTab === 'devices'} 
            onClick={() => setActiveTab('devices')}
          />
          <NavItem 
            icon={<Key />} 
            label="Recovery" 
            active={activeTab === 'recovery'} 
            onClick={() => setActiveTab('recovery')}
          />
        </nav>

        <div className="mt-auto flex flex-col gap-4 w-full px-4">
          <NavItem 
            icon={<Settings />} 
            label="Settings" 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')}
          />
          <button 
            onClick={onLock}
            className="flex items-center gap-4 p-3 rounded-xl hover:bg-red/10 text-text-secondary hover:text-red transition-all group/btn"
          >
            <Lock className="w-6 h-6 shrink-0" />
            <span className="font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Lock AHS</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-pure/50 backdrop-blur-3xl">
        {/* Top Bar */}
        <header className="h-20 border-b border-border-primary flex items-center justify-between px-8">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald shadow-[0_0_10px_rgba(0,230,118,0.5)]"></div>
            <span className="text-sm font-bold tracking-widest uppercase text-emerald">AHS Active</span>
          </div>
          
          <div className="flex items-center gap-6">
            <button 
              onClick={onToggleTheme}
              className="p-2 rounded-lg hover:bg-white/5 transition-all text-text-secondary hover:text-text-primary"
              title={theme === 'light' ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <div className="text-right">
              <p className="text-xs text-text-tertiary font-bold uppercase tracking-wider">Session Time</p>
              <p className="text-sm font-mono text-text-primary">{elapsedTime}</p>
            </div>
          </div>
        </header>

        {/* Dynamic Dashboard Content */}
        <div className="p-8 overflow-y-auto flex-1">
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-12 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
              {/* Hero Card */}
              <div className="col-span-12 p-10 rounded-[2.5rem] bg-gradient-to-br from-white/5 to-transparent border border-white/10 relative overflow-hidden group shadow-2xl">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-cyan/10 rounded-full blur-[120px] -mr-40 -mt-40 group-hover:bg-cyan/20 transition-all duration-1000"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue/5 rounded-full blur-[60px] -ml-16 -mb-16"></div>
                
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="px-3 py-1 rounded-full bg-cyan/20 border border-cyan/30 text-[10px] font-bold uppercase tracking-widest text-cyan animate-pulse">
                      Live Environment
                    </div>
                  </div>
                  <h2 className="text-4xl font-extrabold mb-3 tracking-tight bg-gradient-to-r from-text-primary to-text-secondary bg-clip-text text-transparent">
                    Zero-Knowledge Fortress
                  </h2>
                  <p className="text-lg text-text-secondary mb-10 max-w-xl leading-relaxed">
                    Welcome to your isolated secure zone. All operations are performed strictly with disk-backed hardware-grade encryption.
                  </p>
                  
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setActiveTab('vault')}
                      className="px-6 py-3 rounded-xl bg-cyan text-pure font-bold hover:shadow-[0_0_20px_rgba(0,242,255,0.4)] transition-all flex items-center gap-3"
                    >
                      <Database className="w-5 h-5" />
                      Open Secure Drive
                    </button>
                    <button 
                      onClick={() => setActiveTab('settings')}
                      className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all font-bold"
                    >
                      AHS Settings
                    </button>
                  </div>
                </div>
              </div>

              <StatCard label="Files Protected" value={(stats.filesProtected ?? 0).toString()} sub="Syncing active" color="cyan" />
              <StatCard label="Threats Blocked" value={(stats.threatsBlocked ?? 0).toString()} sub="Real-time scan" color="red" />
              <StatCard label="Active Sessions" value={(stats.activeSessions ?? 0).toString()} sub="Authorized peers" color="emerald" />
              <StatCard label="Storage Used" value={stats.storageUsed ?? "0 B"} sub="of 50 GB" color="blue" />
            </div>
          )}

          {activeTab === 'vault' && <VaultExplorer />}
          {activeTab === 'shield' && <SecurityCenter />}
          {activeTab === 'recovery' && <RecoveryCenter />}
          
          {activeTab === 'settings' && (
            <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-700 pb-20">
               <div>
                  <h2 className="text-2xl font-bold text-text-primary">System Settings</h2>
                  <p className="text-sm text-text-secondary">Configure your secure operating environment</p>
               </div>

               <div className="grid grid-cols-2 gap-6">
                  <AutoLockSettings />
                  
                  <div className="p-6 rounded-3xl bg-matte border border-border-primary space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue/10 text-blue">
                        <HardDrive size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Storage Policies</h3>
                    </div>
                    <div className="space-y-4 pt-2">
                       <SettingToggle 
                         label="Strict Storage Isolation" 
                         description="Locks sensitive data in secure disk volumes and prevents unauthorized access."
                         checked={settings.ramIsolation} 
                         onToggle={() => toggleSetting('ramIsolation')} 
                       />
                       <SettingToggle 
                         label="Encrypted Swap Safety" 
                         description="Ensures no trace of your decrypted files ever touches the physical disk in unencrypted form."
                         checked={settings.noTempFiles} 
                         onToggle={() => toggleSetting('noTempFiles')} 
                       />
                       <SettingToggle 
                         label="Wipe Keys on Sleep" 
                         description="Instantly erases all encryption keys from active state when the system enters sleep or hibernation."
                         checked={settings.wipeKeys} 
                         onToggle={() => toggleSetting('wipeKeys')} 
                       />
                    </div>
                  </div>

                  <div className="p-6 rounded-3xl bg-matte border border-border-primary space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-emerald/10 text-emerald">
                        <Cpu size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Hardening</h3>
                    </div>
                     <div className="space-y-4 pt-2">
                        <SettingToggle 
                          label="Zeroize Buffers" 
                          description="Actively overwrites sensitive memory with zeros immediately after use, leaving no 'ghost' data."
                          checked={settings.zeroize} 
                          onToggle={() => toggleSetting('zeroize')} 
                        />
                        <SettingToggle 
                          label="Process Isolation" 
                          description="Uses kernel-level sandboxing to prevent other applications from reading AHS's private memory."
                          checked={settings.isolation} 
                          onToggle={() => toggleSetting('isolation')} 
                        />
                        <SettingToggle 
                          label="Anti-Forensics" 
                          description="Actively manages the application's system footprint and clears usage logs to hide presence."
                          checked={settings.forensics} 
                          onToggle={() => toggleSetting('forensics')} 
                        />
                     </div>
                  </div>

                  <div className="p-6 rounded-3xl bg-matte border border-border-primary space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-red/10 text-red">
                        <Bell size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Alerts</h3>
                    </div>
                     <div className="space-y-4 pt-2">
                        <SettingToggle 
                          label="Threat Notifications" 
                          description="High-priority alerts for unauthorized memory access attempts or filesystem hooks."
                          checked={settings.notifications} 
                          onToggle={() => toggleSetting('notifications')} 
                        />
                        <SettingToggle 
                          label="Backup Failure Alerts" 
                          description="Immediate warning if background cloud synchronization fails, preventing data loss."
                          checked={settings.backupAlerts} 
                          onToggle={() => toggleSetting('backupAlerts')} 
                        />
                        <SettingToggle 
                          label="New Device Warnings" 
                          description="Notifies you whenever a new mobile key or desktop client is paired with your identity."
                          checked={settings.deviceWarnings} 
                          onToggle={() => toggleSetting('deviceWarnings')} 
                        />
                     </div>
                  </div>
               </div>
            </div>
          )}

          {activeTab === 'devices' && <DeviceManagement />}
        </div>
      </main>
    </div>
  );
};

const NavItem = ({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`flex items-center gap-4 p-3 rounded-xl transition-all group/item ${active ? 'bg-cyan/10 text-cyan' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'}`}
  >
    <div className="w-6 h-6 shrink-0 flex items-center justify-center text-current">
      {icon}
    </div>
    <span className="font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{label}</span>
  </button>
);

const StatCard = ({ label, value, sub, color }: { label: string, value: string, sub: string, color: string }) => (
  <div className="col-span-3 p-6 rounded-2xl bg-matte border border-border-primary hover:border-white/10 transition-all">
    <p className="text-xs text-text-tertiary font-bold uppercase tracking-wider mb-2">{label}</p>
    <p className="text-2xl font-bold mb-1">{value}</p>
    <p className={`text-[10px] font-bold uppercase tracking-tighter text-${color}`}>{sub}</p>
  </div>
);

const SettingToggle = ({ label, description, checked, onToggle }: { label: string, description: string, checked: boolean, onToggle: () => void }) => {
  const [showInfo, setShowInfo] = useState(false);

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
          <Info size={12} className="text-text-tertiary cursor-help hover:text-cyan transition-colors" />
          
          <AnimatePresence>
            {showInfo && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute z-[100] left-0 bottom-full mb-2 w-48 p-3 rounded-xl bg-graphite border border-white/10 shadow-2xl pointer-events-none"
              >
                <p className="text-[10px] leading-relaxed text-text-primary font-medium">
                  {description}
                </p>
                <div className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-graphite"></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      <div 
        className={`w-8 h-4 rounded-full relative transition-all duration-300 cursor-pointer ${checked ? 'bg-cyan shadow-[0_0_10px_rgba(0,242,255,0.2)]' : 'bg-graphite'}`}
        onClick={onToggle}
      >
         <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-pure transition-all duration-300 ease-out ${checked ? 'left-[18px]' : 'left-0.5'}`}></div>
      </div>
    </div>
  );
};
