import sys

with open('vault-desktop-tauri/src/components/DeviceManagement.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old_code = '''  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 15000);
    return () => clearInterval(interval);
  }, []);'''

new_code = '''  import { listen } from "@tauri-apps/api/event";

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 15000);
    
    const unlistenPairing = listen<{ public_key: string; x_public_key: string }>("pairing-success", async (event) => {
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
        unlistenPairing.then(f => f());
    };
  }, []);'''

c = c.replace(old_code, new_code)
# We also need to fetch from our local Rust backend since the backend devices are not the source of truth for push!
# Wait, the UI currently fetches devices from the HTTP backend `api/vault/devices`.
# The HTTP backend `api/vault/devices` returns a list of devices based on what registered with `target_public_key`.
# This is actually fine, but maybe we should just merge it with the local devices!
# Actually, the user wants to see the devices and manage them. Let's just rely on the local Rust `get_mobile_devices` for management.

fetch_old = '''    try {
      // Need the desktop's public key to fetch its authorized devices
      const info: any = await invoke("get_desktop_identity_info");
      
      const response = await fetch(`${getBackendUrl()}/api/vault/devices?public_key=${encodeURIComponent(info.public_key)}`);
      if (response.ok) {
        const data = await response.json();
        setDevices(data);
      }
    } catch (e) {
      console.error("Failed to fetch devices:", e);
    } finally {
      setLoading(false);
    }'''

fetch_new = '''    try {
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
    }'''

c = c.replace(fetch_old, fetch_new)

del_old = '''  const handleDelete = async (pk: string, name: string, os: string) => {
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
  };'''

del_new = '''  const handleDelete = async (pk: string, name: string, os: string) => {
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
  };'''

c = c.replace(del_old, del_new)

with open('vault-desktop-tauri/src/components/DeviceManagement.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
