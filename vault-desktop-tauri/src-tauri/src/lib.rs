pub mod crypto;
pub mod config;
pub mod fs;
mod network;
mod oauth;
mod shield;
pub mod drive_mirror;

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::SigningKey;
use once_cell::sync::Lazy;
use rand::rngs::OsRng;
use rand::RngCore;
use std::collections::HashMap;
use std::fs as std_fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_dialog::DialogExt;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};

pub type SharedKey = Arc<RwLock<Option<([u8; 32], Option<String>)>>>;
pub type SharedBlobId = Arc<RwLock<Option<String>>>;
pub type SharedFileList = Arc<Mutex<HashMap<u64, fs::VaultFile>>>;

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct OnboardingConfig {
    pub onboarded: bool,
    pub mnemonic: Option<String>,
    pub mobile_public_key: Option<String>,
    pub mobile_x_public_key: Option<String>,
    pub desktop_signing_key: Option<String>,
    pub desktop_x_secret: Option<String>,
    pub last_blob_id: Option<String>,
    pub last_sync: Option<u64>,
    pub google_access_token: Option<String>,
    pub google_refresh_token: Option<String>,
}

#[tauri::command]
fn get_desktop_public_key(app: AppHandle) -> Result<String, String> {
    let path = get_config_path(&app);
    let (_, pk) = get_or_create_signing_key_at(path);
    Ok(pk)
}

#[derive(serde::Serialize)]
pub struct DesktopIdentityInfo {
    pub public_key: String,
}

#[tauri::command]
fn get_desktop_identity_info(app: AppHandle) -> Result<DesktopIdentityInfo, String> {
    let path = get_config_path(&app);
    let (_, pk) = get_or_create_signing_key_at(path);
    Ok(DesktopIdentityInfo { public_key: pk })
}

#[tauri::command]
async fn request_unlock_push(app: AppHandle) -> Result<(), String> {
    let path = get_config_path(&app);
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config: OnboardingConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // BROADCAST STRATEGY: 
    // If we have a mobile_public_key, use it as the explicit target.
    // If not (e.g. restoration mode), use our OWN public key as the target.
    // Since the mobile device shares the same identity, it will receive the push broadcast.
    let target_pk = if let Some(pk) = config.mobile_public_key {
        pk
    } else {
        let (_, pk) = get_or_create_signing_key_at(path);
        pk
    };

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/vault/push", crate::config::get_backend_url()))
        .json(&serde_json::json!({
            "target_public_key": target_pk,
            "encrypted_blob": "WAKE_UP_BIOMETRIC"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Push request failed: {}", res.status()))
    }
}

#[allow(dead_code)]
fn get_current_pk_b64() -> (String, String) {
    let mut csprng = OsRng;

    // Ed25519 for signing
    let signing_key: SigningKey = SigningKey::generate(&mut csprng);
    let verifying_key = signing_key.verifying_key();
    let ed_pk = general_purpose::STANDARD.encode(verifying_key.to_bytes());

    // X25519 for encryption
    // In production, these should be stored securely and not re-generated every time
    let static_secret = StaticSecret::random_from_rng(&mut csprng);
    let x_pk = X25519PublicKey::from(&static_secret);
    let x_pk_b64 = general_purpose::STANDARD.encode(x_pk.as_bytes());

    (ed_pk, x_pk_b64)
}

fn get_or_create_x_secret(app: &AppHandle) -> (StaticSecret, String) {
    let config_path = get_config_path(app);
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<OnboardingConfig>(&content) {
            if let Some(x_b64) = config.desktop_x_secret {
                if let Ok(x_bytes) = general_purpose::STANDARD.decode(x_b64) {
                    if let Ok(x_arr) = <[u8; 32]>::try_from(x_bytes) {
                        let secret = StaticSecret::from(x_arr);
                        let pk = X25519PublicKey::from(&secret);
                        let pk_b64 = general_purpose::STANDARD.encode(pk.as_bytes());
                        return (secret, pk_b64);
                    }
                }
            }

            // Fallback: If we have a mnemonic but no saved x_secret, derive it!
            if let Some(phrase) = config.mnemonic {
                if let Ok((_, _, secret)) = crypto::derive_keys_from_mnemonic(&phrase) {
                    let pk = X25519PublicKey::from(&secret);
                    let pk_b64 = general_purpose::STANDARD.encode(pk.as_bytes());
                    return (secret, pk_b64);
                }
            }
        }
    }

    let secret = StaticSecret::random_from_rng(&mut OsRng);
    let pk = X25519PublicKey::from(&secret);
    let pk_b64 = general_purpose::STANDARD.encode(pk.as_bytes());

    // Attempt to save it
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&config_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        OnboardingConfig::default()
    };
    config.desktop_x_secret = Some(general_purpose::STANDARD.encode(secret.to_bytes()));
    if let Ok(content) = serde_json::to_string(&config) {
        let _ = std::fs::write(config_path, content);
    }

    (secret, pk_b64)
}

fn get_or_create_signing_key(app: &AppHandle) -> (SigningKey, String) {
    get_or_create_signing_key_at(get_config_path(app))
}

pub fn get_or_create_signing_key_at(config_path: PathBuf) -> (SigningKey, String) {
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<OnboardingConfig>(&content) {
            if let Some(sk_b64) = config.desktop_signing_key {
                if let Ok(sk_bytes) = general_purpose::STANDARD.decode(sk_b64) {
                    if let Ok(sk_arr) = <[u8; 32]>::try_from(sk_bytes) {
                        let sk = SigningKey::from_bytes(&sk_arr);
                        let pk = general_purpose::STANDARD.encode(sk.verifying_key().to_bytes());
                        return (sk, pk);
                    }
                }
            }

            // Fallback: If we have a mnemonic but no saved key, derive it now!
            if let Some(phrase) = config.mnemonic {
                if let Ok((_, sk, _)) = crypto::derive_keys_from_mnemonic(&phrase) {
                    let pk = general_purpose::STANDARD.encode(sk.verifying_key().to_bytes());
                    return (sk, pk);
                }
            }
        }
    }

    let mut csprng = OsRng;
    let sk = SigningKey::generate(&mut csprng);
    let pk = general_purpose::STANDARD.encode(sk.verifying_key().to_bytes());

    // Attempt to save it
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&config_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        OnboardingConfig::default()
    };
    config.desktop_signing_key = Some(general_purpose::STANDARD.encode(sk.to_bytes()));
    if let Ok(content) = serde_json::to_string(&config) {
        let _ = std::fs::write(config_path, content);
    }

    (sk, pk)
}

