const fs = require('fs');

// 1. Cargo.toml
let cargo = fs.readFileSync('vault-desktop-tauri/src-tauri/Cargo.toml', 'utf8');
if (!cargo.includes('tauri-plugin-process')) {
    cargo = cargo.replace('tauri-plugin-updater = "2"', 'tauri-plugin-updater = "2"\ntauri-plugin-process = "2"');
    fs.writeFileSync('vault-desktop-tauri/src-tauri/Cargo.toml', cargo);
}

// 2. lib.rs
let librs = fs.readFileSync('vault-desktop-tauri/src-tauri/src/lib.rs', 'utf8');
if (!librs.includes('tauri_plugin_process::init()')) {
    librs = librs.replace('.plugin(tauri_plugin_updater::Builder::new().build())', '.plugin(tauri_plugin_updater::Builder::new().build())\n        .plugin(tauri_plugin_process::init())');
    fs.writeFileSync('vault-desktop-tauri/src-tauri/src/lib.rs', librs);
}

// 3. App.tsx
let apptsx = fs.readFileSync('vault-desktop-tauri/src/App.tsx', 'utf8');
if (!apptsx.includes('import { relaunch }')) {
    apptsx = apptsx.replace('import { check } from "@tauri-apps/plugin-updater";', 'import { check } from "@tauri-apps/plugin-updater";\nimport { relaunch } from "@tauri-apps/plugin-process";');
    apptsx = apptsx.replace('await message("Update installed successfully. Please close and reopen the app.", { title: \'Update Complete\', kind: \'info\' });', 'await relaunch();');
    fs.writeFileSync('vault-desktop-tauri/src/App.tsx', apptsx);
}
