import React, { useState, useEffect } from "react";
import { Smartphone, Monitor, Shield, Trash2, Clock, CheckCircle2 } from "lucide-react";
import { getBackendUrl } from "../config";

interface Device {
  name: string;
  os: string;
  status: string;
  last_active: string;
  public_key: string;
}

export const DeviceManagement: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDevices = async () => {
    try {
      const response = await fetch(`${getBackendUrl()}/api/vault/devices`);
      if (response.ok) {
        const data = await response.json();
        setDevices(data);
      }
    } catch (e) {
      console.error("Failed to fetch devices:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (pk: string, name: string, os: string) => {
    if (!confirm(`Are you sure you want to de-authorize "${name}"? This will immediately revoke access for all sessions matching this device.`)) return;

    try {
      const response = await fetch(`${getBackendUrl()}/api/vault/devices?public_key=${encodeURIComponent(pk)}&bulk=true`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setDevices(prev => prev.filter(d => d.name !== name || d.os !== os));
      } else {
        console.error("Failed to delete device");
      }
    } catch (e) {
      console.error("Delete error:", e);
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Authorized Devices</h2>
          <p className="text-sm text-text-secondary">Manage hardware keys and workstations linked to your AHS</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 overflow-y-auto pr-2 pb-20">
        {loading && devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-30">
            <div className="w-10 h-10 border-2 border-cyan border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-bold uppercase tracking-widest">Scanning Network...</p>
          </div>
        ) : (
          (() => {
            const seen = new Set<string>();
            return devices.filter(device => {
              const key = `${device.name}-${device.os}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }).map((device, idx) => (
              <div 
                key={idx}
                className={`p-6 rounded-3xl bg-matte border flex items-center justify-between group transition-all ${idx === 0 ? 'border-cyan/30 bg-cyan/5' : 'border-white/5 hover:border-white/10'}`}
              >
                <div className="flex items-center gap-6">
                  <div className={`p-4 rounded-2xl ${device.os.toLowerCase().includes('phone') || device.os.toLowerCase().includes('android') || device.os.toLowerCase().includes('ios') ? 'bg-cyan/10 text-cyan' : 'bg-blue/10 text-blue'}`}>
                    {device.os.toLowerCase().includes('phone') || device.os.toLowerCase().includes('android') || device.os.toLowerCase().includes('ios') ? <Smartphone size={24} /> : <Monitor size={24} />}
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-bold text-text-primary">{device.name}</h3>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald/10 border border-emerald/20">
                          <CheckCircle2 className="w-3 h-3 text-emerald" />
                          <span className="text-[9px] font-bold uppercase text-emerald tracking-tight">{device.status}</span>
                        </div>
                        {idx === 0 && !device.os.toLowerCase().includes('phone') && (
                          <span className="px-2 py-0.5 rounded-full bg-cyan/10 border border-cyan/20 text-[9px] font-bold uppercase text-cyan tracking-tight">Current Device</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-text-tertiary">
                      <span className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5" />
                        {device.os}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Last active: {new Date(device.last_active).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleDelete(device.public_key, device.name, device.os)}
                    className="p-3 rounded-xl hover:bg-red/10 text-text-tertiary hover:text-red transition-all"
                    title="De-authorize Device"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            ));
          })()
        )}

        {!loading && devices.length === 0 && (
           <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-20">
             <Smartphone size={48} />
             <p className="text-sm font-bold uppercase tracking-[0.2em]">No devices paired</p>
           </div>
        )}
      </div>
    </div>
  );
};
