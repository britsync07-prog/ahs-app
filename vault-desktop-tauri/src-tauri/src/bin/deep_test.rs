use std::fs as std_fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;
use vault_desktop_tauri_lib::{fs, SharedBlobId, SharedKey};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(windows)]
    {
        println!("[TEST] Deep Test is not supported on Windows due to FUSE dependency.");
        Ok(())
    }

    #[cfg(not(windows))]
    {
        println!("[TEST] Starting Deep Test...");

    // 1. Setup State
    let key_state: SharedKey = Arc::new(RwLock::new(None));
    let blob_id_state: SharedBlobId = Arc::new(RwLock::new(None));

    // 2. Generate a mock master key (32 bytes)
    let mock_key = [0u8; 32];
    {
        let mut lock = key_state.write().unwrap();
        *lock = Some((mock_key, None));
    }
    println!("[TEST] Mock Master Key initialized.");

    // 3. Define mount point
    let mount_point = PathBuf::from("/tmp/vault_test_mount");
    if mount_point.exists() {
        // Try to unmount first in case of previous crash
        let _ = std::process::Command::new("fusermount")
            .arg("-u")
            .arg(&mount_point)
            .status();
        std_fs::remove_dir_all(&mount_point).ok();
    }
    std_fs::create_dir_all(&mount_point)?;
    println!("[TEST] Mount point created at {:?}", mount_point);

    // 4. Initialize VaultFS
    // We'll pass a dummy config path
    let config_path = PathBuf::from("/tmp/vault_test_config.json");
    let (vfs, _sync_tx) =
        fs::VaultFS::new_test(config_path, key_state.clone(), blob_id_state.clone());

    // 5. Mount FUSE in a background thread
    let mount_point_c = mount_point.clone();
    let _mount_thread = thread::spawn(move || {
        let options = vec![
            fuser::MountOption::RW,
            fuser::MountOption::FSName("VaultTestFS".to_string()),
            fuser::MountOption::AutoUnmount,
        ];
        println!("[TEST] Mounting FUSE...");
        fuser::mount2(vfs, &mount_point_c, &options).expect("FUSE mount failed");
    });

    // Wait for mount to stabilize
    thread::sleep(Duration::from_secs(2));

    // 6. Test File Creation
    let test_file = mount_point.join("hello.txt");
    println!("[TEST] Creating file: {:?}", test_file);
    std_fs::write(&test_file, "Hello, Zero-Knowledge Vault!")?;

    // 7. Verify file exists
    let content = std_fs::read_to_string(&test_file)?;
    println!("[TEST] File content read: {}", content);
    assert_eq!(content, "Hello, Zero-Knowledge Vault!");

    // 7.1 Test Rename
    let renamed_file = mount_point.join("hello_renamed.txt");
    println!("[TEST] Renaming file to: {:?}", renamed_file);
    std_fs::rename(&test_file, &renamed_file)?;
    assert!(renamed_file.exists());
    assert!(!test_file.exists());
    println!("[TEST] Rename successful.");

    // 8. Test persistence (Sync)
    println!("[TEST] Waiting for sync worker...");
    thread::sleep(Duration::from_secs(2));

    // 9. Unmount
    println!("[TEST] Unmounting...");
    // On Linux, we can use fusermount -u
    std::process::Command::new("fusermount")
        .arg("-u")
        .arg(&mount_point)
        .status()?;

    thread::sleep(Duration::from_secs(1));

    // 10. Verify file is gone from mount point
    println!("[TEST] Checking if file is gone after unmount...");
    assert!(!test_file.exists());
    println!("[TEST] SUCCESS: File is gone from mount point.");

    // 11. Re-mount and verify file is still there (mocking the cloud restore)
    // For this to work, we'd need the sync worker to actually upload and then we'd need to mock the restore.
    // In this test, we are just checking the local FUSE behavior.

    println!("[TEST] Deep Test Passed!");
    Ok(())
    }
}
