# USB Performance Optimization Refined Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve "USB drive" performance by parallelizing uploads and optimizing memory usage in `fs.rs`.

**Architecture:** 
1. Use `rayon` for parallel encryption and uploading of chunks in the sync worker.
2. Optimize `read` path with pre-allocation and reduced cloning.
3. Optimize `SyncWorker` by removing redundant clones and zeroization.
4. Unify `SyncWorker` logic between `new` and `new_test` to ensure consistency.

**Tech Stack:** Rust, Rayon, FUSE (fuser), Tauri.

---

### Task 1: Refactor SyncWorker into a shared function

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Extract SyncWorker logic to `spawn_sync_worker`**

Refactor the loop logic into a function to avoid duplication between `new` and `new_test`.

### Task 2: Parallelize Chunk Uploads with Rayon

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Update `spawn_sync_worker` to use `rayon`**

```rust
use rayon::prelude::*;

// ... inside SyncCommand::SyncFile handling ...
let results: Vec<(usize, String)> = chunks_to_upload
    .into_par_iter()
    .filter_map(|(idx, path)| {
        if let Ok(data) = std_fs::read(&path) {
            if let Ok(id) = crate::crypto::internal_encrypt_chunk(
                &worker_config_path,
                data, // Move instead of clone
                worker_key.clone(),
            ) {
                return Some((idx, id));
            }
        }
        None
    })
    .collect();

for (idx, id) in results {
    new_chunks_map.insert(idx, id);
    successful_indices.push(idx);
}
```

### Task 3: Buffer Optimization in Read/Write Paths

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Optimize `read` method**
- Pre-allocate `output` with `Vec::with_capacity`.
- Use `output.extend_from_slice` directly from decrypted buffer without extra intermediate `Vec`.

- [ ] **Step 2: Optimize `SyncWorker` memory usage**
- Ensure `internal_encrypt_chunk` moves `data` instead of cloning.
- Remove redundant `data.zeroize()` calls in `fs.rs` where the worker already moves the data.

### Task 4: Verification

**Files:**
- Test: `vault-desktop-tauri/src-tauri/src/fs.rs` (ensure it compiles)

- [ ] **Step 1: Verify compilation**
Run: `cargo check` in `vault-desktop-tauri/src-tauri`

- [ ] **Step 2: Run tests (if any)**
Run: `cargo test` in `vault-desktop-tauri/src-tauri`
