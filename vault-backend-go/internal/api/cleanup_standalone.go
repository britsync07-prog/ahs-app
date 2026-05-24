package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"golang.org/x/oauth2"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

// Standalone cleanup handlers to avoid touching existing files

func (h *Handler) CleanupListBlobs(w http.ResponseWriter, r *http.Request) {
	desktopPK := r.Header.Get("X-Desktop-PK")
	signature := r.Header.Get("X-Signature")

	if desktopPK == "" || signature == "" {
		http.Error(w, "Auth required", http.StatusUnauthorized)
		return
	}

	if err := h.verifyDesktopSignature(desktopPK, []byte("CLEANUP_LIST"), signature); err != nil {
		http.Error(w, "Invalid sig", http.StatusUnauthorized)
		return
	}

	// Raw query to avoid touching db.go
	rows, err := h.db.Pool.Query(r.Context(), "SELECT blob_id FROM blobs WHERE owner_public_key = $1", desktopPK)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "blob_ids": ids})
}

func (h *Handler) CleanupListDrive(w http.ResponseWriter, r *http.Request) {
	desktopPK := r.Header.Get("X-Desktop-PK")
	signature := r.Header.Get("X-Signature")
	googleToken := r.Header.Get("X-Google-Token")

	if desktopPK == "" || signature == "" || googleToken == "" {
		http.Error(w, "Missing auth", http.StatusUnauthorized)
		return
	}

	if err := h.verifyDesktopSignature(desktopPK, []byte("CLEANUP_DRIVE"), signature); err != nil {
		http.Error(w, "Invalid sig", http.StatusUnauthorized)
		return
	}

	// Minimal GDrive logic duplication to avoid touching gdrive.go
	ctx := r.Context()
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: googleToken})
	tc := oauth2.NewClient(ctx, ts)
	srv, err := drive.NewService(ctx, option.WithHTTPClient(tc))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Find folder
	q := "name='SecureVault' and mimeType='application/vnd.google-apps.folder' and trashed=false"
	res, err := srv.Files.List().Q(q).Spaces("drive").Do()
	if err != nil || len(res.Files) == 0 {
		http.Error(w, "Vault folder not found", http.StatusNotFound)
		return
	}
	folderId := res.Files[0].Id

	// List files
	q2 := fmt.Sprintf("'%s' in parents and trashed=false", folderId)
	res2, err := srv.Files.List().Q(q2).Fields("files(name)").Do()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var names []string
	for _, f := range res2.Files {
		names = append(names, f.Name)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "blob_ids": names})
}
