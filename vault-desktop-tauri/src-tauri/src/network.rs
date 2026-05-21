use crate::SharedKey;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

#[derive(Serialize, Deserialize, Debug)]
struct WsMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pairing_nonce: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_public_key: Option<String>,
    /// AES-256 key encrypted for desktop X25519 public key (base64)
    #[serde(skip_serializing_if = "Option::is_none", alias = "encrypted_blob")]
    pub encrypted_key: Option<String>,
}

pub async fn connect_and_register(
    app: AppHandle,
    public_key: String,
    pairing_nonce: String,
    is_onboarded: bool,
    x_secret: x25519_dalek::StaticSecret,
) {
    let url = "ws://localhost:8080/api/ws/connect";
    let mut retry_delay = std::time::Duration::from_secs(1);

    println!("Ws: Starting connection loop for pk={} nonce={}", public_key, pairing_nonce);

    loop {
        println!("Ws: Attempting connection to {}...", url);

        match connect_async(url).await {
            Ok((ws_stream, _)) => {
                println!("Ws: Connected successfully.");
                retry_delay = std::time::Duration::from_secs(1);

                let (mut write, mut read) = ws_stream.split();

                // 1. Send registration payload
                let reg = WsMessage {
                    msg_type: "desktop_register".to_string(),
                    public_key: Some(public_key.clone()),
                    pairing_nonce: Some(pairing_nonce.clone()),
                    message: None,
                    x_public_key: None,
                    encrypted_key: None,
                };

                let reg_json = serde_json::to_string(&reg).unwrap();
                println!("Ws: Sending registration: {}", reg_json);
                if let Err(e) = write.send(Message::Text(reg_json.into())).await {
                    eprintln!("Ws: Failed to send registration: {}", e);
                    continue;
                }

                // 2. Listen for messages
                while let Some(msg) = read.next().await {
                    match msg {
                        Ok(Message::Text(text)) => {
                            println!("Ws: Received raw text: {}", text);
                            match serde_json::from_str::<WsMessage>(&text) {
                                Ok(ws_msg) => {
                                    handle_server_message(&app, ws_msg, is_onboarded, &x_secret).await;
                                }
                                Err(e) => {
                                    eprintln!("Ws: Failed to parse message: {}. Raw: {}", e, text);
                                }
                            }
                        }
                        Ok(Message::Ping(_)) => {
                            let _ = write.send(Message::Pong(vec![].into())).await;
                        }
                        Ok(m) => {
                            println!("Ws: Received non-text message: {:?}", m);
                        }
                        Err(e) => {
                            eprintln!("Ws: Read error: {}", e);
                            break;
                        }
                    }
                }
                println!("Ws: Connection closed. Reconnecting...");
            }
            Err(e) => {
                eprintln!(
                    "Ws: Connection failed: {}. Retrying in {:?}...",
                    e, retry_delay
                );
            }
        }

        tokio::time::sleep(retry_delay).await;
        retry_delay = std::cmp::min(retry_delay * 2, std::time::Duration::from_secs(30));
    }
}

async fn handle_server_message(
    app: &AppHandle,
    ws_msg: WsMessage,
    _is_onboarded: bool,
    x_secret: &x25519_dalek::StaticSecret,
) {
    println!("Ws: Received message type: {}", ws_msg.msg_type);
    
    if ws_msg.msg_type == "unlock_approved" || ws_msg.msg_type == "push_relay" {
        // If there's an encrypted key, it's a "Magic Unlock" signal for an existing vault
        if let Some(enc_key) = &ws_msg.encrypted_key {
            if enc_key == "WAKE_UP_BIOMETRIC" {
                println!("Ws: Biometric wake-up received (no-op for desktop)");
                return;
            }

            println!("Ws: Processing Magic Unlock signal");
            match crate::crypto::decrypt_relayed_key(enc_key.clone(), x_secret) {
                Ok(key_bytes) => {
                    let key_state = app.state::<SharedKey>().inner().clone();
                    if let Ok(mut storage) = key_state.write() {
                        *storage = Some((key_bytes, None));
                    }
                    let _ = app.emit("vault-do-mount", ());
                }
                Err(e) => {
                    eprintln!("Ws: Failed to decrypt relayed key: {}", e);
                    if let Err(emit_err) = app.emit("security-error", format!("Key Decryption Failed: {}", e)) {
                        eprintln!("Ws: Critical - Failed to emit security-error: {}", emit_err);
                    }
                }
            }
        } else {
            // If no encrypted key, it's a "First-time Setup" or "Re-pairing" signal
            println!("Ws: Processing Pairing Success signal");
            let payload = serde_json::json!({
                "public_key": ws_msg.public_key,
                "x_public_key": ws_msg.x_public_key,
            });
            if let Err(e) = app.emit("pairing-success", payload) {
                eprintln!("Ws: FAILED to emit pairing-success: {}", e);
            } else {
                println!("Ws: Successfully emitted pairing-success to frontend");
            }
        }
    } else {
        println!("Ws: Unhandled message type: {}", ws_msg.msg_type);
    }
}
