use std::fs as std_fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;
use vault_desktop_tauri_lib::{fs, crypto, config, get_or_create_signing_key_at, SharedBlobId, SharedKey};

fn fetch_stats(pk: &str) -> Result<(i64, String), String> {
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/vault/stats?public_key={}", config::get_backend_url(), pk);
    let res = client.get(&url).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Backend stats returned status: {}", res.status()));
    }
    let val: serde_json::Value = res.json().map_err(|e| e.to_string())?;
    let files = val["filesProtected"].as_i64().unwrap_or(0);
    let storage = val["storageUsed"].as_str().unwrap_or("0 B").to_string();
    Ok((files, storage))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n==========================================");
    println!("=== STARTING INTERACTIVE MIRROR TEST ===");
    println!("==========================================\n");

    let config_dir = PathBuf::from("/home/saimon/.config/com.saimon.vault-desktop-tauri");
    let config_path = config_dir.join("onboarding.json");

    if !config_path.exists() {
        println!("Error: Onboarding config not found at {:?}", config_path);
        return Ok(());
    }

    // 1. Retrieve config and derive signing keys
    let config_content = std_fs::read_to_string(&config_path)?;
    let onboarding: serde_json::Value = serde_json::from_str(&config_content)?;
    
    let mnemonic = onboarding["mnemonic"].as_str().ok_or("Missing mnemonic")?;
    println!("Step 1: Loaded onboarding config successfully.");

    let (master_key, _, _) = crypto::derive_keys_from_mnemonic(mnemonic)?;
    let (_, pk) = get_or_create_signing_key_at(config_path.clone());
    println!("Step 2: Derived master keys. Desktop PK: {}", pk);

    // Get initial stats
    let (init_files, init_storage) = fetch_stats(&pk)?;
    println!("Initial Stats: Files Protected: {}, Storage Used: {}", init_files, init_storage);

    // 2. Setup mount paths
    let mount_point = PathBuf::from("/tmp/vault_interactive_mount");
    if mount_point.exists() {
        let _ = std::process::Command::new("fusermount")
            .arg("-u")
            .arg(&mount_point)
            .status();
        let _ = std_fs::remove_dir_all(&mount_point);
    }
    std_fs::create_dir_all(&mount_point)?;

    // Setup Shared State
    let key_state: SharedKey = Arc::new(RwLock::new(Some((master_key, Some(mnemonic.to_string())))));
    let blob_id_state: SharedBlobId = Arc::new(RwLock::new(None));

    // Mount
    println!("\nMounting FUSE filesystem at {:?}", mount_point);
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
                fuser::MountOption::FSName("VaultInteractiveFS".to_string()),
                fuser::MountOption::AutoUnmount,
            ];
            fuser::mount2(vfs, &mount_point_c, &options).expect("FUSE mount failed");
        });
    }

    // Wait for mount
    thread::sleep(Duration::from_secs(2));

    // 3. Create a test file
    let test_file = mount_point.join("verify_mirror.txt");
    let test_content = "Hello, Google Drive, this is a mirror sync test content!";
    println!("\nStep 3: Creating test file: {:?}", test_file);
    std_fs::write(&test_file, test_content)?;

    println!("Waiting for background sync (8s)...");
    thread::sleep(Duration::from_secs(8));

    let (sync1_files, sync1_storage) = fetch_stats(&pk)?;
    println!("Stats after sync: Files Protected: {}, Storage Used: {}", sync1_files, sync1_storage);

    // 4. Edit the file
    println!("\nStep 4: Editing test file by appending text...");
    let edit_content = "\nThis is a small edit to test the hash check cache!";
    let mut current_content = test_content.to_string();
    current_content.push_str(edit_content);
    std_fs::write(&test_file, &current_content)?;

    println!("Waiting for background sync (8s)...");
    thread::sleep(Duration::from_secs(8));

    let (sync2_files, sync2_storage) = fetch_stats(&pk)?;
    println!("Stats after edit sync: Files Protected: {}, Storage Used: {}", sync2_files, sync2_storage);

    // 5. Lock and Unlock (Remount)
    println!("\nStep 5: Simulating LOCK (unmounting)...");
    std::process::Command::new("fusermount")
        .arg("-u")
        .arg(&mount_point)
        .status()?;
    thread::sleep(Duration::from_secs(2));

    println!("Simulating UNLOCK (re-mounting)...");
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
                fuser::MountOption::FSName("VaultInteractiveFS".to_string()),
                fuser::MountOption::AutoUnmount,
            ];
            fuser::mount2(vfs, &mount_point_c, &options).expect("FUSE mount failed");
        });
    }
    thread::sleep(Duration::from_secs(2));

    // Read the file to trigger OS file read (which might touch/open it)
    println!("Reading the file after unlock to trigger OS open/read...");
    if test_file.exists() {
        let read_back = std_fs::read_to_string(&test_file)?;
        println!("Read content: {}", read_back);
    } else {
        println!("Warning: File not found after remount!");
    }

    println!("Waiting to check if redundant upload is triggered (8s)...");
    thread::sleep(Duration::from_secs(8));

    let (sync3_files, sync3_storage) = fetch_stats(&pk)?;
    println!("Stats after Lock/Unlock and Read: Files Protected: {}, Storage Used: {}", sync3_files, sync3_storage);

    // 6. Delete the file
    println!("\nStep 6: Deleting test file: {:?}", test_file);
    std_fs::remove_file(&test_file)?;

    println!("Waiting for background sync of deletion (8s)...");
    thread::sleep(Duration::from_secs(8));

    let (final_files, final_storage) = fetch_stats(&pk)?;
    println!("Final Stats after deletion: Files Protected: {}, Storage Used: {}", final_files, final_storage);

    // 7. Cleanup
    println!("\nStep 7: Cleaning up and unmounting FUSE...");
    let _ = std::process::Command::new("fusermount")
        .arg("-u")
        .arg(&mount_point)
        .status();
    let _ = std_fs::remove_dir_all(&mount_point);

    println!("\n=== TEST COMPLETED SUCCESSFULLY ===");
    Ok(())
}
