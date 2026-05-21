# Design Spec: USB-Speed Vault Architecture (Fast-Mirror)

**Date:** 2026-05-18
**Topic:** Performance Optimization for VaultFS
**Goal:** Achieve "USB-like" performance with instant local operations and immediate cloud parity.

## 1. Problem Statement
The current VaultFS implementation suffers from:
- **Sequential Uploads**: 4MB chunks are uploaded one-by-one, leading to high latency for large files.
- **FIFO Bottlenecks**: Metadata updates and deletions wait behind large file uploads in a single queue.
- **OS Buffering Latency**: Standard FUSE mount options allow OS-level caching that conflicts with our encryption/sync logic, causing a "stutter" feel.
- **Memory Overhead**: Frequent allocation of intermediate vectors during read/write operations.

## 2. Proposed Architecture: The "Fast-Mirror"

### 2.1 Parallelized Data Pipeline
- **Implementation**: Integrate `rayon` or a custom `tokio` thread pool for chunk processing.
- **Behavior**: When `SyncFile` is triggered, all dirty chunks are encrypted and uploaded in parallel.
- **Concurrency Limit**: Max 8 concurrent uploads to prevent network congestion while maximizing throughput.

### 2.2 Priority-Based Sync Worker
- **Implementation**: Replace `mpsc::channel` with a priority queue (e.g., `priority-queue` crate or a custom `Mutex<BinaryHeap>`).
- **Command Priorities**:
  - **Level 1 (Critical)**: `PurgeBlocks` (Deletions), `SyncIndex` (Structure updates).
  - **Level 2 (Normal)**: `SyncFile` (Data uploads).
- **Behavior**: Deletions and folder moves are processed immediately, even if a large upload is in progress.

### 2.3 FUSE Performance Tuning
- **Mount Options**: Add `fuser::MountOption::DirectIO` and `fuser::MountOption::AsyncRead`.
- **Impact**: Bypasses kernel page cache for the vault mount, ensuring that the "Protected" status is immediate and not "simulated" by OS cache.

### 2.4 Zero-Copy Buffer Management
- **Implementation**: Refactor `VaultFS::read` and `VaultFS::write` to use `bytes::Bytes` or reusable `&mut [u8]` buffers.
- **Impact**: Reduces CPU cycles spent on memory allocation and copying, moving data directly from disk/network to the encrypted stream.

## 3. Data Flow
1. **User saves file**: FUSE `write` updates local dirty chunks.
2. **File closed (`release`)**: `SyncFile` command enters Priority Queue.
3. **Worker**: Picks highest priority task. If `SyncFile`, it spawns parallel upload tasks.
4. **Cloud Update**: All chunks hit the backend. On success, the `SyncIndex` (Priority 1) is immediately queued to finalize parity.
5. **Deletion**: `unlink` sends `PurgeBlocks` (Priority 1). The worker executes it immediately, reflecting the deletion in the cloud stats.

## 4. Success Criteria
- **Instant Deletion**: A delete operation reflects in dashboard stats within < 1 second.
- **Throughput**: Large file uploads (e.g., 80MB) utilize full available bandwidth via parallel chunks.
- **Zero "Stutter"**: No perceived lag when opening the vault drive.

## 5. Risk Mitigation
- **Rate Limiting**: Backend must handle burst parallel uploads (Go backend already uses `minio` which is highly concurrent).
- **Consistency**: Parallel uploads must all succeed before the index is marked clean. Failures in one chunk will retry that specific chunk.
