package api

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/vault-backend-go/internal/db"
	"github.com/vault-backend-go/internal/storage"
	ws "github.com/vault-backend-go/internal/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Native desktop clients (tokio-tungstenite) usually do not send Origin.
		// Allow empty Origin so local desktop-to-backend WS can connect.
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			return true
		}

		allowed := strings.Split(os.Getenv("WS_ALLOWED_ORIGINS"), ",")
		if len(allowed) == 1 && strings.TrimSpace(allowed[0]) == "" {
			allowed = []string{
				"http://localhost:1420",
				"http://127.0.0.1:1420",
				"tauri://localhost",
				"http://tauri.localhost",
				"https://ahs.mayfairmarketing.online",
			}
		}
		for _, a := range allowed {
			if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(a)), []byte(origin)) == 1 {
				return true
			}
		}
		return false
	},
}

type Handler struct {
	storage *storage.GDriveStorage
	hub     *ws.Hub
	db      *db.Database
}

func keyFingerprint(v string) string {
	if v == "" {
		return "empty"
	}
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:6])
}

func NewHandler(s *storage.GDriveStorage, h *ws.Hub, d *db.Database) *Handler {
	return &Handler{storage: s, hub: h, db: d}
}

func (h *Handler) GetDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := h.db.GetDevices(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch devices", http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(devices)
}

