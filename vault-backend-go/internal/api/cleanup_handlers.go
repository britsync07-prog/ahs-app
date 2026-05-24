package api

import (
	"encoding/json"
	"net/http"
)

// GetUserBlobs returns all blob IDs owned by the authenticated desktop client.
// Used for client-side cleanup of orphaned blobs.
func (h *Handler) GetUserBlobs(w http.ResponseWriter, r *http.Request) {
	// 1. Authenticate
	desktopPK := r.Header.Get("X-Desktop-PK")
	signature := r.Header.Get("X-Signature")

	if desktopPK == "" || signature == "" {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	// Verify signature of the request (using an empty body for this GET request)
	if err := h.verifyDesktopSignature(desktopPK, []byte("LIST_BLOBS"), signature); err != nil {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// 2. Fetch all blobs for this PK
	blobIDs, err := h.db.GetAllUserBlobs(r.Context(), desktopPK)
	if err != nil {
		http.Error(w, "Failed to fetch blobs from database", http.StatusInternalServerError)
		return
	}

	if blobIDs == nil {
		blobIDs = []string{}
	}

	// 3. Return the list
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "success",
		"blob_ids": blobIDs,
	})
}
