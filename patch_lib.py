import sys
import re

with open('vault-desktop-tauri/src-tauri/src/lib.rs', 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Update push logic
old_push_logic = '''    let target_pk = if let Some(pk) = config.mobile_public_key {
        pk
    } else {
        let (_, pk) = get_or_create_signing_key_at(path);
        pk
    };

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/vault/push", crate::config::get_backend_url()))
        .json(&serde_json::json!({
            "target_public_key": target_pk,
            "encrypted_blob": "WAKE_UP_BIOMETRIC"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Push request failed: {}", res.status()))
    }'''

new_push_logic = '''    let mut target_pks = Vec::new();
    if let Some(pk) = config.mobile_public_key {
        target_pks.push(pk);
    }
    if let Some(devices) = config.mobile_devices {
        for d in devices {
            target_pks.push(d.public_key);
        }
    }
    
    if target_pks.is_empty() {
        let (_, pk) = get_or_create_signing_key_at(path);
        target_pks.push(pk);
    }

    let client = reqwest::Client::new();
    let mut any_success = false;
    for target_pk in target_pks {
        let res = client
            .post(format!("{}/api/vault/push", crate::config::get_backend_url()))
            .json(&serde_json::json!({
                "target_public_key": target_pk,
                "encrypted_blob": "WAKE_UP_BIOMETRIC"
            }))
            .send()
            .await;
        if let Ok(r) = res {
            if r.status().is_success() {
                any_success = true;
            }
        }
    }

    if any_success {
        Ok(())
    } else {
        Err("Push request failed for all devices".to_string())
    }'''

c = c.replace(old_push_logic, new_push_logic)

# 2. Add commands
new_commands = '''#[tauri::command]
fn get_mobile_devices(app: AppHandle) -> Result<Vec<MobileDevice>, String> {
    let path = get_config_path(&app);
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(config) = serde_json::from_str::<OnboardingConfig>(&content) {
            let mut devices = config.mobile_devices.unwrap_or_default();
            if let Some(pk) = config.mobile_public_key {
                if let Some(x_pk) = config.mobile_x_public_key {
                    if !devices.iter().any(|d| d.public_key == pk) {
                        devices.push(MobileDevice { name: "Primary Device".to_string(), public_key: pk, x_public_key: x_pk });
                    }
                }
            }
            return Ok(devices);
        }
    }
    Ok(vec![])
}

#[tauri::command]
fn remove_mobile_device(app: AppHandle, public_key: String) -> Result<(), String> {
    let path = get_config_path(&app);
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Err("No config found".to_string());
    };
    
    if config.mobile_public_key == Some(public_key.clone()) {
        config.mobile_public_key = None;
        config.mobile_x_public_key = None;
    }
    
    if let Some(mut devices) = config.mobile_devices {
        devices.retain(|d| d.public_key != public_key);
        config.mobile_devices = Some(devices);
    }
    
    let content = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn add_mobile_device(
    app: AppHandle,
    name: String,
    mobile_public_key: String,
    mobile_x_public_key: String,
) -> Result<(), String> {
    let path = get_config_path(&app);
    let mut config: OnboardingConfig = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        OnboardingConfig::default()
    };
    
    let device = MobileDevice {
        name,
        public_key: mobile_public_key.clone(),
        x_public_key: mobile_x_public_key.clone(),
    };
    
    let mut devices = config.mobile_devices.unwrap_or_default();
    devices.push(device);
    config.mobile_devices = Some(devices);
    
    let content = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn check_onboarding'''

c = c.replace('#[tauri::command]\nfn check_onboarding', new_commands)

with open('vault-desktop-tauri/src-tauri/src/lib.rs', 'w', encoding='utf-8') as f:
    f.write(c)