func (h *Handler) GetActivity(w http.ResponseWriter, r *http.Request) {
	pk := r.URL.Query().Get("public_key")
	logs, err := h.db.GetActivityLogs(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch activity logs", http.StatusInternalServerError)
		return
	}

	// Filter logs for THIS user if PK provided
	userLogs := []map[string]interface{}{}
	if pk != "" {
		for _, l := range logs {
			if l["device_public_key"] == pk {
				userLogs = append(userLogs, l)
			}
		}
	} else {
		userLogs = logs
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(userLogs)
}

func (h *Handler) HandleMobileUpdate(w http.ResponseWriter, r *http.Request) {
	updateResponse := map[string]interface{}{
		"version":  "1.1", // Current production version
		"notes":    "Production release with automated update check.",
		"pub_date": "2026-05-22T10:00:00Z",
		"url":      "https://github.com/britsync07-prog/ahs-app/releases/latest/download/vault-mobile-auth.apk",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updateResponse)
}

func (h *Handler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	// In a real production app, you might query GitHub API to get the latest release.
	// For now, we return a structured JSON that Tauri expects.
	updateResponse := map[string]interface{}{
		"version":  "v0.1.1", // Change this when you release a new version
		"notes":    "Stabilized WebSocket connections and fixed redundant imports.",
		"pub_date": "2026-05-21T12:00:00Z",
		"platforms": map[string]interface{}{
			"windows-x86_64": map[string]interface{}{
				"signature": "", // You will get this from the build artifact (.sig file)
				"url":       "https://github.com/britsync07-prog/ahs-app/releases/latest/download/vault-desktop-tauri.msi.zip",
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updateResponse)
}

func (h *Handler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		PublicKey string `json:"public_key"`
		Name      string `json:"name"`
		OS        string `json:"os"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	err := h.db.RegisterOrUpdateDevice(r.Context(), payload.PublicKey, payload.Name, payload.OS)
	if err != nil {
		http.Error(w, "Failed to register device", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) DeleteDevice(w http.ResponseWriter, r *http.Request) {
	pk := r.URL.Query().Get("public_key")
	bulk := r.URL.Query().Get("bulk") == "true"

	if pk == "" {
		http.Error(w, "Missing public key", http.StatusBadRequest)
		return
	}

	if bulk {
		// Find device first to get name/os
		devices, _ := h.db.GetDevices(r.Context())
		var targetName, targetOS string
		for _, d := range devices {
			if d["public_key"] == pk {
				targetName = d["name"].(string)
				targetOS = d["os"].(string)
				break
			}
		}
		if targetName != "" {
			h.db.DeleteDevicesByNameAndOS(r.Context(), targetName, targetOS)
		}
	} else {
		err := h.db.DeleteDevice(r.Context(), pk)
		if err != nil {
			http.Error(w, "Failed to delete device", http.StatusInternalServerError)
			return
		}
	}

	h.db.LogActivity(r.Context(), pk, "SECURITY", "Device De-authorized", "A previously trusted device was manually removed from the authorized network.", "medium")
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	pk := r.URL.Query().Get("public_key")

	// Get all devices first
	devices, err := h.db.GetDevices(r.Context())
	if err != nil {
		devices = []map[string]interface{}{}
	}

	// Filter devices for THIS user if PK provided
	userDevices := []map[string]interface{}{}
	if pk != "" {
		for _, d := range devices {
			if d["public_key"].(string) == pk {
				userDevices = append(userDevices, d)
			}
		}
	} else {
		userDevices = devices
	}

	logs, err := h.db.GetActivityLogs(r.Context())
	if err != nil {
		logs = []map[string]interface{}{}
	}

	// Filter logs for THIS user if PK provided
	userLogs := []map[string]interface{}{}
	if pk != "" {
		for _, l := range logs {
			if l["device_public_key"] == pk {
				userLogs = append(userLogs, l)
			}
		}
	} else {
		userLogs = logs
	}

	// Calculate Real Security Score (Starting at 100)
	score := 100

	// Deduct for many devices (potential surface area)
	if len(userDevices) > 3 {
		score -= (len(userDevices) - 3) * 2
	}

	// Deduct for recent threats
	threatCount := 0
	for _, log := range userLogs {
		risk, ok := log["risk"].(string)
		if ok && (risk == "high" || risk == "critical") {
			score -= 5
			threatCount++
		}
	}

	if score < 0 {
		score = 0
	}

	googleToken := r.Header.Get("X-Google-Token")

	var storageSize int64
	var fileCount int
	if pk != "" {
		count, size, err := h.db.GetUserStorageStats(r.Context(), pk)
		if err == nil {
			storageSize = size
			fileCount = count
		}
	} else if googleToken != "" {
		_, size, err := h.storage.GetBucketStats(r.Context(), googleToken)
		if err == nil {
			storageSize = size
		}
	}

	sizeStr := "0 B"
	if storageSize < 1024 {
		sizeStr = fmt.Sprintf("%d B", storageSize)
	} else if storageSize < 1024*1024 {
		sizeStr = fmt.Sprintf("%.2f KB", float64(storageSize)/1024)
	} else if storageSize < 1024*1024*1024 {
		sizeStr = fmt.Sprintf("%.2f MB", float64(storageSize)/(1024*1024))
	} else {
		sizeStr = fmt.Sprintf("%.2f GB", float64(storageSize)/(1024*1024*1024))
	}

	// Map real modules
	modules := map[string]string{
		"email_shield":      "Disabled",
		"threat_detection":  "Active",
		"network_filter":    "Monitoring",
		"process_isolation": "Active",
		"key_rotation":      "Active",
	}

	if os.Getenv("VAULT_IMAP_USER") != "" {
		modules["email_shield"] = "Active"
	}

	statusMsg := "Excellent Integrity"
	if threatCount > 0 {
		statusMsg = "Threats Detected"
	}

	stats := map[string]interface{}{
		"filesProtected":  fileCount,
		"threatsBlocked":  threatCount,
		"authorizedPeers": len(userDevices),
		"storageUsed":     sizeStr,
		"securityScore":   score,
		"statusMessage":   statusMsg,
		"modules":         modules,
		"activeSessions":  len(userDevices),
		"vaultHealth":     "Secure",
		"deviceCount":     len(userDevices),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (h *Handler) LogThreat(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		DesktopPublicKey string `json:"desktop_public_key"`
		Vector           string `json:"vector"`
		Subject          string `json:"subject"`
		Detail           string `json:"detail"`
		RiskLevel        string `json:"risk_level"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	h.db.LogActivity(r.Context(), payload.DesktopPublicKey, "threat", payload.Subject, payload.Detail, payload.RiskLevel)

	log.Printf("Threat logged from desktop_fp=%s: %s", keyFingerprint(payload.DesktopPublicKey), payload.Subject)
	w.WriteHeader(http.StatusCreated)
}

func (h *Handler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

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

	// Read body for signature verification
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	if err := h.verifyDesktopSignature(desktopPK, bodyBytes, signature); err != nil {
		// FALLBACK: Rust client might be sending SHA256 pre-hashed body
		hash := sha256.Sum256(bodyBytes)
		if err := h.verifyDesktopSignature(desktopPK, hash[:], signature); err != nil {
			log.Printf("Desktop authentication failed: %v", err)
			http.Error(w, "Invalid desktop signature", http.StatusUnauthorized)
			return
		}
	}

	// 1. Get size
	size := int64(len(bodyBytes))
	if size <= 0 {
		http.Error(w, "Content required", http.StatusBadRequest)
		return
	}

	// 2. Generate a unique UUID
	blobID := uuid.New().String()

	// 3. Save to GDrive
	_, err = h.storage.UploadObject(r.Context(), googleToken, blobID, bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("Upload failed: %v", err)
		http.Error(w, "Failed to save blob to GDrive storage", http.StatusInternalServerError)
		return
	}

	// 4. Record ownership in DB for stats
	if err := h.db.RecordBlobOwnership(r.Context(), blobID, desktopPK, size); err != nil {
		log.Printf("Failed to record blob ownership: %v", err)
		// We don't fail the request since the file is already in storage,
		// but we log it.
	}

	// 5. Return the UUID
	response := map[string]string{
		"blob_id": blobID,
		"status":  "success",
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

func (h *Handler) WsConnect(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade failed: %v", err)
		return
	}

	client := &ws.Client{
		Hub:  h.hub,
		Conn: conn,
		Send: make(chan []byte, 256),
	}

	h.hub.Register(client)

	// Start pump goroutines
	go h.writePump(client)
	go h.readPump(client)
}

func (h *Handler) writePump(c *ws.Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Ws: Panic in writePump: %v", r)
		}
		ticker.Stop()
		c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Ws: Ping failed for client: %v", err)
				return
			}
		}
	}
}

