use tiny_http::{Server, Response};
use std::time::Duration;
use url::Url;
use serde_json::Value;
use rand::{thread_rng, Rng};
use rand::distributions::Alphanumeric;

#[derive(serde::Serialize)]
pub struct GoogleTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
}

#[tauri::command]
pub async fn login_google() -> Result<GoogleTokens, String> {
    let client_id = "492554836078-83o35k8ft721nag2h7rbhjlhcj5rselr.apps.googleusercontent.com";
    let client_secret = "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";
    let redirect_uri = "http://localhost:14201/callback";
    
    let state: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=https://www.googleapis.com/auth/drive.file&state={}&access_type=offline&prompt=consent",
        client_id, redirect_uri, state
    );

    webbrowser::open(&auth_url).map_err(|e| e.to_string())?;

    let server = Server::http("127.0.0.1:14201").map_err(|e| e.to_string())?;
    
    // Block and wait for the redirect (timeout after 2 minutes)
    if let Ok(Some(request)) = server.recv_timeout(Duration::from_secs(120)) {
        let url_str = format!("http://localhost:14201{}", request.url());
        let url = Url::parse(&url_str).map_err(|e| e.to_string())?;
        
        let mut code = None;
        let mut received_state = None;

        for (key, value) in url.query_pairs() {
            if key == "code" {
                code = Some(value.to_string());
            } else if key == "state" {
                received_state = Some(value.to_string());
            }
        }

        if received_state.as_deref() != Some(&state) {
            let _ = request.respond(Response::from_string("Error: State mismatch. Possible CSRF attack."));
            return Err("State mismatch".to_string());
        }

        if let Some(auth_code) = code {
            let _ = request.respond(Response::from_string("Success! You can close this window."));
            
            // Exchange code for tokens
            let client = reqwest::Client::new();
            let res = client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", client_id),
                    ("client_secret", client_secret),
                    ("code", &auth_code),
                    ("grant_type", "authorization_code"),
                    ("redirect_uri", redirect_uri),
                ])
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !res.status().is_success() {
                let error_text = res.text().await.unwrap_or_default();
                return Err(format!("Token exchange failed: {}", error_text));
            }

            let tokens: Value = res.json().await.map_err(|e| e.to_string())?;
            
            return Ok(GoogleTokens {
                access_token: tokens["access_token"].as_str().ok_or("Missing access_token")?.to_string(),
                refresh_token: tokens["refresh_token"].as_str().map(|s| s.to_string()),
                expires_in: tokens["expires_in"].as_i64().unwrap_or(3600),
            });
        } else {
            let _ = request.respond(Response::from_string("Error: No code received."));
            return Err("No code received".to_string());
        }
    }
    
    Err("Timeout waiting for authentication".to_string())
}

pub fn refresh_google_token_blocking(config_path: &std::path::PathBuf) -> Result<String, String> {
    let client_id = "492554836078-83o35k8ft721nag2h7rbhjlhcj5rselr.apps.googleusercontent.com";
    let client_secret = "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";
    
    let mut config: crate::OnboardingConfig = if let Ok(content) = std::fs::read_to_string(config_path) {
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("Config not found".to_string());
    };

    let refresh_token = config.google_refresh_token.as_ref().ok_or("No refresh token available")?;

    let client = reqwest::blocking::Client::new();
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Token refresh failed: {}", res.status()));
    }

    let tokens: Value = res.json().map_err(|e| e.to_string())?;
    let new_access_token = tokens["access_token"].as_str().ok_or("Missing access_token")?.to_string();

    // Update config
    config.google_access_token = Some(new_access_token.clone());
    if let Ok(content) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(config_path, content);
    }

    Ok(new_access_token)
}
