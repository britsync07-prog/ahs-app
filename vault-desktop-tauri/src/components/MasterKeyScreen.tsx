import { motion } from "framer-motion";
import { Copy, RefreshCw, CheckCircle2, ShieldAlert, Key, ArrowLeft } from "lucide-react";
import { useState } from "react";

interface MasterKeyScreenProps {
  mnemonic: string;
  isRestoreMode?: boolean;
  onConfirm: () => void;
  onRestore?: (phrase: string) => void;
  onRegenerate: () => void;
  onBack?: () => void;
  status?: string;
  isRestoring?: boolean;
}

export function MasterKeyScreen({ 
  mnemonic, 
  isRestoreMode, 
  onConfirm, 
  onRestore,
  onRegenerate,
  onBack,
  status,
  isRestoring
}: MasterKeyScreenProps) {
  const words = mnemonic.split(" ");
  const [copied, setCopied] = useState(false);
  const [inputPhrase, setInputPhrase] = useState("");

  const handleCopy = () => {
    navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isRestoreMode) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-xl w-full flex flex-col items-center"
      >
        <div className="mb-8 p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20">
          <Key className="w-12 h-12 text-purple-500" />
        </div>

        <h1 className="text-3xl font-bold mb-2 tracking-tight text-center">Restore from Backup</h1>
        <p className="text-text-secondary text-sm mb-8 text-center leading-relaxed">
          Enter your 24-word Master Key to reclaim your vault from the cloud.
        </p>

        {status && (
          <div className={`mb-6 p-4 rounded-xl text-xs font-bold uppercase tracking-wider w-full text-center ${status.includes("No vault") || status.includes("Error") ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-cyan-500/10 text-cyan-500 border border-cyan-500/20"}`}>
            {status}
          </div>
        )}

        <div className="w-full relative group mb-8">
          <div className="absolute -inset-1 bg-purple-500/20 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
          <textarea
            value={inputPhrase}
            onChange={(e) => setInputPhrase(e.target.value)}
            placeholder="Paste your 24-word Master Key phrase here..."
            className="relative w-full h-40 bg-graphite/40 border border-border-primary rounded-2xl p-6 text-purple-400 font-mono text-sm focus:outline-none focus:border-purple-500/50 backdrop-blur-md transition-all resize-none"
          />
        </div>

        <div className="flex flex-col gap-4 w-full">
          <button
            onClick={() => onRestore?.(inputPhrase)}
            disabled={isRestoring || inputPhrase.trim().split(/\s+/).length < 12}
            className="w-full py-4 bg-purple-600 text-pure font-bold rounded-full shadow-[0_0_30px_rgba(147,51,234,0.2)] hover:shadow-[0_0_40px_rgba(147,51,234,0.4)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRestoring && <RefreshCw className="w-4 h-4 animate-spin" />}
            {isRestoring ? "Verifying..." : "Verify & Restore Vault"}
          </button>
          
          <button 
            onClick={onBack}
            className="group flex items-center justify-center gap-2 text-text-tertiary text-[10px] font-bold uppercase tracking-[0.2em] hover:text-text-secondary transition-colors py-2"
          >
            <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
            Back to Options
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl w-full flex flex-col items-center"
    >
      <div className="mb-8 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
        <ShieldAlert className="w-12 h-12 text-amber-500" />
      </div>

      <h1 className="text-3xl font-bold mb-2 tracking-tight text-center">Your Master Recovery Key</h1>
      <p className="text-text-secondary text-sm mb-8 text-center leading-relaxed">
        These 24 words are the <span className="text-cyan font-bold underline">only way</span> to recover your vault if you lose your phone. 
        Write them down on paper and store them in a safe place. 
        <br />
        <span className="text-amber-500 font-medium italic">Never share these words with anyone.</span>
      </p>

      <div className="grid grid-cols-3 md:grid-cols-4 gap-3 mb-8 w-full">
        {words.map((word, i) => (
          <div 
            key={i} 
            className="bg-matte-lighter border border-white/5 rounded-xl p-3 flex items-center gap-3 group hover:border-cyan/30 transition-colors"
          >
            <span className="text-[10px] font-bold text-text-tertiary w-4">{i + 1}</span>
            <span className="text-sm font-bold text-text-primary tracking-wide">{word}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full">
        <button
          onClick={onConfirm}
          className="flex-1 bg-cyan text-pure py-4 rounded-2xl font-bold text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan/20"
        >
          <CheckCircle2 className="w-4 h-4" />
          I've Written It Down
        </button>
        
        <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="p-4 rounded-2xl bg-matte-lighter border border-border-primary text-text-secondary hover:text-text-primary transition-all flex items-center gap-2"
              title="Copy to clipboard (Not Recommended for security)"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald" /> : <Copy className="w-4 h-4" />}
              <span className="text-xs font-bold">{copied ? "Copied" : "Copy"}</span>
            </button>

            <button
              onClick={onRegenerate}
              className="p-4 rounded-2xl bg-matte-lighter border border-border-primary text-text-secondary hover:text-text-primary transition-all"
              title="Regenerate Seed"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
        </div>
      </div>

      <button 
        onClick={onBack}
        className="mt-8 text-text-tertiary text-[10px] font-bold uppercase tracking-[0.2em] hover:text-text-secondary"
      >
        Back
      </button>
    </motion.div>
  );
}

