import React from "react";
import { Trash2, RefreshCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

export const StorageMaintenance: React.FC = () => {
  const [isRunning, setIsRunning] = React.useState(false);

  const handleCleanup = async () => {
    if (!confirm("This will perform a DEEP SCAN of Google Drive and delete any files that are not part of your current vault. Proceed?")) {
      return;
    }

    setIsRunning(true);
    try {
      const purged = await invoke<number>("run_standalone_cleanup");
      alert(`Cleanup successful! Removed ${purged} orphaned files from Google Drive.`);
    } catch (e) {
      console.error("Cleanup failed:", e);
      alert(`Cleanup failed: ${e}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="p-6 rounded-3xl bg-red/5 border border-red/10 mt-6">
      <h4 className="text-sm font-bold text-text-primary mb-1">Deep Storage Cleanup</h4>
      <p className="text-xs text-text-secondary mb-4">
        Scans your Google Drive folder directly to find and delete "zombie" files that were left behind by sync errors.
      </p>
      <button 
        onClick={handleCleanup}
        disabled={isRunning}
        className="w-full py-4 rounded-xl bg-matte border border-red/20 text-red font-bold text-sm flex items-center justify-center gap-3 hover:bg-red/5 transition-all disabled:opacity-50"
      >
        {isRunning ? (
          <div className="w-5 h-5 border-2 border-red border-t-transparent rounded-full animate-spin"></div>
        ) : (
          <Trash2 className="w-5 h-5" />
        )}
        Run Deep Cleanup
      </button>
    </div>
  );
};
