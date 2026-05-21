# Vault Desktop (Tauri)

A zero-knowledge, biometric-authenticated secure vault for your desktop.

## Getting Started

### Windows Users
Please refer to the [WINDOWS_SETUP.md](./WINDOWS_SETUP.md) for detailed installation and prerequisite information.

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production (Windows)
npm run tauri build
```

The production build will generate an `.msi` and `.exe` installer in `src-tauri/target/release/bundle/`.

## Key Features
- **Zero-Knowledge Architecture**: Encryption keys never leave your devices.
- **Biometric "Magic Unlock"**: Use your phone's biometrics to unlock your desktop vault.
- **RAM-Only Decryption**: Sensitive files are mounted in a virtual drive strictly in memory.
- **Windows 11 Optimization**: Premium Mica aesthetics and System Tray integration.