fn get_config_path_internal(app_config_dir: PathBuf) -> PathBuf {
    let mut path = app_config_dir;
    std::fs::create_dir_all(&path).ok();
    path.push("onboarding.json");
    path
}

fn get_config_path(app: &AppHandle) -> PathBuf {
    let path = app
        .path()
        .app_config_dir()
        .expect("Failed to get config dir");
    get_config_path_internal(path)
}

#[tauri::command]
fn check_onboarding(app: AppHandle) -> bool {
    let path = get_config_path(&app);
    if let Ok(content) = std::fs::read_to_string(path) {
        if let Ok(config) = serde_json::from_str::<OnboardingConfig>(&content) {
            return config.onboarded;
        }
    }
    false
}

#[tauri::command]
fn factory_reset(app: AppHandle) {
    let path = get_config_path(&app);
    let _ = std::fs::remove_file(path);

    // Clear memory state
    if let Ok(mut storage) = app.state::<SharedKey>().write() {
        *storage = None;
    }
    if let Ok(mut storage) = app.state::<SharedBlobId>().write() {
        *storage = None;
    }
}

#[tauri::command]
fn complete_onboarding(app: AppHandle, mobile_public_key: String, mobile_x_public_key: String) {
    let path = get_config_path(&app);
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        OnboardingConfig::default()
    };

    config.onboarded = true;
    config.mobile_public_key = Some(mobile_public_key);
    config.mobile_x_public_key = Some(mobile_x_public_key);

    if let Ok(content) = serde_json::to_string(&config) {
        let _ = std::fs::write(path, content);
    }
}

#[tauri::command]
async fn share_master_key_with_phone(
    app: AppHandle,
    key_state: tauri::State<'_, SharedKey>,
) -> Result<(), String> {
    let path = get_config_path(&app);
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let config: OnboardingConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mobile_pk = config.mobile_public_key.ok_or("No paired mobile device")?;
    let mobile_x_pk = config
        .mobile_x_public_key
        .ok_or("No paired mobile X25519 key")?;

    let master_key = {
        let storage = key_state.read().map_err(|e| e.to_string())?;
        storage.as_ref().ok_or("Master key not generated")?.clone()
    };

    // Encrypt master_key for mobile_x_pk using desktop_x_secret
    let (x_secret, _) = get_or_create_x_secret(&app);
    let encrypted_b64 = crypto::encrypt_for_mobile(master_key.0, mobile_x_pk, &x_secret)?;

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/vault/push", crate::config::get_backend_url()))
        .json(&serde_json::json!({
            "mobile_public_key": mobile_pk,
            "encrypted_blob": encrypted_b64
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Push relay failed: {}", res.status()))
    }
}

#[tauri::command]
async fn unlock_manual(
    app: AppHandle,
    seed: String,
    key_state: tauri::State<'_, SharedKey>,
) -> Result<(), String> {
    crypto::set_master_key_from_seed(seed, key_state.clone())?;
    app.emit("vault-do-mount", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_recovery_stats(
    files_state: tauri::State<'_, SharedFileList>,
) -> Result<serde_json::Value, String> {
    let files = files_state.lock().unwrap();
    let total_size: u64 = files.values().map(|f| f.size).sum();
    let last_sync = LAST_SYNC_TIME.load(Ordering::SeqCst);

    Ok(serde_json::json!({
        "total_size": total_size,
        "file_count": files.len(),
        "last_sync": last_sync,
        "integrity": "Verified",
        "retention_days": 30
    }))
}

#[tauri::command]
async fn sync_now() -> Result<(), String> {
    let sync_tx = SYNC_TX.lock().unwrap();
    if let Some(tx) = sync_tx.as_ref() {
        tx.send(fs::SyncCommand::SyncIndex)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Vault is not mounted. Unlock the vault first.".to_string())
    }
}

#[tauri::command]
async fn export_vault_archive(app: AppHandle) -> Result<String, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    
    let folder = app.dialog()
        .file()
        .set_title("Select Backup Destination")
        .blocking_pick_folder();

    if let Some(dest_path) = folder {
        let dest = dest_path.into_path().map_err(|e| e.to_string())?;
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let backup_folder = dest.join(format!("Vault_Backup_{}", timestamp));
        
        std_fs::create_dir_all(&backup_folder).map_err(|e| e.to_string())?;
        copy_dir_recursive(&config_dir, &backup_folder)?;

        Ok(format!("Vault archive exported successfully to: {:?}", backup_folder))
    } else {
        Err("Export cancelled".to_string())
    }
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    if !dst.exists() {
        std_fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }

    for entry in std_fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std_fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
static FUSE_SESSION: Lazy<Mutex<Option<fuser::BackgroundSession>>> = Lazy::new(|| Mutex::new(None));
static SYNC_TX: Lazy<Mutex<Option<fs::PrioritySender>>> =
    Lazy::new(|| Mutex::new(None));
static IS_WATCHING: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));
static LAST_ACTIVITY: AtomicU64 = AtomicU64::new(0);
pub static LAST_SYNC_TIME: AtomicU64 = AtomicU64::new(0);
static AUTO_LOCK_TIMEOUT: AtomicU64 = AtomicU64::new(300);

async fn register_device_internal(public_key: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let os_info = if cfg!(target_os = "windows") {
        "Windows Desktop"
    } else if cfg!(target_os = "macos") {
        "macOS Desktop"
    } else {
        "Linux Desktop"
    };

    let _ = client
        .post(format!("{}/api/vault/register", crate::config::get_backend_url()))
        .json(&serde_json::json!({
            "public_key": public_key,
            "name": "Secure Workstation",
            "os": os_info
        }))
        .send()
        .await;
    Ok(())
}

fn start_inactivity_watcher(app: AppHandle, public_key_b64: String) {
    let pk_clone = public_key_b64.clone();
    
    // Auto-register on startup and every 30 mins
    tauri::async_runtime::spawn(async move {
        let _ = register_device_internal(pk_clone.clone()).await;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1800)).await;
            let _ = register_device_internal(pk_clone.clone()).await;
        }
    });

    let mut watching = IS_WATCHING.lock().unwrap();
    if *watching {
        return;
    }
    *watching = true;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    LAST_ACTIVITY.store(now, Ordering::SeqCst);


    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let last = LAST_ACTIVITY.load(Ordering::SeqCst);
        let timeout = AUTO_LOCK_TIMEOUT.load(Ordering::SeqCst);

        #[cfg(not(windows))]
        if !FUSE_SESSION.lock().unwrap().is_some() {
            let mut watching = IS_WATCHING.lock().unwrap();
            *watching = false;
            break;
        }
        
        #[cfg(windows)]
        {
             // On Windows, the session state is managed differently or not at all currently
             // For now, we assume it stays open until manually locked or timeout
        }

        if now - last >= timeout {
            let app_handle = app.clone();
            tauri::async_runtime::block_on(async move {
                let ks = app_handle.state::<SharedKey>();
                let bs = app_handle.state::<SharedBlobId>();
                let _ = lock_vault_internal(app_handle.clone(), ks, bs).await;
                let _ = app_handle.emit("vault-auto-locked", ());
            });
            let mut watching = IS_WATCHING.lock().unwrap();
            *watching = false;
            break;
        }
    });
}

