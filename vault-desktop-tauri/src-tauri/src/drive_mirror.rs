use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use std::path::PathBuf;
use std::fs::{self, File};
use std::io::Read;
use sha2::{Sha256, Digest};
use reqwest::blocking::Client;
use base64::Engine;
use ed25519_dalek::Signer;

static LAST_SYNCED_HASHES: Lazy<Mutex<HashMap<u64, [u8; 32]>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn update_cached_hash(ino: u64, shadow_path: &PathBuf) {
    if let Ok(hash) = compute_file_sha256(shadow_path) {
        let mut cache = LAST_SYNCED_HASHES.lock().unwrap();
        cache.insert(ino, hash);
    }
}

pub fn is_hash_unchanged(ino: u64, shadow_path: &PathBuf) -> bool {
    if let Ok(hash) = compute_file_sha256(shadow_path) {
        let cache = LAST_SYNCED_HASHES.lock().unwrap();
        if let Some(cached_hash) = cache.get(&ino) {
            return *cached_hash == hash;
        }
    }
    false
}

fn compute_file_sha256(path: &PathBuf) -> Result<[u8; 32], String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().into())
}

pub fn purge_blobs_direct(config_path: &PathBuf, blob_ids: Vec<String>) -> Result<(), String> {
    if blob_ids.is_empty() {
        return Ok(());
    }

    let config_content = fs::read_to_string(config_path).map_err(|e| e.to_string())?;
    let config: crate::OnboardingConfig = serde_json::from_str(&config_content).map_err(|e| e.to_string())?;

    let mut token = match config.google_access_token {
        Some(t) => t,
        None => return Err("Google access token missing".to_string()),
    };

    let (sk, pk) = crate::get_or_create_signing_key_at(config_path.clone());
    let payload = serde_json::json!({ "blob_ids": blob_ids });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let signature = sk.sign(&payload_bytes);
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

    let client = Client::new();
    let mut backend_res = client.post(format!("{}/api/vault/delete", crate::config::get_backend_url()))
        .header("X-Desktop-PK", pk.clone())
        .header("X-Signature", sig_b64.clone())
        .header("X-Google-Token", &token)
        .json(&payload)
        .send();

    if let Ok(ref res) = backend_res {
        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            println!("drive_mirror: Got 401, refreshing Google token...");
            if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
                token = new_token;
                backend_res = client.post(format!("{}/api/vault/delete", crate::config::get_backend_url()))
                    .header("X-Desktop-PK", pk)
                    .header("X-Signature", sig_b64)
                    .header("X-Google-Token", &token)
                    .json(&payload)
                    .send();
            }
        }
    }

    let res = backend_res.map_err(|e| e.to_string())?;
    if res.status().is_success() {
        println!("drive_mirror: Successfully synchronized deletion with backend database & GDrive");
        Ok(())
    } else {
        Err(format!("Backend database/GDrive deletion failed: status {}", res.status()))
    }
}
