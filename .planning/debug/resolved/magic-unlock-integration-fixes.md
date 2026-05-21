---
status: investigating
trigger: "Fix the integration breaks discovered in the Magic Unlock Flow:\n1. Backend (vault-backend-go/internal/api/handlers.go): Update verifyMobileSignature to use Ed25519 instead of ECDSA to match the new mobile hardware key logic.\n2. Backend (vault-backend-go/internal/api/handlers.go): Ensure the signaling relay preserves the 'signature' and 'nonce' fields when sending messages to the Desktop.\n3. Desktop (vault-desktop-tauri/src/App.tsx): Add a listener for security/authorization errors to prevent the UI from hanging when unlock fails.\n\nVerify that the backend now correctly handles Ed25519 signatures and that the desktop receives all necessary metadata."
created: 2025-05-15T12:00:00Z
updated: 2025-05-15T12:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "Magic Unlock flow breaks because of Ed25519/ECDSA mismatch in mobile signature verification, missing nonce/signature fields in the backend relay, and lack of error handling in the desktop UI when verification fails."
  confirming_evidence:
    - "handlers.go:verifyMobileSignature currently uses ecdsa package."
    - "handlers.go:RelayPush only sends type and encrypted_blob, missing signature and pairing_nonce."
    - "network.rs:handle_server_message emits 'security-error' on signature failure, but App.tsx has no listener for it."
  falsification_test: "Applying the changes should allow Magic Unlock to proceed with Ed25519 signatures and the Desktop UI should show an error message instead of hanging if verification fails."
  fix_rationale: "Aligning crypto algorithms, ensuring data persistence through the relay, and adding UI error handling addresses all identified breaks."
  blind_spots: "Potential issues with base64 encoding/decoding consistency between mobile and backend."

next_action: "Update vault-backend-go/internal/api/handlers.go to use Ed25519 for mobile signature verification and preserve fields in RelayPush."

## Symptoms

expected: "Backend verifies Ed25519 signatures, preserves all fields in relay, and Desktop UI handles errors gracefully."
actual: "Backend likely uses ECDSA, relay drops fields, and Desktop hangs on error."
errors: "Signature verification failures or hung UI."
reproduction: "Run Magic Unlock flow with Ed25519 mobile keys."
started: "After mobile hardware key logic update."

## Eliminated

## Evidence

- timestamp: 2025-05-15T12:10:00Z
  checked: vault-backend-go/internal/api/handlers.go
  found: verifyMobileSignature uses ecdsa package and RelayPush drops signature/nonce fields.
  implication: Confirmed backend-side breaks.
- timestamp: 2025-05-15T12:12:00Z
  checked: vault-desktop-tauri/src/App.tsx
  found: No listener for 'security-error' event.
  implication: Confirmed desktop-side break.
## Resolution

root_cause: "Incompatibility between backend crypto and mobile hardware keys (ECDSA vs Ed25519), missing fields in the backend's signaling relay, and lack of UI feedback for security errors on the Desktop."
fix: "1. Updated handlers.go to use ed25519.Verify for mobile signatures. 2. Enhanced RelayPush in handlers.go to include 'signature' and 'pairing_nonce' in the relayed message. 3. Added a 'security-error' event listener in App.tsx to display error messages and reset the waiting state."
verification: "Verified that both vault-backend-go and vault-desktop-tauri compile successfully after the changes. Verified that the field names in the relayed message match the expected names in the Desktop's network.rs."
files_changed: ["vault-backend-go/internal/api/handlers.go", "vault-desktop-tauri/src/App.tsx"]
