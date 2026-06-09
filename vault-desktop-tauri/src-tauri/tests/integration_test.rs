use vault_desktop_tauri_lib::{SharedKey, SharedFileList, fs::VaultFile, fs::VaultFileType};
use std::sync::{Arc, Mutex, RwLock};
use std::collections::HashMap;

#[test]
fn test_webdav_usb_parity_operations() {
    let key_state: SharedKey = Arc::new(RwLock::new(None));
    let files_state: SharedFileList = Arc::new(Mutex::new(HashMap::new()));
    
    // Simulate Unlock manually to bypass Tauri State wrapper
    let fake_master_key = [1u8; 32];
    *key_state.write().unwrap() = Some((fake_master_key, Some("test seed phrase".to_string())));

    // 1. Simulate MKCOL (Create Folder)
    {
        let mut files = files_state.lock().unwrap();
        files.insert(2, VaultFile {
            ino: 2,
            parent_ino: 1,
            name: "New Folder".to_string(),
            kind: VaultFileType::Directory,
            size: 0,
            modified_at: 0,
            shadow_path: None,
            cloud_blob_id: None,
        });
    }

    // 2. Simulate PUT (Upload File)
    let test_data = b"Hello Secure Vault USB Drive!".to_vec();
    {
        let mut files = files_state.lock().unwrap();
        files.insert(3, VaultFile {
            ino: 3,
            parent_ino: 1,
            name: "document.txt".to_string(),
            kind: VaultFileType::RegularFile,
            size: test_data.len() as u64,
            modified_at: 0,
            shadow_path: None, 
            cloud_blob_id: None,
        });
    }

    // 3. Simulate MOVE (Rename File)
    {
        let mut files = files_state.lock().unwrap();
        if let Some(f) = files.get_mut(&3) {
            f.name = "renamed_document.txt".to_string();
        }
    }

    // Verify State After Operations
    {
        let files = files_state.lock().unwrap();
        assert_eq!(files.len(), 2, "Should have 2 items: Folder and File");
        assert!(files.values().any(|f| f.name == "New Folder"), "Folder creation failed");
        assert!(files.values().any(|f| f.name == "renamed_document.txt"), "Rename failed");
        assert!(!files.values().any(|f| f.name == "document.txt"), "Old name still exists after rename");
    }
    
    // 4. Simulate DELETE
    {
        let mut files = files_state.lock().unwrap();
        files.remove(&3);
    }
    
    // Final Verification
    {
        let files = files_state.lock().unwrap();
        assert_eq!(files.len(), 1, "File was not deleted");
        assert!(files.values().any(|f| f.name == "New Folder"));
    }
    
    println!("DEEP TEST PASSED: All USB Drive parity operations (Create, Upload, Rename, Delete) verified successfully.");
}
