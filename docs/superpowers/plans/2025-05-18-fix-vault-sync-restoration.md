# Vault Restoration and Synchronization Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical bugs in vault restoration (restoring from mnemonic) and synchronization (reliable cloud updates and restoration download).

**Architecture:** Refactor cryptographic functions to support ad-hoc signing keys, ensure sequential data integrity during restoration in the main Tauri logic, and improve the reliability of the FUSE sync worker.

**Tech Stack:** Rust (Tauri, FUSE), React (TypeScript).

---

### Task 1: Refactor `crypto.rs` - Flexible Signing for Downloads

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/crypto.rs`

- [ ] **Step 1: Update `stream_download_blob` signature**

```rust
pub fn stream_download_blob(
    config_path: &PathBuf,
    blob_id: String,
    dest_path: &PathBuf,
    provided_sk: Option<SigningKey>, // NEW
) -> Result<(), String> {
    let (sk, pk) = if let Some(sk) = provided_sk {
        let pk = base64::engine::general_purpose::STANDARD.encode(sk.verifying_key().to_bytes());
        (sk, pk)
    } else {
        crate::get_or_create_signing_key_at(config_path.clone())
    };
    
    let signature = sk.sign(blob_id.as_bytes());
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

    let client = Client::new();
    let mut res = client
        .get(format!(
            "http://localhost:8080/api/vault/download/{}",
            blob_id
        ))
        .header("X-Desktop-PK", pk)
        .header("X-Signature", sig_b64)
        .send()
        .map_err(|e| format!("Download failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Server returned error: {}", res.status()));
    }

    let mut dest_file = std::fs::File::create(dest_path).map_err(|e| e.to_string())?;
    res.copy_to(&mut dest_file).map_err(|e| e.to_string())?;
    
    Ok(())
}
```

- [ ] **Step 2: Update all callers of `stream_download_blob`**

- Modify: `vault-desktop-tauri/src-tauri/src/lib.rs` (around line 520)
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs` (around line 224)

### Task 2: Fix `lib.rs` - Reliable `restore_vault`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/lib.rs`

- [ ] **Step 1: Update `restore_vault` to use derived keys and save config properly**

```rust
#[tauri::command]
async fn restore_vault(
    app: AppHandle,
    mnemonic: String,
    key_state: tauri::State<'_, SharedKey>,
) -> Result<bool, String> {
    println!("Restoration: Starting for phrase...");
    // 1. Derive keys
    let (master_key, signing_key, x_secret) = crypto::derive_keys_from_mnemonic(&mnemonic)?;
    let pk = general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes());

    // 2. Check if user exists on backend
    let client = reqwest::Client::new();
    let res = client
        .get("http://localhost:8080/api/vault/stats")
        .query(&[("public_key", &pk)])
        .send()
        .await
        .map_err(|e| format!("Backend connection failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Backend returned error: {}", res.status()));
    }

    let stats: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let file_count = stats["filesProtected"].as_i64().unwrap_or(0);
    let device_count = stats["deviceCount"].as_i64().unwrap_or(0);

    if file_count == 0 && device_count == 0 {
        println!("Restoration: No vault found for this identity.");
        return Ok(false);
    }

    println!("Restoration: Vault found! {} files.", file_count);

    // 3. User exists! Initialize identity
    let config_path = get_config_path(&app);
    let mut config = OnboardingConfig::default();
    config.onboarded = true;
    config.mnemonic = Some(mnemonic.clone());
    config.desktop_signing_key = Some(general_purpose::STANDARD.encode(signing_key.to_bytes()));
    config.desktop_x_secret = Some(general_purpose::STANDARD.encode(x_secret.to_bytes()));
    
    // Fetch the root index ID
    println!("Restoration: Fetching root index pointer...");
    let index_res = client
        .get("http://localhost:8080/api/vault/index")
        .query(&[("public_key", &pk)])
        .send()
        .await
        .map_err(|e| format!("Index fetch failed: {}", e))?;
        
    if index_res.status().is_success() {
        let index_data: serde_json::Value = index_res.json().await.map_err(|e| e.to_string())?;
        if let Some(id) = index_data["blob_id"].as_str() {
            if !id.is_empty() {
                println!("Restoration: Downloading root index {}...", id);
                config.last_blob_id = Some(id.to_string());

                let temp_path = config_path.parent().unwrap().join("restored_index.tmp");
                // USE THE DERIVED SIGNING KEY
                crypto::stream_download_blob(&config_path, id.to_string(), &temp_path, Some(signing_key.clone()))?;

                println!("Restoration: Decrypting root index...");
                let encrypted_data = std_fs::read(&temp_path).map_err(|e| e.to_string())?;
                let key_state_wrapped = Arc::new(RwLock::new(Some((master_key, Some(mnemonic.clone())))));
                let decrypted_data = crypto::decrypt_local_data(&encrypted_data, key_state_wrapped).map_err(|e| format!("Index decryption failed: {}", e))?;

                let local_index_path = config_path.parent().unwrap().join("local_index.json");
                std_fs::write(local_index_path, decrypted_data).map_err(|e| e.to_string())?;
                let _ = std_fs::remove_file(temp_path);
                println!("Restoration: Index restored successfully.");
            }
        }
    }

    if let Ok(content) = serde_json::to_string(&config) {
        std_fs::write(&config_path, content).map_err(|e| e.to_string())?;
    }

    // Set memory state
    *key_state.write().unwrap() = Some((master_key, Some(mnemonic)));

    // Re-trigger WebSocket with new identity
    if let Ok(mut handle_lock) = WS_JOIN_HANDLE.lock() {
        if let Some(h) = handle_lock.take() {
            h.abort();
        }
        let (app_c2, pk_c, n_c) = (app.clone(), pk.clone(), "RESTORED_IDENTITY".to_string());
        let x_secret_c = x_secret.clone();
        *handle_lock = Some(tauri::async_runtime::spawn(async move {
            network::connect_and_register(app_c2, pk_c, n_c, true, x_secret_c).await;
        }));
    }

    Ok(true)
}
```

