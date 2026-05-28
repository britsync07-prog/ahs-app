package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/vault-backend-go/internal/api"
	"github.com/vault-backend-go/internal/db"
	"github.com/vault-backend-go/internal/storage"
	"github.com/vault-backend-go/internal/websocket"
)

func main() {
	// Load .env
	_ = godotenv.Load()

	// 1. Initialize DB
	database, err := db.NewConnection()
	if err != nil {
		log.Fatalf("FATAL: Failed to connect to database. Production mode requires PostgreSQL: %v", err)
	}
	if database == nil {
		log.Fatalf("FATAL: Database connection returned nil. Production mode requires PostgreSQL.")
	}
	defer database.Close()
	
	if err := database.InitSchema(context.Background()); err != nil {
		log.Printf("Warning: Failed to initialize database schema: %v", err)
	}

	// 2. Initialize GDrive Storage
	gdriveStorage := storage.NewGDriveStorage()

	// 4. Initialize WebSocket Hub
	hub := websocket.NewHub()
	go hub.Run()

	// 5. Setup API
	handler := api.NewHandler(gdriveStorage, hub, database)
	router := api.NewRouter(handler)

	server := &http.Server{
		Addr:         ":8080",
		Handler:      router,
		ReadTimeout:  1 * time.Hour,
		WriteTimeout: 1 * time.Hour,
		IdleTimeout:  1 * time.Hour,
	}

	// 5. Start Server with Graceful Shutdown
	go func() {
		log.Printf("Starting API Server on port 8080...")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Could not listen on :8080: %v\n", err)
		}
	}()

	// Wait for interrupt signal
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server gracefully stopped")
}
