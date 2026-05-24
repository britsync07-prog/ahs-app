package api

import (
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func NewRouter(h *Handler) *chi.Mux {
	r := chi.NewRouter()
	allowedOrigins := strings.Split(os.Getenv("HTTP_ALLOWED_ORIGINS"), ",")
	if len(allowedOrigins) == 1 && strings.TrimSpace(allowedOrigins[0]) == "" {
		allowedOrigins = []string{
			"http://localhost:1420",
			"http://127.0.0.1:1420",
			"tauri://localhost",
			"http://tauri.localhost",
			"https://ahs.mayfairmarketing.online",
		}
	}

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Desktop-PK", "X-Signature", "X-Google-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/health", h.HealthCheck)
	r.Get("/api/update", h.HandleUpdate)

	r.Route("/api/vault", func(r chi.Router) {
		r.Post("/upload", h.UploadVault)
		r.Post("/pair", h.PairVault)
		r.Post("/push", h.RelayPush)
		r.Post("/shield/log", h.LogThreat)
		r.Post("/register", h.RegisterDevice)
		r.Get("/download/{blob_id}", h.DownloadVault)
		r.Get("/devices", h.GetDevices)
		r.Delete("/devices", h.DeleteDevice)
		r.Get("/activity", h.GetActivity)
		r.Get("/stats", h.GetStats)
		r.Get("/stats-v2", h.GetStatsV2)
		r.Get("/index", h.GetRootIndex)
		r.Post("/index", h.SetRootIndex)
		r.Post("/delete", h.DeleteVault)
		r.Get("/blobs", h.GetUserBlobs)
		r.Post("/delete-v2", h.DeleteVaultV2)
		r.Get("/cleanup/blobs", h.CleanupListBlobs)
		r.Get("/cleanup/drive", h.CleanupListDrive)
	})

	r.Get("/api/ws/connect", h.WsConnect)

	// --- NEW: Web App Specific Endpoints (Separated from Native) ---
	r.Route("/api/web", func(r chi.Router) {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   []string{"*"},
			AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
			AllowCredentials: false,
			MaxAge:           300,
		}))

		r.Post("/pair", h.WebPairVault)
		r.Post("/push", h.WebRelayPush)
		r.Post("/register-webauthn", h.WebRegisterWebAuthn)
		r.Get("/ws/connect", h.WebWsConnect)
	})

	return r
}
