package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/vault-backend-go/internal/db"
	"github.com/vault-backend-go/internal/storage"
	"github.com/vault-backend-go/internal/websocket"
)

func TestUploadVault(t *testing.T) {
	// Mock storage and DB
	os.Setenv("MINIO_ENDPOINT", "localhost:9000")
	os.Setenv("MINIO_ACCESS_KEY", "minioadmin")
	os.Setenv("MINIO_SECRET_KEY", "minioadmin")
	os.Setenv("MINIO_USE_SSL", "false")
	os.Setenv("MINIO_BUCKET", "test-bucket")

	// We can't easily start a real MinIO, so we might need to mock the storage interface.
	// But let's see if we can at least test the handler logic.
	
	s := &storage.Storage{} // This will fail if it tries to connect to real MinIO
	hub := websocket.NewHub()
	database := &db.Database{}
	h := NewHandler(s, hub, database)

	t.Run("Missing Headers", func(t *testing.T) {
		req, _ := http.NewRequest("POST", "/api/vault/upload", bytes.NewBuffer([]byte("data")))
		rr := httptest.NewRecorder()
		h.UploadVault(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("handler returned wrong status code: got %v want %v", rr.Code, http.StatusUnauthorized)
		}
	})
}

func TestHealthCheck(t *testing.T) {
	h := NewHandler(nil, nil, nil)
	req, _ := http.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()
	h.HealthCheck(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", rr.Code, http.StatusOK)
	}
}
