import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export const TitleBar = () => {
  const appWindow = getCurrentWindow();

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.hide(); // Hide instead of close to keep tray alive

  return (
    <div 
      data-tauri-drag-region 
      className="fixed top-0 left-0 right-0 h-10 bg-[#0A0A0A]/40 backdrop-blur-xl flex items-center justify-between px-5 z-[200] border-b border-white/[0.03] select-none"
    >
      <div className="flex items-center gap-3 pointer-events-none">
        <div className="relative">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan shadow-[0_0_12px_rgba(0,242,255,0.8)]" />
          <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-cyan animate-pulse blur-[2px]" />
        </div>
        <span className="text-[9px] font-extrabold uppercase tracking-[0.3em] text-text-secondary/80">AHS / Workstation 01</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handleMinimize}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-text-secondary hover:text-white"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-text-secondary hover:text-white"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-400 transition-colors text-text-secondary"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
