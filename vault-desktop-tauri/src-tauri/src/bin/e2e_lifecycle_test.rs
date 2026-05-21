use std::fs as std_fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;
use vault_desktop_tauri_lib::{fs, SharedBlobId, SharedKey};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n=== STARTING E2E VAULT LIFECYCLE TEST ===");

    // 1. Setup State & Mock Key
    let key_state: SharedKey = Arc::new(RwLock::new(None));
    let blob_id_state: SharedBlobId = Arc::new(RwLock::new(None));
    let mock_key = [0u8; 32];
    {
        let mut lock = key_state.write().unwrap();
        *lock = Some((mock_key, None));
    }

    let mount_point = PathBuf::from("/tmp/e2e_vault_mount");
    let config_path = PathBuf::from("/tmp/e2e_vault_config.json");

    // Cleanup previous runs
    let _ = std::process::Command::new("fusermount")
        .arg("-u")
        .arg(&mount_point)
        .status();
    let _ = std_fs::remove_dir_all(&mount_point);
    let _ = std_fs::remove_file(&config_path);
    std_fs::create_dir_all(&mount_point)?;

    // Create a dummy onboarding config so the FS can persist to it
    let dummy_config = serde_json::json!({
        "onboarded": true,
        "mobile_public_key": "dummy",
        "mobile_x_public_key": "dummy",
        "desktop_signing_key": "YHf/WkGRhbJfoOyVYJZCeDSgeUw1je52eEW7lVwCeFY=",
        "desktop_x_secret": null,
        "last_blob_id": null
    });
    std_fs::write(&config_path, serde_json::to_string(&dummy_config)?)?;

    println!("[PHASE 1] Initializing Vault & Connecting...");

    // Initial mount (Empty)
    {
        let (vfs, _sync_tx) = fs::VaultFS::new_test(
            config_path.clone(),
            key_state.clone(),
            blob_id_state.clone(),
        );
        let mount_point_c = mount_point.clone();
        thread::spawn(move || {
            let options = vec![
                fuser::MountOption::RW,
                fuser::MountOption::FSName("E2EVault".to_string()),
                fuser::MountOption::AutoUnmount,
            ];
            fuser::mount2(vfs, &mount_point_c, &options).expect("FUSE mount failed");
        });
    }

    thread::sleep(Duration::from_secs(2));

    // 2. Create and Upload File
    let test_file = mount_point.join("secret_data.txt");
    let test_content = "This content should survive the disconnect!";
    println!("[PHASE 2] Creating file: {:?}", test_file);
    std_fs::write(&test_file, test_content)?;

    println!("[PHASE 2] Waiting for cloud sync (4s)...");
    thread::sleep(Duration::from_secs(4));

    // 3. Disconnect
    println!("[PHASE 3] Disconnecting Vault (Unmounting)...");
    std::process::Command::new("fusermount")
        .arg("-u")
        .arg(&mount_point)
        .status()?;

    thread::sleep(Duration::from_secs(1));

    // 4. Verify Disappeared
    println!("[PHASE 4] Verifying vault content is GONE...");
    if test_file.exists() {
        return Err("FAILURE: File still exists after disconnect!".into());
    }
    println!("SUCCESS: Vault confirmed disappeared.");

    // 5. Reconnect
    println!("[PHASE 5] Reconnecting Vault (Re-mounting)...");
    {
        // Re-mount should restore from the persisted config and blob
        let (vfs, _sync_tx) = fs::VaultFS::new_test(
            config_path.clone(),
            key_state.clone(),
            blob_id_state.clone(),
        );
        let mount_point_c = mount_point.clone();
        thread::spawn(move || {
            let options = vec![
                fuser::MountOption::RW,
                fuser::MountOption::FSName("E2EVault".to_string()),
                fuser::MountOption::AutoUnmount,
            ];
            fuser::mount2(vfs, &mount_point_c, &options).expect("FUSE mount failed");
        });
    }

    thread::sleep(Duration::from_secs(3));

    // 6. Verify Reappeared
    println!("[PHASE 6] Verifying file has REAPPEARED...");
    if !test_file.exists() {
        return Err("FAILURE: File did not reappear after reconnection!".into());
    }

    let recovered_content = std_fs::read_to_string(&test_file)?;
    println!("RECOVERED CONTENT: {}", recovered_content);

    if recovered_content == test_content {
        println!("\n=== E2E LIFECYCLE TEST PASSED SUCCESSFULLY ===");
    } else {
        return Err("FAILURE: Recovered content mismatch!".into());
    }

    // Final Cleanup
    let _ = std::process::Command::new("fusermount")
        .arg("-u")
        .arg(&mount_point)
        .status();

    Ok(())
}
