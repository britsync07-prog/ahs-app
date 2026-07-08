import sys

with open('vault-desktop-tauri/src/components/DeviceManagement.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Fix import
c = c.replace("import { QRCodeSVG } from 'qrcode.react';", 'import { QRCodeSVG } from "qrcode.react";\nimport { listen } from "@tauri-apps/api/event";')

# Remove the import I wrongly added inside the function
c = c.replace('  import { listen } from "@tauri-apps/api/event";\n', '')

# Fix implicit any for event and f
c = c.replace('const unlistenPairing = listen<{ public_key: string; x_public_key: string }>("pairing-success", async (event) => {', 'const unlistenPairing = listen<{ public_key: string; x_public_key: string }>("pairing-success", async (event: any) => {')
c = c.replace('unlistenPairing.then(f => f());', 'unlistenPairing.then((f: any) => f());')

# Fix unused os parameter
c = c.replace('const handleDelete = async (pk: string, name: string, os: string) => {', 'const handleDelete = async (pk: string, name: string) => {')
c = c.replace('() => handleDelete(device.public_key, device.name, device.os)', '() => handleDelete(device.public_key, device.name)')

with open('vault-desktop-tauri/src/components/DeviceManagement.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
