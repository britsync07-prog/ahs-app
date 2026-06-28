# Project: WebAuthn Biometrics with PIN Fallback

## Architecture
This project is the Web Authentication Node of the Zero-Knowledge Biometric Vault. It runs as a React + TypeScript single-page application using Vite and Tailwind CSS.
- **Biometrics Module (`src/hooks/useWebAuthn.ts`)**: Encapsulates WebAuthn registration/authentication using `@simplewebauthn/browser`.
- **UI Screens & Components**:
  - `src/App.tsx`: Main application controller managing app lock state, pairing state, and setup state.
  - `src/components/BiometricPrompt.tsx`: Modular overlay for biometric authentication triggers.
  - `src/components/PinPad.tsx`: Reusable digital keypad for PIN entry/fallback.
  - `src/screens/Settings.tsx`: Security settings screen allowing enrollment/updating of biometrics.
- **Database Layer (`src/lib/db.ts`)**: Dexie.js (IndexedDB) for local secure storage of pairing metadata, PIN hash, and WebAuthn credential IDs/public keys.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Exploration | Analyze codebase structures, browser WebAuthn API limitations, and iOS/Android gesture constraints | None | DONE |
| M2 | Test Design | Author E2E Test Suite and local network test blueprint (`TESTING_MOBILE.md`, `TEST_INFRA.md`) | M1 | DONE |
| M3 | Core Implementation | Implement WebAuthn check, handle gesture preservation, skippable setup (PIN-only), and PIN fallback | M2 | DONE |
| M4 | Validation & Audit | Run Reviewers, Challengers, and Forensic Auditor to ensure zero-knowledge and layout integrity | M3 | DONE |

## Interface Contracts
### `useWebAuthn` API
- `checkWebAuthnSupport()`: `() => Promise<{ supported: boolean, reason?: string, message?: string }>`
  - Evaluates secure context, `PublicKeyCredential` presence, hostname validity (not raw IP address), and platform authenticator availability.
- `registerBiometric(username: string)`: `(username: string) => Promise<{ id: string, publicKey: string } | null>`
- `authenticateBiometric(credentialId: string, challenge: string)`: `(credentialId: string, challenge: string) => Promise<any>`

### `db` Storage Interface
- `db.isBiometricsEnabled()`: `() => Promise<boolean>`
- `db.setBiometricsEnabled(enabled: boolean)`: `(enabled: boolean) => Promise<void>`
- `db.getBiometricCredentialId()`: `() => Promise<string | null>`
- `db.setBiometricCredentialId(id: string)`: `(id: string) => Promise<void>`

## Code Layout
- `vault-web-auth/src/App.tsx`
- `vault-web-auth/src/components/BiometricPrompt.tsx`
- `vault-web-auth/src/components/PinPad.tsx`
- `vault-web-auth/src/hooks/useWebAuthn.ts`
- `vault-web-auth/src/screens/Settings.tsx`
- `vault-web-auth/TESTING_MOBILE.md`