#[tauri::command]
fn set_auto_lock_timeout(timeout_secs: u64) {
    AUTO_LOCK_TIMEOUT.store(timeout_secs, Ordering::SeqCst);
}

#[tauri::command]
fn reset_idle_timer() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    LAST_ACTIVITY.store(now, Ordering::SeqCst);
}

async fn lock_vault_internal(
    _app: AppHandle,
    key_state: tauri::State<'_, SharedKey>,
    blob_id_state: tauri::State<'_, SharedBlobId>,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let mut lock = FUSE_SESSION.lock().map_err(|e| e.to_string())?;
        if let Some(session) = lock.take() {
            // Drop in blocking thread to avoid Tokio panic
            tauri::async_runtime::spawn_blocking(move || {
                drop(session);
            });
        }
    }

    #[cfg(windows)]
    {
        // Unmount network drive
        let _ = Command::new("net")
            .arg("use")
            .arg("M:")
            .arg("/delete")
            .arg("/y")
            .status();
    }

    // Explicit lazy unmount to ensure UI doesn't hang if OS is slow to detach
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(mount_point) = vault_mount_path() {
            let _ = Command::new("fusermount")
                .arg("-uz")
                .arg(&mount_point)
                .status();
        }
    }

    crypto::clear_master_key(key_state, blob_id_state)?;
    shield::stop_shield();
    Ok(())
}

fn vault_mount_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(PathBuf::from("M:\\"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(PathBuf::from(home).join("SecureVault"))
    }
}

