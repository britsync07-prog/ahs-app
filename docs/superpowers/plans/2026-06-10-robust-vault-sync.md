# Robust Vault Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure 1:1 mirroring between local vault and Google Drive with automatic uploads and space-efficient purging of old versions.

**Architecture:** Update the background sync worker to force-upload missing files and strictly delete old cloud blobs upon updates. Add on-mount reconciliation to resume interrupted syncs.

**Tech Stack:** Rust (Tauri), Go (Backend/GDrive)

---

### Task 1: Force Sync for Missing Cloud Blobs

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Update Sync Worker logic**
Modify the `spawn_sync_worker` loop in `fs.rs` (~line 170). Change the condition that checks `is_hash_unchanged`. It should only skip if hash is unchanged AND `cloud_blob_id` is present.

```rust
// In spawn_sync_worker match SyncCommand::SyncFile { ino }
if let Some(path) = shadow_path {
    let hash_unchanged = crate::drive_mirror::is_hash_unchanged(ino, &path);
    if hash_unchanged && old_id.is_some() {
        println!("VaultFS Worker: Skipping sync for {} (content unchanged and already in cloud)", name);
        PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
        continue;
    }
    // ... proceed to upload ...
}
```

- [ ] **Step 2: Verify logic**
Run: `cargo test` in `vault-desktop-tauri/src-tauri` (ensure no regressions in existing VFS tests).

---

### Task 2: Strict Cloud Blob Purging

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Ensure old blobs are always purged on update**
In the `SyncFile` handler, verify that if a new upload succeeds, the `old_id` is passed to `internal_purge_blobs`.

```rust
// After successful crate::crypto::stream_upload_blob
if let Some(oid) = old_id {
    if oid != id { // Ensure we don't delete the new one if IDs somehow match
        println!("VaultFS Worker: Purging old cloud version {}", oid);
        let _ = internal_purge_blobs(&worker_config_path, vec![oid]);
    }
}
```

- [ ] **Step 2: Commit changes**
```bash
git add vault-desktop-tauri/src-tauri/src/fs.rs
git commit -m "feat: enforce cloud mirroring and strict purging of old blobs"
```

---

### Task 3: On-Mount Sync Reconciliation

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Add reconciliation loop to `VaultFS::new`**
In `VaultFS::new`, after the index is restored, iterate through the files. If a file has local data but no cloud ID, queue it for sync.

```rust
// Near the end of VaultFS::new
let unsynced_inos: Vec<u64> = {
    let files_lock = shared_files.lock().unwrap();
    files_lock.iter()
        .filter(|(_, f)| f.shadow_path.is_some() && f.cloud_blob_id.is_none() && f.kind == VaultFileType::RegularFile)
        .map(|(ino, _)| *ino)
        .collect()
};

for ino in unsynced_inos {
    println!("VaultFS: Detecting unsynced file (ino {}), queuing for upload", ino);
    PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
    let _ = tx.send(SyncCommand::SyncFile { ino });
}
```

- [ ] **Step 2: Apply same logic to `new_test` for consistency**
Ensure `new_test` in `fs.rs` also includes this logic so tests can verify it.

---

### Task 4: Verification and Final Cleanup

- [ ] **Step 1: Manual Verification**
1. Unlock the vault.
2. Add a file to `M:` (Windows).
3. Check logs to see "Syncing ... to cloud".
4. Edit the file.
5. Check logs for "Purging old cloud version".
6. Restart app and ensure no redundant uploads occur if sync was finished.

- [ ] **Step 2: Final Commit**
```bash
git add vault-desktop-tauri/src-tauri/src/fs.rs
git commit -m "feat: added on-mount sync reconciliation"
```
