# Direct-To-Hardware Write Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a high-performance write engine for `VaultFS` using per-file handles and a 64KB block cache.

**Architecture:** Introduce an `OpenFile` struct to track open file handles and a `HashMap` in `VaultFS` to manage them. Implement a single-block cache per file handle to optimize Read-Modify-Write (RMW) and reduce cryptographic overhead.

**Tech Stack:** Rust, FUSE (fuser), std::fs, aes-gcm

---

### Task 1: Define Core Data Structures

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Define `ActiveBlock` and `OpenFile` structs**

```rust
struct ActiveBlock {
    index: usize,
    data: Vec<u8>,
    dirty: bool,
}

struct OpenFile {
    ino: u64,
    file: std::fs::File,
    active_block: Option<ActiveBlock>,
}
```

- [ ] **Step 2: Add `open_files` and `next_fh` to `VaultFS`**

```rust
pub struct VaultFS {
    // ... existing fields ...
    open_files: Arc<Mutex<HashMap<u64, Arc<Mutex<OpenFile>>>>>,
    next_fh: std::sync::atomic::AtomicU64,
}
```

- [ ] **Step 3: Update `VaultFS::new` and `VaultFS::new_test` to initialize these fields**

### Task 2: Implement File Handle Lifecycle (`open`, `create`, `release`)

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Implement `VaultFS::open`**
  - Lookup inode, open shadow file, generate `fh`, store in `open_files`.

- [ ] **Step 2: Update `VaultFS::create`**
  - Create shadow file, generate `fh`, store in `open_files`.

- [ ] **Step 3: Implement `VaultFS::release`**
  - Flush dirty block if exists, remove from `open_files`.
  - Move sync and notify to background.

- [ ] **Step 4: Implement a helper `flush_active_block(open_file, key_state)`**

### Task 3: Implement Optimized `write` with Block Caching

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Re-implement `VaultFS::write`**
  - Use `fh` to get `OpenFile`.
  - Handle block alignment and caching.
  - Implement zero-initialization for new blocks.

- [ ] **Step 2: Optimization: Skip decryption if the whole block is being overwritten**

### Task 4: Optimized `read` using File Handles

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Re-implement `VaultFS::read`**
  - Use `fh` to get `OpenFile`.
  - Check if the requested data is in the `active_block` (dirty or not).
  - Use the open file handle for disk reads.

### Task 5: Cleanup and Verification

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Update `setattr` and `unlink` to interact with `open_files` if necessary**
- [ ] **Step 2: Verify compilation and basic functionality**
- [ ] **Step 3: (Manual) Verify performance improvements**
