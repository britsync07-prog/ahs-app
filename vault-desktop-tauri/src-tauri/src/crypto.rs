use crate::{SharedBlobId, SharedKey};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use bip39::Mnemonic;
use ed25519_dalek::{Signer, SigningKey};
use rand::{thread_rng, RngCore};
use reqwest::blocking::Client;
use std::io::Read;
use std::path::PathBuf;
use tauri::command;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};
use zeroize::Zeroize;
use sha2::{Sha256, Digest};

use rayon::prelude::*;

pub const BLOCK_SIZE: usize = 128 * 1024; // Increase to 128KB for better throughput
pub const ENCRYPTED_BLOCK_SIZE: usize = BLOCK_SIZE + 16 + 12; // Data + Tag + Nonce

pub fn encrypt_local_data(data: &[u8], key_state: SharedKey) -> Result<Vec<u8>, String> {
    let key_guard = key_state.read().unwrap();
    let key_data = key_guard.as_ref().ok_or("Key not initialized")?.0;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_data);
    let cipher = Aes256Gcm::new(key);

    // Parallelize block processing for large files
    let chunks: Vec<_> = data.chunks(BLOCK_SIZE).collect();
    let encrypted_chunks: Result<Vec<Vec<u8>>, String> = chunks.into_par_iter().map(|chunk| {
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, chunk)
            .map_err(|e| format!("Encryption failed: {}", e))?;
        
        let mut block = Vec::with_capacity(ENCRYPTED_BLOCK_SIZE);
        block.extend_from_slice(&nonce_bytes);
        block.extend_from_slice(&ciphertext);
        Ok(block)
    }).collect();

    let mut result = Vec::new();
    for chunk in encrypted_chunks? {
        result.extend_from_slice(&chunk);
    }
    Ok(result)
}

pub fn decrypt_local_data(data: &[u8], key_state: SharedKey) -> Result<Vec<u8>, String> {
    let key_guard = key_state.read().unwrap();
    let key_data = key_guard.as_ref().ok_or("Key not initialized")?.0;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_data);
    let cipher = Aes256Gcm::new(key);

    let chunks: Vec<_> = data.chunks(ENCRYPTED_BLOCK_SIZE).collect();
    let decrypted_chunks: Result<Vec<Vec<u8>>, String> = chunks.into_par_iter().map(|chunk| {
        if chunk.len() < 28 {
            return Err("Invalid block size".to_string());
        }
        let nonce = Nonce::from_slice(&chunk[..12]);
        let ciphertext = &chunk[12..];
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e))
    }).collect();

    let mut result = Vec::new();
    for chunk in decrypted_chunks? {
        result.extend_from_slice(&chunk);
    }
    Ok(result)
}

pub fn derive_keys_from_mnemonic(phrase: &str) -> Result<([u8; 32], SigningKey, StaticSecret), String> {
    let mnemonic = Mnemonic::parse(phrase).map_err(|e| e.to_string())?;
    let seed = mnemonic.to_seed("");
    
    // 1. Master Key (AES-GCM) - First 32 bytes of seed
    let mut master_key = [0u8; 32];
    master_key.copy_from_slice(&seed[0..32]);

    // 2. Signing Key (Ed25519) - Next 32 bytes
    let mut signing_bytes = [0u8; 32];
    signing_bytes.copy_from_slice(&seed[32..64]);
    let signing_key = SigningKey::from_bytes(&signing_bytes);

    // 3. Encryption Secret (X25519) - Deterministic derivation
    let mut hasher = Sha256::new();
    hasher.update(&seed);
    let x_bytes: [u8; 32] = hasher.finalize().into();
    let x_secret = StaticSecret::from(x_bytes);

    Ok((master_key, signing_key, x_secret))
}

pub fn set_master_key_from_seed(
    phrase: String,
    state: tauri::State<'_, SharedKey>,
) -> Result<(), String> {
    let mnemonic = Mnemonic::parse(&phrase).map_err(|e| e.to_string())?;
    let seed = mnemonic.to_seed("");
    let mut key = [0u8; 32];
    key.copy_from_slice(&seed[0..32]);

    let mut storage = state.write().map_err(|e| e.to_string())?;
    *storage = Some((key, Some(phrase)));
    Ok(())
}

