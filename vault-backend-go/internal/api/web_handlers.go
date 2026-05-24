package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/vault-backend-go/internal/auth"
	ws "github.com/vault-backend-go/internal/websocket"
)

var webUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for web clients (e.g. .pages.dev)
	},
}

func (h *Handler) WebPairVault(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		DesktopPublicKey string `json:"desktop_public_key"`
		MobilePublicKey  string `json:"mobile_public_key"`
		MobileXPublicKey string `json:"mobile_x_public_key"`
		PairingNonce     string `json:"pairing_nonce"`
		Signature        string `json:"signature"`
		WebAuthnID       string `json:"webauthn_id"`     // New hardware ID
		WebAuthnPubKey   string `json:"webauthn_pubkey"` // New hardware PK
		EncryptedKey     string `json:"encrypted_key"`
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

	// 1. Initial Trust Verification (Identity Key Signature)
	// This matches the phone app's security for the first handshake.
	if err := h.verifyMobileSignature(payload.MobilePublicKey, payload.PairingNonce, payload.Signature); err != nil {
		log.Printf("Web pairing identity verification failed: %v", err)
		http.Error(w, "Invalid identity signature", http.StatusUnauthorized)
		return
	}

	// 2. Optional Biometric Enrollment during pairing
	if payload.WebAuthnPubKey != "" {
		err := h.db.RegisterOrUpdateDevice(r.Context(), payload.WebAuthnPubKey, "Secure Web Node", "WebAuthn Hardware")
		if err != nil {
			log.Printf("Failed to register hardware key during pair: %v", err)
		}
	}

	// 3. Verify pairing nonce against the pending desktop session
	if !h.hub.ValidateAndConsumePairingNonce(payload.DesktopPublicKey, payload.PairingNonce) {
		http.Error(w, "Invalid or expired pairing session", http.StatusUnauthorized)
		return
	}

	// Persist Desktop for this node
	osInfo := payload.OSInfo
	if osInfo == "" {
		osInfo = "Secure Web Node"
	}
	h.db.RegisterOrUpdateDevice(r.Context(), payload.DesktopPublicKey, "Secure Workstation", osInfo)
	h.db.LogActivity(r.Context(), payload.DesktopPublicKey, "security", "Vault Unlocked", "Access authorized via magic handshake", "low")

	desktopPK := strings.TrimSpace(payload.DesktopPublicKey)

	// Signal Desktop via WebSocket
	approval := map[string]string{
		"type":         "unlock_approved",
		"public_key":   payload.MobilePublicKey,
		"x_public_key": payload.MobileXPublicKey,
	}
	if strings.TrimSpace(payload.EncryptedKey) != "" {
		approval["encrypted_key"] = strings.TrimSpace(payload.EncryptedKey)
	}
	approvalJSON, _ := json.Marshal(approval)

	h.hub.SendToIdentity(desktopPK, approvalJSON)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "paired"})
}

func (h *Handler) WebRelayPush(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		TargetPublicKey  string `json:"target_public_key"`
		MobilePublicKey  string `json:"mobile_public_key"`
		EncryptedBlob    string `json:"encrypted_blob"`
		PairingNonce     string `json:"pairing_nonce"`
		Signature        string `json:"signature"`
		WebAuthnResponse *struct {
			Response struct {
				AuthenticatorData string `json:"authenticatorData"`
				ClientDataJSON    string `json:"clientDataJSON"`
				Signature         string `json:"signature"`
			} `json:"response"`
		} `json:"webauthn_response"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// 1. Verify Identity (Dual Support for Fingerprint OR PIN)
	if payload.WebAuthnResponse != nil {
		// Fingerprint Path
		err := auth.VerifyWebAuthnAssertion(
			payload.MobilePublicKey,
			payload.WebAuthnResponse.Response.Signature,
			payload.WebAuthnResponse.Response.ClientDataJSON,
			payload.WebAuthnResponse.Response.AuthenticatorData,
			payload.PairingNonce,
		)
		if err != nil {
			log.Printf("Web RelayPush WebAuthn verification failed: %v", err)
			http.Error(w, "Invalid WebAuthn assertion", http.StatusUnauthorized)
			return
		}
	} else {
		// PIN Fallback Path (Legacy Signature)
		if payload.Signature == "" {
			http.Error(w, "Authentication required (missing signature or biometric)", http.StatusUnauthorized)
			return
		}
		if err := h.verifyMobileSignature(payload.MobilePublicKey, payload.PairingNonce, payload.Signature); err != nil {
			log.Printf("Web RelayPush PIN signature verification failed: %v", err)
			http.Error(w, "Invalid security signature", http.StatusUnauthorized)
			return
		}
	}

	msg := map[string]string{
		"type":           "push_relay",
		"encrypted_blob": payload.EncryptedBlob,
	}
	msgJSON, _ := json.Marshal(msg)

	success := h.hub.SendToIdentity(payload.TargetPublicKey, msgJSON)

	if success {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "message": "Unlock push delivered"})
	} else {
		http.Error(w, "Target device not connected", http.StatusNotFound)
	}
}

func (h *Handler) WebRegisterWebAuthn(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		MobilePublicKey string `json:"mobile_public_key"`
		WebAuthnID      string `json:"webauthn_id"`
		WebAuthnPubKey  string `json:"webauthn_pubkey"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	err := h.db.RegisterOrUpdateDevice(r.Context(), payload.WebAuthnPubKey, "Secure Web Node", "WebAuthn Hardware")
	if err != nil {
		http.Error(w, "Failed to register hardware key", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "registered"})
}

func (h *Handler) WebWsConnect(w http.ResponseWriter, r *http.Request) {
	conn, err := webUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Web Ws Upgrade failed: %v", err)
		return
	}

	client := &ws.Client{
		Hub:  h.hub,
		Conn: conn,
		Send: make(chan []byte, 256),
	}

	h.hub.Register(client)

	go h.writePump(client)
	go h.readPump(client)
}
