# Vault Web Auth Theme & Scanner Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `vault-web-auth` project to mirror the native Android app's light theme and resolve the camera scanning issues.

**Architecture:** 
- Centralized theme management using CSS variables and a root `.dark` class.
- State-driven theme initialization in the main `App` component.
- Low-level camera control using the `Html5Qrcode` class for improved reliability and permission handling.

**Tech Stack:** React, Tailwind CSS, Lucide React, `html5-qrcode`.

---

### Task 1: Theme System Foundations

**Files:**
- Modify: `vault-web-auth/src/index.css`
- Modify: `vault-web-auth/src/App.tsx`

- [ ] **Step 1: Update CSS variables in `index.css`**
Update `index.css` to define light mode defaults and dark mode overrides.

```css
@import "tailwindcss";

:root {
  --background: #F2F2F7;
  --surface: #FFFFFF;
  --text: #000000;
  --border: #D1D1D6;
  --primary: #00f3ff;
  --success: #10b981;
  --danger: #ef4444;
  --blue: #2563eb;
}

.dark {
  --background: #000000;
  --surface: #121212;
  --text: #F2F2F7;
  --border: #333333;
}

@theme {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-text: var(--text);
  --color-border: var(--border);
  --color-neon-cyan: var(--primary);
  --color-emerald-green: var(--success);
  --color-deep-red: var(--danger);
  --color-electric-blue: var(--blue);
}

body {
  @apply bg-background text-text font-sans antialiased;
  background-color: var(--background);
  transition: background-color 0.3s ease, color 0.3s ease;
}

@layer components {
  .glass {
    @apply bg-surface/80 backdrop-blur-xl border border-border/50 shadow-sm;
  }
  
  .glass-dark {
    @apply bg-black/40 backdrop-blur-2xl border border-white/5;
  }

  .neon-glow {
    box-shadow: 0 0 15px rgba(0, 243, 255, 0.3);
  }

  .neon-border {
    @apply border border-neon-cyan/30;
  }
}
```

- [ ] **Step 2: Initialize Theme in `App.tsx`**
Update `App.tsx` to manage the `isDarkTheme` state.

```tsx
// Inside App function
const [isDarkTheme, setIsDarkTheme] = useState(false);

useEffect(() => {
  if (isDarkTheme) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}, [isDarkTheme]);
```

- [ ] **Step 3: Update Main App Container**
Replace `bg-black text-white` with `bg-background text-text` in the root divs.

- [ ] **Step 4: Commit Theme Foundations**
```bash
git add vault-web-auth/src/index.css vault-web-auth/src/App.tsx
git commit -m "style: implement light/dark theme system with CSS variables"
```

---

### Task 2: Component Theme Alignment

**Files:**
- Modify: `vault-web-auth/src/screens/Dashboard.tsx`
- Modify: `vault-web-auth/src/components/dashboard/SecurityHeroCard.tsx`
- Modify: `vault-web-auth/src/components/dashboard/LiveStatusGrid.tsx`
- Modify: `vault-web-auth/src/components/FloatingNavBar.tsx`
- Modify: `vault-web-auth/src/components/dashboard/QuickActionButtons.tsx`

- [ ] **Step 1: Update Dashboard Header and Text**
Replace hardcoded `text-white/40` and `text-white/30` with `text-text/40` and `text-text/30`. Update buttons to use `glass` instead of hardcoded dark styles.

- [ ] **Step 2: Refine SecurityHeroCard**
Update the gradient and colors. In light mode, use a white surface with subtle shadow.

```tsx
// vault-web-auth/src/components/dashboard/SecurityHeroCard.tsx
// Update the main container className:
"relative overflow-hidden rounded-[40px] p-8 bg-surface border border-border/50 shadow-xl"
```

- [ ] **Step 3: Refine LiveStatusGrid**
Update grid items to use `bg-surface` and `border-border`.

- [ ] **Step 4: Refine FloatingNavBar**
Update to use `bg-surface/90` and `border-border`.

- [ ] **Step 5: Refine QuickActionButtons**
Ensure buttons have appropriate contrast in light mode.

- [ ] **Step 6: Commit Component Updates**
```bash
git add vault-web-auth/src/components/ vault-web-auth/src/screens/
git commit -m "style: refine components for theme compatibility"
```

---

### Task 3: Camera Scanner Robustness

**Files:**
- Modify: `vault-web-auth/src/components/Scanner.tsx`

- [ ] **Step 1: Rewrite Scanner with `Html5Qrcode`**
Replace the high-level scanner with the low-level class for better control.

```tsx
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, AlertCircle, RefreshCw } from 'lucide-react';

interface ScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export const Scanner = ({ onScan, onClose }: ScannerProps) => {
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const startScanner = async () => {
    setError(null);
    setIsInitializing(true);
    try {
      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      
      await html5QrCode.start(
        { facingMode: "environment" },
        { 
          fps: 10, 
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        },
        (decodedText) => {
          html5QrCode.stop().then(() => onScan(decodedText));
        },
        undefined
      );
      setIsInitializing(false);
    } catch (err) {
      console.error(err);
      setError("Camera permission denied or camera not found. Please ensure you have granted camera access.");
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    startScanner();

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center animate-in fade-in duration-500">
      <div className="w-full p-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 glass rounded-xl flex items-center justify-center">
            <Camera size={20} className="text-neon-cyan" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight uppercase">Pairing</h2>
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-deep-red' : 'bg-neon-cyan animate-pulse'}`} />
              <span className="text-[10px] font-bold text-text/40 uppercase tracking-widest">
                {error ? 'Camera Error' : 'Live Camera Active'}
              </span>
            </div>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-3 glass rounded-full hover:bg-text/10 transition-colors"
        >
          <X size={20} className="text-text" />
        </button>
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center px-8 space-y-12">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black tracking-tight">Link Workstation</h1>
          <p className="text-text/40 max-w-[240px] mx-auto text-sm">Align the QR code on your desktop app with the scanner frame below.</p>
        </div>

        <div className="relative aspect-square w-full max-w-sm rounded-[48px] overflow-hidden border border-border/50 shadow-2xl bg-black">
          <div id="reader" className="w-full h-full"></div>
          
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-4 bg-surface/90 backdrop-blur-md">
              <AlertCircle size={48} className="text-deep-red" />
              <p className="text-sm font-medium text-text/70">{error}</p>
              <button 
                onClick={startScanner}
                className="px-6 py-2 bg-neon-cyan text-black rounded-full font-bold text-xs uppercase tracking-widest"
              >
                Retry Camera
              </button>
            </div>
          ) : isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface">
              <RefreshCw className="text-neon-cyan animate-spin" size={32} />
            </div>
          )}
          
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[260px] h-[260px] relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-neon-cyan rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-neon-cyan rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-neon-cyan rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-neon-cyan rounded-br-2xl" />
              <div className="absolute top-0 left-0 w-full h-0.5 bg-neon-cyan shadow-[0_0_15px_#00f3ff] animate-scan opacity-60"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit Scanner Fix**
```bash
git add vault-web-auth/src/components/Scanner.tsx
git commit -m "fix: rewrite scanner using Html5Qrcode for better iOS support and permission handling"
```

---

### Task 4: Final Validation

- [ ] **Step 1: Run Build**
```bash
cd vault-web-auth && npm run build
```

- [ ] **Step 2: Verify Linting**
```bash
cd vault-web-auth && npm run lint
```
