import React, { useState, useEffect } from "react";
import { File, Folder, HardDrive, Shield, CheckCircle2, Clock, RefreshCcw, Trash2, FileDown, FolderPlus } from "lucide-react";
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
}

export const VaultExplorer: React.FC = () => {
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [currentIno, setCurrentIno] = useState<number>(1);
  const [history, setHistory] = useState<number[]>([]);

  const fetchFiles = async () => {
    try {
      const result = await invoke<VaultFile[]>("list_vault_files");
      setFiles(result);
    } catch (e) {
      console.error("Failed to list vault files:", e);
    }
  };

  useEffect(() => {
    fetchFiles();
    
    // 1. Instant event-based updates
    const unlisten = listen<VaultFile[]>("vault-files-updated", (event) => {
      console.log("Real-time vault update received");
      setFiles(event.payload);
    });

    // 2. Polling fallback
    const interval = setInterval(fetchFiles, 5000);

    return () => {
      clearInterval(interval);
      unlisten.then(f => f());
    };
  }, []);

  const currentFiles = files.filter(f => 
    f.parent_ino === currentIno && 
    f.ino !== currentIno && 
    !f.name.startsWith('.')
  );
  const getPath = (ino: number): string => {
    if (ino === 1) return "";
    const f = files.find(x => x.ino === ino);
    if (!f) return "";
    const parentPath = getPath(f.parent_ino);
    return parentPath + "/" + f.name;
  };

  const currentPathName = getPath(currentIno) || "/";

  const navigateTo = (ino: number) => {
    setHistory([...history, currentIno]);
    setCurrentIno(ino);
  };

  const navigateBack = () => {
    const newHistory = [...history];
    const prev = newHistory.pop();
    if (prev !== undefined) {
      setHistory(newHistory);
      setCurrentIno(prev);
    }
  };

  const handleUpload = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: "Select File to Encrypt & Upload"
      });
      if (selected) {
        // Find path for current folder
        let pathParts = [];
        let tempIno = currentIno;
        while (tempIno !== 1) {
           const f = files.find(x => x.ino === tempIno);
           if (f) {
             pathParts.unshift(f.name);
             tempIno = f.parent_ino;
           } else break;
        }
        const destPrefix = pathParts.join("/");
        
        await invoke("upload_to_vault", { sourcePath: selected, destPrefix });
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
      // Find path for current folder
      let pathParts = [];
      let tempIno = currentIno;
      while (tempIno !== 1) {
         const f = files.find(x => x.ino === tempIno);
         if (f) {
           pathParts.unshift(f.name);
           tempIno = f.parent_ino;
         } else break;
      }
      
      const fullPath = pathParts.length > 0 ? `${pathParts.join("/")}/${newFolderName}` : newFolderName;

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
      {/* Explorer Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {history.length > 0 && (
              <button onClick={navigateBack} className="p-1 hover:bg-matte-lighter rounded transition-colors">
                <Clock className="w-4 h-4 rotate-180" />
              </button>
            )}
            <h2 className="text-2xl font-bold text-text-primary">AHS Explorer</h2>
          </div>
          <p className="text-sm text-text-secondary">
            Location: <span className="font-mono text-cyan/80">~/SecureAHS{currentPathName === "/" ? "" : currentPathName}</span>
          </p>
        </div>
        
        <div className="flex gap-3">
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

      {/* File List Table */}
      <div className="flex-1 bg-matte/40 rounded-2xl border border-border-primary overflow-hidden flex flex-col">
        <div className="grid grid-cols-12 px-6 py-4 border-b border-border-primary text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
          <div className="col-span-6">Name</div>
          <div className="col-span-2">Size</div>
          <div className="col-span-2">Modified</div>
          <div className="col-span-2 text-right">Protection</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {currentFiles.map((file) => (
              <motion.div 
                key={file.ino} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                onDoubleClick={() => file.kind === 'Directory' ? navigateTo(file.ino) : null}
                className="grid grid-cols-12 px-6 py-4 items-center border-b border-white/[0.02] hover:bg-white/[0.03] transition-all cursor-default group"
              >
                <div className="col-span-6 flex items-center gap-4">
                  {file.kind === 'Directory' ? (
                    <Folder className="w-5 h-5 text-blue/60" />
                  ) : (
                    <File className="w-5 h-5 text-text-secondary group-hover:text-cyan transition-colors" />
                  )}
                  <span className="text-sm font-medium text-text-primary">{file.name}</span>
                </div>
                
                <div className="col-span-2 text-xs font-mono text-text-tertiary">
                  {file.kind === 'Directory' ? '--' : (file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`)}
                </div>
                
                <div className="col-span-2 text-xs text-text-tertiary">
                  {new Date(file.modified_at * 1000).toLocaleDateString()} {new Date(file.modified_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                            // Calculate full relative path from root
                            let pathParts = [file.name];
                            let tempIno = file.parent_ino;
                            while (tempIno !== 1) {
                               const f = files.find(x => x.ino === tempIno);
                               if (f) {
                                 pathParts.unshift(f.name);
                                 tempIno = f.parent_ino;
                               } else break;
                            }
                            const fullPath = pathParts.join("/");

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
                            // Calculate full relative path from root
                            let pathParts = [file.name];
                            let tempIno = file.parent_ino;
                            while (tempIno !== 1) {
                               const f = files.find(x => x.ino === tempIno);
                               if (f) {
                                 pathParts.unshift(f.name);
                                 tempIno = f.parent_ino;
                               } else break;
                            }
                            const fullPath = pathParts.join("/");

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
...

        {/* Explorer Footer Status */}
        <div className="px-6 py-3 bg-matte border-t border-border-primary flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
              <CheckCircle2 className="w-3 h-3 text-emerald" />
              All Files Synced
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
              <HardDrive className="w-3 h-3 text-cyan" />
              Storage-Only Active
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald">
            <Clock className="w-3 h-3" />
            Live Disk Decryption Active
          </div>
        </div>
      </div>
      {/* Folder Name Modal */}
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
