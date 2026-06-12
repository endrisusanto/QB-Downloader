use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::{Entry, Error as KeyringError};
use rand::{rngs::OsRng, RngCore};
use thiserror::Error;

const SERVICE: &str = "com.quickbuild.downloader";
const VAULT_KEY_USER: &str = "stronghold-vault-key";

#[derive(Debug, Error)]
pub enum SecureStorageError {
    #[error("OS credential storage is unavailable: {0}")]
    Keyring(String),
}

pub fn get_or_create_vault_password() -> Result<String, SecureStorageError> {
    let entry = Entry::new(SERVICE, VAULT_KEY_USER)
        .map_err(|err| SecureStorageError::Keyring(err.to_string()))?;

    match entry.get_password() {
        Ok(password) if !password.trim().is_empty() => Ok(password),
        Ok(_) | Err(KeyringError::NoEntry) => {
            let mut bytes = [0_u8; 32];
            OsRng.fill_bytes(&mut bytes);
            let password = URL_SAFE_NO_PAD.encode(bytes);
            entry
                .set_password(&password)
                .map_err(|err| SecureStorageError::Keyring(err.to_string()))?;
            Ok(password)
        }
        Err(err) => Err(SecureStorageError::Keyring(err.to_string())),
    }
}
