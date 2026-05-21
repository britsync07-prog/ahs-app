package db

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Database struct {
	Pool *pgxpool.Pool
}

func NewConnection() (*Database, error) {
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	dbname := os.Getenv("DB_NAME")

	if host == "" {
		host = "localhost"
	}
	if port == "" {
		port = "5439"
	}

	connStr := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		user, password, host, port, dbname)

	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("unable to parse connection string: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %v", err)
	}

	return &Database{Pool: pool}, nil
}

func (db *Database) InitSchema(ctx context.Context) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS devices (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			public_key TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			os TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'secure',
			last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			last_root_blob_id TEXT
		)`,
		`ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_root_blob_id TEXT`,
		`CREATE TABLE IF NOT EXISTS activity_logs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			device_public_key TEXT NOT NULL,
			event_type TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT NOT NULL,
			risk_level TEXT NOT NULL DEFAULT 'low',
			timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS blobs (
			blob_id TEXT PRIMARY KEY,
			owner_public_key TEXT NOT NULL,
			size_bytes BIGINT NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, q := range queries {
		if _, err := db.Pool.Exec(ctx, q); err != nil {
			return fmt.Errorf("failed to execute schema query: %v", err)
		}
	}
	return nil
}

func (db *Database) RegisterOrUpdateDevice(ctx context.Context, pk, name, os string) error {
	q := `INSERT INTO devices (public_key, name, os, last_active) 
		  VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
		  ON CONFLICT (public_key) DO UPDATE SET last_active = CURRENT_TIMESTAMP, name = $2, os = $3`
	_, err := db.Pool.Exec(ctx, q, pk, name, os)
	return err
}

func (db *Database) GetDevices(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := db.Pool.Query(ctx, "SELECT name, os, status, last_active, public_key FROM devices ORDER BY last_active DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []map[string]interface{}
	for rows.Next() {
		var name, os, status, pk string
		var lastActive time.Time
		if err := rows.Scan(&name, &os, &status, &lastActive, &pk); err != nil {
			return nil, err
		}
		devices = append(devices, map[string]interface{}{
			"name":        name,
			"os":          os,
			"status":      status,
			"last_active": lastActive.Format(time.RFC3339),
			"public_key":  pk,
		})
	}
	return devices, nil
}

func (db *Database) DeleteDevice(ctx context.Context, pk string) error {
	_, err := db.Pool.Exec(ctx, "DELETE FROM devices WHERE public_key = $1", pk)
	return err
}

func (db *Database) DeleteDevicesByNameAndOS(ctx context.Context, name, os string) error {
	_, err := db.Pool.Exec(ctx, "DELETE FROM devices WHERE name = $1 AND os = $2", name, os)
	return err
}

func (db *Database) LogActivity(ctx context.Context, pk, eventType, title, desc, risk string) error {
	q := `INSERT INTO activity_logs (device_public_key, event_type, title, description, risk_level) 
		  VALUES ($1, $2, $3, $4, $5)`
	_, err := db.Pool.Exec(ctx, q, pk, eventType, title, desc, risk)
	return err
}

func (db *Database) GetActivityLogs(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := db.Pool.Query(ctx, "SELECT device_public_key, event_type, title, description, risk_level, timestamp FROM activity_logs ORDER BY timestamp DESC LIMIT 50")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []map[string]interface{}
	for rows.Next() {
		var dpk, et, title, desc, risk string
		var ts time.Time
		if err := rows.Scan(&dpk, &et, &title, &desc, &risk, &ts); err != nil {
			return nil, err
		}
		logs = append(logs, map[string]interface{}{
			"device_public_key": dpk,
			"type":              et,
			"title":             title,
			"description":       desc,
			"risk":              risk,
			"time":              ts.Format(time.RFC3339),
		})
	}
	return logs, nil
}

func (db *Database) RecordBlobOwnership(ctx context.Context, blobID, pk string, size int64) error {
	q := `INSERT INTO blobs (blob_id, owner_public_key, size_bytes) VALUES ($1, $2, $3)
		  ON CONFLICT (blob_id) DO UPDATE SET size_bytes = $3`
	_, err := db.Pool.Exec(ctx, q, blobID, pk, size)
	return err
}

func (db *Database) GetUserStorageStats(ctx context.Context, pk string) (int, int64, error) {
	var count int
	var size int64
	q := `SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) FROM blobs WHERE owner_public_key = $1`
	err := db.Pool.QueryRow(ctx, q, pk).Scan(&count, &size)
	return count, size, err
}

func (db *Database) GetBlobOwner(ctx context.Context, blobID string) (string, error) {
	var owner string
	err := db.Pool.QueryRow(ctx, "SELECT owner_public_key FROM blobs WHERE blob_id = $1", blobID).Scan(&owner)
	return owner, err
}

func (db *Database) DeleteBlobOwnership(ctx context.Context, blobID string) error {
	_, err := db.Pool.Exec(ctx, "DELETE FROM blobs WHERE blob_id = $1", blobID)
	return err
}

func (db *Database) SetRootBlob(ctx context.Context, pk, blobID string) error {
	_, err := db.Pool.Exec(ctx, "UPDATE devices SET last_root_blob_id = $1 WHERE public_key = $2", blobID, pk)
	return err
}

func (db *Database) GetRootBlob(ctx context.Context, pk string) (string, error) {
	var id string
	err := db.Pool.QueryRow(ctx, "SELECT COALESCE(last_root_blob_id, '') FROM devices WHERE public_key = $1", pk).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return id, nil
}

func (db *Database) Close() {
	db.Pool.Close()
}

func (db *Database) Ping(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}