#[command]
pub fn clear_master_key(
    key_state: tauri::State<'_, SharedKey>,
    _blob_id_state: tauri::State<'_, SharedBlobId>,
) -> Result<(), String> {
    {
        let mut storage = key_state.write().map_err(|e| e.to_string())?;
        if let Some((mut key, _)) = storage.take() {
            key.zeroize(); 
        }
    }

    Ok(())
}

#[command]
pub fn get_master_mnemonic(state: tauri::State<'_, SharedKey>) -> Result<String, String> {
    let storage = state.read().map_err(|e| e.to_string())?;
    let (_, mnemonic) = storage.as_ref().ok_or("Vault is locked")?;
    mnemonic
        .clone()
        .ok_or("Mnemonic not available for this session (unlocked via mobile)".to_string())
}

pub fn decrypt_relayed_key(
    encrypted_b64: String,
    desktop_secret: &StaticSecret,
) -> Result<[u8; 32], String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encrypted_b64)
        .map_err(|e| e.to_string())?;

    if decoded.len() < 44 {
        return Err("Payload too short".to_string());
    }

    let (mobile_pk_bytes, rest) = decoded.split_at(32);
    let (nonce_bytes, ciphertext) = rest.split_at(12);

    let mobile_pk = X25519PublicKey::from(<[u8; 32]>::try_from(mobile_pk_bytes).unwrap());
    let shared_secret = desktop_secret.diffie_hellman(&mobile_pk);

    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(shared_secret.as_bytes());
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    let decrypted = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    if decrypted.len() != 32 {
        return Err("Invalid key length".to_string());
    }

    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&decrypted);
    Ok(key_arr)
}

pub fn stream_upload_blob(
    config_path: &PathBuf,
    shadow_path: &PathBuf,
    _key_state: SharedKey,
) -> Result<String, String> {
    let file = std::fs::File::open(shadow_path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();

    let (sk, pk) = crate::get_or_create_signing_key_at(config_path.clone());
    
    // Read google token from config
    let google_token = if let Ok(content) = std::fs::read_to_string(config_path) {
        if let Ok(config) = serde_json::from_str::<crate::OnboardingConfig>(&content) {
            config.google_access_token
        } else { None }
    } else { None };

    // Sign the whole shadow blob for authentication
    let mut hasher = Sha256::new();
    let mut reader = std::fs::File::open(shadow_path).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 8192];
    loop {
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    let digest = hasher.finalize();
    
    let signature = sk.sign(&digest);
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

    let client = reqwest::blocking::Client::new();
    let mut rb = client
        .post(format!("{}/api/vault/upload", crate::config::get_backend_url()))
        .header("Content-Length", size.to_string())
        .header("X-Desktop-PK", pk.clone())
        .header("X-Signature", sig_b64.clone());
    
    if let Some(token) = google_token {
        rb = rb.header("X-Google-Token", token);
    }

    let mut res = rb.body(file)
        .send()
        .map_err(|e| format!("Upload failed: {}", e))?;

    if res.status() == reqwest::StatusCode::UNAUTHORIZED || res.status() == reqwest::StatusCode::INTERNAL_SERVER_ERROR {
        eprintln!("crypto: Received {} from backend. Attempting token refresh...", res.status());
        if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
            println!("crypto: Token refreshed successfully. Retrying upload...");
            let file = std::fs::File::open(shadow_path).map_err(|e| e.to_string())?;
            let client = reqwest::blocking::Client::new();
            res = client
                .post(format!("{}/api/vault/upload", crate::config::get_backend_url()))
                .header("Content-Length", size.to_string())
                .header("X-Desktop-PK", pk)
                .header("X-Signature", sig_b64)
                .header("X-Google-Token", new_token)
                .body(file)
                .send()
                .map_err(|e| format!("Upload retry failed: {}", e))?;
        } else {
            eprintln!("crypto: Failed to refresh Google Token.");
        }
    }

    if res.status().is_success() {
        let body: serde_json::Value = res.json().map_err(|e| e.to_string())?;
        Ok(body["blob_id"].as_str().unwrap_or("unknown").to_string())
    } else {
        let status = res.status();
        let err_text = res.text().unwrap_or_default();
        eprintln!("crypto: Upload failed permanently with status {}. Body: {}", status, err_text);
        Err(format!("Server returned error: {}", status))
    }
}

