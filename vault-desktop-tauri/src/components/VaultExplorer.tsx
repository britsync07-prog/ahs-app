import React, { useState, useEffect } from "react";
import { File, Folder, HardDrive, Shield, CheckCircle2, Clock, RefreshCcw, Trash2, FileDown, FolderPlus, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, message } from "@tauri-apps/plugin-dialog";

interface VaultFile {
  ino: number;
  parent_ino: number;
  name: string;
  kind: 'Directory' | 'RegularFile';
  size: number;
  modified_at: number;
  cloud_blob_id?: string;
  fullPath?: string;
}

export const VaultExplorer: React.FC = () => {
  const [backendFiles, setBackendFiles] = useState<VaultFile[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [googleConnected, setGoogleConnected] = useState<boolean>(true);

  const checkSyncStatus = async () => {
    try {
      const connected = await invoke<boolean>("is_google_connected");
      setGoogleConnected(connected);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchFiles = async () => {
    try {
      const result = await invoke<VaultFile[]>("list_vault_files");
      setBackendFiles(result);
    } catch (e) {
      console.error("Failed to list vault files:", e);
    }
  };

  useEffect(() => {
    fetchFiles();
    checkSyncStatus();
    const unlisten = listen<VaultFile[]>("vault-files-updated", (event) => {
      setBackendFiles(event.payload);
      checkSyncStatus();
    });
    const interval = setInterval(() => {
      fetchFiles();
      checkSyncStatus();
    }, 5000);
    return () => {
      clearInterval(interval);
      unlisten.then(f => f());
    };
  }, []);

  const currentFiles = React.useMemo(() => {
    const virtualFiles = new Map<string, VaultFile>();
    
    backendFiles.forEach(f => {
      if (f.name.startsWith('.')) return;
      
      const normalizedPath = f.name.replace(/\\/g, '/');
      const isUnderCurrent = currentPath === "" || normalizedPath.startsWith(currentPath + "/");
      
      if (isUnderCurrent) {
        const relativePath = currentPath === "" ? normalizedPath : normalizedPath.substring(currentPath.length + 1);
        const parts = relativePath.split('/');
        
        if (parts.length > 1) {
          const folderName = parts[0];
          if (!virtualFiles.has(folderName)) {
            virtualFiles.set(folderName, {
              ino: f.ino,
              parent_ino: f.parent_ino,
              name: folderName,
              kind: 'Directory',
              size: 0,
              modified_at: f.modified_at,
            });
          }
        } else if (parts.length === 1 && parts[0] !== "") {
          virtualFiles.set(parts[0], {
            ...f,
            name: parts[0],
            fullPath: f.name 
          });
        }
      }
    });
    return Array.from(virtualFiles.values());
  }, [backendFiles, currentPath]);

  const navigateTo = (folderName: string) => {
    setCurrentPath(prev => prev === "" ? folderName : `${prev}/${folderName}`);
  };

  const navigateBack = () => {
    if (currentPath === "") return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  const handleUpload = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: "Select File to Encrypt & Upload"
      });
      if (selected) {
        await invoke("upload_to_vault", { sourcePath: selected, destPrefix: currentPath });
        await message("File successfully encrypted and added to your secure vault.", { title: "Success", kind: "info" });
        fetchFiles();
      }
    } catch (e) {
      console.error("Upload error:", e);
      await message(String(e), { title: "Upload Failed", kind: "error" });
    }
  };

  const [isNamingFolder, setIsNamingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const handleNewFolder = async () => {
    if (!newFolderName.trim()) {
      setIsNamingFolder(true);
      return;
    }

    try {
      const fullPath = currentPath === "" ? newFolderName : `${currentPath}/${newFolderName}`;
      await invoke("create_vault_directory", { name: fullPath });
      setNewFolderName("");
      setIsNamingFolder(false);
      fetchFiles();
    } catch (e) {
      console.error("Folder error:", e);
      await message(String(e), { title: "Creation Failed", kind: "error" });
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {currentPath !== "" && (
              <button onClick={navigateBack} className="p-1 hover:bg-matte-lighter rounded transition-colors">
                <Clock className="w-4 h-4 rotate-180" />
              </button>
            )}
            <h2 className="text-2xl font-bold text-text-primary">AHS Explorer</h2>
          </div>
          <p className="text-sm text-text-secondary">
            Location: <span className="font-mono text-cyan/80">~/SecureAHS{currentPath === "" ? "" : "/" + currentPath}</span>
          </p>
        </div>
        
        <div className="flex gap-3">
          {!googleConnected && (
            <button 
              onClick={async () => {
                try {
                  const tokens = await invoke<any>("login_google");
                  await invoke("save_google_tokens", {
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token
                  });
                  checkSyncStatus();
                  await message("Google Drive connected successfully. Cloud backups are now active.", { title: "Success", kind: "info" });
                } catch (e) {
                  console.error(e);
                  await message(`Failed to connect Google Drive: ${e}`, { title: "Error", kind: "error" });
                }
              }}
              className="px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all flex items-center gap-2"
            >
              <RefreshCcw className="w-3 h-3 animate-pulse" />
              Connect Google Drive (Backups Disabled)
            </button>
          )}
          <button 
            onClick={fetchFiles} 
            className="p-2.5 rounded-xl bg-matte-lighter border border-white/5 text-text-tertiary hover:text-cyan hover:border-cyan/30 transition-all shadow-sm"
            title="Refresh Files"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
          <button onClick={handleNewFolder} className="px-5 py-2.5 rounded-xl bg-matte-lighter border border-white/5 text-xs font-bold uppercase tracking-wider hover:bg-white/10 hover:border-white/20 transition-all flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-text-tertiary" />
            New Folder
          </button>
          <button onClick={handleUpload} className="px-5 py-2.5 rounded-xl bg-cyan text-pure text-xs font-bold uppercase tracking-wider shadow-[0_0_20px_rgba(0,242,255,0.2)] hover:shadow-[0_0_30px_rgba(0,242,255,0.4)] hover:scale-[1.02] transition-all flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Upload Encrypted
          </button>
        </div>
      </div>

      <div className="flex-1 bg-matte/40 rounded-2xl border border-border-primary overflow-hidden flex flex-col">
        <div className="grid grid-cols-12 px-6 py-4 border-b border-border-primary text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
          <div className="col-span-5">Name</div>
          <div className="col-span-2">Size</div>
          <div className="col-span-2">Modified</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-2 text-right">Protection</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {currentFiles.map((file) => (
              <motion.div 
                key={file.name} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                onDoubleClick={() => file.kind === 'Directory' ? navigateTo(file.name) : null}
                className="grid grid-cols-12 px-6 py-4 items-center border-b border-white/[0.02] hover:bg-white/[0.03] transition-all cursor-default group"
              >
                <div className="col-span-5 flex items-center gap-4">
                  {file.kind === 'Directory' ? (
                    <Folder className="w-5 h-5 text-blue/60" />
                  ) : (
                    <File className="w-5 h-5 text-text-secondary group-hover:text-cyan transition-colors" />
                  )}
                  <span className="text-sm font-medium text-text-primary truncate">{file.name}</span>
                </div>
                
                <div className="col-span-2 text-xs font-mono text-text-tertiary">
                  {file.kind === 'Directory' ? '--' : (file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`)}
                </div>
                
                <div className="col-span-2 text-xs text-text-tertiary">
                  {new Date(file.modified_at * 1000).toLocaleDateString()}
                </div>

                <div className="col-span-1 flex justify-center">
                  {file.kind === 'RegularFile' && (
                    file.cloud_blob_id ? (
                      <div className="p-1.5 rounded-full bg-emerald/10 text-emerald" title="Synced to Cloud">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="p-1.5 rounded-full bg-amber-500/10 text-amber-500" title="Local Only / Syncing...">
                        <Clock className="w-3.5 h-3.5 animate-pulse" />
                      </div>
                    )
                  )}
                </div>

                 <div className="col-span-2 flex justify-end items-center gap-3">
                  {file.kind === 'RegularFile' ? (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald/10 border border-emerald/20">
                      <Shield className="w-3 h-3 text-emerald" />
                      <span className="text-[9px] font-bold uppercase text-emerald tracking-tighter">Secure Storage</span>
                    </div>
                  ) : null}
                  
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={async () => {
                        try {
                          const savePath = await open({
                            directory: true,
                            title: "Select Destination Folder"
                          });
                          if (savePath) {
                            const fullPath = file.fullPath || (currentPath === "" ? file.name : `${currentPath}/${file.name}`);
                            await invoke("download_from_vault", { 
                              name: fullPath, 
                              destPath: `${savePath}/${file.name}` 
                            });
                            await message("File successfully decrypted and exported.", { title: "Success", kind: "info" });
                          }
                        } catch (e) {
                          console.error("Download error:", e);
                          await message(`Failed to export: ${e}`, { title: "Error", kind: "error" });
                        }
                      }}
                      className="p-2 hover:bg-white/5 rounded-lg text-text-tertiary hover:text-cyan transition-colors"
                      title="Download/Export"
                    >
                      <FileDown className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={async () => {
                        if (confirm(`Are you sure you want to delete ${file.name}?`)) {
                          try {
                            const fullPath = file.fullPath || (currentPath === "" ? file.name : `${currentPath}/${file.name}`);
                            await invoke("delete_from_vault", { ino: file.ino, name: fullPath });
                            fetchFiles();
                          } catch (e) {
                            console.error("Delete error:", e);
                            await message(`Failed to delete: ${e}`, { title: "Error", kind: "error" });
                          }
                        }
                      }}
                      className="p-2 hover:bg-white/5 rounded-lg text-text-tertiary hover:text-red transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {currentFiles.length === 0 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full text-text-tertiary gap-4"
            >
              <HardDrive className="w-12 h-12 opacity-20" />
              <p className="text-sm font-medium uppercase tracking-widest">Folder is empty</p>
            </motion.div>
          )}
        </div>

        <div className="px-6 py-3 bg-matte border-t border-border-primary flex items-center justify-between">
          <div className="flex items-center gap-6">
            {googleConnected ? (
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald">
                <CheckCircle2 className="w-3 h-3" />
                Cloud Backups Active
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-500">
                <ShieldAlert className="w-3 h-3" />
                Local-Only Storage
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
              <HardDrive className="w-3 h-3 text-cyan" />
              Hardware Identity Verified
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald">
            <Clock className="w-3 h-3" />
            Zero-Knowledge Encryption Active
          </div>
        </div>
      </div>
      <AnimatePresence>
        {isNamingFolder && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-pure/60 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="w-full max-w-sm p-8 rounded-[2rem] bg-matte border border-border-primary shadow-2xl"
            >
              <h3 className="text-xl font-bold text-text-primary mb-2">New Folder</h3>
              <p className="text-sm text-text-secondary mb-6">Enter a name for your secure directory</p>
              
              <input 
                autoFocus
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewFolder();
                  if (e.key === 'Escape') {
                    setIsNamingFolder(false);
                    setNewFolderName("");
                  }
                }}
                placeholder="Folder Name"
                className="w-full px-5 py-3 rounded-xl bg-pure border border-border-primary text-text-primary focus:border-cyan focus:ring-1 focus:ring-cyan outline-none mb-6 transition-all"
              />
              
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    setIsNamingFolder(false);
                    setNewFolderName("");
                  }}
                  className="flex-1 px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-text-primary font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleNewFolder}
                  className="flex-1 px-6 py-3 rounded-xl bg-cyan text-pure font-bold hover:shadow-[0_0_20px_rgba(0,242,255,0.4)] transition-all"
                >
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};