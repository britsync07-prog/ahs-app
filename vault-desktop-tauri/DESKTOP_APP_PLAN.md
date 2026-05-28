# Vault Desktop App - UI/UX & Architecture Plan

## 1. Core Philosophy: "The Invisible Fortress"
The desktop application is not a file manager; it is a **secure operating environment**. It remains invisible and the files inaccessible until the "Magic Unlock" occurs via the smartphone.
- **Tone:** Professional, Tactical, Serious, Futuristic.
- **UX Goal:** The "Magical Moment" when the virtual drive appears in the OS after a Face ID tap.

---

## 2. Design System & Platform Adaptation
- **Theme:** Matte Black, Graphite, Midnight Blue.
- **Accents:** Electric Cyan (Active), Emerald (Secure), Crimson (Danger).
- **Windows (Fluent/Sun Valley):** Acrylic blur, 1px borders, rounded corners, native mica effects.
- **macOS (Apple Silicon Aesthetic):** Frosted glass (Vibrancy), ultra-clean spacing, native sidebar behavior.
- **Typography:** SF Pro (Mac) / Segoe UI Variable (Windows).
- **Animations:** Precise holographic glows, particle transitions for encryption, cinematic vault "sliding" effects.

---

## 3. Structural Breakdown

### Phase 1: Lock Screen / Secure State (Default)
- **Visuals:** Blurred dashboard, large animated central Vault Symbol.
- **Action:** Huge glowing "Request Unlock" button.
- **Cinematics:** 
  - On Click: Animated signal pulses radiating from the vault.
  - Waiting: "Waiting for Face ID approval..." with phone silhouette.
  - Success: Vault animation "opens", the dashboard fades in, and the OS notifies: *“Secure Vault Mounted”*.

### Phase 2: Main Dashboard (Control Center)
- **Sidebar:** Minimal icons (Dashboard, Vault, Shield, Activity, Backups, Devices, Recovery, Settings). Labels expand on hover.
- **Hero Panel:** Large "VAULT ACTIVE" card with an animated shield and "Memory-Safe Mode" indicator.
- **Live Metrics:** Files Protected, Threats Blocked, Session Duration, Secure RAM Status.

### Phase 3: Vault Explorer (The Secure Manager)
- **UI:** Mimics native Finder/Explorer but with a "Security Overlay".
- **RAM-Only Indicator:** Every file has a "Memory Protected" badge. 
- **Interaction:** Opening a file triggers a "Decrypted in RAM" micro-animation. No temporary files are ever written to the physical disk.
- **Context Menu:** "Open Securely", "Share Encrypted Link", "Secure Delete (Wipe)".

### Phase 4: Security Center & Threat Shield
- **Security Score:** Large circular meter (0-100%).
- **Shield Page:** Elite cybersecurity dashboard. 
  - Modules: Email Protection, Process Isolation, Clipboard Monitoring.
  - Threat History: Tactical table of blocked processes and phishing attempts.
  - Quarantine: Isolated area for analyzing suspicious blobs.

### Phase 5: Backup, Sync & Recovery
- **Sync Dashboard:** Invisible background sync status. Bandwidth and encryption health.
- **Recovery Center:** High-stakes UI for the 24-word Master Key. 
  - Warning-styled "Reveal Phrase" workflow.
  - Emergency "Wipe & Revoke" kill switch.

---

## 4. Technical Integration (Tauri/Rust)
1. **Virtual Drive Mounting:**
   - **Windows:** Integration with WinFSP (Windows File System Proxy).
   - **macOS/Linux:** Integration with FUSE (Filesystem in Userspace).
2. **RAM-Only Engine:**
   - Files are streamed from the encrypted cloud, decrypted into a memory-mapped buffer, and served to the OS via the virtual drive.
   - **Key Zeroization:** On lock/idle, the Rust backend wipes the AES keys and flushes the RAM buffers using `zeroize` crates.
3. **Signaling:** WebSocket connection to the Go backend to listen for the "Unlock Approval" from the mobile device.
4. **Local Shield:** Background Rust thread monitoring local email paths and process memory for signature-based threat detection.

---

## 5. Global UI Behaviors
- **Auto-Lock:** If the system is idle for X minutes, the dashboard blurs, the drive unmounts, and the vault "closes".
- **Status Indicator:** A tiny, always-on-top floating "Security Bead" showing the current state (Locked/Unlocked/Scanning).
- **Tactical Notifications:** Dark cards with subtle glows for "Face ID Approved" or "Threat Blocked".
