#![allow(dead_code)]

#[cfg(not(windows))]
use fuser::{
    FileAttr, FileType, Filesystem, ReplyAttr, ReplyCreate, ReplyData, ReplyDirectory, ReplyEmpty,
    ReplyEntry, ReplyOpen, ReplyWrite, Request, TimeOrNow,
};

#[cfg(not(windows))]
use libc::ENOENT;

use std::collections::HashMap;
#[cfg(not(windows))]
use std::ffi::OsStr;
use std::fs as std_fs;

#[cfg(not(windows))]
use std::os::unix::fs::FileExt;

#[cfg(windows)]
use std::os::windows::fs::FileExt;

use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

trait FileExtCross {
    fn read_at_cross(&self, buf: &mut [u8], offset: u64) -> std::io::Result<usize>;
    fn write_at_cross(&self, buf: &[u8], offset: u64) -> std::io::Result<usize>;
}

impl FileExtCross for std_fs::File {
    #[cfg(not(windows))]
    fn read_at_cross(&self, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
        self.read_at(buf, offset)
    }

    #[cfg(windows)]
    fn read_at_cross(&self, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
        self.seek_read(buf, offset)
    }

    #[cfg(not(windows))]
    fn write_at_cross(&self, buf: &[u8], offset: u64) -> std::io::Result<usize> {
        self.write_at(buf, offset)
    }

    #[cfg(windows)]
    fn write_at_cross(&self, buf: &[u8], offset: u64) -> std::io::Result<usize> {
        self.seek_write(buf, offset)
    }
}

#[cfg(not(windows))]
use crate::crypto::BLOCK_SIZE;
use crate::crypto::ENCRYPTED_BLOCK_SIZE;
use crate::{SharedBlobId, SharedKey};
use std::path::PathBuf;
use tauri::AppHandle;

const TTL: Duration = Duration::from_secs(1);

pub static PENDING_SYNCS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

use serde::{Deserialize, Serialize};

pub struct ActiveBlock {
    pub index: usize,
    pub data: Vec<u8>,
    pub dirty: bool,
}