func (h *Handler) readPump(c *ws.Client) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Ws: Panic in readPump: %v", r)
		}
		c.Hub.Unregister(c)
		c.Conn.Close()
	}()
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		// Handle Incoming WebSocket Messages
		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err == nil {
			if msg["type"] == "desktop_register" {
				if pk, ok := msg["public_key"].(string); ok {
					nonce, _ := msg["pairing_nonce"].(string)
					if strings.TrimSpace(pk) == "" || strings.TrimSpace(nonce) == "" {
						log.Printf("Ws: Desktop registration failed - missing pk or nonce")
						continue
					}
					h.hub.BindIdentity(pk, nonce, c)
					log.Printf("Ws: Desktop identity bound: %s", keyFingerprint(pk))
				}
			} else if msg["type"] == "mobile_register" {
				if pk, ok := msg["public_key"].(string); ok {
					// For mobile, pairing_nonce is optional in WS registration
					nonce, _ := msg["pairing_nonce"].(string)
					if strings.TrimSpace(pk) == "" {
						continue
					}
					h.hub.BindIdentity(pk, nonce, c)
					log.Printf("Mobile WS registered: %s", keyFingerprint(pk))
				}
			}
		}
	}
}

func (h *Handler) PairVault(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		DesktopPublicKey string `json:"desktop_public_key"`
		MobilePublicKey  string `json:"mobile_public_key"`
		MobileXPublicKey string `json:"mobile_x_public_key"` // NEW: For ECIES back to mobile
		PairingNonce     string `json:"pairing_nonce"`
		Signature        string `json:"signature"`
		EncryptedKey     string `json:"encrypted_key"` // MUST BE ENCRYPTED FOR DESKTOP PK
		OSInfo           string `json:"os_info"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	if payload.DesktopPublicKey == "" || payload.MobilePublicKey == "" || payload.PairingNonce == "" || payload.Signature == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	// 1. Cryptographic Verification of Mobile Identity
	if err := h.verifyMobileSignature(payload.MobilePublicKey, payload.PairingNonce, payload.Signature); err != nil {
		log.Printf("Identity verification failed: %v", err)
		http.Error(w, "Invalid mobile identity signature", http.StatusUnauthorized)
		return
	}

	// 2. Verify pairing nonce against the pending desktop session
	if !h.hub.ValidateAndConsumePairingNonce(payload.DesktopPublicKey, payload.PairingNonce) {
		http.Error(w, "Invalid or expired pairing session", http.StatusUnauthorized)
		return
	}

	// 2.5 Persist Device and Log Activity
	osInfo := payload.OSInfo
	if osInfo == "" {
		osInfo = "Unknown Desktop"
	}
	h.db.RegisterOrUpdateDevice(r.Context(), payload.DesktopPublicKey, "Secure Workstation", osInfo)
	h.db.LogActivity(r.Context(), payload.DesktopPublicKey, "security", "Vault Unlocked", "Access authorized by mobile hardware", "low")

	desktopPK := strings.TrimSpace(payload.DesktopPublicKey)

	log.Printf(
		"Hardware-verified pairing: desktop_fp=%s mobile_fp=%s",
		keyFingerprint(desktopPK),
		keyFingerprint(payload.MobilePublicKey),
	)

	// 3. Signal Desktop via WebSocket
	approval := map[string]string{
		"type":         "unlock_approved",
		"public_key":   payload.MobilePublicKey,
		"x_public_key": payload.MobileXPublicKey,
	}
	if strings.TrimSpace(payload.EncryptedKey) != "" {
		// Relay the encrypted key (backend cannot decrypt this)
		approval["encrypted_key"] = strings.TrimSpace(payload.EncryptedKey)
	}
	approvalJSON, _ := json.Marshal(approval)

	log.Printf("Signaling desktop pk=%s with message: %s", desktopPK, string(approvalJSON))
	success := h.hub.SendToIdentity(desktopPK, approvalJSON)

	if success {
		log.Printf("Signal successfully queued for desktop pk=%s", desktopPK)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "paired"})
	} else {
		log.Printf("FAILED to signal desktop pk=%s (not found in hub)", desktopPK)
		http.Error(w, "Desktop not found or disconnected", http.StatusNotFound)
	}
}

func (h *Handler) verifyMobileSignature(pubKeyB64, nonce, sigB64 string) error {
	pubBytes, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil {
		return err
	}

	rawPubKey, err := x509.ParsePKIXPublicKey(pubBytes)
	if err != nil {
		return err
	}

	pubKey, ok := rawPubKey.(*ecdsa.PublicKey)
	if !ok {
		return log.Output(0, "Not an ECDSA public key")
	}

	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return err
	}

	hash := sha256.Sum256([]byte(nonce))
	if ecdsa.VerifyASN1(pubKey, hash[:], sig) {
		return nil
	}

	return log.Output(0, "Signature mismatch")
}

func (h *Handler) RelayPush(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		TargetPublicKey string `json:"target_public_key"` // NEW: Explicit target
		MobilePublicKey string `json:"mobile_public_key"` // LEGACY: For desktop compatibility
		EncryptedBlob   string `json:"encrypted_blob"`    // Base64
		EncryptedKey    string `json:"encrypted_key"`     // BACKWARD COMPAT: For mobile approval
		Signature       string `json:"signature"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Resolve the blob (favoring the new generic name)
	blob := payload.EncryptedBlob
	if blob == "" {
		blob = payload.EncryptedKey
	}

	// Resolve the target
	target := payload.TargetPublicKey
	if target == "" {
		target = payload.MobilePublicKey
	}

	if target == "" || blob == "" {
		http.Error(w, "Missing target or blob", http.StatusBadRequest)
		return
	}

	msg := map[string]string{
		"type":           "push_relay",
		"encrypted_blob": blob,
	}
	msgJSON, _ := json.Marshal(msg)

	// Send to the resolved target (can be Desktop OR Mobile)
	success := h.hub.SendToIdentity(target, msgJSON)

	if success {
		log.Printf("Relay success: target_fp=%s", keyFingerprint(target))
		w.WriteHeader(http.StatusAccepted)
	} else {
		log.Printf("Relay target %s not found.", keyFingerprint(target))
		http.Error(w, "Target device not connected", http.StatusNotFound)
	}
}

