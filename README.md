# AHS Vault
<div align="center">

![License](https://img.shields.io/github/license/britsync07-prog/ahs-app?style=flat-square&label=license&color=06b6d4) ![Language](https://img.shields.io/github/languages/top/britsync07-prog/ahs-app?style=flat-square&color=0ea5e9) ![Stars](https://img.shields.io/github/stars/britsync07-prog/ahs-app?style=flat-square&color=f59e0b) ![Last commit](https://img.shields.io/github/last-commit/britsync07-prog/ahs-app?style=flat-square&color=22c55e) ![Repo size](https://img.shields.io/github/repo-size/britsync07-prog/ahs-app?style=flat-square&color=94a3b8)

</div>

> Zero-knowledge encrypted vault unlocked by your phone and your face - desktop, web, and mobile working as one.

AHS Vault is a cross-platform password/file vault built around a zero-knowledge architecture: files are encrypted client-side before they ever touch the cloud, and unlocking is performed by a paired smartphone or a WebAuthn platform authenticator (Face ID / Touch ID) with a PIN fallback. It targets privacy-conscious individuals and small teams who want a "phone-as-key" experience instead of another master-password prompt.

## Overview

The repository is a four-part monorepo for the "Zero-Knowledge Biometric Vault" product (`com.britsync.ahs-vault`, current release v0.1.20):

- A **Go backend** that acts as a "blind cloud": it stores encrypted blobs in MinIO/S3 plus minimal metadata in PostgreSQL, relays unlock signals over WebSocket, and serves the auto-update feed.
- A **Tauri 2 desktop app** (Windows-focused today) that mounts the vault experience: lock screen, encrypted file explorer, security center, device management, and silent self-updates.
- A **browser-based auth node** (React PWA) implementing WebAuthn registration/authentication with a PIN fallback and local pairing metadata in IndexedDB.
- An **Android companion app** (Kotlin/Compose) that scans QR codes to pair, approves unlocks, and reports threat/shield telemetry.

Status: actively developed and released through GitHub Actions-driven GitHub Releases (v0.1.x series), with a production deployment guide (`PRODUCTION_SETUP_GUIDE_V2.md`) and a live update endpoint wired to `https://ahs.mayfairmarketing.online/api/update`.

## Features

- Zero-knowledge, chunked AES-256-GCM encryption (128 KiB blocks, per-block random nonce, parallelized with Rayon) performed entirely in the Rust core before upload.
- Phone-as-key unlock: the desktop requests an unlock, the backend relays it over WebSocket, and the paired Android app approves it after biometric/PIN confirmation.
- QR-code pairing between desktop and mobile (ML Kit barcode scanning on Android, `html5-qrcode` on the web node).
- WebAuthn platform-authenticator support (Face ID / Touch ID / Windows Hello) with automatic detection of secure-context, RP-ID, and raw-IP limitations (`useWebAuthn.ts`).
- Seamless PIN fallback: cancelled, failed, or unsupported biometrics drop straight to a PIN pad; biometric enrollment itself is skippable (PIN-only mode).
- 24-word BIP39 master recovery phrase with generator, grid display, and import in the Master Recovery Center.
- Device management: register, list, and revoke paired devices, with an activity trail and usage stats served by the backend.
- Threat Shield telemetry: the desktop security center logs blocked-process/threat events to `/api/vault/shield/log`.
- Fully automatic cleanup of orphaned blobs in the background (batched deletions, no manual UI action needed).
- Configurable auto-lock, including locking immediately after long transfers complete.
- Cloud mirroring of encrypted backups to Google Drive and WebDAV targets (`drive_mirror.rs`, `oauth.rs`, backend `gdrive.go`).
- Silent desktop self-updates: Tauri updater checks the backend feed, downloads the signed installer, installs passively via NSIS hooks, and relaunches automatically.
- Multi-device mobile unlocking support (one vault approvable from several phones).
- Local-first web node: pairing metadata, PIN hash, and WebAuthn credential IDs stay in Dexie/IndexedDB, with an installable PWA shell.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop runtime | Tauri 2 (Rust core, NSIS installer, updater plugin) |
| Desktop/frontend language | Rust, TypeScript, React 19, Vite 7, Tailwind CSS 4, Framer Motion |
| Cryptography | AES-256-GCM, X25519 key agreement, Ed25519 signatures, BIP39 mnemonics, `zeroize` key wiping |
| Backend | Go 1.25, chi v5 router, gorilla/websocket, pgx/v5 |
| Metadata store | PostgreSQL 15 (Docker; JSON-file store also available for dev) |
| Blob storage | MinIO (S3-compatible), Google Drive mirror |
| Web auth node | React 19 PWA, `@simplewebauthn/browser`, Dexie (IndexedDB), `@scure/bip39`, `@noble/*` curves |
| Mobile | Kotlin, Jetpack Compose, CameraX, ML Kit Barcode, Tink + Android security-crypto, OkHttp WebSocket |
| CI/CD | GitHub Actions (Windows installer + mobile builds), GitHub Releases, Tauri minisign update signing |
| Infrastructure | Docker Compose (PostgreSQL 15 + MinIO + Go API) |

## Architecture

The system splits responsibilities so the server never can read user data:

1. **Desktop (source of truth for keys).** The Tauri Rust core (`src-tauri/src/crypto.rs`) generates/holds key material locally, encrypts files block-by-block, and only pushes opaque ciphertext. `fs.rs`, `sync.rs`, and `drive_mirror.rs` handle the virtual-vault filesystem and backup mirrors; `shield.rs` feeds the threat dashboard.
2. **Backend (blind storage + signal relay).** `vault-backend-go` exposes `/api/vault/*` (upload, pair, push, register devices, index, stats, activity, delete) and `/api/ws/connect` for real-time unlock signaling. `HandleUpdate` at `/api/update` translates the latest GitHub Release (installer + `.sig`) into the JSON shape the Tauri updater expects.
3. **Web auth node.** A standalone PWA used to pair from a browser: WebAuthn ceremony via `@simplewebauthn/browser`, PIN fallback hashed locally, QR scanning to link a device, and WebSocket listening for unlock challenges (`useWebSocket.ts`).
4. **Android companion.** Scans the pairing QR, keeps secrets in Android Keystore via `security-crypto`/Tink (`SecureStorageManager.kt`), maintains a foreground WebSocket service (`WebSocketService.kt`), and renders dashboards (threat score meter, activity, devices).
5. **Update pipeline.** Tagging `vX.Y.Z` triggers `build-windows.yml`: builds and minisign-signs the NSIS installer, publishes a GitHub Release; the backend feed then offers it to installed apps, which update and relaunch silently.

## Project Structure

```text
ahs-app/
+-- vault-backend-go/        # Go "blind cloud" API
�   +-- cmd/api/             # Server entry point
�   +-- internal/api/        # Chi router, HTTP/WS handlers, /api/update feed
�   +-- internal/auth/       # WebAuthn + cryptographic signaling logic
�   +-- internal/db/         # PostgreSQL repository + JSON store, migrations
�   +-- internal/storage/    # MinIO/S3 adapter, Google Drive mirror
�   +-- internal/websocket/  # Unlock-signal hub
+-- vault-desktop-tauri/     # Desktop client
�   +-- src/                 # React UI: LockScreen, VaultExplorer, SecurityCenter,
�   �                        #   RecoveryCenter, DeviceManagement, AutoLockSettings
�   +-- src-tauri/           # Rust core: crypto.rs, fs.rs, sync.rs,
�                            #   drive_mirror.rs, oauth.rs, shield.rs
+-- vault-web-auth/          # Browser auth node PWA (WebAuthn + PIN + QR pairing)
+-- vault-mobile-auth/       # Android companion app (Kotlin/Compose)
+-- docker-compose.prod.yml  # Production: Go API + postgres:15-alpine
+-- docker-compose.yml       # Dev infrastructure in vault-backend-go
+-- PRODUCTION_SETUP_GUIDE_V2.md  # Bulletproof auto-update release guide
+-- .github/workflows/       # build-windows.yml (signed releases), build-mobile.yml
```

## Getting Started

### Prerequisites

- Go 1.25+ (backend)
- Docker and Docker Compose (PostgreSQL + MinIO)
- Node.js 22 and npm (desktop and web frontends)
- Rust stable toolchain + Tauri 2 CLI (desktop builds)
- Android Studio / SDK 34 with Kotlin (mobile app, minSdk 26)

### Installation

1. Clone the repository and start the backend infrastructure:
   ```bash
   cd vault-backend-go
   cp .env.example .env
   docker compose up -d
   ```
2. Run the Go API:
   ```bash
   go run ./cmd/api
   ```
3. Desktop app (development):
   ```bash
   cd ../vault-desktop-tauri
   npm install
   npm run tauri dev
   ```
4. Web auth node:
   ```bash
   cd ../vault-web-auth
   npm install
   npm run dev
   ```
5. Android app: open `vault-mobile-auth` in Android Studio, or `./gradlew assembleDebug`.

### Environment Variables

| Variable | Purpose | Example placeholder |
|---|---|---|
| `DB_USER` | PostgreSQL user for vault metadata | `vault_admin` |
| `DB_PASSWORD` | PostgreSQL password | `change-me-strong` |
| `DB_NAME` | Metadata database name | `vault_metadata` |
| `DB_PORT` | Host port for PostgreSQL (dev uses 5434) | `5434` |
| `DB_HOST` | Database host inside the network (prod compose sets `db`) | `db` |
| `MINIO_USER` | MinIO root user (dev compose) | `minio_admin` |
| `MINIO_PASSWORD` | MinIO root password | `change-me-strong` |
| `HTTP_ALLOWED_ORIGINS` | Comma-separated CORS origins allowed by the API | `https://vault.example.com` |
| `TAURI_SIGNING_PRIVATE_KEY` | Updater signing key supplied to release CI (store as a GitHub secret) | `(secret)` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing key password for release CI | `(secret)` |

### Running

- Development infrastructure: `docker compose up -d` inside `vault-backend-go` (Postgres on :5434, MinIO API :9000, console :9001).
- Backend API: `go run ./cmd/api` (listens on :8080).
- Desktop: `npm run tauri dev` for hot-reload, `npm run tauri build` for a signed bundle.
- Production backend: `docker compose -f docker-compose.prod.yml up -d --build` from the repo root.
- Release: bump `version` in `tauri.conf.json` and `package.json`, commit, then push a `vX.Y.Z` tag - GitHub Actions builds, signs, and publishes the installer, and running apps pick it up automatically.

## Challenges Faced & Solutions

- **Desktop auto-update trust chain kept breaking** - successive releases failed signature validation because the updater public key, the signing key, and its password strategy drifted apart (see `fix: restore desktop updater trust chain`, `align updater signing key for release`, `resolve signing error by enforcing specific password strategy`). Solution: standardized on one passwordless minisign key pair, pinned its public half in `tauri.conf.json`, enforced a deterministic password strategy in CI, and documented the whole flow in `PRODUCTION_SETUP_GUIDE_V2.md` so future releases are mechanical.
- **Updater fed the wrong artifact type** - the backend initially pointed Tauri at `.zip` bundles while Tauri v2 emits `.nsis.zip`/`.exe` artifacts, causing failed updates (`Update backend HandleUpdate to expect Tauri v2 .exe bundle`, `properly identify Tauri v2 .nsis.zip updater artifacts`). Solution: taught `HandleUpdate` to detect Tauri v2 artifact naming and enabled `createUpdaterArtifacts` so exactly one canonical artifact + `.sig` pair ships per release.
- **Blob cleanup timed out the backend** - purging orphaned blobs in one pass exceeded request timeouts on large vaults. Solution: commit `batch orphaned blob deletions to prevent backend timeout` split deletions into batches in `drive_mirror.rs`, then `make orphaned blob cleanup fully automatic in background` moved the job off the UI entirely and the manual purge button was removed.
- **Auto-lock fought long-running transfers** - the idle timer could lock the vault mid-operation, interrupting large syncs. Solution: `fix auto-lock to lock immediately after long transfers` reworked lock scheduling so transfers suppress the timer and the vault locks deterministically when they finish.
- **Stored state broke across Rust struct changes** - evolving persisted structs deserialized old sessions incorrectly. Solution: `ensure serde struct backward compatibility` added `#[serde(default)]`-style compatibility handling plus a dedicated `test_serde` binary to guard serialization changes in CI.
- **CI failed on clean installs (emnapi)** - the web node's wasm toolchain dependencies were missing from the lockfile, breaking `npm ci` on Cloudflare Pages. Solution: patched emnapi versions into the lockfile and declared `@emnapi/core`, `@emnapi/runtime`, and `@emnapi/wasi-threads` explicitly in `devDependencies`.
- **GitHub API rate limits broke the update feed** - `latest_release.json` captured the rate-limit error response from unauthenticated GitHub API polling behind `/api/update`. Solution: reduced redundant polling, fixed the related Action 403s (`resolve github action 403`), and documented adding an authenticated token for higher limits in the production guide.

## Known Limitations & Roadmap

- Released under the MIT License (see [LICENSE](./LICENSE)).
- The updater signing private key material appears in the workflow file and production guide (see Security Notes); rotating to proper CI secrets is required before open-sourcing.
- Backend CORS currently answers with an `AllowedOrigins: *` wildcard even though a stricter allow-list variable exists.
- `tauri.conf.json` ships with `"csp": null`; a restrictive CSP should be defined before wider distribution.
- iOS is covered indirectly through the web auth node PWA rather than a native app; `build-mobile.yml` covers Android only.
- The update feed relies on unauthenticated GitHub API access (documented 60 req/hr ceiling without a token).
- Test coverage exists for backend handlers, WebAuthn, and Rust integration cases, but desktop UI flows lack automated E2E tests.

## Security Notes

Observed practices: client-side AES-256-GCM with fresh per-block nonces; asymmetric key agreement (X25519) and signatures (Ed25519); BIP39 24-word recovery phrases; `zeroize` for in-memory key wiping; WebAuthn platform authenticators with capability pre-checks; PIN fallback hashed and stored only in local IndexedDB; Android secrets held in Keystore-backed EncryptedSharedPreferences/Tink; blind backend that stores ciphertext and metadata only.

Hygiene warnings (filenames only):

- Private updater signing keys are tracked in git at `vault-desktop-tauri/new.key` and `vault-desktop-tauri/test.key` (with matching `.pub` files).
- `TAURI_SIGNING_PRIVATE_KEY` and its password are hardcoded in `.github/workflows/build-windows.yml` and printed in plaintext in `PRODUCTION_SETUP_GUIDE_V2.md`; both must be moved to GitHub secrets and rotated.
- `logs.txt`, `release.json`, and `latest_release.json` (containing raw GitHub API responses) are committed at the repo root.
- `vault-backend-go/.env.example` ships convenient-but-weak default passwords; change them for any real deployment.

## License

MIT License � Copyright (c) 2026 Musfiqur Rahman Saimon. See [LICENSE](./LICENSE).


---
Keywords: zero-knowledge vault, biometric authentication, webauthn, aes-256-gcm, tauri, rust, security

