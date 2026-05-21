# VaultFS Permission and Logic Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address permission issues and logic errors in VaultFS to prevent 'Permission Denied' errors and ensure correct filesystem behavior.

**Architecture:** Update `fuser` trait implementation in `fs.rs` for better permission handling and OS error reporting, and update mount options in `lib.rs`.

**Tech Stack:** Rust, `fuser`, `libc`, `tauri`.

---

### Task 1: Update Mount Options in `lib.rs`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `AllowOther` and `DefaultPermissions` to mount options**

```rust
// vault-desktop-tauri/src-tauri/src/lib.rs around line 545

            let options = vec![
                fuser::MountOption::RW,
                fuser::MountOption::FSName("VaultFS".to_string()),
                fuser::MountOption::AllowOther,
                fuser::MountOption::DefaultPermissions,
            ];
```

### Task 2: Implement `access` in `fs.rs`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Implement `access` method**

```rust
    fn access(&mut self, req: &Request, ino: u64, _mask: i32, reply: ReplyEmpty) {
        let files = self.files.lock().unwrap();
        if let Some(file) = files.get(&ino) {
            if req.uid() == self.uid || req.uid() == 0 {
                reply.ok();
            } else {
                reply.error(libc::EACCES);
            }
        } else {
            reply.error(libc::ENOENT);
        }
    }
```

### Task 3: Improve `open` in `fs.rs`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Update `open` to handle flags and return OS errors**

```rust
    fn open(&mut self, _req: &Request, ino: u64, flags: i32, reply: ReplyOpen) {
        let (path, is_regular) = {
            let files = self.files.lock().unwrap();
            match files.get(&ino) {
                Some(f) => (f.shadow_path.clone(), matches!(f.kind, VaultFileType::RegularFile)),
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

        if let Some(shadow_path) = path {
            let mut options = std_fs::OpenOptions::new();
            let read = (flags & libc::O_ACCMODE) == libc::O_RDONLY || (flags & libc::O_ACCMODE) == libc::O_RDWR;
            let write = (flags & libc::O_ACCMODE) == libc::O_WRONLY || (flags & libc::O_ACCMODE) == libc::O_RDWR;
            
            options.read(read).write(write);

            let file = match options.open(&shadow_path) {
                Ok(f) => f,
                Err(e) => {
                    reply.error(e.raw_os_error().unwrap_or(libc::EIO));
                    return;
                }
            };

            let fh = self.next_fh.fetch_add(1, Ordering::SeqCst);
            let open_file = OpenFile {
                file,
                active_block: None,
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
```

### Task 4: Fix `readdir` in `fs.rs`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Update `readdir` to return correct `parent_ino` for `..`**

```rust
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
```

### Task 5: Fix `mknod` in `fs.rs`

**Files:**
- Modify: `vault-desktop-tauri/src-tauri/src/fs.rs`

- [ ] **Step 1: Update `mknod` to create an empty shadow file**

```rust
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
        };
        files.insert(ino, new_file.clone());
        drop(files);
        self.save_local_index();
        self.notify_ui();
        reply.entry(&TTL, &self.make_attr(&new_file), 0);
    }
```

### Task 6: Verification

- [ ] **Step 1: Run `cargo check`**

Run: `cargo check` in `vault-desktop-tauri/src-tauri`
Expected: Success
