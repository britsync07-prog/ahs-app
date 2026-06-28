# Streaming Backend Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the backend upload handler to stream large files to disk instead of RAM to prevent OOM crashes.

**Architecture:** Use `os.CreateTemp` to create a temporary file, `io.TeeReader` with `sha256.New()` to hash while streaming, and then pass the temporary file to the storage provider.

**Tech Stack:** Go, standard library (`os`, `io`, `crypto/sha256`).

---

### Task 1: Refactor UploadVault for Streaming

**Files:**
- Modify: `vault-backend-go/internal/api/handlers.go:345-395`

- [ ] **Step 1: Replace memory-loading logic with streaming to temp file**

Replace the current `io.ReadAll` and signature verification logic with a streaming approach.

```go
func (h *Handler) UploadVault(w http.ResponseWriter, r *http.Request) {
	// 0. Authenticate Desktop
	desktopPK := r.Header.Get("X-Desktop-PK")
	signature := r.Header.Get("X-Signature")
	googleToken := r.Header.Get("X-Google-Token")

	if desktopPK == "" || signature == "" {
		http.Error(w, "Authentication required (missing headers)", http.StatusUnauthorized)
		return
	}

	if googleToken == "" {
		http.Error(w, "Google Token required (X-Google-Token)", http.StatusUnauthorized)
		return
	}

	// Create temp file for disk-based processing (offloads RAM to storage)
	tempFile, err := os.CreateTemp("", "upload-*")
	if err != nil {
		log.Printf("Failed to create temp file: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Hash while streaming
	hasher := sha256.New()
	tee := io.TeeReader(r.Body, hasher)

	// Stream to disk
	size, err := io.Copy(tempFile, tee)
	if err != nil {
		log.Printf("Failed to stream upload to disk: %v", err)
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	if size <= 0 {
		http.Error(w, "Content required", http.StatusBadRequest)
		return
	}

	// Verify signature using the SHA-256 hash
	hashBytes := hasher.Sum(nil)
	if err := h.verifyDesktopSignature(desktopPK, hashBytes, signature); err != nil {
		log.Printf("Desktop authentication failed (streaming): %v", err)
		http.Error(w, "Invalid desktop signature", http.StatusUnauthorized)
		return
	}

	// Reset file pointer for storage upload
	if _, err := tempFile.Seek(0, 0); err != nil {
		log.Printf("Failed to seek temp file: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// 2. Generate a unique UUID
	blobID := uuid.New().String()

	// 3. Save to GDrive (streaming from temp file)
	_, err = h.storage.UploadObject(r.Context(), googleToken, blobID, tempFile)
	if err != nil {
		log.Printf("Upload failed: %v", err)
		http.Error(w, "Failed to save blob to GDrive storage", http.StatusInternalServerError)
		return
	}

	// 4. Record ownership in DB for stats
	if err := h.db.RecordBlobOwnership(r.Context(), blobID, desktopPK, size); err != nil {
		log.Printf("Failed to record blob ownership: %v", err)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"blob_id": blobID})
}
```

- [ ] **Step 2: Verify compilation**

Run: `go build ./...` in `vault-backend-go` directory.
Expected: Successful compilation without errors.

- [ ] **Step 3: Commit changes**

```bash
git add vault-backend-go/internal/api/handlers.go
git commit -m "feat(backend): stream uploads to disk instead of RAM"
```