### Task 3: Fix `fs.rs` - Reliable Sync and restoration

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Ensure `SyncFile` triggers `SyncIndex`**

```rust
SyncCommand::SyncFile { ino } => {
    // ... existing code to upload ...
    if let Ok(id) = crate::crypto::stream_upload_blob(
        &worker_config_path,
        &path,
        worker_key.clone(),
    ) {
        // Save the cloud blob ID
        let mut f_lock = worker_files.lock().unwrap();
        if let Some(f) = f_lock.get_mut(&ino) {
            f.cloud_blob_id = Some(id);
        }
        drop(f_lock);
        // CRITICAL: Notify that index needs update!
        let _ = sync_tx_clone.send(SyncCommand::SyncIndex);
    }
    // ...
}
```

- [ ] **Step 2: Fix `PullAll` logic**

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
                None, // Use default stored key
            ) {
                let mut f_lock = worker_files.lock().unwrap();
                if let Some(f) = f_lock.get_mut(&file.ino) {
                    f.shadow_path = Some(shadow_path);
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

### Task 4: Fix `App.tsx` - Restoration Flow Delay

**Files:**
- Modify: `vault-desktop-tauri/src/App.tsx`

- [ ] **Step 1: Add delay before `start_restoration_download`**

```typescript
  const handleRestoreVault = async (phrase: string) => {
    setIsRestoring(true);
    setStatusMessage("Verifying cloud backup...");
    try {
      const exists = await invoke<boolean>("restore_vault", { mnemonic: phrase });
      if (exists) {
        setIsOnboarded(true);
        setOnboardingStep("restoring");
        // Start background download
        await invoke("mount_vault");
        // SLIGHT DELAY to ensure worker is ready and mounted
        await new Promise(resolve => setTimeout(resolve, 1000));
        await invoke("start_restoration_download");
        setUnlocked(true);
        setStatusMessage("");
      } else {
        setStatusMessage("No vault found for this phrase.");
      }
    } catch (e) {
      console.error("Restore failed:", e);
      setStatusMessage("Error connecting to cloud.");
    } finally {
      setIsRestoring(false);
    }
  };
```

### Task 5: Verification

- [ ] **Step 1: Compile the project**
Run: `cd vault-desktop-tauri && npm run build` (or similar command to check Rust compilation)
Expected: No compilation errors.

- [ ] **Step 2: Verify `restore_vault` logic flow**
Review the code to ensure `signing_key` is passed correctly to `stream_download_blob` during restoration.

- [ ] **Step 3: Verify `SyncWorker` logic flow**
Review the code to ensure `SyncFile` always triggers `SyncIndex` and `PullAll` handles existing blobs correctly.

---
