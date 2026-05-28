import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CloudDownload, CheckCircle2, Loader2, FileIcon, Shield, Folder } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

interface VaultFile {
    ino: number;
    name: string;
    kind: "Directory" | "RegularFile";
    shadow_path?: string;
    cloud_blob_id?: string;
}

interface RestorationProgressProps {
    onComplete: () => void;
}

export const RestorationProgress: React.FC<RestorationProgressProps> = ({ onComplete }) => {
    const [files, setFiles] = useState<VaultFile[]>([]);
    const [progress, setProgress] = useState(0);
    const [isCompleting, setIsCompleting] = useState(false);

    useEffect(() => {
        const unlisten = listen<VaultFile[]>("vault-files-updated", (event) => {
            const fileList = event.payload;
            setFiles(fileList);
            
            const regularFiles = fileList.filter(f => f.kind === "RegularFile");
            const downloaded = regularFiles.filter(f => !!f.shadow_path).length;
            const total = regularFiles.length;
            
            if (total > 0) {
                const p = Math.round((downloaded / total) * 100);
                setProgress(p);
                
                if (p === 100 && total > 0 && !isCompleting) {
                    setIsCompleting(true);
                    // Give it a moment to show 100% before completing
                    setTimeout(onComplete, 2000);
                }
            } else if (fileList.length > 0 && regularFiles.length === 0 && !isCompleting) {
                // If there are ONLY directories, we are technically done immediately
                setProgress(100);
                setIsCompleting(true);
                setTimeout(onComplete, 1000);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [onComplete, isCompleting]);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-2xl w-full flex flex-col items-center p-12 bg-matte/60 backdrop-blur-xl border border-white/5 rounded-[40px] shadow-2xl"
        >
            <div className="relative mb-12">
                <div className="absolute inset-0 bg-cyan/20 blur-[60px] rounded-full animate-pulse-slow"></div>
                <div className="relative p-6 rounded-3xl bg-cyan/10 border border-cyan/20">
                    <CloudDownload className="w-16 h-16 text-cyan animate-bounce" />
                </div>
            </div>

            <h1 className="text-4xl font-bold text-text-primary tracking-tight mb-4">Reclaiming Your Vault</h1>
            <p className="text-text-secondary text-center max-w-md mb-12 leading-relaxed">
                We're securely downloading your encrypted data from the cloud relay and initializing your local storage.
            </p>

            {/* Main Progress Bar */}
            <div className="w-full mb-8">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">
                        Restoration Status
                    </span>
                    <span className="text-lg font-mono font-bold text-cyan">{progress}%</span>
                </div>
                <div className="h-2 w-full bg-graphite/40 rounded-full overflow-hidden border border-white/5 p-0.5">
                    <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className="h-full bg-cyan rounded-full shadow-[0_0_15px_rgba(0,242,255,0.4)]"
                    />
                </div>
            </div>

            {/* Files List */}
            <div className="w-full bg-graphite/20 rounded-2xl border border-white/5 p-6 max-h-60 overflow-y-auto custom-scrollbar">
                <div className="space-y-4">
                    {files.length === 0 ? (
                        <div className="flex flex-col items-center py-8 opacity-40">
                            <Loader2 className="w-6 h-6 animate-spin mb-2" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Awaiting cloud index...</span>
                        </div>
                    ) : (
                        files.map((file, i) => (
                            <motion.div 
                                key={file.ino}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="flex items-center justify-between group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${file.shadow_path || file.kind === "Directory" ? 'bg-cyan/10' : 'bg-white/5'}`}>
                                        {file.kind === "Directory" ? (
                                            <Folder className="w-3.5 h-3.5 text-cyan" />
                                        ) : (
                                            <FileIcon className={`w-3.5 h-3.5 ${file.shadow_path ? 'text-cyan' : 'text-text-tertiary'}`} />
                                        )}
                                    </div>
                                    <span className={`text-xs font-medium truncate max-w-[200px] ${file.shadow_path || file.kind === "Directory" ? 'text-text-primary' : 'text-text-tertiary'}`}>
                                        {file.name}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {file.shadow_path || file.kind === "Directory" ? (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald/10 border border-emerald/20">
                                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald" />
                                            <span className="text-[8px] font-bold text-emerald uppercase tracking-wider">Ready</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan/5 border border-cyan/10">
                                            <Loader2 className="w-2.5 h-2.5 text-cyan animate-spin" />
                                            <span className="text-[8px] font-bold text-cyan uppercase tracking-wider">Syncing</span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>

            <div className="mt-12 flex items-center gap-4 text-text-tertiary">
                <Shield className="w-4 h-4 opacity-40" />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em]">Zero-Knowledge Hardware-Signed Recovery</span>
            </div>
        </motion.div>
    );
};
