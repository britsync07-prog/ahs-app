# USB-Speed Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve "USB-like" performance with instant local operations and immediate cloud parity through parallel uploads, priority queuing, and DirectIO.

**Architecture:** 
1.  **Parallelization**: Use `rayon` to encrypt/upload chunks in parallel.
2.  **Prioritization**: Replace FIFO channel with a `PriorityQueue` for the sync worker.
3.  **Low Latency**: Enable `DirectIO` in FUSE mount options.
4.  **Efficiency**: Reduce memory allocations in read/write paths.

**Tech Stack:** Rust (Tauri), `rayon`, `priority-queue`, `fuser`.

---

### Task 1: Enable DirectIO and Performance Mount Options

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/lib.rs`

- [ ] **Step 1: Add DirectIO and AsyncRead flags**
Add `fuser::MountOption::DirectIO` and `fuser::MountOption::AsyncRead` to the mount options vector.

```rust
// vault-desktop-tauri/src-tauri/src/lib.rs
let options = vec![
    fuser::MountOption::RW,
    fuser::MountOption::FSName("VaultFS".to_string()),
    fuser::MountOption::DirectIO,
    fuser::MountOption::AsyncRead,
];
```

- [ ] **Step 2: Commit**
```bash
git add vault-desktop-tauri/src-tauri/src/lib.rs
git commit -m "perf: enable DirectIO and AsyncRead for FUSE mount"
```

---

### Task 2: Implement Priority-Based Sync Worker

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Define Command Priorities**
Update `SyncCommand` to include a priority method.
- `SyncIndex`, `PurgeBlocks`: Priority 10 (High)
- `SyncFile`: Priority 5 (Normal)

- [ ] **Step 2: Replace MPSC with Priority Queue**
Update `VaultFS` struct and `new` function to use a `PriorityQueue` protected by a `Condvar` or similar for the worker thread.

```rust
// vault-desktop-tauri/src-tauri/src/fs.rs
pub enum SyncCommand {
    SyncFile { ino: u64 },
    SyncIndex,
    PurgeBlocks { blob_ids: Vec<String> },
}

// Implement Ord or a helper for priority
```

- [ ] **Step 3: Update Worker Loop**
Refactor the `std::thread::spawn` block to pull from the priority queue.

- [ ] **Step 4: Commit**
```bash
git add vault-desktop-tauri/src-tauri/src/fs.rs
git commit -m "perf: replace FIFO sync worker with Priority Queue"
```

---

### Task 3: Parallelize Chunk Uploads with Rayon

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Parallelize the chunk processing loop**
In `SyncCommand::SyncFile`, use `rayon::into_par_iter()` to encrypt and upload chunks concurrently.

```rust
// vault-desktop-tauri/src-tauri/src/fs.rs
use rayon::prelude::*;

let results: Vec<_> = chunks_to_upload.into_par_iter().map(|(idx, path)| {
    if let Ok(mut data) = std_fs::read(&path) {
        let res = crate::crypto::internal_encrypt_chunk(
            &worker_config_path,
            data.clone(),
            worker_key.clone(),
        );
        data.zeroize();
        res.map(|id| (idx, id))
    } else {
        Err("Failed to read chunk".to_string())
    }
}).collect();
```

- [ ] **Step 2: Commit**
```bash
git add vault-desktop-tauri/src-tauri/src/fs.rs
git commit -m "perf: parallelize chunk uploads using rayon"
```

---

### Task 4: Optimize Read/Write Buffers

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Use pre-allocated buffers in `write`**
Instead of frequent `Vec` allocations, use a reusable buffer or write directly to the `std::fs::File`.

- [ ] **Step 2: Streamline `read` path**
Reduce intermediate clones when reading chunks from the local dirty cache.

- [ ] **Step 3: Commit**
```bash
git add vault-desktop-tauri/src-tauri/src/fs.rs
git commit -m "perf: optimize read/write memory allocations"
```

---

### Task 5: Verification & Benchmarking

- [ ] **Step 1: Verify Parallelism**
Upload a large file and monitor logs. You should see multiple "Syncing" messages appearing quickly or verify CPU usage spikes across multiple cores.

- [ ] **Step 2: Verify Instant Deletion**
Start a large upload, then delete a different file. Confirm the deletion happens before the large upload finishes.

- [ ] **Step 3: Dashboard Check**
Verify "FILES PROTECTED" and "STORAGE USED" update correctly and instantly.
