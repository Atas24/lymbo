//! Secrets in the OS credential store (Keychain on macOS, Credential Manager
//! on Windows): the Anthropic API key and the Handshake login. Neither ever
//! touches SQLite, logs, or anything sent to the AI.
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.lymbo.app";
const API_KEY: &str = "anthropic-api-key";
const HANDSHAKE: &str = "handshake-login";

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|e| format!("Credential store error: {e}"))
}

fn read(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read from the keychain: {e}")),
    }
}

fn write(account: &str, value: &str) -> Result<(), String> {
    entry(account)?
        .set_password(value)
        .map_err(|e| format!("Could not save to the keychain: {e}"))
}

fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove from the keychain: {e}")),
    }
}

// ---------- Anthropic API key ----------

pub fn get() -> Result<Option<String>, String> {
    read(API_KEY)
}
pub fn set(key: &str) -> Result<(), String> {
    write(API_KEY, key)
}
pub fn remove() -> Result<(), String> {
    delete(API_KEY)
}

// ---------- Handshake login ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct HandshakeLogin {
    pub email: String,
    pub password: String,
    /// "school" = school single sign-on, "handshake" = Handshake's own password.
    pub method: String,
}

pub fn handshake_get() -> Result<Option<HandshakeLogin>, String> {
    match read(HANDSHAKE)? {
        Some(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|_| "Saved Handshake login is unreadable. Re-enter it in KASPR.".into()),
        None => Ok(None),
    }
}
pub fn handshake_set(login: &HandshakeLogin) -> Result<(), String> {
    write(HANDSHAKE, &serde_json::to_string(login).map_err(|e| e.to_string())?)
}
pub fn handshake_remove() -> Result<(), String> {
    delete(HANDSHAKE)
}
