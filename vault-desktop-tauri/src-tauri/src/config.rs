pub const PRODUCTION_DOMAIN: &str = "ahs.mayfairmarketing.online";

pub fn get_backend_url() -> String {
    format!("https://{}", PRODUCTION_DOMAIN)
}

pub fn get_ws_url() -> String {
    format!("wss://{}/api/ws/connect", PRODUCTION_DOMAIN)
}
