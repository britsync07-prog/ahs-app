use std::path::PathBuf;

pub fn delete_blobs_direct(config_path: &PathBuf, blob_ids: Vec<String>) -> Result<(), String> {
    if blob_ids.is_empty() { return Ok(()); }
    
    // Read google token from config
    let google_token = if let Ok(content) = std::fs::read_to_string(config_path) {
        if let Ok(config) = serde_json::from_str::<crate::OnboardingConfig>(&content) {
            config.google_access_token
        } else { None }
    } else { None };

    let token = match google_token {
        Some(t) => t,
        None => return Err("Google token not found".to_string()),
    };

    let client = reqwest::blocking::Client::new();
    
    for blob_id in blob_ids {
        // Direct call to Google Drive API
        let mut res = client.delete(format!("https://www.googleapis.com/drive/v3/files/{}", blob_id))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .map_err(|e| e.to_string())?;

        // 401 Unauthorized means token is probably expired
        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            if let Ok(new_token) = crate::oauth::refresh_google_token_blocking(config_path) {
                // Retry with new token
                res = client.delete(format!("https://www.googleapis.com/drive/v3/files/{}", blob_id))
                    .header("Authorization", format!("Bearer {}", new_token))
                    .send()
                    .map_err(|e| e.to_string())?;
            } else {
                return Err("Failed to refresh Google token".to_string());
            }
        }

        // 204 No Content is success for delete. 404 Not Found means it's already gone, which is fine.
        if !res.status().is_success() && res.status() != reqwest::StatusCode::NOT_FOUND {
            eprintln!("Failed to delete blob {} from Google Drive: {}", blob_id, res.status());
        }
    }

    Ok(())
}
