import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clock, Shield } from "lucide-react";

export const AutoLockSettings: React.FC = () => {
  const [timeout, setTimeoutValue] = React.useState(() => {
    const saved = localStorage.getItem('vault_autolock_timeout');
    return saved ? parseInt(saved, 10) : 300;
  });

  React.useEffect(() => {
    localStorage.setItem('vault_autolock_timeout', timeout.toString());
    // Also inform backend on mount/change to ensure consistency
    invoke("set_auto_lock_timeout", { timeoutSecs: timeout }).catch(console.error);
  }, [timeout]);

  const handleTimeoutChange = (newVal: number) => {
    setTimeoutValue(newVal);
  };

  const options = [
    { label: "1 Minute", value: 60 },
    { label: "5 Minutes", value: 300 },
    { label: "15 Minutes", value: 900 },
    { label: "1 Hour", value: 3600 },
    { label: "Never", value: 9999999 }, // Effectively disabled
  ];

  return (
    <div className="p-6 rounded-3xl bg-matte border border-white/5 space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-cyan/10 text-cyan">
          <Clock size={20} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Auto-Lock Session</h3>
          <p className="text-[10px] text-text-secondary">AHS will automatically close after inactivity.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleTimeoutChange(opt.value)}
            className={`px-4 py-3 rounded-xl border text-xs font-bold transition-all ${
              timeout === opt.value
                ? "bg-cyan text-pure border-cyan shadow-[0_0_15px_rgba(0,242,255,0.3)]"
                : "bg-white/5 border-white/5 text-text-secondary hover:bg-white/10"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 p-3 rounded-xl bg-pure/40 border border-white/5">
        <Shield size={14} className="text-emerald" />
        <span className="text-[10px] text-text-tertiary font-medium">Aggressive auto-lock protects your data if the terminal is left unattended.</span>
      </div>
    </div>
  );
};
