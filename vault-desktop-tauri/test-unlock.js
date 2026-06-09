const { fetch } = require('@tauri-apps/api/http');
const { invoke } = require('@tauri-apps/api/core');

// We need a way to hit the WebDAV server from Node.
// But the vault needs to be unlocked first.
// I will write a simple Rust test instead.