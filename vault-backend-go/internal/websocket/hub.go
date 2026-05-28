package websocket

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	Hub  *Hub
	Conn *websocket.Conn
	Send chan []byte
}

type Hub struct {
	clients       map[*Client]bool
	identities    map[string][]*Client // PublicKey -> Clients
	pairingNonces map[string]pairingSession
	broadcast     chan []byte
	register      chan *Client
	unregister    chan *Client
	mu            sync.Mutex
}

type pairingSession struct {
	nonce     string
	createdAt time.Time
}

func keyFingerprint(v string) string {
	if v == "" {
		return "empty"
	}
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:6])
}

func NewHub() *Hub {
	return &Hub{
		broadcast:     make(chan []byte),
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		clients:       make(map[*Client]bool),
		identities:    make(map[string][]*Client),
		pairingNonces: make(map[string]pairingSession),
	}
}

func (h *Hub) BindIdentity(publicKey string, pairingNonce string, client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Append client to the list for this identity if not already present
	exists := false
	for _, c := range h.identities[publicKey] {
		if c == client {
			exists = true
			break
		}
	}
	if !exists {
		h.identities[publicKey] = append(h.identities[publicKey], client)
	}

	h.pairingNonces[publicKey] = pairingSession{
		nonce:     pairingNonce,
		createdAt: time.Now(),
	}
	log.Printf("Identity bound: public_key=%s nonce=%s fp=%s total_clients=%d", publicKey, pairingNonce, keyFingerprint(publicKey), len(h.identities[publicKey]))
}

func (h *Hub) ValidateAndConsumePairingNonce(publicKey string, nonce string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	session, ok := h.pairingNonces[publicKey]
	if !ok {
		return false
	}

	// Pairing sessions are short-lived and single-use.
	if time.Since(session.createdAt) > 5*time.Minute {
		delete(h.pairingNonces, publicKey)
		return false
	}
	if session.nonce != nonce {
		return false
	}

	delete(h.pairingNonces, publicKey)
	return true
}

func (h *Hub) SendToIdentity(publicKey string, message []byte) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	clients, ok := h.identities[publicKey]
	if !ok || len(clients) == 0 {
		log.Printf("Hub: Identity %s NOT FOUND in active map or no connected clients", keyFingerprint(publicKey))
		return false
	}

	log.Printf("Hub: Sending message to identity %s (%d clients)", keyFingerprint(publicKey), len(clients))
	anySuccess := false
	for _, client := range clients {
		select {
		case client.Send <- message:
			anySuccess = true
		default:
			log.Printf("Hub: FAILED to queue message for one client of identity %s (channel full)", keyFingerprint(publicKey))
		}
	}

	return anySuccess
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("Hub: Client registered. Total clients: %d", len(h.clients))

			// Send welcome message
			welcome := map[string]string{
				"type":    "connection_established",
				"message": "Vault WebSocket Connected",
			}
			data, _ := json.Marshal(welcome)
			client.Send <- data

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				// Remove from identities
				identityFound := false
				for pk, clients := range h.identities {
					for i, c := range clients {
						if c == client {
							log.Printf("Hub: Unbinding client from identity %s (disconnected)", keyFingerprint(pk))
							// Remove from slice
							h.identities[pk] = append(clients[:i], clients[i+1:]...)

							if len(h.identities[pk]) == 0 {
								log.Printf("Hub: No more clients for identity %s, cleaning up", keyFingerprint(pk))
								delete(h.identities, pk)
								delete(h.pairingNonces, pk)
							}
							identityFound = true
							break
						}
					}
					if identityFound {
						break
					}
				}
				if !identityFound {
					log.Printf("Hub: Unregistering anonymous client")
				}
				delete(h.clients, client)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("Hub: Client unregistered. Total clients: %d", len(h.clients))

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}

func (h *Hub) Broadcast(message []byte) {
	h.broadcast <- message
}
