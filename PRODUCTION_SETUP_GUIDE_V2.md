# AHS Vault Desktop - Bulletproof Auto-Update Guide

This guide documents the final, bulletproof auto-update mechanism implemented across the desktop app, the GitHub Action, and the Go backend API. Follow these instructions exactly to release new updates to users seamlessly.

## 1. System Architecture Overview

*   **Frontend (App.tsx)**: On startup, the React app silently queries the backend via the Tauri updater plugin (`check()`). If an update is available, it asks the user. If they agree, it downloads the installer in the background, triggers a silent/passive installation (`installMode: "both"` + NSIS hooks), and then immediately auto-restarts using the `relaunch()` function. No wizard screens.
*   **Tauri Config (tauri.conf.json)**: `plugins.updater.endpoints` points to your backend. `plugins.updater.pubkey` holds the public key (`new.key.pub`).
*   **GitHub Actions (build-windows.yml)**: Uses the `TAURI_SIGNING_PRIVATE_KEY` to cryptographically sign the `.exe` installer. It does **not** look for a password.
*   **Backend API (/api/update)**: Queries GitHub's API to find the latest release, extracts the `.sig` and `.exe` URLs, and formats them perfectly for Tauri's JSON specification.

## 2. Setting Up GitHub Secrets (DO THIS ONCE)

To ensure you never face the password hassle again, your GitHub Repository Secrets must be configured exactly like this:

1.  Navigate to your repository on GitHub.
2.  Go to **Settings** > **Secrets and variables** > **Actions**.
3.  Update or Create the `TAURI_SIGNING_PRIVATE_KEY` secret. Paste in the exact private key below (no extra spaces):

```text
dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5Ti9qNTNEWjllZkY4cU4zM3M3dzFVdFdmaFpHSlMyUHh4VzlZdVF2eXJHTUFBQkFBQUFBQUFBQUFBQUlBQUFBQS9lZ3dLeVB5TlRtOXBqYnI0U0ZkSUJhUWxZbTJsNjY3UGFNc0grbGhTK1lFbnl5VjNSa0lBQUE3TFpaYWhmVmh2eGZkdW0zVFhtNllzbVFFYzFzamRuU2l0ZG5yTE1UVStiQy9zL2VPRVcxZVRWRk45WXNsVEdUOHlrTkpOSG1SMVBCQ1pRUEg3Ums9Cg==
```

4.  **CRITICAL:** Create a new secret called `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and set its value to exactly: `ahs2026`

## 3. How to Release a New Update

When you have modified code and want to push an update out to all your users, follow these exact steps:

1.  **Bump the Version:** Open `vault-desktop-tauri/src-tauri/tauri.conf.json` and change the `"version"` string (e.g., from `"0.1.19"` to `"0.1.20"`). Also bump it in `package.json` for consistency.
2.  **Commit and Push:**
    ```bash
    git add .
    git commit -m "chore: bump version to 0.1.20"
    git push
    ```
3.  **Tag the Release:** GitHub Actions uses tags to trigger a "Release" build.
    ```bash
    git tag v0.1.20
    git push origin v0.1.20
    ```

**What Happens Next?**
1.  GitHub Actions will start building the Windows installer.
2.  It will sign the `.exe` with the passwordless secret (no errors!).
3.  It will upload the `.exe` and `.exe.sig` assets to a new GitHub Release labeled `v0.1.20`.
4.  Your Go backend (`/api/update`) will instantly detect this new GitHub release.
5.  All users who currently have the app open (or the next time they open it) will get the prompt, and the app will flawlessly auto-update in the background and relaunch itself.

## 4. Backend Note on GitHub API Limits
Your backend `HandleUpdate` queries the public GitHub API `https://api.github.com/repos/...` without an authentication token. GitHub limits unauthenticated requests to **60 requests per hour per IP address**. 
*If you expect a lot of users polling this endpoint simultaneously, your backend may get rate-limited by GitHub (returning HTTP 500 to the desktop app).*
**Future Fix:** Consider providing a GitHub Personal Access Token (PAT) as an Authorization header in your `vault-backend-go` `http.Get` request to raise the limit to 5,000 req/hr.
