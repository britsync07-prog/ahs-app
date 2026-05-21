# Vault Unlock & UI Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve vault unlock flow by supporting multiple clients per identity in the backend and fixing the desktop UI loop bug.

**Architecture:** 
- Backend: Update WebSocket `Hub` to store a slice of clients per identity, enabling broadcasting to all connected devices for a given public key.
- Desktop Backend: Update `request_unlock_push` to broadcast using the desktop's own public key if no mobile public key is cached.
- Desktop Frontend: Prevent resetting onboarding state on push failure.

**Tech Stack:** Go (Backend), Rust/Tauri (Desktop Backend), React/TypeScript (Desktop Frontend)

---

### Task 1: Backend WebSocket Hub Refactor

**Files:**
- Modify: `vault-backend-go/internal/websocket/hub.go`

- [ ] **Step 1: Update Hub struct**
Change `identities map[string]*Client` to `identities map[string][]*Client`.

- [ ] **Step 2: Update BindIdentity**
Update to append the client to the slice for that public key.

- [ ] **Step 3: Update SendToIdentity**
Iterate through the slice of clients and send the message to each.

- [ ] **Step 4: Update Run (unregister case)**
Update the logic to remove the specific client from the identity's client slice.

---

### Task 2: Backend RelayPush Broadcast

**Files:**
- Modify: `vault-backend-go/internal/api/handlers.go`

- [ ] **Step 1: Ensure RelayPush uses identity broadcast**
Verify `RelayPush` correctly calls `SendToIdentity` with the target public key. (It already does this, but ensure it works with the new multi-client hub).

---

### Task 3: Desktop Backend Broadcast Logic

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/lib.rs`

- [ ] **Step 1: Update request_unlock_push**
Modify to use the desktop's own public key if `mobile_public_key` is not found in config.

---

### Task 4: Desktop Frontend UI Loop Fix

**Files:**
- Modify: `vault-desktop-tauri/src/App.tsx`

- [ ] **Step 1: Update handleRequestUnlock**
Remove the code that calls `setIsOnboarded(false)` and `initIdentity()` on error. Instead, update the status message.

---

### Task 5: Verification

- [ ] **Step 1: Verify backend compiles**
Run `go build ./...` in `vault-backend-go`.

- [ ] **Step 2: Verify desktop backend compiles**
Run `cargo check` in `vault-desktop-tauri/src-tauri`.

- [ ] **Step 3: Verify frontend compiles**
Run `npm run build` in `vault-desktop-tauri` (or just check for lint errors if full build is too slow).