pub struct OpenFile {
    pub file: std_fs::File,
    pub active_block: Option<ActiveBlock>,
    pub dirty: bool,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VaultFileType {
    Directory,
    RegularFile,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct VaultFile {
    pub ino: u64,
    pub parent_ino: u64,
    pub name: String,
    pub kind: VaultFileType,
    pub size: u64,
    pub modified_at: u64,
    pub shadow_path: Option<PathBuf>, // Path to encrypted blob on local disk
    pub cloud_blob_id: Option<String>, // ID of the encrypted blob on cloud
    pub last_synced_hash: Option<String>, // SHA256 of the content when it was last synced
}

#[derive(Eq, Hash, PartialEq)]
pub enum SyncCommand {
    SyncFile { ino: u64 },
    SyncIndex,
    PurgeShadow { path: PathBuf },
    PullAll,
    PurgeCloud { blob_id: String },
}

impl SyncCommand {
    fn priority(&self) -> i32 {
        match self {
            SyncCommand::SyncIndex | SyncCommand::PurgeShadow { .. } | SyncCommand::PullAll | SyncCommand::PurgeCloud { .. } => 10,
            SyncCommand::SyncFile { .. } => 5,
        }
    }
}

use priority_queue::PriorityQueue;
use std::sync::{Arc, Condvar, Mutex};

pub struct PrioritySender {
    inner: Arc<(Mutex<PriorityQueue<SyncCommand, i32>>, Condvar)>,
}

impl PrioritySender {
    pub fn send(&self, cmd: SyncCommand) -> Result<(), String> {
        let (lock, cvar) = &*self.inner;
        let mut pq = lock.lock().map_err(|e| e.to_string())?;
        let priority = cmd.priority();
        pq.push(cmd, priority);
        cvar.notify_one();
        Ok(())
    }
}

impl Clone for PrioritySender {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub ino: u64,
    pub name: String,
    pub total_size: u64,
    pub current_bytes: u64,
    pub status: String, // "syncing", "downloading", "restoring"
    pub percentage: u8,
}

pub struct VaultFS {
    pub app_handle: Option<AppHandle>,
    pub files: Arc<Mutex<HashMap<u64, VaultFile>>>,
    pub next_ino: Mutex<u64>,
    pub sync_tx: PrioritySender,
    pub key_state: SharedKey,
    pub local_index_path: PathBuf,
    pub shadow_dir: PathBuf,
    pub open_files: Arc<Mutex<HashMap<u64, Arc<Mutex<OpenFile>>>>>,
    pub next_fh: std::sync::atomic::AtomicU64,
    pub sync_progress: Arc<Mutex<HashMap<u64, SyncProgress>>>,
    #[cfg(not(windows))]
    pub uid: u32,
    #[cfg(not(windows))]
    pub gid: u32,
}

fn spawn_sync_worker(
    app_handle: Option<AppHandle>,
    sync_tx: PrioritySender,
    worker_files: Arc<Mutex<HashMap<u64, VaultFile>>>,
    worker_key: SharedKey,
    _worker_blob_id: SharedBlobId,
    worker_config_path: PathBuf,
    worker_local_index_path: PathBuf,
) {
    let rx_inner = sync_tx.inner.clone();
    let sync_tx_clone = sync_tx.clone();
    std::thread::spawn(move || {
        loop {
            let cmd = {
                let (lock, cvar) = &*rx_inner;
                let mut pq = lock.lock().unwrap();
                while pq.is_empty() {
                    pq = cvar.wait(pq).unwrap();
                }
                pq.pop().unwrap().0
            };

            match cmd {
                SyncCommand::SyncFile { ino } => {
                    let _guard = crate::TransferGuard::new();
                    let is_ignored = {
                        let f_lock = worker_files.lock().unwrap();
                        is_ignored_path(ino, &*f_lock)
                    };

                    if is_ignored {
                        let blob_id_to_purge = {
                            let mut f_lock = worker_files.lock().unwrap();
                            if let Some(f) = f_lock.get_mut(&ino) {
                                let id = f.cloud_blob_id.take();
                                if id.is_some() {
                                    if let Ok(data) = serde_json::to_string(&*f_lock) {
                                        let _ = std_fs::write(&worker_local_index_path, data);
                                    }
                                }
                                id
                            } else {
                                None
                            }
                        };
                        if let Some(blob_id) = blob_id_to_purge {
                            println!("VaultFS Worker: Purging cloud storage for file moved to trash (blob {})", blob_id);
                            let _ = internal_purge_blobs(&worker_config_path, vec![blob_id]);
                            let _ = sync_tx_clone.send(SyncCommand::SyncIndex);
                        }
                        PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                        continue;
                    }

                    let (name, shadow_path, old_id, stored_hash) = {
                        let f_lock = worker_files.lock().unwrap();
                        if let Some(f) = f_lock.get(&ino) {
                            (f.name.clone(), f.shadow_path.clone(), f.cloud_blob_id.clone(), f.last_synced_hash.clone())
                        } else {
                            PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                            continue;
                        }
                    };

                    if let Some(path) = shadow_path {
                        let hash_unchanged = if let Some(h) = stored_hash {
                            crate::drive_mirror::is_hash_unchanged_with_stored(&h, &path)
                        } else {
                            crate::drive_mirror::is_hash_unchanged(ino, &path)
                        };

                        if hash_unchanged && old_id.is_some() {
                            println!("VaultFS Worker: Skipping sync for {} (content unchanged and already in cloud)", name);
                            PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                            continue;
                        }
                        println!("VaultFS Worker: Syncing {} to cloud", name);
                        if let Ok(id) = crate::crypto::stream_upload_blob(
                            &worker_config_path,
                            &path,
                            worker_key.clone(),
                        ) {
                            crate::drive_mirror::update_cached_hash(ino, &path);
                            
                            // Compute the hash we just uploaded to save in index
                            let new_hash_hex = std_fs::read(&path).ok().map(|data| {
                                use sha2::{Sha256, Digest};
                                let mut hasher = Sha256::new();
                                hasher.update(data);
                                hex::encode(hasher.finalize())
                            });

                            // Save the cloud blob ID and hash
                            let mut f_lock = worker_files.lock().unwrap();
                            if let Some(f) = f_lock.get_mut(&ino) {
                                f.cloud_blob_id = Some(id.clone());
                                f.last_synced_hash = new_hash_hex;
                            }
                            drop(f_lock);

                            // Progress Update: 100%
                            if let Some(handle) = &app_handle {
                                use tauri::Emitter;
                                let progress = SyncProgress {
                                    ino,
                                    name: name.clone(),
                                    total_size: std_fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                                    current_bytes: std_fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                                    status: "complete".to_string(),
                                    percentage: 100,
                                };
                                let _ = handle.emit("vault-sync-progress", progress);
                            }

                            // Purge old blob if it existed
                            if let Some(oid) = old_id {
                                if oid != id {
                                    println!("VaultFS Worker: Purging old cloud version {}", oid);
                                    let _ = internal_purge_blobs(&worker_config_path, vec![oid]);
                                }
                            }

                            // CRITICAL: Notify that index needs update!
                            let _ = sync_tx_clone.send(SyncCommand::SyncIndex);
                        } else {
                            // Emit failure progress
                             if let Some(handle) = &app_handle {
                                use tauri::Emitter;
                                let _ = handle.emit("vault-sync-progress", SyncProgress {
                                    ino,
                                    name: name.clone(),
                                    total_size: 0,
                                    current_bytes: 0,
                                    status: "failed".to_string(),
                                    percentage: 0,
                                });
                            }
                        }
                    }
                    PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                }
                SyncCommand::SyncIndex => {
                    let (encrypted_data, pk) = {
                        let f_lock = worker_files.lock().unwrap();
                        if let Ok(local_data) = serde_json::to_string(&*f_lock) {
                            let _ = std_fs::write(&worker_local_index_path, local_data);
                        }
                        
                        // Cloud index must be "clean" of local paths
                        let mut cloud_index = f_lock.clone();
                        for file in cloud_index.values_mut() {
                            file.shadow_path = None;
                        }
                        let data = serde_json::to_vec(&cloud_index).unwrap_or_default();
                        let encrypted = crate::crypto::encrypt_local_data(&data, worker_key.clone()).unwrap_or_default();

                        let config_path = worker_config_path.clone();
                        let pk = if let Ok(content) = std_fs::read_to_string(&config_path) {
                            if let Ok(_config) = serde_json::from_str::<crate::OnboardingConfig>(&content) {
                                let (_, pk) = crate::get_or_create_signing_key_at(config_path);
                                pk
                            } else { "".to_string() }
                        } else { "".to_string() };

                        (encrypted, pk)
                    };
                    
                    // Mirror index to cloud
                    if !encrypted_data.is_empty() {
                        let temp_index_path = worker_local_index_path.with_extension("tmp_cloud");
                        if std_fs::write(&temp_index_path, &encrypted_data).is_ok() {
                            if let Ok(id) = crate::crypto::stream_upload_blob(
                                &worker_config_path,
                                &temp_index_path,
                                worker_key.clone(),
                            ) {
                                let _ = std_fs::remove_file(temp_index_path);
                                // Notify backend of new root index
                                if !pk.is_empty() {
                                    use ed25519_dalek::Signer;
                                    use base64::Engine;
                                    let (sk, _) = crate::get_or_create_signing_key_at(worker_config_path.clone());
                                    
                                    let client = reqwest::blocking::Client::new();
                                    
                                    // 1. Fetch old index ID for purging
                                    let old_index_id = if let Ok(resp) = client.get(format!("{}/api/vault/index", crate::config::get_backend_url()))
                                        .query(&[("public_key", &pk)])
                                        .header("X-Desktop-PK", &pk)
                                        .send() {
                                            if let Ok(json) = resp.json::<serde_json::Value>() {
                                                json["blob_id"].as_str().map(|s| s.to_string())
                                            } else { None }
                                        } else { None };

                                    let signature = sk.sign(id.as_bytes());
                                    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());
                                    
                                    let _ = client.post(format!("{}/api/vault/index", crate::config::get_backend_url()))
                                        .header("X-Desktop-PK", &pk)
                                        .header("X-Signature", sig_b64)
                                        .json(&serde_json::json!({
                                            "public_key": pk,
                                            "blob_id": id
                                        }))
                                        .send();

                                    // 2. Purge old index
                                    if let Some(oid) = old_index_id {
                                        if oid != id {
                                            let _ = internal_purge_blobs(&worker_config_path, vec![oid]);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                }
                SyncCommand::PurgeShadow { path } => {
                    let _ = std_fs::remove_file(path);
                    PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                }
                SyncCommand::PurgeCloud { blob_id } => {
                    let _ = internal_purge_blobs(&worker_config_path, vec![blob_id]);
                    PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                }
                SyncCommand::PullAll => {
                    println!("VaultFS Worker: Starting full restoration from cloud...");
                    let files_to_pull = {
                        let f_lock = worker_files.lock().unwrap();
                        f_lock.values().cloned().collect::<Vec<VaultFile>>()
                    };

                    let total = files_to_pull.len();
                    for (i, file) in files_to_pull.into_iter().enumerate() {
                        if let Some(blob_id) = file.cloud_blob_id {
                            // Progress Update: Restoration Started
                            if let Some(handle) = &app_handle {
                                use tauri::Emitter;
                                let percentage = (((i) as f32 / total as f32) * 100.0) as u8;
                                let progress = SyncProgress {
                                    ino: file.ino,
                                    name: file.name.clone(),
                                    total_size: file.size,
                                    current_bytes: 0,
                                    status: "restoring".to_string(),
                                    percentage,
                                };
                                let _ = handle.emit("vault-sync-progress", progress);
                            }

                            let shadow_path = worker_local_index_path.parent().unwrap()
                                .join(".vault_shadow")
                                .join(format!("{}.blob", file.ino));
                                
                            // Ensure shadow dir exists
                            let _ = std_fs::create_dir_all(shadow_path.parent().unwrap());

                            if let Ok(_) = crate::crypto::stream_download_blob(
                                &worker_config_path,
                                blob_id,
                                &shadow_path,
                                None,
                            ) {
                                let mut f_lock = worker_files.lock().unwrap();
                                if let Some(f) = f_lock.get_mut(&file.ino) {
                                    f.shadow_path = Some(shadow_path.clone());
                                }
                                crate::drive_mirror::update_cached_hash(file.ino, &shadow_path);
                                
                                // Progress Update: Restoration Success
                                if let Some(handle) = &app_handle {
                                    use tauri::Emitter;
                                    let percentage = (((i + 1) as f32 / total as f32) * 100.0) as u8;
                                    let progress = SyncProgress {
                                        ino: file.ino,
                                        name: file.name.clone(),
                                        total_size: file.size,
                                        current_bytes: file.size,
                                        status: "restored".to_string(),
                                        percentage,
                                    };
                                    let _ = handle.emit("vault-sync-progress", progress);
                                }
                            } else {
                                eprintln!("VaultFS Worker: Failed to download blob for {}", file.name);
                            }
                        }
                    }
                    println!("VaultFS Worker: Full restoration complete.");
                    PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                }
            }
        }
    });
}

impl VaultFS {
    fn save_local_index(&self) {
        let files = self.files.lock().unwrap();
        if let Ok(data) = serde_json::to_string(&*files) {
            let _ = std_fs::write(&self.local_index_path, data);
        }
    }

    pub fn new(
        app_handle: AppHandle,
        key_state: SharedKey,
        blob_id_state: SharedBlobId,
        shared_files: crate::SharedFileList,
    ) -> (Self, PrioritySender) {
        let mut files: HashMap<u64, VaultFile> = HashMap::new();
        files.insert(
            1,
            VaultFile {
                ino: 1,
                parent_ino: 1,
                name: "/".to_string(),
                kind: VaultFileType::Directory,
                size: 0,
                modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                shadow_path: None,
                cloud_blob_id: None,
                last_synced_hash: None,
            },
        );

        let config_path = crate::get_config_path(&app_handle);
        let shadow_dir = config_path.parent().unwrap().join(".vault_shadow");
        let _ = std_fs::create_dir_all(&shadow_dir);
        let local_index_path = config_path.parent().unwrap().join("local_index.json");

        // Restore index: Priority: Local > Cloud
        let restored = if let Ok(data) = std_fs::read_to_string(&local_index_path) {
            println!("VaultFS: Restoring index from local cache");
            if let Ok(mut map) = serde_json::from_str::<HashMap<u64, VaultFile>>(&data) {
                // Verify shadow paths exist, otherwise set to None to force redownload
                for file in map.values_mut() {
                    if let Some(path) = &file.shadow_path {
                        if !path.exists() {
                            println!("VaultFS: Shadow path {:?} missing for {}, resetting", path, file.name);
                            file.shadow_path = None;
                        }
                    }
                }
                Some(map)
            } else {
                None
            }
        } else {
            None
        };

        let pq_inner = Arc::new((Mutex::new(PriorityQueue::new()), Condvar::new()));
        let tx = PrioritySender { inner: pq_inner.clone() };

        let mut initial_files = restored.unwrap_or(files);
        let mut orphaned_inos = Vec::new();
        for &ino in initial_files.keys() {
            if !traces_to_root(ino, &initial_files) {
                orphaned_inos.push(ino);
            }
        }
        if !orphaned_inos.is_empty() {
            println!("VaultFS: Found {} orphaned index entries, healing...", orphaned_inos.len());
            for ino in orphaned_inos {
                if let Some(file) = initial_files.remove(&ino) {
                    println!("VaultFS: Healing orphaned file: {} (ino {}) - Cloud ID {:?} kept safe", file.name, ino, file.cloud_blob_id);
                    if let Some(shadow_path) = file.shadow_path {
                        let _ = std_fs::remove_file(shadow_path);
                    }
                    // DANGER: Never purge cloud blobs during initial mount healing!
                    // If restoration is partial, we don't want to delete the only backup.
                    // if let Some(blob_id) = file.cloud_blob_id {
                    //    let _ = tx.send(SyncCommand::PurgeCloud { blob_id });
                    // }
                }
            }
            if let Ok(data) = serde_json::to_string(&initial_files) {
                let _ = std_fs::write(&local_index_path, data);
            }
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            let _ = tx.send(SyncCommand::SyncIndex);
        }

        let max_ino = initial_files.keys().max().cloned().unwrap_or(1);

        // Update the shared files map directly
        {
            let mut lock = shared_files.lock().unwrap();
            *lock = initial_files;
        }

        let worker_files = shared_files.clone();
        let worker_key = key_state.clone();
        let worker_blob_id = blob_id_state.clone();
        let worker_config_path = config_path.clone();
        let worker_local_index_path = local_index_path.clone();

        spawn_sync_worker(
            Some(app_handle.clone()),
            tx.clone(),
            worker_files,
            worker_key,
            worker_blob_id,
            worker_config_path.clone(),
            worker_local_index_path,
        );

        // Start background cloud reconciliation to purge any leftover/garbage blobs!
        start_cloud_reconciliation(worker_config_path, shared_files.clone());

        // Check for missing files and trigger PullAll
        let has_missing = {
            let files_lock = shared_files.lock().unwrap();
            files_lock.values().any(|f| f.shadow_path.is_none() && f.cloud_blob_id.is_some())
        };
        
        if has_missing {
            println!("VaultFS: Missing files detected on mount, triggering PullAll");
            let _ = tx.send(SyncCommand::PullAll);
        }

        // Check for unsynced files and trigger upload (Now queues all for robust check)
        let sync_inos: Vec<u64> = {
            let files_lock = shared_files.lock().unwrap();
            files_lock.iter()
                .filter(|(_, f)| f.shadow_path.is_some() && f.kind == VaultFileType::RegularFile)
                .map(|(ino, _)| *ino)
                .collect()
        };

        for ino in sync_inos {
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            let _ = tx.send(SyncCommand::SyncFile { ino });
        }

        #[cfg(not(windows))]
        let (uid, gid) = unsafe { (libc::getuid(), libc::getgid()) };

        (
            Self {
                app_handle: Some(app_handle.clone()),
                files: shared_files,
                next_ino: Mutex::new(max_ino + 1),
                sync_tx: tx.clone(),
                key_state,
                local_index_path,
                shadow_dir,
                open_files: Arc::new(Mutex::new(HashMap::new())),
                next_fh: std::sync::atomic::AtomicU64::new(1),
                sync_progress: Arc::new(Mutex::new(HashMap::new())),
                #[cfg(not(windows))]
                uid,
                #[cfg(not(windows))]
                gid,
            },
            tx,
        )
    }

    pub fn new_test(
        config_path: PathBuf,
        key_state: SharedKey,
        blob_id_state: SharedBlobId,
    ) -> (Self, PrioritySender) {
        let mut files: HashMap<u64, VaultFile> = HashMap::new();
        files.insert(
            1,
            VaultFile {
                ino: 1,
                parent_ino: 1,
                name: "/".to_string(),
                kind: VaultFileType::Directory,
                size: 0,
                modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                shadow_path: None,
                cloud_blob_id: None,
                last_synced_hash: None,
            },
        );

        let shadow_dir = config_path.parent().unwrap().join(".vault_shadow");
        let _ = std_fs::create_dir_all(&shadow_dir);
        let local_index_path = config_path.parent().unwrap().join("local_index.json");

        // Restore index from disk config
        if let Ok(content) = std_fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<crate::OnboardingConfig>(&content) {
                if let Some(id) = config.last_blob_id {
                    *blob_id_state.write().unwrap() = Some(id);
                }
            }
        }

        // Restore index from local
        let restored = if let Ok(data) = std_fs::read_to_string(&local_index_path) {
            println!("[TEST] Restoring index from local cache");
            if let Ok(mut map) = serde_json::from_str::<HashMap<u64, VaultFile>>(&data) {
                // Verify shadow paths exist, otherwise set to None to force redownload
                for file in map.values_mut() {
                    if let Some(path) = &file.shadow_path {
                        if !path.exists() {
                            file.shadow_path = None;
                        } else {
                            crate::drive_mirror::update_cached_hash(file.ino, path);
                        }
                    }
                }
                Some(map)
            } else {
                None
            }
        } else {
            None
        };

        let pq_inner = Arc::new((Mutex::new(PriorityQueue::new()), Condvar::new()));
        let tx = PrioritySender { inner: pq_inner.clone() };

        let mut initial_files = restored.unwrap_or(files);
        let mut orphaned_inos = Vec::new();
        for &ino in initial_files.keys() {
            if !traces_to_root(ino, &initial_files) {
                orphaned_inos.push(ino);
            }
        }
        if !orphaned_inos.is_empty() {
            println!("[TEST] Found {} orphaned index entries, healing...", orphaned_inos.len());
            for ino in orphaned_inos {
                if let Some(file) = initial_files.remove(&ino) {
                    println!("[TEST] Healing orphaned file: {} (ino {})", file.name, ino);
                    if let Some(shadow_path) = file.shadow_path {
                        let _ = std_fs::remove_file(shadow_path);
                    }
                    if let Some(blob_id) = file.cloud_blob_id {
                        let _ = tx.send(SyncCommand::PurgeCloud { blob_id });
                    }
                }
            }
            if let Ok(data) = serde_json::to_string(&initial_files) {
                let _ = std_fs::write(&local_index_path, data);
            }
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            let _ = tx.send(SyncCommand::SyncIndex);
        }

        let max_ino = initial_files.keys().max().cloned().unwrap_or(1);
        let files_arc = Arc::new(Mutex::new(initial_files));

        let worker_files = files_arc.clone();
        let worker_key = key_state.clone();
        let worker_blob_id = blob_id_state.clone();
        let worker_config_path = config_path.clone();
        let worker_local_index_path = local_index_path.clone();

        spawn_sync_worker(
            None,
            tx.clone(),
            worker_files,
            worker_key,
            worker_blob_id,
            worker_config_path.clone(),
            worker_local_index_path,
        );

        // Start background cloud reconciliation to purge any leftover/garbage blobs!
        start_cloud_reconciliation(worker_config_path, files_arc.clone());

        // Check for missing files and trigger PullAll
        let has_missing = {
            let files_lock = files_arc.lock().unwrap();
            files_lock.values().any(|f| f.shadow_path.is_none() && f.cloud_blob_id.is_some())
        };
        
        if has_missing {
            println!("[TEST] VaultFS: Missing files detected on mount, triggering PullAll");
            let _ = tx.send(SyncCommand::PullAll);
        }

        // Check for unsynced files and trigger upload
        let unsynced_inos: Vec<u64> = {
            let files_lock = files_arc.lock().unwrap();
            files_lock.iter()
                .filter(|(_, f)| f.shadow_path.is_some() && f.cloud_blob_id.is_none() && f.kind == VaultFileType::RegularFile)
                .map(|(ino, _)| *ino)
                .collect()
        };

        for ino in unsynced_inos {
            println!("[TEST] VaultFS: Detecting unsynced file (ino {}), queuing for upload", ino);
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            let _ = tx.send(SyncCommand::SyncFile { ino });
        }

        #[cfg(not(windows))]
        let (uid, gid) = unsafe { (libc::getuid(), libc::getgid()) };

        (
            Self {
                app_handle: None,
                files: files_arc,
                next_ino: Mutex::new(max_ino + 1),
                sync_tx: tx.clone(),
                key_state,
                local_index_path,
                shadow_dir,
                open_files: Arc::new(Mutex::new(HashMap::new())),
                next_fh: std::sync::atomic::AtomicU64::new(1),
                sync_progress: Arc::new(Mutex::new(HashMap::new())),
                #[cfg(not(windows))]
                uid,
                #[cfg(not(windows))]
                gid,
            },
            tx,
        )
    }

    pub fn get_files_handle(&self) -> Arc<Mutex<HashMap<u64, VaultFile>>> {
        self.files.clone()
    }

    pub fn create_file_internal(&self, parent: u64, name: &str) -> Result<(u64, u64), String> {
        let mut files = self.files.lock().unwrap();

        if files
            .values()
            .any(|f| f.parent_ino == parent && f.name == name)
        {
            return Err("File already exists".to_string());
        }

        let mut next_ino = self.next_ino.lock().unwrap();
        let ino = *next_ino;
        *next_ino += 1;

        let shadow_path = self.shadow_dir.join(format!("{}.blob", ino));

        let new_file = VaultFile {
            ino,
            parent_ino: parent,
            name: name.to_string(),
            kind: VaultFileType::RegularFile,
            size: 0,
            modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            shadow_path: Some(shadow_path.clone()),
            cloud_blob_id: None,
            last_synced_hash: None,
        };
        let file = std_fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&shadow_path)
            .map_err(|e| e.to_string())?;

        let fh = self.next_fh.fetch_add(1, Ordering::SeqCst);
        let open_file = OpenFile {
            file,
            active_block: None,
            dirty: true,
        };

        self.open_files
            .lock()
            .unwrap()
            .insert(fh, Arc::new(Mutex::new(open_file)));

        files.insert(ino, new_file.clone());
        drop(files);
        self.save_local_index();
        self.notify_ui();
        Ok((ino, fh))
    }

    pub fn write_file_internal(&self, ino: u64, fh: u64, offset: u64, data: &[u8]) -> Result<usize, String> {
        let open_file_arc = {
            let lock = self.open_files.lock().unwrap();
            lock.get(&fh).cloned().ok_or("File handle not found")?
        };

        let mut open_file = open_file_arc.lock().unwrap();
        let offset = offset as usize;
        let write_size = data.len();
        
        let start_block = offset / crate::crypto::BLOCK_SIZE;
        let end_block = (offset + write_size - 1) / crate::crypto::BLOCK_SIZE;

        let mut data_written = 0;

        for block_idx in start_block..=end_block {
            let in_cache = open_file.active_block.as_ref().map_or(false, |b| b.index == block_idx);
            if !in_cache {
                Self::flush_active_block(&mut open_file, self.key_state.clone())?;

                let block_offset = block_idx * crate::crypto::ENCRYPTED_BLOCK_SIZE;
                let mut encrypted_block = vec![0u8; crate::crypto::ENCRYPTED_BLOCK_SIZE];
                let bytes_read = open_file.file.read_at_cross(&mut encrypted_block, block_offset as u64).unwrap_or(0);
                
                let block_data = if bytes_read > 0 {
                    encrypted_block.truncate(bytes_read);
                    crate::crypto::decrypt_local_data(&encrypted_block, self.key_state.clone()).unwrap_or_else(|_| vec![0u8; crate::crypto::BLOCK_SIZE])
                } else {
                    Vec::with_capacity(crate::crypto::BLOCK_SIZE)
                };

                open_file.active_block = Some(ActiveBlock {
                    index: block_idx,
                    data: block_data,
                    dirty: false,
                });
            }

            if let Some(block) = &mut open_file.active_block {
                let data_start_in_block = if block_idx == start_block {
                    offset % crate::crypto::BLOCK_SIZE
                } else {
                    0
                };
                
                let remaining_to_write = write_size - data_written;
                let bytes_to_write_in_this_block = remaining_to_write.min(crate::crypto::BLOCK_SIZE - data_start_in_block);
                
                let required_len = data_start_in_block + bytes_to_write_in_this_block;
                if block.data.len() < required_len {
                    block.data.resize(required_len, 0);
                }
                
                block.data[data_start_in_block..required_len].copy_from_slice(&data[data_written..data_written + bytes_to_write_in_this_block]);
                block.dirty = true;
                data_written += bytes_to_write_in_this_block;
            }
        }
        open_file.dirty = true;

        let mut files = self.files.lock().unwrap();
        if let Some(f) = files.get_mut(&ino) {
            let new_size = (offset + write_size) as u64;
            if new_size > f.size {
                f.size = new_size;
            }
            f.modified_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
            f.cloud_blob_id = None; // Mark as dirty/unsynced
        }

        Ok(data.len())
    }

    pub fn read_file_internal(&self, ino: u64, fh: u64, offset: u64, buf: &mut [u8]) -> Result<usize, String> {
        let open_file_arc = {
            let lock = self.open_files.lock().unwrap();
            lock.get(&fh).cloned().ok_or("File handle not found")?
        };

        let mut open_file = open_file_arc.lock().unwrap();
        let file_size = {
            let files = self.files.lock().unwrap();
            files.get(&ino).map(|f| f.size).unwrap_or(0) as usize
        };

        let offset = offset as usize;
        let size = buf.len();
        if offset >= file_size {
            return Ok(0);
        }

        let mut read_size = size as usize;
        if offset + read_size > file_size {
            read_size = file_size - offset;
        }

        let start_block = offset / crate::crypto::BLOCK_SIZE;
        let end_block = (offset + read_size - 1) / crate::crypto::BLOCK_SIZE;

        let mut data_read = 0;
        for block_idx in start_block..=end_block {
            let in_cache = open_file.active_block.as_ref().map_or(false, |b| b.index == block_idx);
            if !in_cache {
                Self::flush_active_block(&mut open_file, self.key_state.clone())?;
                
                let block_offset = block_idx * crate::crypto::ENCRYPTED_BLOCK_SIZE;
                let mut encrypted_block = vec![0u8; crate::crypto::ENCRYPTED_BLOCK_SIZE];
                let bytes_read = open_file.file.read_at_cross(&mut encrypted_block, block_offset as u64).unwrap_or(0);
                
                if bytes_read > 0 {
                    encrypted_block.truncate(bytes_read);
                    if let Ok(decrypted) = crate::crypto::decrypt_local_data(&encrypted_block, self.key_state.clone()) {
                        open_file.active_block = Some(ActiveBlock {
                            index: block_idx,
                            data: decrypted,
                            dirty: false,
                        });
                    } else {
                        return Err("Decryption failed".to_string());
                    }
                } else {
                    open_file.active_block = Some(ActiveBlock {
                        index: block_idx,
                        data: Vec::new(),
                        dirty: false,
                    });
                }
            }

            if let Some(block) = &open_file.active_block {
                let data_start_in_block = if block_idx == start_block {
                    offset % crate::crypto::BLOCK_SIZE
                } else {
                    0
                };
                
                let remaining_to_read = read_size - data_read;
                let available_in_block = block.data.len().saturating_sub(data_start_in_block);
                let bytes_to_take = remaining_to_read.min(available_in_block);
                
                if bytes_to_take > 0 {
                    buf[data_read..data_read + bytes_to_take].copy_from_slice(&block.data[data_start_in_block..data_start_in_block + bytes_to_take]);
                    data_read += bytes_to_take;
                }
            }
        }

        Ok(data_read)
    }

    pub fn release_file_internal(&self, ino: u64, fh: u64) -> Result<(), String> {
        let open_file_opt = self.open_files.lock().unwrap().remove(&fh);
        let mut is_dirty = false;
        if let Some(open_file_arc) = open_file_opt {
            let mut open_file = open_file_arc.lock().unwrap();
            Self::flush_active_block(&mut open_file, self.key_state.clone())?;
            is_dirty = open_file.dirty;
        }

        if is_dirty {
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            let _ = self.sync_tx.send(SyncCommand::SyncIndex);
            
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            if self.sync_tx.send(SyncCommand::SyncFile { ino }).is_err() {
                PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
            }
        }

        self.notify_ui();
        Ok(())
    }

    fn notify_ui(&self) {
        use tauri::Emitter;
        if let Some(handle) = &self.app_handle {
            let files = self.files.lock().unwrap();
            let list: Vec<VaultFile> = files.values().cloned().collect();
            let _ = handle.emit("vault-files-updated", list);
        }
    }

    fn flush_active_block(open_file: &mut OpenFile, key_state: SharedKey) -> Result<(), String> {
        if let Some(block) = open_file.active_block.take() {
            if block.dirty {
                let encrypted = crate::crypto::encrypt_local_data(&block.data, key_state)?;
                let offset = block.index * ENCRYPTED_BLOCK_SIZE;
                open_file
                    .file
                    .write_at_cross(&encrypted, offset as u64)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    #[cfg(not(windows))]
    fn make_attr(&self, file: &VaultFile) -> FileAttr {
        let now = SystemTime::now();
        let mtime = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(file.modified_at);
        FileAttr {
            ino: file.ino,
            size: file.size,
            blocks: (file.size + 511) / 512,
            atime: now,
            mtime,
            ctime: now,
            crtime: now,
            kind: match file.kind {
                VaultFileType::Directory => FileType::Directory,
                VaultFileType::RegularFile => FileType::RegularFile,
            },
            perm: if let VaultFileType::Directory = file.kind {
                0o755
            } else {
                0o644
            },
            nlink: 1,
            uid: self.uid,
            gid: self.gid,
            rdev: 0,
            flags: 0,
            blksize: 512,
        }
    }
}

#[cfg(not(windows))]
impl Filesystem for VaultFS {

    fn lookup(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: ReplyEntry) {
        let name_str = name.to_string_lossy();
        let files = self.files.lock().unwrap();
        if let Some(file) = files
            .values()
            .find(|f| f.parent_ino == parent && f.name == name_str)
        {
            reply.entry(&TTL, &self.make_attr(file), 0);
        } else {
            reply.error(ENOENT);
        }
    }

    fn getattr(&mut self, _req: &Request, ino: u64, reply: ReplyAttr) {
        let files = self.files.lock().unwrap();
        if let Some(file) = files.get(&ino) {
            reply.attr(&TTL, &self.make_attr(file));
        } else {
            reply.error(ENOENT);
        }
    }

    fn access(&mut self, req: &Request, ino: u64, _mask: i32, reply: ReplyEmpty) {
        let files = self.files.lock().unwrap();
        if files.contains_key(&ino) {
            if req.uid() == self.uid || req.uid() == 0 {
                reply.ok();
            } else {
                eprintln!("VaultFS: access DENIED for ino {} (req uid: {}, self uid: {})", ino, req.uid(), self.uid);
                reply.error(libc::EACCES);
            }
        } else {
            reply.error(libc::ENOENT);
        }
    }

    fn readdir(
        &mut self,
        _req: &Request,
        ino: u64,
        _fh: u64,
        offset: i64,
        mut reply: ReplyDirectory,
    ) {
        let files = self.files.lock().unwrap();
        let parent_ino = files.get(&ino).map(|f| f.parent_ino).unwrap_or(1);

        let mut entries = vec![
            (ino, FileType::Directory, "."),
            (parent_ino, FileType::Directory, ".."),
        ];

        // Find children of this inode
        for f in files.values() {
            if f.parent_ino == ino && f.ino != ino {
                entries.push((
                    f.ino,
                    if let VaultFileType::Directory = f.kind {
                        FileType::Directory
                    } else {
                        FileType::RegularFile
                    },
                    &f.name,
                ));
            }
        }
        for (i, entry) in entries.into_iter().enumerate().skip(offset as usize) {
            if reply.add(entry.0, (i + 1) as i64, entry.1, entry.2) {
                break;
            }
        }
        reply.ok();
    }

    fn read(
        &mut self,
        _req: &Request,
        ino: u64,
        fh: u64,
        offset: i64,
        size: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyData,
    ) {
        let open_file_arc = {
            let lock = self.open_files.lock().unwrap();
            match lock.get(&fh) {
                Some(arc) => arc.clone(),
                None => {
                    reply.error(libc::EBADF);
                    return;
                }
            }
        };

        let mut open_file = open_file_arc.lock().unwrap();
        let file_size = {
            let files = self.files.lock().unwrap();
            files.get(&ino).map(|f| f.size).unwrap_or(0) as usize
        };

        let offset = offset as usize;
        if offset >= file_size {
            reply.data(&[]);
            return;
        }

        let mut read_size = size as usize;
        if offset + read_size > file_size {
            read_size = file_size - offset;
        }

        let mut result_data = Vec::with_capacity(read_size);
        let start_block = offset / BLOCK_SIZE;
        let end_block = (offset + read_size - 1) / BLOCK_SIZE;

        for block_idx in start_block..=end_block {
            // 1. Ensure block is in cache
            let in_cache = open_file.active_block.as_ref().map_or(false, |b| b.index == block_idx);
            if !in_cache {
                // Flush existing if dirty
                let _ = Self::flush_active_block(&mut open_file, self.key_state.clone());
                
                // Read and decrypt new block
                let block_offset = block_idx * ENCRYPTED_BLOCK_SIZE;
                let mut encrypted_block = vec![0u8; ENCRYPTED_BLOCK_SIZE];
                let bytes_read = open_file.file.read_at_cross(&mut encrypted_block, block_offset as u64).unwrap_or(0);
                
                if bytes_read > 0 {
                    encrypted_block.truncate(bytes_read);
                    if let Ok(decrypted) = crate::crypto::decrypt_local_data(&encrypted_block, self.key_state.clone()) {
                        open_file.active_block = Some(ActiveBlock {
                            index: block_idx,
                            data: decrypted,
                            dirty: false,
                        });
                    } else {
                        reply.error(libc::EIO);
                        return;
                    }
                } else {
                    // Empty block (e.g. read beyond end or sparse)
                    open_file.active_block = Some(ActiveBlock {
                        index: block_idx,
                        data: Vec::new(),
                        dirty: false,
                    });
                }
            }

            // 2. Read from cache
            if let Some(block) = &open_file.active_block {
                let data_start_in_block = if block_idx == start_block {
                    offset % BLOCK_SIZE
                } else {
                    0
                };
                
                let remaining_to_read = read_size - result_data.len();
                let available_in_block = block.data.len().saturating_sub(data_start_in_block);
                let bytes_to_take = remaining_to_read.min(available_in_block);
                
                if bytes_to_take > 0 {
                    result_data.extend_from_slice(&block.data[data_start_in_block..data_start_in_block + bytes_to_take]);
                }
            }
        }

        reply.data(&result_data);
    }

    fn write(
        &mut self,
        _req: &Request,
        ino: u64,
        fh: u64,
        offset: i64,
        data: &[u8],
        _write_flags: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyWrite,
    ) {
        let _guard = crate::TransferGuard::new();
        let open_file_arc = {
            let lock = self.open_files.lock().unwrap();
            match lock.get(&fh) {
                Some(arc) => arc.clone(),
                None => {
                    reply.error(libc::EBADF);
                    return;
                }
            }
        };

        let mut open_file = open_file_arc.lock().unwrap();
        let offset = offset as usize;
        let write_size = data.len();
        
        let start_block = offset / BLOCK_SIZE;
        let end_block = (offset + write_size - 1) / BLOCK_SIZE;

        let mut data_written = 0;

        for block_idx in start_block..=end_block {
            // 1. Ensure correct block is in cache
            let in_cache = open_file.active_block.as_ref().map_or(false, |b| b.index == block_idx);
            if !in_cache {
                // Flush existing if dirty
                let _ = Self::flush_active_block(&mut open_file, self.key_state.clone());

                // Read/Initialize new block
                let block_offset = block_idx * ENCRYPTED_BLOCK_SIZE;
                let mut encrypted_block = vec![0u8; ENCRYPTED_BLOCK_SIZE];
                let bytes_read = open_file.file.read_at_cross(&mut encrypted_block, block_offset as u64).unwrap_or(0);
                
                let block_data = if bytes_read > 0 {
                    encrypted_block.truncate(bytes_read);
                    crate::crypto::decrypt_local_data(&encrypted_block, self.key_state.clone()).unwrap_or_else(|_| vec![0u8; BLOCK_SIZE])
                } else {
                    Vec::with_capacity(BLOCK_SIZE)
                };

                open_file.active_block = Some(ActiveBlock {
                    index: block_idx,
                    data: block_data,
                    dirty: false,
                });
            }

            // 2. Perform modification in cache
            if let Some(block) = &mut open_file.active_block {
                let data_start_in_block = if block_idx == start_block {
                    offset % BLOCK_SIZE
                } else {
                    0
                };
                
                let remaining_to_write = write_size - data_written;
                let bytes_to_write_in_this_block = remaining_to_write.min(BLOCK_SIZE - data_start_in_block);
                
                let required_len = data_start_in_block + bytes_to_write_in_this_block;
                if block.data.len() < required_len {
                    block.data.resize(required_len, 0);
                }
                
                block.data[data_start_in_block..required_len].copy_from_slice(&data[data_written..data_written + bytes_to_write_in_this_block]);
                block.dirty = true;
                data_written += bytes_to_write_in_this_block;
            }
        }
        open_file.dirty = true;

        // Update file metadata
        let mut files = self.files.lock().unwrap();
        if let Some(f) = files.get_mut(&ino) {
            let new_size = (offset + write_size) as u64;
            if new_size > f.size {
                f.size = new_size;
            }
            f.modified_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
            f.cloud_blob_id = None; // Mark as dirty/unsynced
        }

        reply.written(data.len() as u32);
    }

    fn create(
        &mut self,
        _req: &Request,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        _flags: i32,
        reply: ReplyCreate,
    ) {
        let name_str = name.to_string_lossy().into_owned();
        let mut files = self.files.lock().unwrap();

        if files
            .values()
            .any(|f| f.parent_ino == parent && f.name == name_str)
        {
            reply.error(libc::EEXIST);
            return;
        }

        let mut next_ino = self.next_ino.lock().unwrap();
        let ino = *next_ino;
        *next_ino += 1;

        let shadow_path = self.shadow_dir.join(format!("{}.blob", ino));

        let new_file = VaultFile {
            ino,
            parent_ino: parent,
            name: name_str,
            kind: VaultFileType::RegularFile,
            size: 0,
            modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            shadow_path: Some(shadow_path.clone()),
            cloud_blob_id: None,
            last_synced_hash: None,
        };
        let file = match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&shadow_path)
        {
            Ok(f) => f,
            Err(_) => {
                reply.error(libc::EIO);
                return;
            }
        };

        let fh = self.next_fh.fetch_add(1, Ordering::SeqCst);
        let open_file = OpenFile {
            file,
            active_block: None,
            dirty: true,
        };

        self.open_files
            .lock()
            .unwrap()
            .insert(fh, Arc::new(Mutex::new(open_file)));

        files.insert(ino, new_file.clone());
        drop(files);
        self.save_local_index();
        self.notify_ui();
        reply.created(&TTL, &self.make_attr(&new_file), 0, fh, 0);
    }

    fn release(
        &mut self,
        _req: &Request,
        ino: u64,
        fh: u64,
        _flags: i32,
        _lock_owner: Option<u64>,
        _flush: bool,
        reply: ReplyEmpty,
    ) {
        let _guard = crate::TransferGuard::new();
        // 1. Flush and remove from open_files
        let open_file_opt = self.open_files.lock().unwrap().remove(&fh);
        let mut is_dirty = false;
        if let Some(open_file_arc) = open_file_opt {
            let mut open_file = open_file_arc.lock().unwrap();
            let _ = Self::flush_active_block(&mut open_file, self.key_state.clone());
            is_dirty = open_file.dirty;
        }

        // 2. Trigger background sync and housekeeping
        if is_dirty {
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            let _ = self.sync_tx.send(SyncCommand::SyncIndex); // Background save + cloud notify
            
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            if self.sync_tx.send(SyncCommand::SyncFile { ino }).is_err() {
                PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
            }
        }

        // UI notification is still sync for now, but fast
        self.notify_ui();
        reply.ok();
    }

    fn setattr(
        &mut self,
        _req: &Request,
        ino: u64,
        _mode: Option<u32>,
        _uid: Option<u32>,
        _gid: Option<u32>,
        size: Option<u64>,
        _atime: Option<TimeOrNow>,
        _mtime: Option<TimeOrNow>,
        _ctime: Option<SystemTime>,
        _fh: Option<u64>,
        _crtime: Option<SystemTime>,
        _chgtime: Option<SystemTime>,
        _bkuptime: Option<SystemTime>,
        _flags: Option<u32>,
        reply: ReplyAttr,
    ) {
        let mut files = self.files.lock().unwrap();
        if let Some(f) = files.get_mut(&ino) {
            if let Some(s) = size {
                if let Some(path) = &f.shadow_path {
                    if s == 0 {
                        let _ = std_fs::write(path, vec![]);
                    } else if s < f.size {
                        let end_block = (s.saturating_sub(1)) / (BLOCK_SIZE as u64);
                        let end_block_offset = end_block * (ENCRYPTED_BLOCK_SIZE as u64);
                        
                        if let Ok(file) = std::fs::OpenOptions::new().read(true).write(true).open(path) {
                            let mut encrypted_block = vec![0u8; ENCRYPTED_BLOCK_SIZE];
                            let bytes_read = file.read_at_cross(&mut encrypted_block, end_block_offset).unwrap_or(0);
                            if bytes_read > 0 {
                                encrypted_block.truncate(bytes_read);
                                if let Ok(mut decrypted) = crate::crypto::decrypt_local_data(&encrypted_block, self.key_state.clone()) {
                                    let mut new_last_block_len = (s % (BLOCK_SIZE as u64)) as usize;
                                    if new_last_block_len == 0 { new_last_block_len = BLOCK_SIZE; }
                                    
                                    if decrypted.len() > new_last_block_len {
                                        decrypted.truncate(new_last_block_len);
                                        if let Ok(new_encrypted) = crate::crypto::encrypt_local_data(&decrypted, self.key_state.clone()) {
                                            let _ = file.write_at_cross(&new_encrypted, end_block_offset);
                                            let _ = file.set_len(end_block_offset + new_encrypted.len() as u64);
                                        }
                                    } else {
                                        let _ = file.set_len(end_block_offset + bytes_read as u64);
                                    }
                                }
                            }
                        }
                    }
                }
                f.size = s;
                f.cloud_blob_id = None; // Mark as dirty/unsynced
            }
            let attr = self.make_attr(f);
            drop(files);
            self.save_local_index();
            reply.attr(&TTL, &attr);
        } else {
            reply.error(ENOENT);
        }
    }

    fn unlink(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let name_str = name.to_string_lossy();
        let mut files = self.files.lock().unwrap();
        let ino = files
            .values()
            .find(|f| f.parent_ino == parent && f.name == name_str)
            .map(|f| f.ino);
        if let Some(i) = ino {
            if let Some(file) = files.remove(&i) {
                if let Some(path) = file.shadow_path {
                    // Queue shadow file deletion
                    PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
                    let _ = self.sync_tx.send(SyncCommand::PurgeShadow { path });
                }
                if let Some(blob_id) = file.cloud_blob_id {
                    // Queue cloud blob deletion
                    PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
                    let _ = self.sync_tx.send(SyncCommand::PurgeCloud { blob_id });
                }
                drop(files);
                self.save_local_index();
                
                PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
                if self.sync_tx.send(SyncCommand::SyncIndex).is_err() {
                    PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
                }

                self.notify_ui();
                reply.ok();
            } else {
                reply.error(ENOENT);
            }
        } else {
            reply.error(ENOENT);
        }
    }

    fn mkdir(
        &mut self,
        _req: &Request,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        reply: ReplyEntry,
    ) {
        let name_str = name.to_string_lossy().into_owned();
        let mut files = self.files.lock().unwrap();

        if files
            .values()
            .any(|f| f.parent_ino == parent && f.name == name_str)
        {
            reply.error(libc::EEXIST);
            return;
        }

        let mut next_ino = self.next_ino.lock().unwrap();
        let ino = *next_ino;
        *next_ino += 1;

        let new_dir = VaultFile {
            ino,
            parent_ino: parent,
            name: name_str,
            kind: VaultFileType::Directory,
            size: 0,
            modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            shadow_path: None,
            cloud_blob_id: None,
            last_synced_hash: None,
        };
        files.insert(ino, new_dir.clone());
        drop(files);
        self.save_local_index();
        
        PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
        if self.sync_tx.send(SyncCommand::SyncIndex).is_err() {
            PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
        }
        
        self.notify_ui();
        reply.entry(&TTL, &self.make_attr(&new_dir), 0);
    }

    fn mknod(
        &mut self,
        _req: &Request,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        _rdev: u32,
        reply: ReplyEntry,
    ) {
        let name_str = name.to_string_lossy().into_owned();
        let mut files = self.files.lock().unwrap();

        if files
            .values()
            .any(|f| f.parent_ino == parent && f.name == name_str)
        {
            reply.error(libc::EEXIST);
            return;
        }

        let mut next_ino = self.next_ino.lock().unwrap();
        let ino = *next_ino;
        *next_ino += 1;

        let shadow_path = self.shadow_dir.join(format!("{}.blob", ino));

        // Ensure the shadow file exists
        if let Err(_) = std_fs::File::create(&shadow_path) {
            reply.error(libc::EIO);
            return;
        }

        let new_file = VaultFile {
            ino,
            parent_ino: parent,
            name: name_str,
            kind: VaultFileType::RegularFile,
            size: 0,
            modified_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            shadow_path: Some(shadow_path.clone()),
            cloud_blob_id: None,
            last_synced_hash: None,
        };
        files.insert(ino, new_file.clone());
        drop(files);
        self.save_local_index();

        PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
        if self.sync_tx.send(SyncCommand::SyncIndex).is_err() {
            PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
        }

        self.notify_ui();
        reply.entry(&TTL, &self.make_attr(&new_file), 0);
    }

    fn rmdir(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let name_str = name.to_string_lossy();
        let mut files = self.files.lock().unwrap();
        let ino = files
            .values()
            .find(|f| {
                f.parent_ino == parent
                    && f.name == name_str
                    && matches!(f.kind, VaultFileType::Directory)
            })
            .map(|f| f.ino);
        if let Some(i) = ino {
            if i == 1 {
                reply.error(libc::EPERM);
                return;
            }
            // Check if directory is empty (no other files have parent_ino == i)
            let is_empty = !files.values().any(|f| f.parent_ino == i);
            if !is_empty {
                drop(files);
                reply.error(libc::ENOTEMPTY);
                return;
            }
            files.remove(&i);
            drop(files);
            self.save_local_index();
            
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            if self.sync_tx.send(SyncCommand::SyncIndex).is_err() {
                PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
            }
            
            self.notify_ui();
            reply.ok();
        } else {
            reply.error(ENOENT);
        }
    }

    fn rename(
        &mut self,
        _req: &Request,
        parent: u64,
        name: &OsStr,
        newparent: u64,
        newname: &OsStr,
        _flags: u32,
        reply: ReplyEmpty,
    ) {
        let name_str = name.to_string_lossy();
        let newname_str = newname.to_string_lossy().into_owned();
        let mut files = self.files.lock().unwrap();

        // 1. Find the source file
        let src_ino = files
            .values()
            .find(|f| f.parent_ino == parent && f.name == name_str)
            .map(|f| f.ino);

        if let Some(i) = src_ino {
            // 2. If target exists, remove it first (standard rename behavior)
            let target_ino = files
                .values()
                .find(|f| f.parent_ino == newparent && f.name == newname_str)
                .map(|f| f.ino);
            if let Some(ti) = target_ino {
                if ti != i {
                    if let Some(f) = files.remove(&ti) {
                        if let Some(path) = f.shadow_path {
                            let _ = self.sync_tx.send(SyncCommand::PurgeShadow { path });
                        }
                    }
                }
            }

            // 3. Perform the rename
            if let Some(f) = files.get_mut(&i) {
                f.name = newname_str;
                f.parent_ino = newparent;
            }
            drop(files);
            self.save_local_index();
            
            PENDING_SYNCS.fetch_add(1, Ordering::SeqCst);
            if self.sync_tx.send(SyncCommand::SyncIndex).is_err() {
                PENDING_SYNCS.fetch_sub(1, Ordering::SeqCst);
            }
            
            self.notify_ui();
            reply.ok();
        } else {
            reply.error(ENOENT);
        }
    }
    fn opendir(&mut self, _req: &Request, ino: u64, _flags: i32, reply: ReplyOpen) {
        let files = self.files.lock().unwrap();
        if let Some(f) = files.get(&ino) {
            if let VaultFileType::Directory = f.kind {
                reply.opened(0, 0);
            } else {
                reply.error(libc::ENOTDIR);
            }
        } else {
            reply.error(ENOENT);
        }
    }

    fn open(&mut self, _req: &Request, ino: u64, flags: i32, reply: ReplyOpen) {
        let (mut path, cloud_blob_id, is_regular, file_name) = {
            let files = self.files.lock().unwrap();
            match files.get(&ino) {
                Some(f) => (f.shadow_path.clone(), f.cloud_blob_id.clone(), matches!(f.kind, VaultFileType::RegularFile), f.name.clone()),
                None => {
                    reply.error(ENOENT);
                    return;
                }
            }
        };

        if !is_regular {
            reply.error(libc::EISDIR);
            return;
        }

        if path.is_none() && cloud_blob_id.is_some() {
            let blob_id = cloud_blob_id.unwrap();
            let shadow_path = self.shadow_dir.join(format!("{}.blob", ino));
            let config_path = self.local_index_path.with_file_name("onboarding.json");

            println!("VaultFS: File {} missing locally, downloading on demand...", file_name);

            match crate::crypto::stream_download_blob(&config_path, blob_id, &shadow_path, None) {
                Ok(_) => {
                    println!("VaultFS: Successfully downloaded {} on demand.", file_name);
                    let mut files = self.files.lock().unwrap();
                    if let Some(f) = files.get_mut(&ino) {
                        f.shadow_path = Some(shadow_path.clone());
                    }
                    path = Some(shadow_path.clone());
                    crate::drive_mirror::update_cached_hash(ino, &shadow_path);
                    drop(files);
                    self.save_local_index();
                    self.notify_ui();
                }
                Err(e) => {
                    eprintln!("VaultFS: Failed to download {} on demand: {}", file_name, e);
                    reply.error(libc::EIO);
                    return;
                }
            }
        }

        if let Some(shadow_path) = path {
            let mut options = std_fs::OpenOptions::new();
            let read = (flags & libc::O_ACCMODE) == libc::O_RDONLY || (flags & libc::O_ACCMODE) == libc::O_RDWR;
            let write = (flags & libc::O_ACCMODE) == libc::O_WRONLY || (flags & libc::O_ACCMODE) == libc::O_RDWR;
            
            options.read(read).write(write);

            let file = match options.open(&shadow_path) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("VaultFS: open FAILED for shadow_path {:?} (ino {}): {}", shadow_path, ino, e);
                    reply.error(e.raw_os_error().unwrap_or(libc::EIO));
                    return;
                }
            };

            let fh = self.next_fh.fetch_add(1, Ordering::SeqCst);
            let open_file = OpenFile {
                file,
                active_block: None,
                dirty: false,
            };

            self.open_files
                .lock()
                .unwrap()
                .insert(fh, Arc::new(Mutex::new(open_file)));
            reply.opened(fh, flags as u32);
        } else {
            reply.error(ENOENT);
        }
    }

    fn flush(&mut self, _req: &Request, _ino: u64, fh: u64, _lock_owner: u64, reply: ReplyEmpty) {
        let _guard = crate::TransferGuard::new();
        let open_file_arc = {
            let lock = self.open_files.lock().unwrap();
            lock.get(&fh).cloned()
        };

        if let Some(arc) = open_file_arc {
            let mut open_file = arc.lock().unwrap();
            let _ = Self::flush_active_block(&mut open_file, self.key_state.clone());
        }
        reply.ok();
    }
}

pub fn internal_purge_blobs(config_path: &PathBuf, blob_ids: Vec<String>) -> Result<(), String> {
    crate::drive_mirror::purge_blobs_direct(config_path, blob_ids)
}

fn traces_to_root(ino: u64, files: &HashMap<u64, VaultFile>) -> bool {
    if ino == 1 {
        return true;
    }
    let mut current = ino;
    let mut visited = std::collections::HashSet::new();
    while current != 1 {
        if !visited.insert(current) {
            return false;
        }
        if let Some(parent) = files.get(&current).map(|f| f.parent_ino) {
            if parent == current {
                return false;
            }
            current = parent;
        } else {
            return false;
        }
    }
    true
}

fn is_ignored_path(ino: u64, files: &HashMap<u64, VaultFile>) -> bool {
    if ino == 1 {
        return false;
    }
    let mut current = ino;
    let mut visited = std::collections::HashSet::new();
    while current != 1 {
        if !visited.insert(current) {
            break;
        }
        if let Some(file) = files.get(&current) {
            let name = file.name.to_lowercase();
            if name.starts_with(".trash")
                || name == ".ds_store"
                || name == "thumbs.db"
                || name == "desktop.ini"
            {
                return true;
            }
            current = file.parent_ino;
        } else {
            break;
        }
    }
    false
}

pub fn start_cloud_reconciliation(
    config_path: PathBuf,
    files_arc: Arc<Mutex<HashMap<u64, VaultFile>>>,
) {
    std::thread::spawn(move || {
        // Initial delay to allow restoration/mount to settle
        println!("VaultFS: Cloud reconciliation will start in 10 minutes...");
        std::thread::sleep(std::time::Duration::from_secs(600));
        
        println!("VaultFS: Starting background cloud storage reconciliation...");
        match perform_cloud_reconciliation(&config_path, &files_arc) {
            Ok(_) => println!("VaultFS: Cloud storage reconciliation completed successfully."),
            Err(e) => eprintln!("VaultFS: Cloud reconciliation failed: {}", e),
        }
    });
}

fn perform_cloud_reconciliation(
    config_path: &PathBuf,
    files_arc: &Arc<Mutex<HashMap<u64, VaultFile>>>,
) -> Result<(), String> {
    // 1. Load config
    let config_content = std_fs::read_to_string(config_path).map_err(|e| e.to_string())?;
    let config: crate::OnboardingConfig = serde_json::from_str(&config_content).map_err(|e| e.to_string())?;

    // 2. SAFETY CHECK: Abort reconciliation if restoration is in progress
    let (local_file_count, missing_local_count) = {
        let files = files_arc.lock().unwrap();
        let total = files.len();
        let missing = files.values().filter(|f| f.cloud_blob_id.is_some() && f.shadow_path.is_none() && f.kind == VaultFileType::RegularFile).count();
        (total, missing)
    };

    if missing_local_count > 0 {
        println!("VaultFS Reconciler: Restoration in progress ({} files pending download). Skipping cloud purge for safety.", missing_local_count);
        return Ok(());
    }

    let mut token = match config.google_access_token.clone() {
        Some(t) => t,
        None => return Err("Google access token missing - reconciliation aborted".to_string()),
    };

    let client = reqwest::blocking::Client::new();
    
    let query_gdrive = |client: &reqwest::blocking::Client, token: &str, q: &str, fields: &str| -> Result<serde_json::Value, String> {
        let res = client.get("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(token)
            .query(&[("q", q), ("fields", fields)])
            .send()
            .map_err(|e| e.to_string())?;
        
        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err("UNAUTHORIZED".to_string());
        }

        if !res.status().is_success() {
            return Err(format!("GDrive query failed: status {}", res.status()));
        }

        res.json::<serde_json::Value>().map_err(|e| e.to_string())
    };

    let mut folder_res = query_gdrive(&client, &token, "name='SecureVault' and mimeType='application/vnd.google-apps.folder' and trashed=false", "files(id)");
    
    if let Err(ref e) = folder_res {
        if e == "UNAUTHORIZED" {
            println!("VaultFS Reconciler: Access token expired, refreshing...");
            if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
                token = new_token;
                folder_res = query_gdrive(&client, &token, "name='SecureVault' and mimeType='application/vnd.google-apps.folder' and trashed=false", "files(id)");
            }
        }
    }

    let folder_json = folder_res?;
    let files_arr = folder_json["files"].as_array().ok_or("Invalid response from GDrive folder search")?;
    if files_arr.is_empty() {
        println!("VaultFS Reconciler: SecureVault folder not found on Google Drive.");
        return Ok(());
    }

    let folder_id = files_arr[0]["id"].as_str().ok_or("Folder ID missing")?;

    let q_files = format!("'{}' in parents and trashed=false", folder_id);
    let files_json = query_gdrive(&client, &token, &q_files, "files(id,name)")?;
    let gdrive_files = files_json["files"].as_array().ok_or("Invalid response from GDrive file listing")?;

    // FINAL SAFETY CHECK: If GDrive has many files but our index is nearly empty, ABORT.
    // Only abort if local files still reference cloud_blob_ids (active restoration scenario).
    // If no local file has a cloud_blob_id, files were intentionally deleted — safe to clean up.
    if local_file_count <= 1 && gdrive_files.len() > 2 {
        let any_have_cloud_blob = {
            let files = files_arc.lock().unwrap();
            files.values().any(|f| f.cloud_blob_id.is_some())
        };
        if any_have_cloud_blob {
            println!("VaultFS Reconciler: DANGER! Local index has {} files referencing cloud blobs but Google Drive has {} files. Aborting purge to prevent data loss.", local_file_count, gdrive_files.len());
            return Ok(());
        }
        println!("VaultFS Reconciler: Local index is empty and no files reference cloud blobs — proceeding with cleanup.");
    }

    let mut active_blobs = std::collections::HashSet::new();
    
    let (_, pk) = crate::get_or_create_signing_key_at(config_path.clone());
    let url = format!("{}/api/vault/index?public_key={}", crate::config::get_backend_url(), pk);
    if let Ok(res) = client.get(&url).send() {
        if res.status().is_success() {
            if let Ok(val) = res.json::<serde_json::Value>() {
                if let Some(blob_id) = val["blob_id"].as_str() {
                    if !blob_id.is_empty() {
                        active_blobs.insert(blob_id.to_string());
                    }
                }
            }
        }
    }

    {
        let files = files_arc.lock().unwrap();
        for file in files.values() {
            if let Some(blob_id) = &file.cloud_blob_id {
                active_blobs.insert(blob_id.clone());
            }
        }
    }

    println!("VaultFS Reconciler: Found {} active blobs in vault index.", active_blobs.len());

    let mut garbage_blobs = Vec::new();
    for f in gdrive_files {
        if let Some(name) = f["name"].as_str() {
            if name.len() == 36 && !active_blobs.contains(name) {
                garbage_blobs.push(name.to_string());
            }
        }
    }

    if garbage_blobs.is_empty() {
        println!("VaultFS Reconciler: No garbage blobs found on Google Drive.");
        return Ok(());
    }

    println!("VaultFS Reconciler: Found {} garbage blobs to purge: {:?}", garbage_blobs.len(), garbage_blobs);

    crate::drive_mirror::purge_blobs_direct(config_path, garbage_blobs)?;

    Ok(())
}

/// Manually find and purge orphaned cloud blobs (GDrive files with no matching local or backend index entry).
/// Skips all safety checks since the user explicitly requested this action.
/// Returns the count of purged blobs.
pub fn cleanup_orphaned_blobs(
    config_path: &PathBuf,
    files_arc: &Arc<Mutex<HashMap<u64, VaultFile>>>,
) -> Result<usize, String> {
    let config_content = std_fs::read_to_string(config_path).map_err(|e| e.to_string())?;
    let config: crate::OnboardingConfig = serde_json::from_str(&config_content).map_err(|e| e.to_string())?;

    let mut token = match config.google_access_token {
        Some(t) => t,
        None => return Err("Google access token missing. Connect Google Drive first.".to_string()),
    };

    let client = reqwest::blocking::Client::new();

    let query_gdrive = |client: &reqwest::blocking::Client, token: &str, q: &str, fields: &str| -> Result<serde_json::Value, String> {
        let res = client.get("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(token)
            .query(&[("q", q), ("fields", fields)])
            .send()
            .map_err(|e| e.to_string())?;

        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err("UNAUTHORIZED".to_string());
        }

        if !res.status().is_success() {
            return Err(format!("GDrive query failed: status {}", res.status()));
        }

        res.json::<serde_json::Value>().map_err(|e| e.to_string())
    };

    let mut folder_res = query_gdrive(&client, &token, "name='SecureVault' and mimeType='application/vnd.google-apps.folder' and trashed=false", "files(id)");

    if let Err(ref e) = folder_res {
        if e == "UNAUTHORIZED" {
            println!("cleanup_orphaned_blobs: Access token expired, refreshing...");
            if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
                token = new_token;
                folder_res = query_gdrive(&client, &token, "name='SecureVault' and mimeType='application/vnd.google-apps.folder' and trashed=false", "files(id)");
            }
        }
    }

    let folder_json = folder_res?;
    let files_arr = folder_json["files"].as_array().ok_or("Invalid response from GDrive folder search")?;
    if files_arr.is_empty() {
        return Err("SecureVault folder not found on Google Drive.".to_string());
    }

    let folder_id = files_arr[0]["id"].as_str().ok_or("Folder ID missing")?;

    let q_files = format!("'{}' in parents and trashed=false", folder_id);
    let files_json = query_gdrive(&client, &token, &q_files, "files(id,name)")?;
    let gdrive_files = files_json["files"].as_array().ok_or("Invalid response from GDrive file listing")?;

    let mut active_blobs = std::collections::HashSet::new();

    let (_, pk) = crate::get_or_create_signing_key_at(config_path.clone());
    let url = format!("{}/api/vault/index?public_key={}", crate::config::get_backend_url(), pk);
    if let Ok(res) = client.get(&url).send() {
        if res.status().is_success() {
            if let Ok(val) = res.json::<serde_json::Value>() {
                if let Some(blob_id) = val["blob_id"].as_str() {
                    if !blob_id.is_empty() {
                        active_blobs.insert(blob_id.to_string());
                    }
                }
            }
        }
    }

    {
        let files = files_arc.lock().unwrap();
        for file in files.values() {
            if let Some(blob_id) = &file.cloud_blob_id {
                active_blobs.insert(blob_id.clone());
            }
        }
    }

    let mut garbage_blobs = Vec::new();
    for f in gdrive_files {
        if let Some(name) = f["name"].as_str() {
            if name.len() == 36 && !active_blobs.contains(name) {
                garbage_blobs.push(name.to_string());
            }
        }
    }

    let count = garbage_blobs.len();
    if count == 0 {
        println!("cleanup_orphaned_blobs: No orphaned blobs found.");
        return Ok(0);
    }

    println!("cleanup_orphaned_blobs: Found {} orphaned blobs, purging...", count);
    crate::drive_mirror::purge_blobs_direct(config_path, garbage_blobs)?;
    println!("cleanup_orphaned_blobs: Successfully purged {} orphaned blobs.", count);

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::sync::{Arc, RwLock};

    #[test]
    fn test_vault_deep_integrity_unit() {
        let tmp_dir = tempdir().expect("Failed to create temp dir");
        let config_path = tmp_dir.path().join("onboarding.json");
        
        let key_data = [0u8; 32];
        let key_state: SharedKey = Arc::new(RwLock::new(Some((key_data, None))));
        let blob_id_state: SharedBlobId = Arc::new(RwLock::new(None));
        
        let (vfs, _sync_tx) = VaultFS::new_test(config_path, key_state.clone(), blob_id_state);
        
        // 1. Create File
        let (ino, fh) = vfs.create_file_internal(1, "test.txt").expect("Create failed");
        
        // 2. Write Data
        let test_data = b"DEEP_TEST_SECRET_DATA_12345";
        vfs.write_file_internal(ino, fh, 0, test_data).expect("Write failed");
        
        // 3. Flush
        vfs.release_file_internal(ino, fh).expect("Release failed");
        
        // 4. Verify Shadow File Exists (Encrypted)
        let shadow_path = tmp_dir.path().join(".vault_shadow").join(format!("{}.blob", ino));
        assert!(shadow_path.exists(), "Shadow blob missing");
        
        let encrypted_content = std_fs::read(&shadow_path).expect("Read shadow failed");
        assert_ne!(encrypted_content, test_data, "Data is not encrypted!");
        
        // 5. Read Back and Decrypt
        let mut read_buf = vec![0u8; test_data.len()];
        // Re-open handle for reading
        let fh_read = vfs.next_fh.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let file = std_fs::File::open(&shadow_path).expect("Open shadow failed");
        vfs.open_files.lock().unwrap().insert(fh_read, Arc::new(Mutex::new(OpenFile {
            file,
            active_block: None,
            dirty: false,
        })));

        let bytes_read = vfs.read_file_internal(ino, fh_read, 0, &mut read_buf).expect("Read failed");
        
        assert_eq!(bytes_read, test_data.len());
        assert_eq!(&read_buf, test_data, "Integrity check failed: decrypted data differs!");
        
        println!("UNIT TEST: Encryption integrity verified!");
    }
}
