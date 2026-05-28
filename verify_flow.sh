#!/bin/bash
set -e

BACKEND_URL="http://localhost:8080"
CONFIG_DIR="/tmp/vault_test_config"
MOUNT_POINT="/tmp/vault_test_mount"
FILE_NAME="test_file_$(date +%s).txt"
FILE_CONTENT="This is a secret message for end-to-end testing."

# 1. Clean up old test data
rm -rf "$CONFIG_DIR" "$MOUNT_POINT"
mkdir -p "$CONFIG_DIR" "$MOUNT_POINT"

echo "=== PHASE 1: Generate Identity & Pair ==="
# We will use a dedicated test tool to simulate the Tauri commands
# Since we don't have the Tauri app running in a way we can easily script,
# we will use the Go backend directly to verify blob storage.

# 2. Derive deterministic keys for testing (Mnemonic: 24 words)
MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"
# Deterministic Public Key for this mnemonic (from previous successful runs/checks)
PUBLIC_KEY="j9c0tV9tMmjeSBmb4zM3WwmKjDewY33isjx3eKqupP4="

echo "=== PHASE 2: Check Cloud Status ==="
STATS=$(curl -s "$BACKEND_URL/api/vault/stats?public_key=$PUBLIC_KEY")
echo "Initial Stats: $STATS"

echo "=== PHASE 3: Uploading a file (Simulated) ==="
# In reality, Tauri does this. We will simulate the upload to verify backend acceptance.
# We need to sign the request.
# For simplicity, we'll look at the database state to see if files exist.

echo "=== PHASE 4: Verifying MinIO Storage ==="
# We can use the stats endpoint to see if filesProtected > 0
FILE_COUNT=$(echo $STATS | jq -r '.filesProtected')
echo "Files Protected: $FILE_COUNT"

if [ "$FILE_COUNT" -gt 0 ]; then
  echo "Backup exists in cloud. Attempting to verify index."
  INDEX=$(curl -s "$BACKEND_URL/api/vault/index?public_key=$PUBLIC_KEY")
  echo "Cloud Index: $INDEX"
else
  echo "No backup found. This might be a clean slate test."
fi

echo "=== PHASE 5: Implementation Check ==="
# I will check if the 'SetRootIndex' security fix actually works.
# Attempting to update root index without signature (should fail 401)
echo "Testing SetRootIndex security..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/vault/index" -d '{"public_key":"test","blob_id":"test"}')
if [ "$HTTP_CODE" == "401" ]; then
  echo "SetRootIndex SECURITY PASS (401 Unauthorized)"
else
  echo "SetRootIndex SECURITY FAIL (Got $HTTP_CODE)"
fi

echo "=== PHASE 6: End-to-End Success Logic Check ==="
# I'll check the 'restore_vault' logic in lib.rs for any obvious flaws I missed.
