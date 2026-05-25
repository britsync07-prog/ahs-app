use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use std::path::PathBuf;
use std::fs::{self, File};
use std::io::Read;
use sha2::{Sha256, Digest};
use reqwest::blocking::Client;
use serde_json::Value;
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

    // A helper to send requests and retry once on 401 Unauthorized by refreshing token
    let mut send_request = |req_builder_fn: &dyn Fn(&Client, &str) -> reqwest::blocking::RequestBuilder| -> Result<reqwest::blocking::Response, String> {
        let client = Client::new();
        let res = req_builder_fn(&client, &token).send().map_err(|e| e.to_string())?;
        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            println!("drive_mirror: Got 401, refreshing Google token...");
            if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
                token = new_token;
                let res2 = req_builder_fn(&client, &token).send().map_err(|e| e.to_string())?;
                return Ok(res2);
            }
        }
        Ok(res)
    };

    // 1. Locate the SecureVault folder ID
    let folder_query = "name='SecureVault' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    let res = send_request(&|client, t| {
        client.get("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(t)
            .query(&[("q", folder_query), ("spaces", "drive"), ("fields", "files(id)")])
    })?;

    if !res.status().is_success() {
        return Err(format!("Failed to search SecureVault folder: status {}", res.status()));
    }

    let val: Value = res.json().map_err(|e| e.to_string())?;
    let folder_id = match val["files"].as_array().and_then(|arr| arr.get(0)).and_then(|f| f["id"].as_str()) {
        Some(id) => id.to_string(),
        None => {
            println!("drive_mirror: SecureVault folder not found, skipping Google Drive deletion");
            return Ok(());
        }
    };

    // 2. Search and delete each target blob from Google Drive
    for blob_id in blob_ids.iter() {
        if blob_id.is_empty() || blob_id == "unknown" {
            continue;
        }

        let file_query = format!("name='{}' and '{}' in parents and trashed=false", blob_id, folder_id);
        let list_res = send_request(&|client, t| {
            client.get("https://www.googleapis.com/drive/v3/files")
                .bearer_auth(t)
                .query(&[("q", file_query.as_str()), ("spaces", "drive"), ("fields", "files(id)")])
        })?;

        if list_res.status().is_success() {
            let list_val: Value = list_res.json().map_err(|e| e.to_string())?;
            if let Some(files) = list_val["files"].as_array() {
                for file in files {
                    if let Some(file_id) = file["id"].as_str() {
                        println!("drive_mirror: Deleting file {} (ID: {}) from Google Drive", blob_id, file_id);
                        let del_res = send_request(&|client, t| {
                            client.delete(format!("https://www.googleapis.com/drive/v3/files/{}", file_id))
                                .bearer_auth(t)
                        });
                        if let Err(e) = del_res {
                            eprintln!("drive_mirror: Failed to delete file {} from GDrive: {}", file_id, e);
                        }
                    }
                }
            }
        } else {
            eprintln!("drive_mirror: Failed to search file {} in GDrive: status {}", blob_id, list_res.status());
        }
    }

    // 3. Call backend delete endpoint to clear DB records
    let (sk, pk) = crate::get_or_create_signing_key_at(config_path.clone());
    let payload = serde_json::json!({ "blob_ids": blob_ids });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let signature = sk.sign(&payload_bytes);
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

    let client = Client::new();
    let backend_res = client.post(format!("{}/api/vault/delete", crate::config::get_backend_url()))
        .header("X-Desktop-PK", pk)
        .header("X-Signature", sig_b64)
        .header("X-Google-Token", &token)
        .json(&payload)
        .send()
        .map_err(|e| e.to_string())?;

    if backend_res.status().is_success() {
        println!("drive_mirror: Successfully synchronized deletion with backend database");
        Ok(())
    } else {
        Err(format!("Backend database deletion synchronization failed: status {}", backend_res.status()))
    }
}