#[allow(unused_variables)]
async fn mount_vault_internal(
    app: AppHandle,
    key_state_clone: SharedKey,
    blob_id_state_clone: SharedBlobId,
) -> Result<(), String> {
    let app_clone = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mount_point = vault_mount_path()?;
        std_fs::create_dir_all(&mount_point).map_err(|e| e.to_string())?;
        
        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std_fs::set_permissions(&mount_point, std_fs::Permissions::from_mode(0o755));
        }

        // 1. Cleanup previous session if any
        #[cfg(not(windows))]
        {
            let mut lock = FUSE_SESSION.lock().unwrap();
            if let Some(session) = lock.take() {
                // We are already in a blocking thread, safe to drop
                drop(session);
            }
        }

        // 2. Lazy unmount just in case the kernel still has a stale mount
        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("fusermount")
                .arg("-uz")
                .arg(&mount_point)
                .status();
        }

        // 3. Load last_blob_id into state
        let config_path = get_config_path_internal(app_clone.path().app_config_dir().unwrap());
        if let Ok(content) = std_fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<OnboardingConfig>(&content) {
                if let Some(bid) = config.last_blob_id {
                    let mut bid_lock = blob_id_state_clone.write().unwrap();
                    *bid_lock = Some(bid);
                    if let Some(t) = config.last_sync {
                        LAST_SYNC_TIME.store(t, Ordering::SeqCst);
                    }
                }
            }
        }

        // Initialize VaultFS for ALL platforms so the sync worker starts
        let shared_files = app_clone.state::<SharedFileList>();
        let (vfs, sync_tx) =
            fs::VaultFS::new(app_clone.clone(), key_state_clone.clone(), blob_id_state_clone.clone(), shared_files.inner().clone());
        {
            *SYNC_TX.lock().unwrap() = Some(sync_tx);
        }

        #[cfg(target_os = "windows")]
        {
            let config_path_clone = config_path.clone();
            let app_handle_webdav = app_clone.clone();
            let key_state_webdav = key_state_clone.clone();
            
            // Start WebDAV server in a background thread
            std::thread::spawn(move || {
                run_webdav_server(app_handle_webdav, key_state_webdav);
            });

            // Attempt to mount network drive M: with retries to allow WebDAV to start
            let _ = Command::new("net")
                .arg("use")
                .arg("M:")
                .arg("/delete")
                .arg("/y")
                .status();

            for i in 0..5 {
                std::thread::sleep(std::time::Duration::from_millis(1000 * (i + 1)));
                // Reverted back to HTTP path as UNC was causing Error 67 on this system
                let status = Command::new("net")
                    .arg("use")
                    .arg("M:")
                    .arg("http://127.0.0.1:8081")
                    .arg("/persistent:no")
                    .status();
                
                if let Ok(s) = status {
                    if s.success() {
                        println!("VaultFS: Successfully mounted M: using HTTP path");
                        break;
                    }
                }
                println!("VaultFS: Mount attempt {} failed (HTTP), retrying...", i + 1);
            }

            let (_, pk) = get_or_create_signing_key_at(config_path_clone);
            start_inactivity_watcher(app_clone.clone(), pk);
            shield::start_intelligent_shield(app_clone);
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            let options = vec![
                fuser::MountOption::RW,
                fuser::MountOption::FSName("VaultFS".to_string()),
                fuser::MountOption::AllowOther,
                fuser::MountOption::DefaultPermissions,
            ];

            println!("VaultFS: Attempting to mount at {:?}", mount_point);
            match fuser::spawn_mount2(vfs, &mount_point, &options) {
                Ok(session) => {
                    println!("VaultFS: Mounted successfully at {:?}", mount_point);
                    {
                        *FUSE_SESSION.lock().unwrap() = Some(session);
                    }

                    let (_, pk) = get_or_create_signing_key_at(config_path);
                    start_inactivity_watcher(app_clone.clone(), pk);
                    shield::start_intelligent_shield(app_clone);
                    Ok(())
                }
                Err(e) => {
                    eprintln!("VaultFS: Failed to mount at {:?}: {}", mount_point, e);
                    Err(format!("FUSE mount failed: {}", e))
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mount_vault(
    app: AppHandle,
    key_state: tauri::State<'_, SharedKey>,
    blob_id_state: tauri::State<'_, SharedBlobId>,
) -> Result<(), String> {
    mount_vault_internal(app, key_state.inner().clone(), blob_id_state.inner().clone()).await
}

#[tauri::command]
async fn unlock_offline(
    app: AppHandle,
    mnemonic: String,
    key_state: tauri::State<'_, SharedKey>,
    blob_id_state: tauri::State<'_, SharedBlobId>,
) -> Result<(), String> {
    crypto::set_master_key_from_seed(mnemonic, key_state.clone())?;
    mount_vault_internal(app, key_state.inner().clone(), blob_id_state.inner().clone()).await
}

#[tauri::command]
async fn lock_vault(
    app: AppHandle,
    key_state: tauri::State<'_, SharedKey>,
    blob_id_state: tauri::State<'_, SharedBlobId>,
) -> Result<(), String> {
    lock_vault_internal(app, key_state, blob_id_state).await
}

#[tauri::command]
fn list_vault_files(files_state: tauri::State<'_, SharedFileList>) -> Vec<fs::VaultFile> {
    let files = files_state.lock().unwrap();
    files.values().cloned().collect()
}

#[tauri::command]
async fn create_vault_directory(name: String) -> Result<(), String> {
    let p = vault_mount_path()?.join(name);
    std_fs::create_dir(p).map_err(|e| e.to_string())
}

#[tauri::command]
async fn upload_to_vault(source_path: String, dest_prefix: Option<String>) -> Result<(), String> {
    let src = PathBuf::from(source_path);
    let filename = src.file_name().ok_or("Invalid filename")?;
    let mut dest = vault_mount_path()?;
    if let Some(prefix) = dest_prefix {
        if !prefix.is_empty() {
            dest = dest.join(prefix);
            std_fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        }
    }
    dest = dest.join(filename);

    std_fs::copy(src, dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_from_vault(_ino: u64, name: String) -> Result<(), String> {
    let p = vault_mount_path()?.join(name);
    if p.is_dir() {
        std_fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std_fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn download_from_vault(name: String, dest_path: String) -> Result<(), String> {
    let src = vault_mount_path()?.join(name);
    let dest = PathBuf::from(dest_path);
    std_fs::copy(src, dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn restore_vault(
    app: AppHandle,
    mnemonic: String,
    key_state: tauri::State<'_, SharedKey>,
) -> Result<bool, String> {
    println!("Restoration: Starting for phrase...");
    // 1. Derive keys
    let (master_key, signing_key, x_secret) = crypto::derive_keys_from_mnemonic(&mnemonic)?;
    let pk = general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes());

    // 2. Check if user exists on backend
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/vault/stats", crate::config::get_backend_url()))
        .query(&[("public_key", &pk)])
        .send()
        .await
        .map_err(|e| format!("Backend connection failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Backend returned error: {}", res.status()));
    }

    let stats: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let file_count = stats["filesProtected"].as_i64().unwrap_or(0);
    let device_count = stats["deviceCount"].as_i64().unwrap_or(0);

    if file_count == 0 && device_count == 0 {
        println!("Restoration: No vault found for this identity.");
        return Ok(false); // User doesn't exist or vault is empty
    }

    println!("Restoration: Vault found! {} files.", file_count);

    // 3. User exists! Initialize identity
    let config_path = get_config_path(&app);
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&config_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        OnboardingConfig::default()
    };

    config.onboarded = true;
    config.mnemonic = Some(mnemonic.clone());
    config.desktop_signing_key = Some(general_purpose::STANDARD.encode(signing_key.to_bytes()));
    config.desktop_x_secret = Some(general_purpose::STANDARD.encode(x_secret.to_bytes()));
    
    // Also fetch the root index ID
    println!("Restoration: Fetching root index pointer...");
    let index_res = client
        .get(format!("{}/api/vault/index", crate::config::get_backend_url()))
        .query(&[("public_key", &pk)])
        .send()
        .await
        .map_err(|e| format!("Index fetch failed: {}", e))?;
        
    if index_res.status().is_success() {
        let index_data: serde_json::Value = index_res.json().await.map_err(|e| e.to_string())?;
        if let Some(id) = index_data["blob_id"].as_str() {
            if !id.is_empty() {
                println!("Restoration: Downloading root index {}...", id);
                config.last_blob_id = Some(id.to_string());

                let id = id.to_string();
                let config_path_c = config_path.clone();
                let signing_key_c = signing_key.clone();
                let master_key_c = master_key;
                let mnemonic_c = mnemonic.clone();

                tauri::async_runtime::spawn_blocking(move || {
                    // Download and decrypt the index
                    let temp_path = config_path_c.parent().unwrap().join("restored_index.tmp");
                    crypto::stream_download_blob(
                        &config_path_c,
                        id,
                        &temp_path,
                        Some(signing_key_c),
                    )?;

                    println!("Restoration: Decrypting root index...");
                    let encrypted_data = std_fs::read(&temp_path).map_err(|e| e.to_string())?;
                    let key_state_wrapped =
                        Arc::new(RwLock::new(Some((master_key_c, Some(mnemonic_c)))));
                    let decrypted_data = crypto::decrypt_local_data(&encrypted_data, key_state_wrapped)
                        .map_err(|e| format!("Index decryption failed: {}", e))?;

                    let local_index_path = config_path_c.parent().unwrap().join("local_index.json");
                    std_fs::write(local_index_path, decrypted_data).map_err(|e| e.to_string())?;
                    let _ = std_fs::remove_file(temp_path);
                    println!("Restoration: Index restored successfully.");
                    Ok::<(), String>(())
                })
                .await
                .map_err(|e| e.to_string())??;
            }
        }
    }

    println!("Restoration: Finalizing config at {:?}", config_path);
    if let Ok(content) = serde_json::to_string_pretty(&config) {
        std_fs::write(&config_path, content).map_err(|e| e.to_string())?;
    }

    // Set memory state
    *key_state.write().unwrap() = Some((master_key, Some(mnemonic)));

    // Re-trigger WebSocket with new identity
    if let Ok(mut handle_lock) = WS_JOIN_HANDLE.lock() {
        if let Some(h) = handle_lock.take() {
            h.abort();
        }
        let (app_c2, pk_c, n_c) = (app.clone(), pk.clone(), "RESTORED_IDENTITY".to_string());
        let x_secret_c = x_secret.clone();
        *handle_lock = Some(tauri::async_runtime::spawn(async move {
            network::connect_and_register(app_c2, pk_c, n_c, true, x_secret_c).await;
        }));
    }

    Ok(true)
}

#[tauri::command]
async fn start_restoration_download(
    _app: AppHandle,
    _key_state: tauri::State<'_, SharedKey>,
    _blob_id_state: tauri::State<'_, SharedBlobId>,
    _files_state: tauri::State<'_, SharedFileList>,
) -> Result<(), String> {
    // This function will fetch the index, then download all files
    
    // For "Restore", we mount the vault, and VaultFS should realize 
    // it has an index but no local blobs, so it should fetch them.
    
    // I'll add a 'SyncAll' command to the worker.
    
    let sync_tx = SYNC_TX.lock().unwrap();
    if let Some(tx) = sync_tx.as_ref() {
        let _ = tx.send(fs::SyncCommand::PullAll);
    }
    
    Ok(())
}
static WS_JOIN_HANDLE: Lazy<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> =
    Lazy::new(|| Mutex::new(None));

#[derive(serde::Serialize)]
pub struct IdentityResponse {
    pub desktop_public_key: String,
    pub desktop_x_public_key: String,
    pub pairing_nonce: String,
    pub backend_url: String,
    pub mnemonic: Option<String>,
}

#[tauri::command]
fn generate_desktop_identity(app: AppHandle, key_state: tauri::State<'_, SharedKey>) -> Result<IdentityResponse, String> {
    let path = get_config_path(&app);
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        OnboardingConfig::default()
    };

    // If we don't have a mnemonic yet, generate one now
    // This ensures the identity (PK) shown in the QR code is already deterministic
    if config.mnemonic.is_none() {
        let mut entropy = [0u8; 32];
        OsRng.fill_bytes(&mut entropy);
        let m = bip39::Mnemonic::from_entropy(&entropy).map_err(|e| e.to_string())?;
        config.mnemonic = Some(m.to_string());
    }

    let phrase = config.mnemonic.as_ref().unwrap();
    let (master_key, signing_key, x_secret) = crypto::derive_keys_from_mnemonic(phrase)?;

    let ed_pk = general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes());
    let x_pk = X25519PublicKey::from(&x_secret);
    let x_pk_b64 = general_purpose::STANDARD.encode(x_pk.as_bytes());

    // Save them to config
    config.desktop_signing_key = Some(general_purpose::STANDARD.encode(signing_key.to_bytes()));
    config.desktop_x_secret = Some(general_purpose::STANDARD.encode(x_secret.to_bytes()));

    if let Ok(content) = serde_json::to_string(&config) {
        let _ = std_fs::write(path, content);
    }

    // Set memory state
    *key_state.write().unwrap() = Some((master_key, Some(phrase.clone())));

    let nonce = uuid::Uuid::new_v4().to_string();
    let is_onboarded = config.onboarded;
    let backend_url = crate::config::get_backend_url();

    if let Ok(mut handle_lock) = WS_JOIN_HANDLE.lock() {
        if let Some(h) = handle_lock.take() {
            h.abort();
        }
        let (app_c, pk_c, n_c) = (app.clone(), ed_pk.clone(), nonce.clone());
        let x_secret_c = x_secret.clone();
        *handle_lock = Some(tauri::async_runtime::spawn(async move {
            network::connect_and_register(app_c, pk_c, n_c, is_onboarded, x_secret_c).await;
        }));
    }

    Ok(IdentityResponse {
        desktop_public_key: ed_pk,
        desktop_x_public_key: x_pk_b64,
        pairing_nonce: nonce,
        backend_url,
        mnemonic: Some(phrase.clone()),
    })
}

#[tauri::command]
fn open_vault_folder() -> Result<(), String> {
    let p = vault_mount_path()?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(&p).spawn().ok();
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("xdg-open").arg(&p).spawn().ok();
    }
    Ok(())
}

#[tauri::command]
fn is_google_connected(app: AppHandle) -> bool {
    let path = get_config_path(&app);
    if let Ok(content) = std::fs::read_to_string(path) {
        if let Ok(config) = serde_json::from_str::<OnboardingConfig>(&content) {
            // Strictly require a refresh_token to be considered "connected"
            // If they only have an access_token, it will eventually expire and fail.
            return config.google_refresh_token.is_some();
        }
    }
    false
}

#[tauri::command]
fn save_google_tokens(app: AppHandle, access_token: String, refresh_token: Option<String>) -> Result<(), String> {
    let path = get_config_path(&app);
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        OnboardingConfig::default()
    };

    config.google_access_token = Some(access_token);
    if refresh_token.is_some() {
        config.google_refresh_token = refresh_token;
    }

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn run_webdav_server(app: AppHandle, key_state: SharedKey) {
    let server = tiny_http::Server::http("127.0.0.1:8081").unwrap();
    println!("WebDAV: Server started on 127.0.0.1:8081");

    for mut request in server.incoming_requests() {
        let method = request.method().to_string();
        let mut url = request.url().to_string();
        
        if url.ends_with('/') && url.len() > 1 { url.pop(); }
        if url.starts_with("/DavWWWRoot") { url = url.replacen("/DavWWWRoot", "", 1); }
        if url.is_empty() { url = "/".to_string(); }

        println!("WebDAV Request: {} {}", method, url);

        match method.as_str() {
            "OPTIONS" => {
                let response = tiny_http::Response::empty(200)
                    .with_header(tiny_http::Header::from_bytes(&b"Allow"[..], &b"GET, HEAD, POST, OPTIONS, PROPFIND, PUT, DELETE, MKCOL, MOVE, LOCK, UNLOCK, PROPPATCH"[..]).unwrap())
                    .with_header(tiny_http::Header::from_bytes(&b"DAV"[..], &b"1, 2"[..]).unwrap())
                    .with_header(tiny_http::Header::from_bytes(&b"MS-Author-Via"[..], &b"DAV"[..]).unwrap())
                    .with_header(tiny_http::Header::from_bytes(&b"Content-Length"[..], &b"0"[..]).unwrap());
                let _ = request.respond(response);
            }
            "PROPPATCH" => {
                let xml = format!(
                    r#"<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>{}</D:href>
    <D:propstat>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>"#, url);
                let response = tiny_http::Response::from_string(xml)
                    .with_status_code(207)
                    .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/xml; charset=utf-8"[..]).unwrap());
                let _ = request.respond(response);
            }
            "PROPFIND" => {
                let depth = request.headers().iter().find(|h| h.field.equiv("Depth")).map(|h| h.value.as_str()).unwrap_or("infinity");
                let files_state = app.state::<SharedFileList>();
                let files = files_state.lock().unwrap();
                
                let target_path = url.trim_start_matches('/');
                let target_ino = if target_path.is_empty() { Some(1) } else { files.values().find(|f| f.name == target_path).map(|f| f.ino) };

                if let Some(ino) = target_ino {
                    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n<D:multistatus xmlns:D=\"DAV:\">\n");
                    
                    if ino == 1 {
                        xml.push_str("<D:response>\n");
                        xml.push_str(&format!("<D:href>{}</D:href>\n", url));
                        xml.push_str("<D:propstat>\n<D:prop>\n");
                        xml.push_str("<D:displayname>VaultRoot</D:displayname>\n");
                        xml.push_str("<D:resourcetype><D:collection/></D:resourcetype>\n");
                        xml.push_str("<D:creationdate>2024-01-01T00:00:00Z</D:creationdate>\n");
                        xml.push_str("<D:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</D:getlastmodified>\n");
                        xml.push_str("</D:prop>\n<D:status>HTTP/1.1 200 OK</D:status>\n</D:propstat>\n</D:response>\n");
                    } else if let Some(f) = files.get(&ino) { 
                        xml.push_str(&generate_dav_response(f, &url)); 
                    }

                    if depth != "0" {
                        for f in files.values() {
                            // Because VaultFS stores full paths in `f.name` like "BLEACK/28.jpeg" and hardcodes `parent_ino: 1`,
                            // we must parse the paths here to simulate folders for Windows WebClient.
                            let mut include = false;
                            let mut child_url = String::new();
                            
                            if ino == 1 {
                                // Root directory: include files/folders with NO slashes
                                if !f.name.contains('/') && f.name != "" {
                                    include = true;
                                    child_url = format!("/{}", f.name);
                                }
                            } else {
                                // Subdirectory: include files/folders directly underneath this target_path
                                let parent_prefix = format!("{}/", target_path);
                                if f.name.starts_with(&parent_prefix) && f.name.len() > parent_prefix.len() {
                                    let remainder = &f.name[parent_prefix.len()..];
                                    if !remainder.contains('/') {
                                        include = true;
                                        child_url = format!("{}/{}", url, remainder);
                                    }
                                }
                            }
                            
                            if include {
                                xml.push_str(&generate_dav_response(f, &child_url));
                            }
                        }
                    }
                    xml.push_str("</D:multistatus>");
                    let response = tiny_http::Response::from_string(xml)
                        .with_status_code(207)
                        .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/xml; charset=utf-8"[..]).unwrap());
                    let _ = request.respond(response);
                } else { let _ = request.respond(tiny_http::Response::empty(404)); }
            }
            "HEAD" => {
                let path = url.trim_start_matches('/');
                let files_state = app.state::<SharedFileList>();
                let files = files_state.lock().unwrap();
                if let Some(f) = files.values().find(|f| f.name == path) {
                    let response = tiny_http::Response::empty(200)
                        .with_header(tiny_http::Header::from_bytes(&b"Content-Length"[..], f.size.to_string().as_bytes()).unwrap());
                    let _ = request.respond(response);
                } else { let _ = request.respond(tiny_http::Response::empty(404)); }
            }
            "GET" => {
                let path = url.trim_start_matches('/');
                let files_state = app.state::<SharedFileList>();
                let files = files_state.lock().unwrap();
                if let Some(f) = files.values().find(|f| f.name == path) {
                    if let Some(shadow_path) = &f.shadow_path {
                        if let Ok(encrypted_data) = std_fs::read(shadow_path) {
                            if let Ok(decrypted) = crypto::decrypt_local_data(&encrypted_data, key_state.clone()) {
                                let response = tiny_http::Response::from_data(decrypted);
                                let _ = request.respond(response);
                                continue;
                            }
                        }
                    }
                }
                let _ = request.respond(tiny_http::Response::empty(404));
            }
            "PUT" => {
                let path = url.trim_start_matches('/');
                let mut data = Vec::new();
                let _ = request.as_reader().read_to_end(&mut data);

                let config_dir = app.path().app_config_dir().unwrap();
                let shadow_dir = config_dir.join(".vault_shadow");
                let local_index_path = config_dir.join("local_index.json");

                let files_state = app.state::<SharedFileList>();
                let mut files = files_state.lock().unwrap();

                let existing_ino = files.values().find(|f| f.name == path).map(|f| f.ino);
                
                let res: Result<bool, String> = if let Some(ino) = existing_ino {
                    let shadow_path = shadow_dir.join(format!("{}.blob", ino));
                    let _ = std_fs::create_dir_all(&shadow_dir);
                    let encrypted = crypto::encrypt_local_data(&data, key_state.clone()).unwrap();
                    let _ = std_fs::write(shadow_path, encrypted);
                    
                    if let Some(f) = files.get_mut(&ino) {
                        f.size = data.len() as u64;
                        f.modified_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                    }
                    
                    let sync_tx = SYNC_TX.lock().unwrap();
                    if let Some(tx) = sync_tx.as_ref() {
                        let _ = tx.send(fs::SyncCommand::SyncFile { ino });
                    }
                    Ok(true) // Was overwrite
                } else {
                    let next_ino = files.keys().max().cloned().unwrap_or(1) + 1;
                    let shadow_path = shadow_dir.join(format!("{}.blob", next_ino));
                    let _ = std_fs::create_dir_all(&shadow_dir);
                    
                    let encrypted = crypto::encrypt_local_data(&data, key_state.clone()).unwrap();
                    let _ = std_fs::write(&shadow_path, encrypted);

                    let new_file = fs::VaultFile {
                        ino: next_ino,
                        parent_ino: 1,
                        name: path.to_string(),
                        kind: fs::VaultFileType::RegularFile,
                        size: data.len() as u64,
                        modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                        shadow_path: Some(shadow_path),
                        cloud_blob_id: None,
                        last_synced_hash: None,
                    };
                    files.insert(next_ino, new_file);
                    
                    if let Ok(idx_data) = serde_json::to_string(&*files) {
                        let _ = std_fs::write(local_index_path, idx_data);
                    }
                    
                    let sync_tx = SYNC_TX.lock().unwrap();
                    if let Some(tx) = sync_tx.as_ref() {
                        let _ = tx.send(fs::SyncCommand::SyncFile { ino: next_ino });
                        let _ = tx.send(fs::SyncCommand::SyncIndex);
                    }
                    Ok(false) // Was new
                };

                if let Ok(is_overwrite) = res {
                    let status = if is_overwrite { 200 } else { 201 };
                    let _ = request.respond(tiny_http::Response::empty(status));
                } else {
                    let _ = request.respond(tiny_http::Response::empty(500));
                }
            }
            "DELETE" => {
                let path = url.trim_start_matches('/');
                let files_state = app.state::<SharedFileList>();
                let mut files = files_state.lock().unwrap();
                
                let found_ino = files.values().find(|f| f.name == path).map(|f| f.ino);
                if let Some(ino) = found_ino {
                    if let Some(f) = files.remove(&ino) {
                        let sync_tx = SYNC_TX.lock().unwrap();
                        if let Some(tx) = sync_tx.as_ref() {
                            if let Some(p) = f.shadow_path { let _ = tx.send(fs::SyncCommand::PurgeShadow { path: p }); }
                            if let Some(bid) = f.cloud_blob_id { let _ = tx.send(fs::SyncCommand::PurgeCloud { blob_id: bid }); }
                            let _ = tx.send(fs::SyncCommand::SyncIndex);
                        }
                    }
                    let _ = request.respond(tiny_http::Response::empty(204));
                } else { let _ = request.respond(tiny_http::Response::empty(404)); }
            }
            "MKCOL" => {
                let path = url.trim_start_matches('/');
                let files_state = app.state::<SharedFileList>();
                let mut files = files_state.lock().unwrap();
                
                let next_ino = files.keys().max().cloned().unwrap_or(1) + 1;
                let new_dir = fs::VaultFile {
                    ino: next_ino,
                    parent_ino: 1,
                    name: path.to_string(),
                    kind: fs::VaultFileType::Directory,
                    size: 0,
                    modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                    shadow_path: None,
                    cloud_blob_id: None,
                    last_synced_hash: None,
                    };
                files.insert(next_ino, new_dir);
                
                let sync_tx = SYNC_TX.lock().unwrap();
                if let Some(tx) = sync_tx.as_ref() { let _ = tx.send(fs::SyncCommand::SyncIndex); }
                let _ = request.respond(tiny_http::Response::empty(201));
            }
            "MOVE" => {
                let path = url.trim_start_matches('/');
                let dest_header = request.headers().iter().find(|h| h.field.equiv("Destination"));
                
                if let Some(dest) = dest_header {
                    if let Ok(u) = url::Url::parse(dest.value.as_str()) {
                        let new_path = u.path().trim_start_matches('/');
                        let files_state = app.state::<SharedFileList>();
                        let mut files = files_state.lock().unwrap();
                        
                        let found_ino = files.values().find(|f| f.name == path).map(|f| f.ino);
                        if let Some(ino) = found_ino {
                            if let Some(f) = files.get_mut(&ino) {
                                f.name = new_path.to_string();
                                f.modified_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                            }
                            let sync_tx = SYNC_TX.lock().unwrap();
                            if let Some(tx) = sync_tx.as_ref() { let _ = tx.send(fs::SyncCommand::SyncIndex); }
                            let _ = request.respond(tiny_http::Response::empty(201));
                            continue;
                        }
                    }
                }
                let _ = request.respond(tiny_http::Response::empty(404));
            }
            "LOCK" => {
                let xml = r#"<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>Infinity</D:depth>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>urn:uuid:dummy-lock</D:href></D:locktoken>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>"#;
                let response = tiny_http::Response::from_string(xml)
                    .with_status_code(200)
                    .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/xml; charset=utf-8"[..]).unwrap())
                    .with_header(tiny_http::Header::from_bytes(&b"Lock-Token"[..], &b"<urn:uuid:dummy-lock>"[..]).unwrap());
                let _ = request.respond(response);
            }
            "UNLOCK" => { let _ = request.respond(tiny_http::Response::empty(204)); }
            _ => { let _ = request.respond(tiny_http::Response::empty(405)); }
        }
    }
}

#[cfg(target_os = "windows")]
fn generate_dav_response(f: &fs::VaultFile, href: &str) -> String {
    let is_dir = matches!(f.kind, fs::VaultFileType::Directory);
    let mut res = String::new();
    res.push_str("<D:response>\n");
    res.push_str(&format!("<D:href>{}</D:href>\n", href));
    res.push_str("<D:propstat>\n<D:prop>\n");
    res.push_str(&format!("<D:displayname>{}</D:displayname>\n", f.name));
    if is_dir { 
        res.push_str("<D:resourcetype><D:collection/></D:resourcetype>\n"); 
    } else { 
        res.push_str("<D:resourcetype/>\n"); 
        res.push_str(&format!("<D:getcontentlength>{}</D:getcontentlength>\n", f.size)); 
        res.push_str("<D:getcontenttype>application/octet-stream</D:getcontenttype>\n");
    }
    res.push_str("<D:creationdate>2024-01-01T00:00:00Z</D:creationdate>\n");
    res.push_str("<D:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</D:getlastmodified>\n");
    res.push_str("</D:prop>\n<D:status>HTTP/1.1 200 OK</D:status>\n</D:propstat>\n</D:response>\n");
    res
}

#[tauri::command]
async fn generate_secondary_pairing_payload(
    app: AppHandle,
    key_state: tauri::State<'_, SharedKey>,
) -> Result<IdentityResponse, String> {
    let storage = key_state.read().map_err(|e| e.to_string())?;
    
    // We only allow secondary pairing if the vault is currently unlocked
    if storage.is_none() {
        return Err("Vault must be unlocked to pair a new device".to_string());
    }

    let (_, pk_b64) = get_or_create_signing_key(&app);
    let (x_priv, x_pub_b64) = get_or_create_x_secret(&app);

    let mut rng = rand::thread_rng();
    let mut nonce_bytes = [0u8; 32];
    rng.fill_bytes(&mut nonce_bytes);
    let nonce = base64::engine::general_purpose::STANDARD.encode(nonce_bytes);

    // Register this new pairing session with the backend so it expects the handshake
    let backend_url = crate::config::get_backend_url();
    
    if let Ok(mut handle_lock) = WS_JOIN_HANDLE.lock() {
        if let Some(h) = handle_lock.take() {
            h.abort();
        }
        let (app_c, pk_c, n_c) = (app.clone(), pk_b64.clone(), nonce.clone());
        let x_secret_c = x_priv.clone();
        *handle_lock = Some(tauri::async_runtime::spawn(async move {
            network::connect_and_register(app_c, pk_c, n_c, true, x_secret_c).await;
        }));
    }

    // Notice we do NOT include the mnemonic or AES key here.
    // Secondary devices must wait for the "Magic Push" from the Desktop.
    Ok(IdentityResponse {
        desktop_public_key: pk_b64,
        desktop_x_public_key: x_pub_b64,
        pairing_nonce: nonce,
        backend_url,
        mnemonic: None, 
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.set_focus();
            });
        }))
        .manage(SharedKey::default())
        .manage(SharedBlobId::default())
        .manage(SharedFileList::default())
        .invoke_handler(tauri::generate_handler![
            generate_desktop_identity,
            generate_secondary_pairing_payload,
            get_desktop_identity_info,
            open_vault_folder,
            mount_vault,
            lock_vault,
            list_vault_files,
            crypto::clear_master_key,
            reset_idle_timer,
            set_auto_lock_timeout,
            request_unlock_push,
            get_desktop_public_key,
            check_onboarding,
            complete_onboarding,
            unlock_manual,
            factory_reset,
            share_master_key_with_phone,
            create_vault_directory,
            upload_to_vault,
            crypto::get_master_mnemonic,
            sync_now,
            get_recovery_stats,
            export_vault_archive,
            delete_from_vault,
            download_from_vault,
            unlock_offline,
            restore_vault,
            start_restoration_download,
            oauth::login_google,
            is_google_connected,
            save_google_tokens
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let window = app.get_webview_window("main").unwrap();
                let _ = apply_mica(&window, None);
            }

            // START 24-HOUR BACKGROUND HEARTBEAT SYNC
            std::thread::spawn(|| {
                loop {
                    // Wait 24 hours (86400 seconds)
                    std::thread::sleep(std::time::Duration::from_secs(86400));

                    let sync_tx = SYNC_TX.lock().unwrap();
                    if let Some(tx) = sync_tx.as_ref() {
                        let _ = tx.send(fs::SyncCommand::SyncIndex);
                    }
                }
            });

            // Setup System Tray
            let quit_i = MenuItemBuilder::new("Quit Vault").id("quit").build(app)?;
            let show_i = MenuItemBuilder::new("Show Vault").id("show").build(app)?;

            let menu = MenuBuilder::new(app).item(&show_i).item(&quit_i).build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        let window = app.get_webview_window("main").unwrap();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let app_h = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let is_onboarded = check_onboarding(app_h.clone());
                if is_onboarded {
                    let (_sk, pk) = get_or_create_signing_key(&app_h);
                    let (x_secret, _) = get_or_create_x_secret(&app_h);
                    network::connect_and_register(
                        app_h,
                        pk,
                        "ALREADY_ONBOARDED".to_string(),
                        true,
                        x_secret,
                    )
                    .await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
