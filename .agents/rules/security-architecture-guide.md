---
trigger: always_on
---

# SYSTEM DIRECTIVE: ZERO-KNOWLEDGE BIOMETRIC VAULT

**ROLE:** You are an expert cybersecurity systems architect and principal engineer. This document contains the immutable architecture for our Zero-Knowledge Biometric Vault. Before writing any code, scaffolding any directories, or answering any questions, you must read this document to understand the context, the tech stack (Rust, Go, Swift/Kotlin), and the military-grade security constraints. Never write, suggest, or generate code that violates these memory-safety or cryptographic standards.

---

## PART 1: THE THREE-REPOSITORY STRUCTURE
You will be assisting in building this system across three distinct codebases. You must maintain clear boundaries between them:

1. **vault-backend-go:** The "Blind Cloud." Built in Go (Golang). Manages WebSockets for real-time signaling, stores encrypted blobs in MinIO (S3-compatible), and manages user metadata in PostgreSQL. It never sees a private key or an unencrypted file.
2. **vault-mobile-auth:** The "Biometric Key." Built in Swift (iOS) and Kotlin (Android). Interacts directly with hardware security (Secure Enclave / Keystore). Uses `libsodium` for Ed25519 signatures and Curve25519 key exchange.
3. **vault-desktop-tauri:** The "Local Vault." Built with Tauri (React + Rust). Handles the virtual drive OS hooks, performs AES-256-GCM encryption/decryption strictly in RAM, and manages the local UI.

---

## PART 2: THE 5 PILLARS OF IMPLEMENTATION (REFERENCE ARCHITECTURES)
When generating code or architecture for specific features, you must reference, adapt, and learn from the following open-source implementations to ensure best-in-class security.

### Pillar 1: Zero-Knowledge Storage
*Focus: Client-side encryption engine, secure vault API, and E2E encrypted sync.*
* **s3drive/s3drive:** Desktop client for E2E encrypted sync and mounting.
* **ProtonMail/WebClients:** Reference for zero-knowledge cross-platform sync.
* **jlinoff/pam:** Strictly local, file-based AES-256 encrypted blobs.
* **keepassxreboot/keepassxc:** Local database sovereignty.
* **securitybunker/databunker:** Secure vault API for PII/PHI records.

### Pillar 2: Biometric "Magic Unlock"
*Focus: Phone-as-key cryptographic authenticator, hardware-backed keys, touchless/proximity unlocking.*
* **lowRISC/opentitan:** Open-source silicon root of trust for hardware-backed keys.
* **duo-labs/webauthn:** Go implementation of WebAuthn for biometric challenges.
* **Yubico/yubico-piv-tool:** Used with PAM for touchless/proximity unlocking.
* **narwhalacademy/zebra-crossing:** Mobile device hardening protocols.

### Pillar 3: Memory-Only & Virtual Drives
*Focus: Virtual secure drive mounting, RAM-safe handling, memory zeroing, no disk writes.*
* **libfuse/libfuse:** Filesystem in Userspace for Linux/macOS mounting.
* **dokan-dev/dokany:** FUSE equivalent for Windows virtual drives.
* **billziss-gh/winfsp:** Windows File System Proxy.
* **veracrypt/VeraCrypt:** On-the-fly encryption and virtual drive volumes.
* **cryfs/cryfs:** Encrypted cloud-focused filesystem.

### Pillar 4: Localized Threat Protection
*Focus: Phishing detection, local scanning, entirely isolated from the cloud.*
* **vstakhov/rspamd:** High-performance local email filtering engine.
* **Cisco-Talos/clamav:** Open-source antivirus engine for local attachment scanning.
* **apache/spamassassin:** Localized email header and metadata analysis.

### Pillar 5: 24-Word Master Key Recovery
*Focus: Offline recovery tool, seed generation.*
* **bitcoin/bips:** Specifically BIP-0039 for mnemonic seed generation.
* **monero-project/monero-gui:** Implementation of 25-word mnemonic recovery.
* **cake-tech/cake_wallet:** Multi-currency BIP39 implementation.

---

## PART 3: IMMUTABLE SECURITY RULES
1. **Never Send Raw Keys:** The backend must never receive or store a private key or a decrypted file. Only signed challenges and encrypted blobs touch the server.
2. **RAM-Only Decryption:** The desktop app must decrypt files strictly in temporary memory (RAM). When the vault locks or the user is idle, memory must be securely zeroed and flushed.
3. **Hardware Sovereignty:** Mobile authentication must utilize native OS secure hardware elements (Secure Enclave/StrongBox).
4. **Cryptographic Standards:** Use strictly audited libraries (`libsodium`, `ring`). Do not roll custom cryptography.


## Design Protocol & Delegation

Whenever a task involves UI/UX planning, visual layouts, or frontend styling, you must immediately delegate the work to the **Designing Agent**. The Designing Agent must strictly adhere to the following design system:

*   **Design Language (Apple Aesthetic):** Emulate the clean, minimalist, and premium aesthetic of Apple's web designs. Prioritize generous whitespace, crisp typography, sharp alignments, and uncluttered user interfaces.
*   **Color Palette:** Utilize a formal, highly professional color scheme. Rely heavily on high-contrast monochromes—crisp whites, deep blacks, and subtle neutral grays—to maintain a sophisticated and modern look.
*   **Target Platforms (Windows & Mobile):** All design architectures must be explicitly tailored for both **Windows desktop applications** and **Mobile applications**. Ensure layouts are fully responsive and adapt perfectly between large-screen desktop environments (optimizing for cursor interactions) and compact mobile screens (optimizing for touch gestures).

