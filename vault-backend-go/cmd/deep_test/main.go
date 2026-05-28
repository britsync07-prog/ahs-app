package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

const backendURL = "http://localhost:8080"

func main() {
	seed := make([]byte, 32)
	for i := range seed {
		seed[i] = byte(i)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)
	pkB64 := base64.StdEncoding.EncodeToString(pub)

	fmt.Printf("Testing with Public Key: %s\n", pkB64)

	registerDevice(pkB64)
	blobID := uploadBlob(pkB64, priv, "dummy data")
	fmt.Printf("Uploaded blob ID: %s\n", blobID)

	indexData := map[string]interface{}{
		"1": map[string]interface{}{
			"ino": 1,
			"name": "/",
			"kind": "Directory",
		},
		"2": map[string]interface{}{
			"ino": 2,
			"name": "test.txt",
			"kind": "RegularFile",
			"cloud_blob_id": blobID,
		},
	}
	indexJSON, _ := json.Marshal(indexData)
	indexBlobID := uploadBlob(pkB64, priv, string(indexJSON))
	fmt.Printf("Uploaded index blob ID: %s\n", indexBlobID)

	setRootIndex(pkB64, indexBlobID)
	checkStats(pkB64)
	restoredIndexID := getRootIndex(pkB64)
	downloadedIndexJSON := downloadBlob(pkB64, priv, restoredIndexID)
	fmt.Printf("Downloaded Index: %s\n", downloadedIndexJSON)

	var restoredIndex map[string]interface{}
	json.Unmarshal([]byte(downloadedIndexJSON), &restoredIndex)
	fileInfo := restoredIndex["2"].(map[string]interface{})
	fileBlobID := fileInfo["cloud_blob_id"].(string)
	
	downloadedContent := downloadBlob(pkB64, priv, fileBlobID)
	fmt.Printf("Downloaded Content: %s\n", downloadedContent)

	if downloadedContent == "dummy data" {
		fmt.Println("SUCCESS: FULL E2E RESTORATION VERIFIED")
	} else {
		fmt.Println("FAILURE: Content mismatch")
	}
}

func registerDevice(pk string) {
	fmt.Println("Registering device...")
	payload := map[string]string{
		"public_key": pk,
		"name":       "Test Device",
		"os":         "Linux",
	}
	data, _ := json.Marshal(payload)
	res, err := http.Post(backendURL+"/api/vault/register", "application/json", bytes.NewBuffer(data))
	if err != nil {
		fmt.Printf("Registration request failed: %v\n", err)
		return
	}
	if res.StatusCode != 200 {
		fmt.Printf("Registration failed, Status: %d\n", res.StatusCode)
		return
	}
	fmt.Println("Registration success")
}

func uploadBlob(pk string, priv ed25519.PrivateKey, content string) string {
	fmt.Println("Uploading blob...")
	data := []byte(content)
	sig := ed25519.Sign(priv, data)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	req, _ := http.NewRequest("POST", backendURL+"/api/vault/upload", bytes.NewBuffer(data))
	req.Header.Set("X-Desktop-PK", pk)
	req.Header.Set("X-Signature", sigB64)

	client := &http.Client{}
	res, err := client.Do(req)
	if err != nil {
		fmt.Printf("Upload request failed: %v\n", err)
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		body, _ := io.ReadAll(res.Body)
		fmt.Printf("Upload failed, Status: %d, Body: %s\n", res.StatusCode, string(body))
		return ""
	}

	var result map[string]string
	json.NewDecoder(res.Body).Decode(&result)
	return result["blob_id"]
}

func setRootIndex(pk, blobID string) {
	fmt.Println("Setting root index...")
	payload := map[string]string{
		"public_key": pk,
		"blob_id":    blobID,
	}
	data, _ := json.Marshal(payload)
	res, err := http.Post(backendURL+"/api/vault/index", "application/json", bytes.NewBuffer(data))
	if err != nil {
		fmt.Printf("Set root index request failed: %v\n", err)
		return
	}
	if res.StatusCode != 200 {
		fmt.Printf("Set root index failed, Status: %d\n", res.StatusCode)
		return
	}
	fmt.Println("Set root index success")
}

func checkStats(pk string) {
	fmt.Println("Checking stats...")
	u, _ := url.Parse(backendURL + "/api/vault/stats")
	q := u.Query()
	q.Set("public_key", pk)
	u.RawQuery = q.Encode()

	res, err := http.Get(u.String())
	if err != nil {
		fmt.Printf("Stats check request failed: %v\n", err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		fmt.Printf("Stats check failed, Status: %d\n", res.StatusCode)
		return
	}

	var stats map[string]interface{}
	json.NewDecoder(res.Body).Decode(&stats)
	fmt.Printf("Stats response: %+v\n", stats)
}

func downloadBlob(pk string, priv ed25519.PrivateKey, blobID string) string {
	fmt.Printf("Downloading blob %s...\n", blobID)
	sig := ed25519.Sign(priv, []byte(blobID))
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	req, _ := http.NewRequest("GET", backendURL+"/api/vault/download/"+blobID, nil)
	req.Header.Set("X-Desktop-PK", pk)
	req.Header.Set("X-Signature", sigB64)

	client := &http.Client{}
	res, err := client.Do(req)
	if err != nil {
		fmt.Printf("Download request failed: %v\n", err)
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		fmt.Printf("Download failed, Status: %d\n", res.StatusCode)
		return ""
	}

	data, _ := io.ReadAll(res.Body)
	return string(data)
}

func getRootIndex(pk string) string {
	fmt.Println("Getting root index...")
	u, _ := url.Parse(backendURL + "/api/vault/index")
	q := u.Query()
	q.Set("public_key", pk)
	u.RawQuery = q.Encode()

	res, err := http.Get(u.String())
	if err != nil {
		fmt.Printf("Get root index request failed: %v\n", err)
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		fmt.Printf("Get root index failed, Status: %d\n", res.StatusCode)
		return ""
	}

	var result map[string]string
	json.NewDecoder(res.Body).Decode(&result)
	fmt.Printf("Root index blob_id: %s\n", result["blob_id"])
	return result["blob_id"]
}
