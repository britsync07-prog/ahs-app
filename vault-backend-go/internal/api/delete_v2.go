package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
)

// DeleteVaultV2 allows deleting blobs even if the DB record is missing, 
// as long as the user has the Google Token for the vault.
func (h *Handler) DeleteVaultV2(w http.ResponseWriter, r *http.Request) {
	desktopPK := r.Header.Get("X-Desktop-PK")
	signature := r.Header.Get("X-Signature")
	googleToken := r.Header.Get("X-Google-Token")

	if desktopPK == "" || signature == "" || googleToken == "" {
		http.Error(w, "Auth required", http.StatusUnauthorized)
		return
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	if err := h.verifyDesktopSignature(desktopPK, bodyBytes, signature); err != nil {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	var payload struct {
		BlobIDs []string `json:"blob_ids"`
	}
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	deletedCount := 0
	for _, id := range payload.BlobIDs {
		// 1. Check ownership (if in DB)
		owner, err := h.db.GetBlobOwner(r.Context(), id)
		if err == nil && owner != desktopPK {
			log.Printf("DeleteV2: Skip %s (owned by %s)", id, owner)
			continue
		}

		// 2. Delete from GDrive
		// Ownership is implicitly verified because we only delete from 'SecureVault' folder
		// which the user has full access to via their token.
		if err := h.storage.DeleteObject(r.Context(), googleToken, id); err != nil {
			log.Printf("DeleteV2: Failed GDrive delete %s: %v", id, err)
			continue
		}

		// 3. Delete from DB
		_ = h.db.DeleteBlobOwnership(r.Context(), id)
		deletedCount++
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"deleted": deletedCount,
	})
}