pub fn stream_download_blob(
    config_path: &PathBuf,
    blob_id: String,
    dest_path: &PathBuf,
    provided_sk: Option<SigningKey>,
) -> Result<(), String> {
    if blob_id.is_empty() || blob_id == "unknown" {
        return Err("Invalid or empty blob ID".to_string());
    }
    let (sk, pk) = if let Some(sk) = provided_sk {
        let pk = base64::engine::general_purpose::STANDARD.encode(sk.verifying_key().to_bytes());
        (sk, pk)
    } else {
        crate::get_or_create_signing_key_at(config_path.clone())
    };
    let signature = sk.sign(blob_id.as_bytes());
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

    // Read google token from config
    let google_token = if let Ok(content) = std::fs::read_to_string(config_path) {
        if let Ok(config) = serde_json::from_str::<crate::OnboardingConfig>(&content) {
            config.google_access_token
        } else { None }
    } else { None };

    let client = Client::new();
    let mut rb = client
        .get(format!("{}/api/vault/download/{}", crate::config::get_backend_url(), blob_id))
        .header("X-Desktop-PK", pk.clone())
        .header("X-Signature", sig_b64.clone());
    
    if let Some(token) = google_token {
        rb = rb.header("X-Google-Token", token);
    }

    let mut res = rb.send()
        .map_err(|e| {
            eprintln!("crypto: Network error during stream_download_blob: {}", e);
            format!("Download failed: {}", e)
        })?;

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        eprintln!("crypto: Received UNAUTHORIZED (401) from backend. Attempting token refresh...");
        if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
            println!("crypto: Token refreshed successfully. Retrying download...");
            let client = Client::new();
            res = client
                .get(format!("{}/api/vault/download/{}", crate::config::get_backend_url(), blob_id))
                .header("X-Desktop-PK", pk)
                .header("X-Signature", sig_b64)
                .header("X-Google-Token", new_token)
                .send()
                .map_err(|e| {
                    eprintln!("crypto: Network error during retry: {}", e);
                    format!("Download retry failed: {}", e)
                })?;
        } else {
            eprintln!("crypto: Failed to refresh Google Token. Backend might reject request.");
        }
    }

    if !res.status().is_success() {
        let status = res.status();
        let error_body = res.text().unwrap_or_else(|_| "Unknown error".to_string());
        eprintln!("crypto: Server returned error status {}: {}", status, error_body);
        return Err(format!("Server returned error: {}", status));
    }

    let mut dest_file = std::fs::File::create(dest_path).map_err(|e| e.to_string())?;
    res.copy_to(&mut dest_file).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn encrypt_for_mobile(
    data: [u8; 32],
    mobile_x_pk_b64: String,
    desktop_secret: &StaticSecret,
) -> Result<String, String> {
    let mobile_x_pk_bytes = base64::engine::general_purpose::STANDARD
        .decode(mobile_x_pk_b64)
        .map_err(|e| e.to_string())?;

    if mobile_x_pk_bytes.len() != 32 {
        return Err("Invalid mobile X25519 public key length".to_string());
    }

    let mobile_pk = X25519PublicKey::from(<[u8; 32]>::try_from(mobile_x_pk_bytes).unwrap());
    let shared_secret = desktop_secret.diffie_hellman(&mobile_pk);

    let desktop_pk = X25519PublicKey::from(desktop_secret);

    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(shared_secret.as_bytes());
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; 12];
    thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let encrypted = cipher
        .encrypt(nonce, data.as_slice())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut payload = desktop_pk.as_bytes().to_vec();
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&encrypted);

    Ok(base64::engine::general_purpose::STANDARD.encode(payload))
}
