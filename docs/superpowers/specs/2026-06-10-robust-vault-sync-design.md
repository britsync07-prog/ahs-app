# Design Doc: Robust Cloud-First Vault Sync

Ensuring 1:1 mirroring between local vault and Google Drive with space-efficient auto-uploads.

## Goals
- **Guaranteed Mirroring:** Every file in the local vault must have a corresponding encrypted blob in Google Drive.
- **Space Efficiency:** Old blobs must be purged immediately when a file is updated to prevent storage bloat.
- **Auto-Sync:** Changes must be detected and uploaded without user intervention.
- **Reliability:** Failed uploads must be detected and retried automatically.

## Architecture & Components

### 1. Enhanced Sync Worker (`vault-desktop-tauri/src-tauri/src/fs.rs`)
The `spawn_sync_worker` loop will be updated to:
- **Priority Check:** Even if `is_hash_unchanged` is true, if `cloud_blob_id` is `None`, the file MUST be uploaded.
- **Atomic Update:** Ensure the sequence of "Upload New -> Update Index -> Delete Old" is reliable.

### 2. On-Mount Reconciliation (`vault-desktop-tauri/src-tauri/src/fs.rs`)
The `VaultFS::new` (mount) logic will:
- Iterate through all files in the index.
- If a file has `shadow_path` (local data) but `cloud_blob_id` is `None`, queue a `SyncFile` command immediately.
- This ensures that if the app was closed during a sync, it resumes on next start.

### 3. Space Management (`vault-desktop-tauri/src-tauri/src/drive_mirror.rs`)
Verify that `purge_blobs_direct` correctly handles deletions on the GDrive side via the Go backend.
- Ensure that when `SyncFile` completes, the *old* `blob_id` is passed to the purge queue.

### 4. Continuous Auto-Upload
- The WebDAV and FUSE implementations already trigger `SyncFile` on file release. We will add a small delay/debounce to ensure that rapid saves don't spam the sync worker with redundant intermediate versions.

## Success Criteria
1. Adding a file to the `M:` drive (Windows) or `~/SecureVault` (Linux/Mac) triggers an immediate upload.
2. Editing a file results in exactly one new blob in GDrive and the deletion of the previous blob.
3. Restarting the app with unsynced files triggers an automatic background sync.
4. The Google Drive 'SecureVault' folder contains exactly the same number of blobs as files in the vault (plus one for the index).

## User Review Required
Please review the above design. Once approved, I will create a detailed implementation plan.
