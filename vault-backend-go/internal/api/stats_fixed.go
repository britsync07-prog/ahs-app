package api

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// GetStatsV2 returns user vault stats, excluding the root index blob from the file count.
func (h *Handler) GetStatsV2(w http.ResponseWriter, r *http.Request) {
	pk := r.URL.Query().Get("public_key")
	if pk == "" {
		http.Error(w, "public_key required", http.StatusBadRequest)
		return
	}

	count, size, err := h.db.GetUserStorageStats(r.Context(), pk)
	if err != nil {
		http.Error(w, "Failed to fetch stats", http.StatusInternalServerError)
		return
	}

	// Exclude root index from count
	rootID, err := h.db.GetRootBlob(r.Context(), pk)
	if err == nil && rootID != "" {
		// If root index exists in blobs table, decrement count
		owner, err := h.db.GetBlobOwner(r.Context(), rootID)
		if err == nil && owner == pk {
			if count > 0 {
				count--
			}
		}
	}

	sizeStr := "0 B"
	if size < 1024 {
		sizeStr = fmt.Sprintf("%d B", size)
	} else if size < 1024*1024 {
		sizeStr = fmt.Sprintf("%.2f KB", float64(size)/1024)
	} else if size < 1024*1024*1024 {
		sizeStr = fmt.Sprintf("%.2f MB", float64(size)/(1024*1024))
	} else {
		sizeStr = fmt.Sprintf("%.2f GB", float64(size)/(1024*1024*1024))
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"filesProtected": count,
		"storageUsed":    sizeStr,
		"storageBytes":   size,
		"status":         "secure",
	})
}
