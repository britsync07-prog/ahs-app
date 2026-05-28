# Windows Setup Guide for Vault Desktop

This guide covers how to install, build, and use the Vault Desktop application on Windows 10 and 11.

## 1. Prerequisites (For Users)
To run the Vault Desktop application, you need:
- **WebView2 Runtime**: Most Windows 10 and 11 systems have this built-in. If the app fails to launch, download it from [Microsoft's website](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

## 2. Prerequisites (For Developers/Building from Source)
If you are building the application yourself, you need:
- **Rust**: Install via [rustup.rs](https://rustup.rs/).
- **Node.js**: Version 18 or higher.
- **Microsoft C++ Build Tools**: 
    1. Download the [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
    2. Select the "Desktop development with C++" workload.
    3. Ensure "MSVC v143 - VS 2022 C++ x64/x86 build tools" and "Windows 11 SDK" (or 10) are selected.

## 3. Installation Steps
1.  **Download**: Locate the `.msi` or `.exe` installer from the latest release.
2.  **Install**: Double-click the installer and follow the prompts.
3.  **Launch**: Open "Vault" from your Start Menu.
4.  **Pairing**:
    - Ensure your mobile device has the **Vault Mobile App** installed.
    - Scan the QR code displayed on your desktop with your phone.
    - Follow the prompts on your phone to establish hardware trust.

## 4. Background Operation (System Tray)
The Vault application is designed to run in the background to maintain your secure RAM-drive.
- **Minimize/Close**: Clicking the 'X' or minimize button will keep the app running in your system tray.
- **Re-open**: Double-click the Vault icon in the system tray or right-click and select "Show Vault".
- **Quit**: To fully exit, right-click the tray icon and select "Quit Vault".

## 5. Troubleshooting
- **Drive not mounting**: Ensure no other process is using `C:\Vault`.
- **Mica Effect missing**: Mica is only supported on Windows 11. On Windows 10, the app will fall back to a solid dark background.
- **Network issues**: Ensure the desktop and mobile are on the same local network or can reach the backend server.
