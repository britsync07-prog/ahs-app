# Vault Mobile App Execution Plan

## Objective
Build the phone app as an **Authenticator + Vault Manager** aligned with `Project Overview-1.pdf`:
- first scan pairs device and completes security setup
- daily unlock uses biometric/PIN approval (not 24-word seed)
- app shows vault operational status (storage, last backup, security state)

## Phase A (Now): Pairing + Security Setup + Unlock Approval
- QR first scan:
  - register pairing with backend
  - force security setup dialog (PIN + seed import + biometric enable)
- Unlock scan:
  - biometric approval (fallback PIN)
  - send unlock approval with `aes_key_b64`
- Acceptance:
  - no 24-word prompt on normal unlock
  - setup is visible and mandatory on first use

## Phase B: Notification-Driven Unlock
- Backend creates unlock request records.
- Mobile receives push notification for pending unlock request.
- Tap notification -> biometric/PIN -> approve/deny.
- Acceptance:
  - unlock works from notification and from in-app pending request list.

## Phase C: Vault Manager Dashboard
- Dashboard cards:
  - vault lock status
  - storage used / total
  - last successful backup timestamp
  - last sync timestamp
- Acceptance:
  - values shown from backend status API, with offline fallback state.

## Phase D: Security Center
- Manage PIN, biometric status, trusted devices, and reset security.
- Acceptance:
  - clear device trust and credential management UX.

## Phase E: Reliability + QA
- Edge cases: reconnect, stale nonce, duplicate scans, offline behavior.
- Acceptance:
  - deterministic state transitions, clean error messages, no dead-end flows.
