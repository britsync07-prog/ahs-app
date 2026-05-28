use notify::{Watcher, RecursiveMode, Result, Event};
use std::path::Path;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use crate::crypto::internal_encrypt_and_upload;

static SYNC_WATCHER: Lazy<Mutex<Option<notify::RecommendedWatcher>>> = Lazy::new(|| Mutex::new(None));

pub fn start_sync_watcher() -> std::result::Result<(), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let staging_path = format!("{}/.vault_local_staging", home);
    let path = Path::new(&staging_path);

    // Ensure staging directory exists
    if !path.exists() {
        std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }

    let mut watcher = notify::recommended_watcher(move |res: Result<Event>| {
        match res {
            Ok(event) => {
                if event.kind.is_modify() || event.kind.is_create() {
                    for path in event.paths {
                        if path.is_file() {
                            println!("Sync: Detected change in {:?}", path);
                            match std::fs::read(&path) {
                                Ok(data) => {
                                    match internal_encrypt_and_upload(data) {
                                        Ok(blob_id) => println!("Sync: Successfully uploaded {:?} -> Blob ID: {}", path, blob_id),
                                        Err(e) => eprintln!("Sync: Encryption/Upload failed for {:?}: {}", path, e),
                                    }
                                }
                                Err(e) => eprintln!("Sync: Failed to read file {:?}: {}", path, e),
                            }
                        }
                    }
                }
            }
            Err(e) => eprintln!("Sync: Watcher error: {:?}", e),
        }
    }).map_err(|e| e.to_string())?;

    watcher.watch(path, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;

    let mut lock = SYNC_WATCHER.lock().map_err(|e| e.to_string())?;
    *lock = Some(watcher);

    println!("Sync: Background watcher active on {}", staging_path);
    Ok(())
}

pub fn stop_sync_watcher() {
    let mut lock = SYNC_WATCHER.lock().unwrap();
    if let Some(watcher) = lock.take() {
        drop(watcher);
        println!("Sync: Background watcher stopped.");
    }
}
