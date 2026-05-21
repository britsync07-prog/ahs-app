# Vault Mobile App - UI/UX Implementation Plan

## Objective
To build the `vault-mobile-auth` application with an "Apple-level polish" and "military-grade seriousness" aesthetic, acting as the primary biometric remote control and security dashboard for the Zero-Knowledge Vault.

## Core Aesthetic & Design System
- **Theme:** Exclusively Dark Mode.
- **Color Palette:**
  - **Primary:** Deep black, graphite, dark navy.
  - **Accent:** Neon cyan, emerald green, electric blue.
  - **Danger/Alert:** Deep red.
  - **Avoid:** Bright white, playful colors, cluttered social-media aesthetics.
- **Typography:** SF Pro / Inter / Satoshi. Large bold headers, thin futuristic labels.
- **Components:** Glassmorphism (dark translucent), glowing active icons, rounded corners, thin borders.
- **Animations:** Soft glow breathing, fingerprint pulse, holographic transitions, cinematic dimming for biometric prompts.

## Global Application Behaviors
1. **App Launch / Resume:**
   - Instant blur of background content.
   - Immediate Biometric (Face ID / Fingerprint) prompt.
   - App content is strictly invisible in the OS app switcher.
2. **Biometric Popups:**
   - Dimmed background, cinematic feel, animated biometric ring, success pulse.

---

## Phase 1: Navigation & Foundation
**Goal:** Establish the root layout and global styling.
- **Floating Bottom Navigation Bar:**
  - 5 Tabs: `Vault`, `Devices`, `Activity`, `Shield`, `Settings`.
  - Style: Dark translucent background, floating dock, minimal labels, glowing active state.

---

## Phase 2: The Vault Tab (Main Dashboard)
**Goal:** Build the primary view the user sees upon unlocking.
- **Top Header:** Profile avatar (Left), "Secure Vault" (Center), Notification bell & Status dot (Right - Green/Yellow/Red).
- **Hero Section:**
  - Large animated security card ("Vault Status: Protected", "AES-256 Encrypted").
  - Includes a subtle animated glow and a pulsing lock icon.
- **Quick Action Buttons (The Signature Feature):**
  - **Unlock Computer:** Large pill shape, glowing blue/green, fingerprint icon. Triggers device list -> Face ID -> Unlock signal.
  - **Lock All Devices:** Emergency kill switch. Outlined red button, shield icon.
- **Connected Device Cards:** Scrollable horizontal list (MacBook/Windows) showing status, battery, and quick actions (Lock/Unlock/Ping).
- **Live Security Status:** Small glassmorphism cards (Vault Health, Active Sessions, Threats Blocked, Last Backup).
- **Recent Activity Preview:** Mini feed routing to the Activity tab.

---

## Phase 3: Secondary Tabs Implementation
**Goal:** Build out the supporting management screens.

### 3.1 Devices Tab ("Find My" meets Enterprise Security)
- **Device List:** Visual cards of connected computers with status indicators (Green/Yellow/Red).
- **Device Details:** Specific controls (Unlock, Lock, Force Logout, Wipe Keys) and auto-lock slider settings (1m, 5m, 15m, instant).

### 3.2 Activity Tab (Security Timeline)
- **Chronological Feed:** Timestamped events with risk-level icons (e.g., "Face ID approved", "Suspicious link blocked").
- **Filter Bar:** All / Security / Backups / Devices / Threats.
- **Event Details:** Deep dive into location/IP/Action with remediation buttons ("Lock Device", "Report Threat").

### 3.3 Shield Tab (Active Threat Defense)
- **Hero:** Large circular Threat Score Meter.
- **Email Protection Card:** Scanned counts, blocked threats.
- **Live Toggles:** Switches for Phishing Detection, Unsafe WiFi, Background Scans, etc.

### 3.4 Settings Tab (Recovery & Preferences)
- **Master Key Section (Critical):** Large warning-styled card. "Never share it". Buttons to view recovery phrase or export PDF.
- **Security Settings:** Biometric requirements, Panic mode, multi-device approval.
- **Backup & Notifications:** Sync preferences and alert controls.

---

## Phase 4: Onboarding & Micro-Interactions
**Goal:** Polish the initial user experience and interaction feedback.
- **5-Screen Cinematic Onboarding:**
  1. "Your files should belong only to you."
  2. Phone unlocking computer animation.
  3. Zero-Knowledge visualization (encrypted shards).
  4. Write Down Recovery Key (Serious tone).
  5. Connect First Computer.
- **Micro-Interactions:**
  - Unlock success: Lock icon dissolves into a green wave pulse.
  - Threat detected: Subtle haptic vibration, red border flash.
  - Backup complete: Soft checkmark sweep.
