# Turbo Sync & UI Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drastically increase upload/download speeds using parallel block processing and provide real-time sync progress in the UI.

**Architecture:** 
1. **Parallel Crypto:** Use `rayon` for parallel encryption/decryption of file blocks.
2. **Buffering:** Increase I/O buffer sizes.
3. **Progress Tracking:** Implement a global `SYNC_PROGRESS` state in Rust that emits events to Tauri.
4. **UI:** Update `VaultExplorer` to show progress bars and active filenames.

**Tech Stack:** Rust (Rayon, Tauri), React (Lucide-Redux)

---

### Task 1: Parallel Crypto Engine

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/Cargo.toml`
- Modify: `vault-desktop-tauri/src-tauri/src/crypto.rs`

- [ ] **Step 1: Add rayon dependency**
- [ ] **Step 2: Implement parallel encryption for local shadow blobs**
- [ ] **Step 3: Implement parallel decryption for local shadow blobs**
- [ ] **Step 4: Optimize block size and buffering for streaming**

---

### Task 2: Real-time Progress State & Events

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`
- Modify: `vault-desktop-tauri/src-tauri/src/lib.rs`

- [ ] **Step 1: Define `SyncProgress` struct and global state**
- [ ] **Step 2: Inject progress updates into `stream_upload_blob` and `stream_download_blob`**
- [ ] **Step 3: Emit `vault-sync-progress` events to Tauri frontend**
- [ ] **Step 4: Ensure `PullAll` (Restoration) reports overall and per-file progress**

---

### Task 3: UI Overhaul - Sync Dashboard

**Files:**
- Modify: `vault-desktop-tauri/src/components/VaultExplorer.tsx`

- [ ] **Step 1: Listen for `vault-sync-progress` events**
- [ ] **Step 2: Add a "Sync Activity" panel above the file list**
- [ ] **Step 3: Replace the amber clock with a circular progress ring when syncing**
- [ ] **Step 4: Add a "Turbo Boost" toggle in settings (increases concurrency)**

---

### Task 4: Multi-Part Upload Support (Optional/Performance)

**Files:**
- Modify: `vault-backend-go/internal/api/handlers.go`
- Modify: `vault-backend-go/internal/storage/gdrive.go`

- [ ] **Step 1: Implement chunked upload in Go backend for larger files**
- [ ] **Step 2: Update Rust client to use chunked uploads for files > 5MB**

---

### Task 5: Verification

- [ ] **Step 1: Test 10MB+ file upload speed (Expected: < 10s)**
- [ ] **Step 2: Verify UI correctly shows "Downloading Restoration: 45% (File X of Y)"**
- [ ] **Step 3: Final Build and Installer Generation**
