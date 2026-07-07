import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { LockScreen } from "./screens/LockScreen";
import { Dashboard } from "./screens/Dashboard";
import { QRCodeSVG } from "qrcode.react";
import { Shield, Smartphone, ArrowRight, CheckCircle2 } from "lucide-react";
import { MasterKeyScreen } from "./components/MasterKeyScreen";
import { TitleBar } from "./components/TitleBar";
import { RestorationProgress } from "./components/RestorationProgress";

function App() {
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);
  const [pairingPayload, setPairingPayload] = useState<string | null>(null);
  const [mobileKeys, setMobileKeys] = useState<{ public_key: string; x_public_key: string } | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [isWaitingForMobile, setIsWaitingForMobile] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isMounting, setIsMounting] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<"choice" | "pairing" | "master-key" | "restoring">("choice");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [googleConnected, setGoogleConnected] = useState<boolean>(false);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  const handleRestoreVault = async (phrase: string) => {
    setIsRestoring(true);
    setStatusMessage("Verifying cloud backup...");
    try {
      const exists = await invoke<boolean>("restore_vault", { mnemonic: phrase });
      if (exists) {
        setIsOnboarded(true);
        setOnboardingStep("restoring");
        // Start background download
        await invoke("mount_vault");
        // SLIGHT DELAY to ensure worker is ready and mounted
        await new Promise(resolve => setTimeout(resolve, 1000));
        await invoke("start_restoration_download");
      } else {
        setStatusMessage("No vault found for this phrase.");
      }
    } catch (e) {
      console.error("Restore failed:", e);
      setStatusMessage("Error connecting to cloud.");
    } finally {
      setIsRestoring(false);
    }
  };
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  // Single unified mount function
  const doMount = async () => {
    setIsMounting(true);
    setStatusMessage("Mounting secure drive...");
    try {
      await invoke("mount_vault");
      setUnlocked(true);
      setIsWaitingForMobile(false);
      setStatusMessage("");
    } catch (e) {
      console.error("Mount error:", e);
      setStatusMessage("Mount failed. Check logs.");
      setUnlocked(true);
    } finally {
      setIsMounting(false);
    }
  };

  const initIdentity = async () => {
    try {
      const payload = await invoke<any>("generate_desktop_identity");
      setPairingPayload(JSON.stringify(payload));
      setMnemonic(payload.mnemonic);
    } catch (e) {
      console.error("Identity init failed:", e);
    }
  };

  const handleGenerateMasterKey = async () => {
    try {
      await invoke("factory_reset");
      await initIdentity();
    } catch (e) {
      console.error("Master Key generation failed:", e);
    }
  };

  const handleFinishOnboarding = () => {
    if (!mobileKeys) return;
    setIsOnboarded(true);
    setStatusMessage("AHS identity established.");
    
    // Run in background so it doesn't freeze the UI
    invoke("complete_onboarding", { 
      mobilePublicKey: mobileKeys.public_key,
      mobileXPublicKey: mobileKeys.x_public_key
    }).catch(e => console.error(e));
    
    invoke("share_master_key_with_phone").catch(e => console.error(e));
  };

  const handleRequestUnlock = async () => {
    setIsWaitingForMobile(true);
    setStatusMessage("Pushing authorization to mobile...");
    try {
      await invoke("request_unlock_push");
    } catch (e) {
      console.error("Unlock request failed:", e);
      setStatusMessage("Push failed. Pair with mobile or use Master Key.");
      setIsWaitingForMobile(false);
    }
  };

  const handleOfflineUnlock = async (mnemonic: string) => {
    setIsMounting(true);
    setStatusMessage("Initializing offline decryption...");
    try {
      await invoke("unlock_offline", { mnemonic });
      setUnlocked(true);
      setIsWaitingForMobile(false);
      setStatusMessage("");
    } catch (e) {
      console.error("Offline unlock failed:", e);
      setStatusMessage("Invalid Master Key or Mount Failed.");
    } finally {
      setIsMounting(false);
    }
  };

  const handleLock = async () => {
    try {
      await invoke("lock_vault");
      setUnlocked(false);
    } catch (e) {
      console.error("Lock error:", e);
    }
  };

  const handleRevealMasterKey = async () => {
    setIsRevealing(true);
    try {
      await invoke("request_master_key_reveal");
    } catch (e) {
      console.error("Reveal master key push failed:", e);
      setIsRevealing(false);
    }
  };

  const handleClearRevealedMnemonic = () => {
    setRevealedMnemonic(null);
  };

  useEffect(() => {
    // 1. Check Onboarding Status
    invoke<boolean>("check_onboarding").then((status) => {
      setIsOnboarded(status);
      if (!status) {
        initIdentity();
      }
    });

    invoke<boolean>("is_google_connected").then(setGoogleConnected).catch(console.error);

    // 2. Listen for pairing success (from WebSocket client in Rust)
    const unlistenPairing = listen<{ public_key: string; x_public_key: string }>("pairing-success", (event) => {
       console.log("Pairing success event received:", event.payload);
       setMobileKeys(event.payload);
       // handleGenerateMasterKey(); // REMOVED: Identity is already established in initIdentity()
       setOnboardingStep("master-key");
    });

    const unlistenMount = listen("vault-do-mount", () => {
      console.log("Event: vault-do-mount received");
      doMount();
    });

    const unlistenAutoLock = listen("vault-auto-locked", () => {
      setUnlocked(false);
    });

    const unlistenMasterKeyRevealed = listen<string>("master-key-revealed", (event) => {
      console.log("Event: master-key-revealed received");
      setRevealedMnemonic(event.payload);
      setIsRevealing(false);
    });

    return () => {
      unlistenPairing.then((f) => f());
      unlistenMount.then((f) => f());
      unlistenAutoLock.then((f) => f());
      unlistenMasterKeyRevealed.then((f) => f());
    };
  }, []);

  // Global Activity Listener for Auto-Lock
  useEffect(() => {
    if (unlocked) {
      let lastReset = 0;
      const resetIdle = () => {
        const now = Date.now();
        if (now - lastReset > 1000) { // Throttle to 1s
          lastReset = now;
          invoke("reset_idle_timer").catch(console.error);
        }
      };
      
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
      events.forEach(name => document.addEventListener(name, resetIdle, { passive: true }));
      
      // Initial reset on unlock
      resetIdle();

      return () => {
        events.forEach(name => document.removeEventListener(name, resetIdle));
      };
    }
  }, [unlocked]);

  if (isOnboarded === null) return null;

  return (
    <div className="bg-pure min-h-screen text-text-primary selection:bg-cyan/30 pt-10">
      <TitleBar />
      <AnimatePresence mode="wait">
        {!isOnboarded ? (
          <motion.div
            key="onboarding-container"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="h-screen w-screen flex flex-col items-center justify-center p-8 bg-matte"
          >
            <AnimatePresence mode="wait">
              {onboardingStep === "choice" ? (
                <motion.div
                  key="step-choice"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex flex-col items-center max-w-lg w-full"
                >
                  <div className="mb-8 p-4 rounded-3xl bg-cyan/10 border border-cyan/20">
                    <Shield className="w-12 h-12 text-cyan" />
                  </div>
                  <h1 className="text-4xl font-bold mb-4 tracking-tight text-center">Welcome to Secure Vault</h1>
                  <p className="text-text-secondary text-sm mb-12 text-center leading-relaxed">
                    Connect your cloud storage, then choose how to initialize your vault.
                  </p>
                  
                  {/* Google Drive Connection UI */}
                  <div className="w-full mb-8">
                    <button
                      onClick={async () => {
                        setIsConnectingGoogle(true);
                        try {
                          const tokens = await invoke<any>("login_google");
                          await invoke("save_google_tokens", { 
                            accessToken: tokens.access_token, 
                            refreshToken: tokens.refresh_token 
                          });
                          setGoogleConnected(true);
                        } catch (e) {
                          console.error("Google login failed", e);
                        } finally {
                          setIsConnectingGoogle(false);
                        }
                      }}
                      disabled={googleConnected || isConnectingGoogle}
                      className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-center gap-3 ${
                        googleConnected 
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500" 
                          : "bg-graphite/40 border-border-primary hover:border-cyan/50 hover:bg-graphite/60 text-text-primary"
                      }`}
                    >
                      {isConnectingGoogle ? (
                         <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : googleConnected ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                           <path d="M12.0003 4.75C13.7703 4.75 15.3553 5.36 16.6053 6.54998L20.0303 3.125C17.9503 1.19 15.2353 0 12.0003 0C7.31028 0 3.25528 2.69 1.25028 6.60998L5.32028 9.76998C6.27528 6.83 9.00028 4.75 12.0003 4.75Z" fill="#EA4335" />
                           <path d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L20.18 21.265C22.57 19.015 23.49 15.92 23.49 12.275Z" fill="#4285F4" />
                           <path d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z" fill="#FBBC05" />
                           <path d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L15.8954 17.935C14.8154 18.665 13.5454 19.12 12.0004 19.12C8.86036 19.12 6.21536 17.25 5.26536 14.295L1.27536 17.39C3.25536 21.31 7.31036 24.0001 12.0004 24.0001Z" fill="#34A853" />
                        </svg>
                      )}
                      <span className="font-bold">
                        {isConnectingGoogle ? "Connecting..." : googleConnected ? "Google Drive Connected" : "Connect Google Drive"}
                      </span>
                    </button>
                  </div>
                  
                  <div className={`grid grid-cols-2 gap-6 w-full transition-opacity duration-300 ${!googleConnected ? 'opacity-50' : ''}`}>
                    <button 
                      onClick={() => setOnboardingStep("pairing")}
                      disabled={!googleConnected}
                      className="group p-8 rounded-3xl bg-graphite/40 border border-border-primary hover:border-cyan/50 hover:bg-graphite/60 transition-all text-left flex flex-col gap-4 disabled:pointer-events-none"
                    >
                      <div className="p-3 rounded-2xl bg-cyan/10 w-fit group-hover:bg-cyan/20 transition-colors">
                        <Smartphone className="w-6 h-6 text-cyan" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg mb-1">New Vault</h3>
                        <p className="text-xs text-text-tertiary">Scan QR to pair with mobile device.</p>
                      </div>
                    </button>

                    <button 
                      onClick={() => {
                        // We use the same mnemonic entry as LockScreen but for restoration
                        setMnemonic(""); 
                        setOnboardingStep("master-key");
                      }}
                      disabled={!googleConnected}
                      className="group p-8 rounded-3xl bg-graphite/40 border border-border-primary hover:border-cyan/50 hover:bg-graphite/60 transition-all text-left flex flex-col gap-4 disabled:pointer-events-none"
                    >
                      <div className="p-3 rounded-2xl bg-purple-500/10 w-fit group-hover:bg-purple-500/20 transition-colors">
                        <ArrowRight className="w-6 h-6 text-purple-500" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg mb-1">Restore Backup</h3>
                        <p className="text-xs text-text-tertiary">Recover using your 24-word key.</p>
                      </div>
                    </button>
                  </div>
                </motion.div>
              ) : onboardingStep === "pairing" ? (
                <motion.div
                  key="step-pairing"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex flex-col items-center"
                >
                  <div className="mb-8 p-4 rounded-2xl bg-cyan/10 border border-cyan/20">
                    <Shield className="w-12 h-12 text-cyan" />
                  </div>
                  <h1 className="text-3xl font-bold mb-2 tracking-tight">Establish Hardware Trust</h1>
                  <p className="text-text-secondary text-sm mb-12 text-center max-w-md leading-relaxed">
                    Scan this QR code with the AHS app on your phone to link your biometric identity to this workstation.
                  </p>
                  
                  <div className="bg-white p-6 rounded-3xl mb-12 shadow-[0_0_50px_rgba(0,242,255,0.15)] relative group">
                    {pairingPayload ? (
                      <QRCodeSVG value={pairingPayload} size={220} />
                    ) : (
                      <div className="w-[220px] h-[220px] flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-matte border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-text-tertiary">
                    <Smartphone className="w-5 h-5" />
                    <ArrowRight className="w-4 h-4 opacity-30" />
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]">End-to-End Secure Handshake</span>
                  </div>
                  
                  <button 
                    onClick={() => setOnboardingStep("choice")}
                    className="mt-8 text-text-tertiary text-[10px] font-bold uppercase tracking-[0.2em] hover:text-text-secondary"
                  >
                    Back
                  </button>
                </motion.div>
              ) : onboardingStep === "restoring" ? (
                <RestorationProgress onComplete={() => setUnlocked(true)} />
              ) : (
                <MasterKeyScreen 
                  mnemonic={mnemonic || ""} 
                  isRestoreMode={onboardingStep === "master-key" && mnemonic === ""}
                  onConfirm={handleFinishOnboarding}
                  onRestore={handleRestoreVault}
                  onRegenerate={handleGenerateMasterKey}
                  onBack={() => setOnboardingStep("choice")}
                  status={statusMessage}
                  isRestoring={isRestoring}
                />
              )}
            </AnimatePresence>
          </motion.div>
        ) : !unlocked ? (
          <motion.div
            key="lock-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
          >
            <LockScreen 
              onUnlockRequest={handleRequestUnlock}
              onOfflineUnlock={handleOfflineUnlock}
              isWaiting={isWaitingForMobile}
              status={statusMessage}
            />
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <Dashboard
              onLock={handleLock}
              theme={theme}
              onToggleTheme={toggleTheme}
              onRevealMasterKey={handleRevealMasterKey}
              revealedMnemonic={revealedMnemonic}
              onClearRevealedMnemonic={handleClearRevealedMnemonic}
              isRevealing={isRevealing}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mounting Overlay */}
      <AnimatePresence>
        {isMounting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-pure/60 backdrop-blur-sm flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-2 border-cyan border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-cyan">Initializing Storage Environment</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reveal Master Key overlay */}
      <AnimatePresence>
        {isRevealing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-pure/60 backdrop-blur-sm flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-2 border-cyan border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-cyan">Check your phone to approve...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
