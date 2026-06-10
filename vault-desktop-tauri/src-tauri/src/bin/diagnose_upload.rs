use vault_desktop_tauri_lib::{SharedKey, OnboardingConfig, crypto};
use std::sync::{Arc, RwLock};
use std::path::PathBuf;
use std::fs;

fn main() {
    println!("--- GDrive Upload Diagnostic Tool ---");

    let app_data = std::env::var("APPDATA").expect("APPDATA not set");
    let config_dir = PathBuf::from(app_data).join("com.saimon.vault-desktop-tauri");
    let config_path = config_dir.join("onboarding.json");

    if !config_path.exists() {
        println!("❌ Config file not found at {:?}", config_path);
        return;
    }

    let config_content = fs::read_to_string(&config_path).unwrap();
    let config: OnboardingConfig = serde_json::from_str(&config_content).unwrap();

    println!("✅ Config loaded.");
    println!("Google Access Token Present: {}", config.google_access_token.is_some());
    println!("Google Refresh Token Present: {}", config.google_refresh_token.is_some());
    println!("Mnemonic Present: {}", config.mnemonic.is_some());

    if config.mnemonic.is_none() {
        println!("❌ No mnemonic found. Vault is not set up.");
        return;
    }

    // Initialize key state
    let key_state: SharedKey = Arc::new(RwLock::new(None));
    let phrase = config.mnemonic.unwrap();
    
    // Fix the E0308 error: Manually set the state instead of using the Tauri helper
    if let Ok((master_key, _, _)) = crypto::derive_keys_from_mnemonic(&phrase) {
        *key_state.write().unwrap() = Some((master_key, Some(phrase)));
        println!("✅ Master key initialized.");
    } else {
        println!("❌ Failed to derive master key.");
        return;
    }

    // Create a dummy file in shadow dir
    let shadow_dir = config_dir.join(".vault_shadow");
    fs::create_dir_all(&shadow_dir).unwrap();
    let dummy_blob_path = shadow_dir.join("99999.blob");
    
    let test_data = b"Diagnostic Test File Content".to_vec();
    let encrypted = crypto::encrypt_local_data(&test_data, key_state.clone()).unwrap();
    fs::write(&dummy_blob_path, encrypted).unwrap();
    println!("✅ Dummy shadow blob created.");

    println!("🚀 Attempting upload to backend...");
    match crypto::stream_upload_blob(&config_path, &dummy_blob_path, key_state) {
        Ok(blob_id) => {
            println!("✅ SUCCESS! Blob ID: {}", blob_id);
        }
        Err(e) => {
            println!("❌ UPLOAD FAILED: {}", e);
        }
    }

    let _ = fs::remove_file(dummy_blob_path);
}