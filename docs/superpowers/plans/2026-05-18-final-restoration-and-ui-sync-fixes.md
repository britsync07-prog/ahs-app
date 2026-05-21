# Final Restoration and UI Sync Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the final restoration and UI sync fixes in `vault-desktop-tauri`.

**Architecture:**
- Update `spawn_sync_worker` to take `AppHandle` for event emission.
- Bridge cloud blobs to local readability by updating `shadow_path` and emitting `vault-files-updated`.
- Ensure `restore_vault` fully populates and saves `OnboardingConfig`.

**Tech Stack:** Rust (Tauri)

---

### Task 1: Update `vault-desktop-tauri/src-tauri/src/fs.rs`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Modify `spawn_sync_worker` signature**

Update `spawn_sync_worker` to take `app_handle: Option<AppHandle>` as its first argument.

```rust
fn spawn_sync_worker(
    app_handle: Option<AppHandle>,
    sync_tx: PrioritySender,
    worker_files: Arc<Mutex<HashMap<u64, VaultFile>>>,
    // ...
```

- [ ] **Step 2: Update `PullAll` branch in `spawn_sync_worker`**

Inside the `SyncCommand::PullAll` match arm, update the loop to save the `shadow_path` and emit UI events.

```rust
                SyncCommand::PullAll => {
                    println!("VaultFS Worker: Starting full restoration from cloud...");
                    let files_to_pull = {
                        let f_lock = worker_files.lock().unwrap();
                        f_lock.values().cloned().collect::<Vec<VaultFile>>()
                    };

                    let total = files_to_pull.len();
                    for (i, file) in files_to_pull.into_iter().enumerate() {
                        if let Some(blob_id) = file.cloud_blob_id {
                            println!("VaultFS Worker: Restoration progress [{}/{}] Downloading {}...", i+1, total, file.name);
                            let shadow_path = worker_local_index_path.parent().unwrap()
                                .join(".vault_shadow")
                                .join(format!("{}.blob", file.ino));
                                
                            // Ensure shadow dir exists
                            let _ = std_fs::create_dir_all(shadow_path.parent().unwrap());

                            if let Ok(_) = crate::crypto::stream_download_blob(
                                &worker_config_path,
                                blob_id,
                                &shadow_path,
                                None,
                            ) {
                                let mut f_lock = worker_files.lock().unwrap();
                                if let Some(f) = f_lock.get_mut(&file.ino) {
                                    f.shadow_path = Some(shadow_path);
                                }
                                
                                // Emit UI event
                                if let Some(handle) = &app_handle {
                                    use tauri::Emitter;
                                    let list: Vec<VaultFile> = f_lock.values().cloned().collect();
                                    let _ = handle.emit("vault-files-updated", list);
                                }
                            } else {
                                eprintln!("VaultFS Worker: Failed to download blob for {}", file.name);
                            }
                        }
                    }
                    println!("VaultFS Worker: Full restoration complete.");
                    PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                }
```

- [ ] **Step 3: Update `VaultFS::new` and `VaultFS::new_test`**

Pass `Some(app_handle.clone())` or `None` to `spawn_sync_worker`.

- [ ] **Step 4: Run `cargo check` to verify**

Run: `cargo check` in `vault-desktop-tauri/src-tauri`
Expected: Success

### Task 2: Update `vault-desktop-tauri/src-tauri/src/lib.rs`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/lib.rs`

- [ ] **Step 1: Update `restore_vault` to fully populate `OnboardingConfig`**

In `restore_vault`, ensure `last_sync` and `last_blob_id` are set and saved correctly.

```rust
    if index_res.status().is_success() {
        let index_data: serde_json::Value = index_res.json().await.map_err(|e| e.to_string())?;
        if let Some(id) = index_data["blob_id"].as_str() {
            if !id.is_empty() {
                println!("Restoration: Downloading root index {}...", id);
                config.last_blob_id = Some(id.to_string());
                config.last_sync = Some(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs());

                // ... (rest of the block)
```

- [ ] **Step 2: Add logs and write final config**

```rust
    println!("Restoration: Finalizing config at {:?}", config_path);
    if let Ok(content) = serde_json::to_string_pretty(&config) {
        std_fs::write(&config_path, content).map_err(|e| e.to_string())?;
    }
```

- [ ] **Step 3: Run `cargo check` to verify**

Run: `cargo check` in `vault-desktop-tauri/src-tauri`
Expected: Success
