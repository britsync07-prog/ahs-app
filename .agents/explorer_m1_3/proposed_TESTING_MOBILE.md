# Testing Guidelines: WebAuthn Mobile Compatibility & PIN Fallback

This document describes how to test and verify iOS/Safari WebAuthn compatibility, strict user activation gesture handling, and PIN fallback mechanisms within the Web Authentication Node of the Zero-Knowledge Biometric Vault.

---

## 1. Secure Context & Local Network Hosting (HTTPS)

WebAuthn requires a **Secure Context** (`window.isSecureContext === true`). On mobile devices, this means the page must be served over `https://` (except for `localhost`, which is generally inaccessible directly from a separate mobile device).

### Option A: Local Tunneling (Recommended)
The easiest way to expose your local Vite dev server over HTTPS to a mobile device is using a tunnel tool:
1. Start the Vite development server:
   ```bash
   npm run dev
   ```
2. In another terminal, start `ngrok` or `localtunnel` pointing to Vite's port (default `5173`):
   ```bash
   npx localtunnel --port 5173
   ```
   or
   ```bash
   ngrok http 5173
   ```
3. Open the secure URL (e.g., `https://xxxx.localtunnel.me`) on your iOS device.

### Option B: Local HTTPS with self-signed certificates & Custom Domain (mkcert)
WebAuthn does **not** allow raw IP address hostnames (e.g., `https://192.168.1.50:5173`) as RP IDs. You must use a local hostname.
1. Generate local certs using `mkcert`:
   ```bash
   mkcert -install
   mkcert local.dev
   ```
2. Configure Vite in `vite.config.ts` to use HTTPS:
   ```typescript
   import fs from 'fs';
   // ...
   server: {
     https: {
       key: fs.readFileSync('./local.dev-key.pem'),
       cert: fs.readFileSync('./local.dev.pem'),
     },
     host: '0.0.0.0'
   }
   ```
3. On your mobile device, configure DNS or use a service like `nip.io` (e.g., `https://192.168.1.50.nip.io:5173`) and install/trust the `mkcert` root CA on iOS.

---

## 2. Verifying iOS/Safari User Gesture Preservation

Safari blocks WebAuthn requests if there are asynchronous operations (e.g. database reads, API requests) between the user's tap and the WebAuthn API call.

### Test Procedure:
1. Trigger a remote unlock request (Magic Unlock) from the desktop app.
2. The mobile app displays the "Identity Verification Required" dialog.
3. Tap **Verify Identity**.
4. **Pass Criteria**:
   - The native iOS FaceID/TouchID prompt appears immediately.
   - Console logs do not show `NotAllowedError`.
5. **Fail Criteria (Gesture Broken)**:
   - The FaceID/TouchID prompt does not appear.
   - The console reports: `NotAllowedError: The operation either timed out or was not allowed.`

### Simulating Gesture Loss:
To prove that pre-fetching state fixes the issue, try adding a 100ms artificial delay in `handleApproveUnlock` before the WebAuthn call:
```typescript
await new Promise(resolve => setTimeout(resolve, 100));
```
Verify that Safari now rejects the biometric request. Remove the delay to restore functionality.

---

## 3. Testing PIN Fallback Scenarios

### Scenario A: Biometrics Disabled/Skipped
1. Wipe database or start fresh.
2. During Security Setup, tap **Skip / PIN Only**.
3. Once completed, lock the app.
4. Tapping **Unlock Vault** should bypass the biometric check and show the PIN Pad immediately.
5. Send a remote unlock request (Magic Unlock). The mobile app should show the PIN Pad immediately without displaying the biometric prompt.

### Scenario B: User Cancels Biometric Dialog
1. Ensure biometrics are enabled and enrolled.
2. Trigger an app unlock or a remote unlock approval.
3. When the iOS FaceID/TouchID prompt appears, tap **Cancel** or double-tap away to dismiss it.
4. **Expected Behavior**:
   - The app instantly transitions to show the PIN Pad fallback overlay.
   - The user can enter their PIN to successfully complete the unlock/approval.

### Scenario C: Unsupported Environments (e.g., HTTP / IP hostnames)
1. Access the web app over HTTP or via a raw IP address (e.g. `http://192.168.1.50:5173`).
2. Go to Security Setup.
3. **Expected Behavior**:
   - The app detects that WebAuthn is unsupported.
   - It displays a descriptive message explaining the reason (e.g., "WebAuthn cannot be used with an IP address hostname").
   - It only displays the "Complete Setup (PIN Only)" button.
   - No biometric enrollment option is present.

---

## 4. Mobile Debugging Tools

### Inspecting Safari on iOS (macOS host)
1. Connect the iOS device via USB.
2. On iOS: Go to **Settings > Safari > Advanced** and turn on **Web Inspector**.
3. On macOS: Open **Safari**, go to **Develop > [Your iPhone Name] > [Your Vault Web Page]**.
4. You can inspect the console, network requests, and the IndexedDB database (`VaultAuthDB`) under the **Storage** tab.

### Inspecting on Windows (using Chrome/Edge tools)
1. Install and run `remotedebug-ios-webkit-adapter` on your PC, or
2. Use a browser tool like [Inspect](https://inspect.dev/) or [Vorlon.js].
