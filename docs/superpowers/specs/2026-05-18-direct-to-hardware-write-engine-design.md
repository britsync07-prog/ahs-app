# Direct-To-Hardware Write Engine Design

**Status:** Draft
**Date:** 2026-05-18

## Problem
The current `VaultFS` implementation in `fs.rs` is extremely slow (approx. 200KB/s) for file copies. 
Main reasons:
1. **Global Locking:** `self.files` lock is held during the entire `write` operation, including decryption, modification, encryption, and disk I/O.
2. **Repetitive RMW:** Every `write` call (often small chunks from the OS) triggers a full Read-Modify-Write cycle: open file, read block, decrypt, modify, encrypt, write block, close file.
3. **Handle Management:** FUSE handles (`fh`) are not utilized; files are looked up and opened/closed on every operation.

## Proposed Solution: "Direct-To-Hardware" Engine
Introduce an optimized write path that uses file handles and an active block cache to minimize overhead.

### 1. File Handle Management
- Implement a `HashMap<u64, Arc<Mutex<OpenFile>>>` in `VaultFS`.
- `VaultFS::open` and `VaultFS::create` will:
    - Open the shadow file with `std::fs::OpenOptions`.
    - Generate a unique `fh` (file handle).
    - Store the open file state in the hash map.
    - Return `fh` to FUSE.
- `VaultFS::release` will:
    - Flush any dirty blocks.
    - Remove the entry from the hash map (closing the file).

### 2. Active Block Cache
`OpenFile` state will include a single-block buffer (64KB) for the current active block being written.

```rust
struct OpenFile {
    ino: u64,
    file: std::fs::File,
    active_block: Option<ActiveBlock>,
}

struct ActiveBlock {
    index: usize,
    data: Vec<u8>, // Plaintext, size = BLOCK_SIZE
    dirty: bool,
}
```

### 3. Optimized Write Logic
When a `write(fh, offset, data)` comes in:
1. Retrieve `OpenFile` from the map using `fh`.
2. Lock the `OpenFile`.
3. Calculate `block_idx = offset / BLOCK_SIZE`.
4. If `active_block` matches `block_idx`, update memory buffer.
5. If `active_block` is different:
    - Flush current `active_block` if dirty (encrypt + `write_at`).
    - Load new block:
        - If `offset` is beyond current file size (new block), initialize with zeros.
        - Otherwise, read encrypted block from disk and decrypt.
    - Update memory buffer.
6. Update `VaultFile` metadata (size, mtime) while holding the global `files` lock only briefly.

### 4. Concurrency Improvements
- Release global `VaultFS.files` lock before performing encryption/decryption and disk I/O.
- Each file handle has its own lock, allowing concurrent writes to different files.

### 5. Async Housekeeping
- Move `save_local_index()` and `notify_ui()` to a background task or ensure they are non-blocking in `release`.

## Success Criteria
- Sequentially copying a file to the vault should reach near-native disk speeds (limited by AES-GCM throughput).
- Memory usage remains low (64KB per open file handle).
- No data corruption on partial writes or unexpected releases.

## Risks
- Unexpected crashes could lead to data loss of the currently cached 64KB block (acceptable trade-off for performance in this context, similar to OS page cache).
- Concurrent writes to the *same* inode via *different* file handles (uncommon in standard desktop usage but should be handled by inode-level sync if necessary).