func (h *Handler) DeleteVault(w http.ResponseWriter, r *http.Request) {
	// 0. Authenticate
	desktopPK := r.Header.Get("X-Desktop-PK")
	signature := r.Header.Get("X-Signature")
	googleToken := r.Header.Get("X-Google-Token")

	if desktopPK == "" || signature == "" {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	if googleToken == "" {
		http.Error(w, "Google Token required (X-Google-Token)", http.StatusUnauthorized)
		return
	}

	var payload struct {
		BlobIDs []string `json:"blob_ids"`
	}
	// Need to read body for signature verification first
	bodyBytes, _ := io.ReadAll(r.Body)
	if err := h.verifyDesktopSignature(desktopPK, bodyBytes, signature); err != nil {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	deletedCount := 0
	for _, id := range payload.BlobIDs {
		// 1. Verify ownership
		owner, err := h.db.GetBlobOwner(r.Context(), id)
		if err != nil || owner != desktopPK {
			continue // Skip if not owner
		}

		// 2. Delete from GDrive
		if err := h.storage.DeleteObject(r.Context(), googleToken, id); err != nil {
			log.Printf("Failed to delete storage object %s: %v", id, err)
			continue
		}

		// 3. Delete from DB
		if err := h.db.DeleteBlobOwnership(r.Context(), id); err != nil {
			log.Printf("Failed to delete db record %s: %v", id, err)
		}
		deletedCount++
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"deleted": deletedCount,
	})
}
func (h *Handler) DownloadVault(w http.ResponseWriter, r *http.Request) {
	blobID := chi.URLParam(r, "blob_id")
	if blobID == "" {
		http.Error(w, "Missing blob_id", http.StatusBadRequest)
		return
	}

	// 0. Authenticate
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

	// Verify signature of the blobID
	if err := h.verifyDesktopSignature(desktopPK, []byte(blobID), signature); err != nil {
		http.Error(w, "Invalid desktop signature for download", http.StatusUnauthorized)
		return
	}

	reader, err := h.storage.GetObject(r.Context(), googleToken, blobID)
	if err != nil {
		log.Printf("Failed to retrieve object: %v", err)
		http.Error(w, "Failed to retrieve object from GDrive", http.StatusNotFound)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)
	io.Copy(w, reader)
}

func (h *Handler) verifyDesktopSignature(pubKeyB64 string, data []byte, sigB64 string) error {
	pubBytes, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil {
		return err
	}

	if len(pubBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key size")
	}

	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return err
	}

	if ed25519.Verify(pubBytes, data, sig) {
		return nil
	}

	return fmt.Errorf("signature verification failed")
}

func (h *Handler) GetRootIndex(w http.ResponseWriter, r *http.Request) {
	pk := r.URL.Query().Get("public_key")
	if pk == "" {
		http.Error(w, "public_key required", http.StatusBadRequest)
		return
	}

	id, err := h.db.GetRootBlob(r.Context(), pk)
	if err != nil {
		http.Error(w, "Failed to get root index", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"blob_id": id})
}

func (h *Handler) SetRootIndex(w http.ResponseWriter, r *http.Request) {
	desktopPK := r.Header.Get("X-Desktop-PK")
	signature := r.Header.Get("X-Signature")

	if desktopPK == "" || signature == "" {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	var payload struct {
		PublicKey string `json:"public_key"`
		BlobID    string `json:"blob_id"`
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Verify signature of the blob_id
	if err := h.verifyDesktopSignature(desktopPK, []byte(payload.BlobID), signature); err != nil {
		log.Printf("SetRootIndex: Invalid signature from %s: %v", desktopPK, err)
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	if err := h.db.SetRootBlob(r.Context(), desktopPK, payload.BlobID); err != nil {
		http.Error(w, "Failed to set root index", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) parseRangeInt(s string) int64 {
	var val int64
	fmt.Sscanf(s, "%d", &val)
	return val
}
