use native_tls::TlsConnector;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Debug)]
pub struct ThreatInfo {
    pub vector: String, // "Email" or "File"
    pub subject: String,
    pub detail: String,
    pub risk_level: String, // "High", "Critical"
}

static IS_SHIELD_ACTIVE: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

pub fn start_intelligent_shield(app: AppHandle) {
    let mut active = IS_SHIELD_ACTIVE.lock().unwrap();
    if *active {
        return;
    }
    *active = true;

    // 1. Start Email Shield
    let app_mail = app.clone();
    std::thread::spawn(move || run_mail_shield(app_mail));

    // 2. Start File System Shield (Downloads monitoring)
    let app_file = app.clone();
    std::thread::spawn(move || run_file_shield(app_file));
}

pub fn stop_shield() {
    let mut active = IS_SHIELD_ACTIVE.lock().unwrap();
    *active = false;
    println!("Shield: Intelligent Shield services stopping...");
}

fn run_mail_shield(app: AppHandle) {
    let imap_server =
        env::var("VAULT_IMAP_SERVER").unwrap_or_else(|_| "imap.gmail.com".to_string());
    let imap_port = env::var("VAULT_IMAP_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(993);
    let username = env::var("VAULT_IMAP_USER").ok();
    let password = env::var("VAULT_IMAP_PASS").ok();

    if username.is_none() || password.is_none() {
        println!(
            "Shield: Email monitoring disabled (no credentials provided via environment variables)"
        );
        return;
    }

    let user = username.unwrap();
    let pass = password.unwrap();

    let url_regex = Regex::new(r"https?://[^\s<>]+").unwrap();
    let blocklist = vec![
        "login-update",
        "secure-verify",
        "free-crypto",
        "bit.ly",
        "tinyurl.com",
    ];

    loop {
        {
            let active = IS_SHIELD_ACTIVE.lock().unwrap();
            if !*active {
                break;
            }
        }

        let tls_connector = TlsConnector::builder().build().unwrap();
        if let Ok(client) = imap::connect(
            (imap_server.as_str(), imap_port),
            &imap_server,
            &tls_connector,
        ) {
            if let Ok(mut session) = client.login(&user, &pass) {
                session.select("INBOX").ok();

                if let Ok(mats) = session.search("UNSEEN") {
                    for msg_id in mats.iter() {
                        if let Ok(messages) = session.fetch(msg_id.to_string(), "RFC822") {
                            for message in messages.iter() {
                                let body = String::from_utf8_lossy(message.body().unwrap_or(&[]));
                                let subject = extract_subject(&body);

                                for mat in url_regex.find_iter(&body) {
                                    let url = mat.as_str();
                                    for keyword in &blocklist {
                                        if url.contains(keyword) {
                                            let _ = app.emit(
                                                "threat-detected",
                                                ThreatInfo {
                                                    vector: "Email".to_string(),
                                                    subject: subject.clone(),
                                                    detail: format!(
                                                        "Phishing link detected: {}",
                                                        url
                                                    ),
                                                    risk_level: "High".to_string(),
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                session.logout().ok();
            }
        }
        std::thread::sleep(Duration::from_secs(60));
    }
}

fn run_file_shield(app: AppHandle) {
    let downloads_path = match get_downloads_dir() {
        Some(p) => p,
        None => return,
    };

    let suspicious_extensions = vec!["exe", "bat", "msi", "sh", "scr", "vbs"];

    loop {
        {
            let active = IS_SHIELD_ACTIVE.lock().unwrap();
            if !*active {
                break;
            }
        }

        if let Ok(entries) = std::fs::read_dir(&downloads_path) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let path = entry.path();
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if suspicious_extensions.contains(&ext.to_lowercase().as_str()) {
                                if let Ok(metadata) = entry.metadata() {
                                    if let Ok(created) = metadata.created() {
                                        if created
                                            .elapsed()
                                            .unwrap_or(Duration::from_secs(999))
                                            .as_secs()
                                            < 65
                                        {
                                            let _ = app.emit("threat-detected", ThreatInfo {
                                                vector: "File System".to_string(),
                                                subject: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                                                detail: format!("Suspicious executable detected in Downloads: .{}", ext),
                                                risk_level: "Critical".to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_secs(30));
    }
}

fn get_downloads_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .ok()
            .map(|p| PathBuf::from(p).join("Downloads"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .ok()
            .map(|p| PathBuf::from(p).join("Downloads"))
    }
}

fn extract_subject(body: &str) -> String {
    for line in body.lines() {
        if line.to_lowercase().starts_with("subject:") {
            return line[8..].trim().to_string();
        }
    }
    "Unknown Subject".to_string()
}
