import sys

with open('vault-desktop-tauri/src-tauri/src/lib.rs', 'r', encoding='utf-8') as f:
    c = f.read()

struct_old = '''#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct OnboardingConfig {
    pub onboarded: bool,
    pub mnemonic: Option<String>,
    pub mobile_public_key: Option<String>,
    pub mobile_x_public_key: Option<String>,
    pub desktop_signing_key: Option<String>,
    pub desktop_x_secret: Option<String>,
    pub last_blob_id: Option<String>,
    pub last_sync: Option<u64>,
    pub google_access_token: Option<String>,
    pub google_refresh_token: Option<String>,
}'''

struct_new = '''#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct MobileDevice {
    pub name: String,
    pub public_key: String,
    pub x_public_key: String,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct OnboardingConfig {
    pub onboarded: bool,
    pub mnemonic: Option<String>,
    pub mobile_public_key: Option<String>,
    pub mobile_x_public_key: Option<String>,
    pub mobile_devices: Option<Vec<MobileDevice>>,
    pub desktop_signing_key: Option<String>,
    pub desktop_x_secret: Option<String>,
    pub last_blob_id: Option<String>,
    pub last_sync: Option<u64>,
    pub google_access_token: Option<String>,
    pub google_refresh_token: Option<String>,
}'''

c = c.replace(struct_old, struct_new)

with open('vault-desktop-tauri/src-tauri/src/lib.rs', 'w', encoding='utf-8') as f:
    f.write(c)
