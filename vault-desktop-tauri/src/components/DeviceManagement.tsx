import React, { useState, useEffect } from "react";
import { Smartphone, Monitor, Shield, Trash2, Clock, CheckCircle2, QrCode, X } from "lucide-react";
import { getBackendUrl } from "../config";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { listen } from "@tauri-apps/api/event";

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
  const [showPairingQR, setShowPairingQR] = useState(false);
  const [pairingPayload, setPairingPayload] = useState<any>(null);

  const fetchDevices = async () => {
    try {
      // Fetch devices from local Rust config
      const localDevices: any[] = await invoke("get_mobile_devices");
      
      // Also fetch from backend to get last_active status if needed
      const info: any = await invoke("get_desktop_identity_info");
      let backendDevices: any[] = [];
      try {
          const response = await fetch(`${getBackendUrl()}/api/vault/devices?public_key=${encodeURIComponent(info.public_key)}`);
          if (response.ok) {
              backendDevices = await response.json();
          }
      } catch (e) {}

      const merged = localDevices.map(ld => {
          const bd = backendDevices.find(b => b.public_key === ld.public_key);
          return {
              name: ld.name,
              os: bd?.os || "Mobile Device",
              status: bd ? "Online" : "Offline",
              last_active: bd?.last_active || new Date().toISOString(),
              public_key: ld.public_key
          };
      });
      setDevices(merged);
    } catch (e) {
      console.error("Failed to fetch devices:", e);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 15000);
    
    const unlistenPairing = listen<{ public_key: string; x_public_key: string }>("pairing-success", async (event: any) => {
       console.log("DeviceManagement pairing success:", event.payload);
       try {
           await invoke("add_mobile_device", {
               name: "Secondary Device",
               mobilePublicKey: event.payload.public_key,
               mobileXPublicKey: event.payload.x_public_key
           });
           setShowPairingQR(false);
           fetchDevices();
       } catch (e) {
           console.error("Failed to add mobile device:", e);
       }
    });

    return () => {
        clearInterval(interval);
        unlistenPairing.then((f: any) => f());
    };
  }, []);

  const handleDelete = async (pk: string, name: string) => {
    if (!confirm(`Are you sure you want to de-authorize "${name}"? This will immediately revoke access for all sessions matching this device.`)) return;

    try {
      await invoke("remove_mobile_device", { publicKey: pk });
      // Also delete from backend
      await fetch(`${getBackendUrl()}/api/vault/devices?public_key=${encodeURIComponent(pk)}&bulk=true`, {
        method: 'DELETE'
      }).catch(() => {});
      
      setDevices(prev => prev.filter(d => d.public_key !== pk));
    } catch (e) {
      console.error("Delete error:", e);
    }
  };

  const generatePairingQR = async () => {
    try {
      // We generate a fresh pairing nonce, but use the existing keys
      const payload: any = await invoke("generate_secondary_pairing_payload");
      setPairingPayload(payload);
      setShowPairingQR(true);
    } catch (e) {
      console.error("Failed to generate pairing payload:", e);
      alert("Failed to generate pairing code.");
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Authorized Devices</h2>
          <p className="text-sm text-text-secondary">Manage hardware keys and workstations linked to your AHS</p>
        </div>
        <button 
          onClick={generatePairingQR}
          className="px-4 py-2 bg-cyan/10 border border-cyan/30 text-cyan rounded-xl font-bold uppercase tracking-widest text-xs flex items-center gap-2 hover:bg-cyan hover:text-black transition-all"
        >
          <QrCode size={16} />
          Pair New Device
        </button>
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
                    onClick={() => handleDelete(device.public_key, device.name)}
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

      {showPairingQR && pairingPayload && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="glass border border-border-subtle p-8 rounded-[40px] max-w-sm w-full relative">
            <button 
              onClick={() => setShowPairingQR(false)}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/10 transition-colors"
            >
              <X size={24} className="text-text-secondary" />
            </button>
            
            <div className="text-center space-y-6">
              <h3 className="text-2xl font-black uppercase tracking-tight text-text-primary">Pair Secondary Device</h3>
              <p className="text-sm text-text-secondary">Scan this code using the AHS Mobile App or a secondary Web Auth node.</p>
              
              <div className="p-4 bg-white rounded-3xl mx-auto inline-block shadow-[0_0_30px_rgba(0,243,255,0.2)]">
                <QRCodeSVG 
                  value={JSON.stringify(pairingPayload)}
                  size={240}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <p className="text-[10px] text-text-tertiary uppercase tracking-widest font-bold">Waiting for device handshake...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
