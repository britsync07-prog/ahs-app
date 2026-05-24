use crate::fs::VaultFile;
use crate::{get_config_path, get_or_create_signing_key, OnboardingConfig};
use ed25519_dalek::Signer;
use std::collections::{HashSet, HashMap};
use std::path::PathBuf;
use tauri::AppHandle;
use base64::Engine;

// Fixed deletion utility that includes the Google Token
pub fn standalone_purge_blobs(config_path: &PathBuf, blob_ids: Vec<String>) -> Result<(), String> {
    if blob_ids.is_empty() { return Ok(()); }
    
    let (sk, pk) = crate::get_or_create_signing_key_at(config_path.clone());
    let payload = serde_json::json!({ "blob_ids": blob_ids });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    
    let signature = sk.sign(&payload_bytes);
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());
    
    // Read google token from config
    let google_token = if let Ok(content) = std::fs::read_to_string(config_path) {
        if let Ok(config) = serde_json::from_str::<OnboardingConfig>(&content) {
            config.google_access_token
        } else { None }
    } else { None };

    let client = reqwest::blocking::Client::new();
    let mut rb = client.post(format!("{}/api/vault/delete-v2", crate::config::get_backend_url()))
        .header("X-Desktop-PK", pk.clone())
        .header("X-Signature", sig_b64.clone())
        .json(&payload);
    
    if let Some(token) = google_token {
        rb = rb.header("X-Google-Token", token);
    }

    let mut res = rb.send().map_err(|e| e.to_string())?;
        
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
            let client = reqwest::blocking::Client::new();
            res = client.post(format!("{}/api/vault/delete-v2", crate::config::get_backend_url()))
                .header("X-Desktop-PK", pk)
                .header("X-Signature", sig_b64)
                .header("X-Google-Token", new_token)
                .json(&payload)
                .send()
                .map_err(|e| e.to_string())?;
        }
    }

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Purge failed: {}", res.status()))
    }
}

#[tauri::command]
pub async fn run_standalone_cleanup(app: AppHandle) -> Result<usize, String> {
    let config_path = get_config_path(&app);
    let config_content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: OnboardingConfig = serde_json::from_str(&config_content).map_err(|e| e.to_string())?;
    
    let (sk, pk) = get_or_create_signing_key(&app);
    let google_token = config.google_access_token.clone().ok_or("Drive not connected")?;

    // 1. Fetch from Drive via new standalone endpoint
    let client = reqwest::Client::new();
    let signature = sk.sign(b"CLEANUP_DRIVE");
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());
    
    let res = client
        .get(format!("{}/api/vault/cleanup/drive", crate::config::get_backend_url()))
        .header("X-Desktop-PK", &pk)
        .header("X-Signature", sig_b64)
        .header("X-Google-Token", google_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
        
    if !res.status().is_success() {
        return Err(format!("Drive list failed: {}", res.status()));
    }
    
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let drive_blobs: Vec<String> = data["blob_ids"]
        .as_array()
        .ok_or("Invalid format")?
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // 2. Identify in-use
    let mut in_use = HashSet::new();
    if let Some(id) = &config.last_blob_id {
        in_use.insert(id.clone());
    }
    let local_index_path = config_path.parent().unwrap().join("local_index.json");
    if let Ok(content) = std::fs::read_to_string(&local_index_path) {
        if let Ok(files) = serde_json::from_str::<HashMap<u64, VaultFile>>(&content) {
            for file in files.values() {
                if let Some(bid) = &file.cloud_blob_id {
                    in_use.insert(bid.clone());
                }
            }
        }
    }

    // 3. Find orphans
    let orphans: Vec<String> = drive_blobs.into_iter().filter(|bid| !in_use.contains(bid)).collect();
    let count = orphans.len();
    
    // 4. Purge
    for batch in orphans.chunks(50) {
        let _ = standalone_purge_blobs(&config_path, batch.iter().cloned().collect());
    }

    Ok(count)
}
