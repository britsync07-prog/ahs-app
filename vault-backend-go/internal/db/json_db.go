package db

import (
	"context"
	"encoding/json"
	"os"
	"sync"
)

type JsonDatabase struct {
	path string
	mu   sync.RWMutex
	data struct {
		Devices      []map[string]interface{} `json:"devices"`
		ActivityLogs []map[string]interface{} `json:"activity_logs"`
		Blobs        []map[string]interface{} `json:"blobs"`
	}
}

func NewJsonConnection() (*JsonDatabase, error) {
	db := &JsonDatabase{path: "vault_local_db.json"}
	_ = db.load()
	return db, nil
}

func (db *JsonDatabase) load() error {
	file, err := os.ReadFile(db.path)
	if err != nil {
		return err
	}
	return json.Unmarshal(file, &db.data)
}

func (db *JsonDatabase) save() error {
	data, err := json.MarshalIndent(db.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(db.path, data, 0644)
}

func (db *JsonDatabase) InitSchema(ctx context.Context) error {
	return nil
}

func (db *JsonDatabase) RegisterOrUpdateDevice(ctx context.Context, pk, name, osInfo string) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	
	for i, d := range db.data.Devices {
		if d["public_key"] == pk {
			db.data.Devices[i]["name"] = name
			db.data.Devices[i]["os"] = osInfo
			return db.save()
		}
	}
	
	db.data.Devices = append(db.data.Devices, map[string]interface{}{
		"public_key": pk,
		"name":       name,
		"os":         osInfo,
		"status":     "secure",
	})
	return db.save()
}

// ... other methods implemented similarly ...
