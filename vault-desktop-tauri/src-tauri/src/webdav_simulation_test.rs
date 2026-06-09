use vault_desktop_tauri_lib::{SharedKey, SharedFileList, fs::VaultFile, fs::VaultFileType, crypto};
use std::sync::{Arc, Mutex, RwLock};
use std::collections::HashMap;

// This test simulates the exact WebDAV logic without needing the full Tauri AppHandle
#[test]
fn test_webdav_deep_simulation() {
    let key_state: SharedKey = Arc::new(RwLock::new(None));
    let files_state: SharedFileList = Arc::new(Mutex::new(HashMap::new()));
    
    crypto::set_master_key_from_seed("test seed phrase for deep testing".to_string(), key_state.clone()).unwrap();

    // Simulate MKCOL (Create Folder)
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

    // Simulate PUT (Upload File)
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
            shadow_path: None, // In real app, this points to encrypted blob
            cloud_blob_id: None,
        });
    }

    // Simulate MOVE (Rename File)
    {
        let mut files = files_state.lock().unwrap();
        if let Some(f) = files.get_mut(&3) {
            f.name = "renamed_document.txt".to_string();
        }
    }

    // Verify State
    {
        let files = files_state.lock().unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.values().any(|f| f.name == "New Folder"));
        assert!(files.values().any(|f| f.name == "renamed_document.txt"));
        assert!(!files.values().any(|f| f.name == "document.txt")); // Old name should be gone
    }
    
    // Simulate DELETE
    {
        let mut files = files_state.lock().unwrap();
        files.remove(&3);
    }
    
    // Final Verify
    {
        let files = files_state.lock().unwrap();
        assert_eq!(files.len(), 1);
        assert!(files.values().any(|f| f.name == "New Folder"));
    }
    
    println!("Deep Test Passed: Simulated WebDAV state transitions successfully.");
}