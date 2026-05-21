pub const PRODUCTION_DOMAIN: &str = "ahs.mayfairmarketing.online";

pub fn get_backend_url() -> String {
    if cfg!(debug_assertions) {
        "http://localhost:8080".to_string()
    } else {
        format!("https://{}", PRODUCTION_DOMAIN)
    }
}

pub fn get_ws_url() -> String {
    if cfg!(debug_assertions) {
        "ws://localhost:8080/api/ws/connect".to_string()
    } else {
        format!("wss://{}/api/ws/connect", PRODUCTION_DOMAIN)
    }
}
