use crate::fs::{VaultFile, internal_purge_blobs};
use crate::{get_config_path, get_or_create_signing_key, OnboardingConfig};
use ed25519_dalek::Signer;
use std::collections::{HashSet, HashMap};
use tauri::AppHandle;
use base64::Engine;

#[tauri::command]
pub async fn run_vault_cleanup(app: AppHandle) -> Result<usize, String> {
    println!("Cleanup: Starting automated vault cleanup...");
    
    let config_path = get_config_path(&app);
    let config_content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: OnboardingConfig = serde_json::from_str(&config_content).map_err(|e| e.to_string())?;
    
    let (sk, pk) = get_or_create_signing_key(&app);
    
    // 1. Fetch all blobs from backend
    let client = reqwest::Client::new();
    let signature = sk.sign(b"LIST_BLOBS");
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());
    
    let res = client
        .get(format!("{}/api/vault/blobs", crate::config::get_backend_url()))
        .header("X-Desktop-PK", &pk)
        .header("X-Signature", sig_b64)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch blobs: {}", e))?;
        
    if !res.status().is_success() {
        return Err(format!("Backend returned error: {}", res.status()));
    }
    
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let all_blobs: Vec<String> = data["blob_ids"]
        .as_array()
        .ok_or("Invalid response format")?
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .filter(|s| !s.is_empty())
        .collect();
        
    println!("Cleanup: Found {} blobs on cloud.", all_blobs.len());

    // 2. Identify in-use blobs from local index
    let local_index_path = config_path.parent().unwrap().join("local_index.json");
    let mut in_use = HashSet::new();
    
    // Add current root index ID
    if let Some(id) = &config.last_blob_id {
        in_use.insert(id.clone());
    }
    
    if let Ok(content) = std::fs::read_to_string(&local_index_path) {
        if let Ok(files) = serde_json::from_str::<HashMap<u64, VaultFile>>(&content) {
            for file in files.values() {
                if let Some(bid) = &file.cloud_blob_id {
                    in_use.insert(bid.clone());
                }
            }
        }
    }
    
    println!("Cleanup: {} blobs are currently in-use.", in_use.len());

    // 3. Find orphaned blobs
    let orphans: Vec<String> = all_blobs
        .into_iter()
        .filter(|bid| !in_use.contains(bid))
        .collect();
        
    let orphan_count = orphans.len();
    if orphan_count == 0 {
        println!("Cleanup: No orphaned blobs found. Vault is clean.");
        return Ok(0);
    }
    
    println!("Cleanup: Identified {} orphaned blobs to be purged.", orphan_count);

    // 4. Purge in batches
    // We'll use batches of 50 to avoid huge request bodies
    for batch in orphans.chunks(50) {
        let batch_vec: Vec<String> = batch.iter().cloned().collect();
        if let Err(e) = internal_purge_blobs(&config_path, batch_vec) {
            eprintln!("Cleanup: Batch purge failed: {}", e);
        }
    }

    println!("Cleanup: Completed. Purged {} blobs.", orphan_count);
    Ok(orphan_count)
}
