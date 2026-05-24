---
status: investigating
trigger: "Restore Original Backend Behavior. I broke the desktop app by changing the backend's JSON response keys from CamelCase to snake_case. The desktop app's Rust code strictly requires the original CamelCase keys."
created: 2025-05-18T10:00:00Z
updated: 2025-05-18T10:00:00Z
---

## Current Focus

hypothesis: "Backend response keys changed from CamelCase to snake_case, breaking desktop app integration."
test: "Inspect handlers.go and router.go to verify current response format and routing logic."
expecting: "Findings confirming snake_case keys and modified GetRootIndex logic."
next_action: "Read vault-backend-go/internal/api/handlers.go and vault-backend-go/internal/api/router.go"

## Symptoms

expected: "Backend response for /api/vault/stats uses CamelCase keys. GetRootIndex uses query params."
actual: "Backend uses snake_case keys. GetRootIndex logic likely changed for web-parity."
errors: "Desktop app (Rust) fails to parse JSON responses."
reproduction: "Invoke /api/vault/stats and observe JSON keys."
started: "Recently, during web-parity implementation."

## Eliminated

## Evidence

- timestamp: 2025-05-18T10:10:00Z
  checked: vault-backend-go/internal/api/handlers.go
  found: GetStats already uses CamelCase for most keys, but GetRootIndex has a header fallback.
  implication: GetRootIndex needs to be strictly query-param based.
- timestamp: 2025-05-18T10:12:00Z
  checked: vault-backend-go/internal/db/db.go
  found: GetActivityLogs and GetDevices use snake_case keys (device_public_key, last_active, etc.) which might be part of the "snake_case breakage".
  implication: These should be converted to CamelCase to match original behavior.
- timestamp: 2025-05-18T10:15:00Z
  checked: vault-web-auth/src/screens/Dashboard.tsx and Shield.tsx
  found: Web app expects 'subject' and 'detail' for activity logs, but backend returns 'title' and 'description'.
  implication: Backend should return 'subject' and 'detail' (likely the original keys).

## Resolution

root_cause: "Backend response keys were partially or fully converted to snake_case, and some key names (like title/description) diverged from what the desktop and web apps expect (subject/detail)."
fix: "1. Revert GetStats keys in handlers.go. 2. Restore GetRootIndex to query-param only. 3. Convert all DB-returned map keys to CamelCase. 4. Align activity log keys (title->subject, description->detail)."
