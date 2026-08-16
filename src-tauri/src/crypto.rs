use crate::rand;
use crate::rand::Rng;
use crate::util::{bytes_to_hex_string, hex_string_to_bytes};
use aes::Aes256;
use aes_gcm::{AeadInPlace, AesGcm, KeyInit};
use argon2::{Argon2, Params, Version};
use chacha20poly1305::{aead::Aead, ChaCha20Poly1305, Nonce};
use generic_array::{typenum::U16, GenericArray};
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

/// Represents encryption parameters
#[derive(Debug)]
pub struct EncryptionParams {
    pub key: String,   // Hex string
    pub nonce: String, // Hex string
}

/// Legacy hard-coded Argon2 salt used for accounts created before per-device
/// salt support. Kept for U2 migration; do not use for new encryption.
pub const LEGACY_SALT: &[u8] = b"vectovectvecvevpacto";

/// Length of a random key-derivation salt, in bytes.
pub const SALT_LENGTH: usize = 32;

/// Argon2id memory cost in KiB for new accounts. The legacy `hash_pass` used
/// 96000 KiB, so this constant is intentionally not reused for legacy key
/// derivation.
pub const ARGON_MEMORY_KIB: u32 = 96 * 1024;

/// Argon2id memory cost in KiB for legacy accounts (must match the original
/// `hash_pass` setting of 96000 KiB).
const LEGACY_ARGON_MEMORY_KIB: u32 = 96000;

/// Argon2id iteration count for legacy accounts (kept at 4 to match the
/// original `hash_pass` setting and unlock pre-migration data).
const LEGACY_ARGON_ITERATIONS: u32 = 4;

/// Argon2id iteration count for new accounts. Raised to 6 to meet OWASP's
/// minimum recommended cost while keeping desktop unlock fast (~100ms).
pub const ARGON_ITERATIONS: u32 = 6;

/// Argon2id parallelism degree (matches the legacy `hash_pass` setting).
pub const ARGON_PARALLELISM: u32 = 1;

/// Argon2id output key length, in bytes.
pub const ARGON_OUTPUT_LEN: usize = 32;

/// Generates random encryption parameters (key and nonce)
pub fn generate_encryption_params() -> EncryptionParams {
    let mut rng = rand::thread_rng();

    // Generate 32 byte key (for AES-256)
    let key: [u8; 32] = rng.gen();
    // Generate 16 byte nonce (to match 0xChat)
    let nonce: [u8; 16] = rng.gen();

    EncryptionParams {
        key: hex::encode(key),
        nonce: hex::encode(nonce),
    }
}

/// Encrypts data using AES-256-GCM with a 16-byte nonce
pub fn encrypt_data(data: &[u8], params: &EncryptionParams) -> Result<Vec<u8>, String> {
    // Decode key and nonce from hex
    let key_bytes = hex::decode(&params.key).map_err(|e| format!("Invalid key hex: {}", e))?;
    let nonce_bytes =
        hex::decode(&params.nonce).map_err(|e| format!("Invalid nonce hex: {}", e))?;

    // Initialize AES-GCM cipher
    let cipher = AesGcm::<Aes256, U16>::new(GenericArray::from_slice(&key_bytes));

    // Prepare nonce
    let nonce = GenericArray::from_slice(&nonce_bytes);

    // Create output buffer
    let mut buffer = data.to_vec();

    // Encrypt in place and get authentication tag
    let tag = cipher
        .encrypt_in_place_detached(nonce, &[], &mut buffer)
        .map_err(|_| String::from("Failed to Encrypt Data"))?;

    // Append the authentication tag to the encrypted data
    buffer.extend_from_slice(tag.as_slice());

    Ok(buffer)
}

/// Build Argon2id parameters for new accounts.
fn argon2_params() -> Params {
    Params::new(
        ARGON_MEMORY_KIB,
        ARGON_ITERATIONS,
        ARGON_PARALLELISM,
        Some(ARGON_OUTPUT_LEN),
    )
    .expect("valid Argon2 params")
}

/// Build Argon2id parameters for legacy accounts (pre-migration).
fn legacy_argon2_params() -> Params {
    Params::new(
        LEGACY_ARGON_MEMORY_KIB,
        LEGACY_ARGON_ITERATIONS,
        ARGON_PARALLELISM,
        Some(ARGON_OUTPUT_LEN),
    )
    .expect("valid Argon2 params")
}

/// Derive a 32-byte encryption key from a password and a salt using Argon2id.
pub fn derive_key_from_salt(password: &str, salt: &[u8]) -> [u8; 32] {
    let argon = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, argon2_params());
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .expect("Argon2 key derivation should succeed");
    key
}

/// Derive the legacy key for an account still using the hard-coded salt.
pub fn derive_legacy_key(password: &str) -> [u8; 32] {
    let argon = Argon2::new(
        argon2::Algorithm::Argon2id,
        Version::V0x13,
        legacy_argon2_params(),
    );
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), LEGACY_SALT, &mut key)
        .expect("Argon2 legacy key derivation should succeed");
    key
}

/// Generate a fresh random 32-byte salt for key derivation using the OS CSPRNG.
pub fn generate_salt() -> [u8; SALT_LENGTH] {
    let mut salt = [0u8; SALT_LENGTH];
    crate::rand::rngs::OsRng.fill(&mut salt);
    salt
}

/// Return the path to the redundant per-account salt file cache.
/// The file lives next to the SQLite database in the profile directory.
pub fn salt_file_path<R: Runtime>(handle: &AppHandle<R>, npub: &str) -> Result<PathBuf, String> {
    let profile_dir = crate::account_manager::get_profile_directory(handle, npub)?;
    Ok(profile_dir.join("salt.bin"))
}

/// Read the redundant salt file cache, if it exists and is well-formed.
pub fn read_salt_file<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
) -> Result<Option<[u8; SALT_LENGTH]>, String> {
    let path = salt_file_path(handle, npub)?;
    if !path.exists() {
        return Ok(None);
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read salt file: {}", e))?;
    if bytes.len() != SALT_LENGTH {
        return Ok(None);
    }

    let mut salt = [0u8; SALT_LENGTH];
    salt.copy_from_slice(&bytes);
    Ok(Some(salt))
}

/// Write the redundant salt file cache with restricted permissions.
/// Failures are logged as warnings but are not fatal; the settings table is
/// the authoritative source of truth.
pub fn write_salt_file<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
    salt: &[u8; SALT_LENGTH],
) -> Result<(), String> {
    let path = salt_file_path(handle, npub)?;

    std::fs::write(&path, salt).map_err(|e| format!("Failed to write salt file: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&path)
            .map_err(|e| format!("Failed to read salt file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&path, perms)
            .map_err(|e| format!("Failed to set salt file permissions: {}", e))?;
    }

    #[cfg(windows)]
    {
        // Best-effort hidden attribute via the Windows `attrib` utility.
        let path_str = path.to_string_lossy();
        let _ = std::process::Command::new("attrib")
            .arg("+h")
            .arg(path_str.as_ref())
            .output();
    }

    Ok(())
}

/// Low-level ChaCha20-Poly1305 encryption using a 32-byte key.
/// Returns nonce (12 bytes) + ciphertext + tag as a hex string.
pub fn encrypt_with_key(input: &str, key: &[u8; 32]) -> String {
    let mut rng = rand::thread_rng();
    let nonce_bytes: [u8; 12] = rng.gen();

    let cipher = ChaCha20Poly1305::new_from_slice(key).expect("Key should be valid");
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, input.as_bytes())
        .expect("Encryption should not fail");

    let mut buffer = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    buffer.extend_from_slice(&nonce_bytes);
    buffer.extend_from_slice(&ciphertext);

    bytes_to_hex_string(&buffer)
}

/// Low-level ChaCha20-Poly1305 decryption using a 32-byte key.
pub fn decrypt_with_key(ciphertext: &str, key: &[u8; 32]) -> Result<String, ()> {
    let encrypted_data = hex_string_to_bytes(ciphertext);
    if encrypted_data.len() < 12 {
        return Err(());
    }

    let (nonce_bytes, actual_ciphertext) = encrypted_data.split_at(12);

    let cipher = match ChaCha20Poly1305::new_from_slice(key) {
        Ok(c) => c,
        Err(_) => return Err(()),
    };

    let plaintext = match cipher.decrypt(Nonce::from_slice(nonce_bytes), actual_ciphertext) {
        Ok(pt) => pt,
        Err(_) => return Err(()),
    };

    // SAFETY: plaintext originates from a valid UTF-8 string that was encrypted.
    unsafe { Ok(String::from_utf8_unchecked(plaintext)) }
}

/// Internal function for encryption logic using ChaCha20Poly1305.
/// Uses the session encryption key; callers must set the key first via
/// `set_encryption_key` or the password-based encrypt helpers.
pub async fn internal_encrypt(input: String) -> String {
    let key = crate::current_encryption_key().expect("Encryption key should be set");
    encrypt_with_key(&input, &key)
}

/// Internal function for decryption logic using ChaCha20Poly1305.
/// Uses the session encryption key; callers must set the key first.
pub async fn internal_decrypt(ciphertext: String) -> Result<String, ()> {
    let key = crate::current_encryption_key().ok_or(())?;
    decrypt_with_key(&ciphertext, &key)
}

/// AES-256 key length, in bytes: `Aes256`'s fixed key size. `pub(crate)` so
/// callers that must validate before ever reaching `decrypt_data` (e.g. the
/// sticker fetch path, before issuing a network request) can check the same
/// bound instead of duplicating a literal.
pub(crate) const AES_KEY_LEN: usize = 32;

/// AES-GCM nonce length, in bytes: the `U16` nonce size parameter used here.
pub(crate) const AES_NONCE_LEN: usize = 16;

pub fn decrypt_data(
    encrypted_data: &[u8],
    key_hex: &str,
    nonce_hex: &str,
) -> Result<Vec<u8>, String> {
    // Verify minimum size requirements (need at least 16 bytes for the authentication tag)
    if encrypted_data.len() < 16 {
        return Err(format!("Invalid Input: encrypted data too small ({} bytes, minimum 16 bytes required for authentication tag)", encrypted_data.len()));
    }

    // Decode key and nonce from hex
    let key_bytes = hex::decode(key_hex).map_err(|e| format!("Invalid key hex: {}", e))?;
    let nonce_bytes = hex::decode(nonce_hex).map_err(|e| format!("Invalid nonce hex: {}", e))?;

    // `GenericArray::from_slice` below panics unless the decoded length matches
    // exactly, and this data can come straight from an attacker-controlled MLS
    // announce, so reject bad lengths here instead of ever reaching it.
    if key_bytes.len() != AES_KEY_LEN {
        return Err(format!(
            "Invalid key hex: expected {} bytes, got {}",
            AES_KEY_LEN,
            key_bytes.len()
        ));
    }
    if nonce_bytes.len() != AES_NONCE_LEN {
        return Err(format!(
            "Invalid nonce hex: expected {} bytes, got {}",
            AES_NONCE_LEN,
            nonce_bytes.len()
        ));
    }

    // Split input into ciphertext and authentication tag
    let (ciphertext, tag_bytes) = encrypted_data.split_at(encrypted_data.len() - 16);

    // Initialize AES-GCM cipher
    let cipher = AesGcm::<Aes256, U16>::new(GenericArray::from_slice(&key_bytes));

    // Prepare nonce and tag
    let nonce = GenericArray::from_slice(&nonce_bytes);
    let tag = aes_gcm::Tag::from_slice(tag_bytes);

    // Create output buffer
    let mut buffer = ciphertext.to_vec();

    // Perform decryption
    let decryption = cipher.decrypt_in_place_detached(nonce, &[], &mut buffer, tag);

    // Check that it went well
    if decryption.is_err() {
        return Err(decryption.unwrap_err().to_string());
    }

    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use argon2::{Argon2, Version};

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Runtime::new().expect("tokio runtime")
    }

    #[test]
    fn generate_params_has_valid_hex_lengths() {
        let params = generate_encryption_params();
        assert_eq!(params.key.len(), 64, "32-byte key = 64 hex chars");
        assert_eq!(params.nonce.len(), 32, "16-byte nonce = 32 hex chars");
        assert!(hex::decode(&params.key).is_ok());
        assert!(hex::decode(&params.nonce).is_ok());
    }

    #[test]
    fn aes_gcm_round_trip() {
        let params = EncryptionParams {
            key: hex::encode([0u8; 32]),
            nonce: hex::encode([0u8; 16]),
        };
        let plaintext = b"hello pacto";
        let encrypted = encrypt_data(plaintext, &params).expect("encrypt");
        assert!(!encrypted.is_empty());
        let decrypted = decrypt_data(&encrypted, &params.key, &params.nonce).expect("decrypt");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_rejects_too_short_input() {
        let result = decrypt_data(&[0u8; 15], &hex::encode([0u8; 32]), &hex::encode([0u8; 16]));
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_rejects_wrong_tag() {
        let params = EncryptionParams {
            key: hex::encode([0u8; 32]),
            nonce: hex::encode([0u8; 16]),
        };
        let mut encrypted = encrypt_data(b"hello", &params).expect("encrypt");
        let last = encrypted.len() - 1;
        encrypted[last] ^= 0xff;
        let result = decrypt_data(&encrypted, &params.key, &params.nonce);
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_rejects_invalid_key_hex() {
        let result = decrypt_data(&[0u8; 32], "not-hex", &hex::encode([0u8; 16]));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid key hex"));
    }

    #[test]
    fn decrypt_rejects_invalid_nonce_hex() {
        let result = decrypt_data(&[0u8; 32], &hex::encode([0u8; 32]), "not-hex");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid nonce hex"));
    }

    #[test]
    fn decrypt_rejects_empty_key() {
        let params = EncryptionParams {
            key: hex::encode([0u8; 32]),
            nonce: hex::encode([0u8; 16]),
        };
        let encrypted = encrypt_data(b"hello", &params).expect("encrypt");
        // An empty key hex decodes to zero bytes; must not panic in
        // `GenericArray::from_slice`.
        let result = decrypt_data(&encrypted, "", &params.nonce);
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_rejects_short_key() {
        let params = EncryptionParams {
            key: hex::encode([0u8; 32]),
            nonce: hex::encode([0u8; 16]),
        };
        let encrypted = encrypt_data(b"hello", &params).expect("encrypt");
        // "aa" is valid hex but decodes to a single byte, far short of the
        // 32-byte AES-256 key.
        let result = decrypt_data(&encrypted, "aa", &params.nonce);
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_rejects_short_nonce() {
        let params = EncryptionParams {
            key: hex::encode([0u8; 32]),
            nonce: hex::encode([0u8; 16]),
        };
        let encrypted = encrypt_data(b"hello", &params).expect("encrypt");
        let result = decrypt_data(&encrypted, &params.key, "bb");
        assert!(result.is_err());
    }

    #[test]
    fn encrypt_data_rejects_invalid_key_hex() {
        let params = EncryptionParams {
            key: "not-hex".to_string(),
            nonce: hex::encode([0u8; 16]),
        };
        let result = encrypt_data(b"hello", &params);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid key hex"));
    }

    #[test]
    fn encrypt_data_rejects_invalid_nonce_hex() {
        let params = EncryptionParams {
            key: hex::encode([0u8; 32]),
            nonce: "not-hex".to_string(),
        };
        let result = encrypt_data(b"hello", &params);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid nonce hex"));
    }

    #[test]
    fn derive_legacy_key_is_deterministic() {
        let first = derive_legacy_key("pacto-secret");
        let second = derive_legacy_key("pacto-secret");
        assert_eq!(first, second);
    }

    #[test]
    fn derive_key_is_deterministic() {
        let salt = generate_salt();
        let first = derive_key_from_salt("pacto-secret", &salt);
        let second = derive_key_from_salt("pacto-secret", &salt);
        assert_eq!(first, second);
    }

    #[test]
    fn derive_legacy_key_matches_old_hash_pass() {
        let expected = rt().block_on(hash_pass("pacto-secret".to_string()));
        let actual = derive_legacy_key("pacto-secret");
        assert_eq!(actual, expected);
    }

    #[test]
    fn different_salts_produce_different_keys() {
        let salt1 = generate_salt();
        let salt2 = generate_salt();
        assert_ne!(salt1, salt2);

        let key1 = derive_key_from_salt("pacto-secret", &salt1);
        let key2 = derive_key_from_salt("pacto-secret", &salt2);
        assert_ne!(key1, key2);
    }

    #[test]
    fn generate_salt_is_random() {
        let salt1 = generate_salt();
        let salt2 = generate_salt();
        assert_ne!(salt1, salt2);
    }

    #[test]
    fn chacha_round_trip_with_key() {
        let key = derive_legacy_key("password");
        let ciphertext = encrypt_with_key("plaintext message", &key);
        assert!(!ciphertext.is_empty());
        let decrypted = decrypt_with_key(&ciphertext, &key);
        assert_eq!(decrypted.expect("decrypt"), "plaintext message");
    }

    #[test]
    fn chacha_decrypt_rejects_wrong_key() {
        let key = derive_legacy_key("password");
        let ciphertext = encrypt_with_key("plaintext message", &key);
        let wrong_key = derive_legacy_key("wrong");
        let decrypted = decrypt_with_key(&ciphertext, &wrong_key);
        assert!(decrypted.is_err());
    }

    #[test]
    fn chacha_decrypt_rejects_short_ciphertext() {
        let key = derive_legacy_key("password");
        let decrypted = decrypt_with_key("0x00", &key);
        assert!(decrypted.is_err());
    }

    #[test]
    fn chacha_decrypt_rejects_malformed_hex() {
        let key = derive_legacy_key("password");
        let decrypted = decrypt_with_key("not-hex", &key);
        assert!(decrypted.is_err());
    }

    #[test]
    fn salt_file_round_trip() {
        let app = tauri::test::mock_app();
        let npub = "npub1saltroundtrip";
        let salt = generate_salt();
        write_salt_file(app.handle(), npub, &salt).unwrap();
        let read = read_salt_file(app.handle(), npub).unwrap();
        assert_eq!(read, Some(salt));
    }

    #[test]
    fn salt_file_returns_none_when_missing() {
        let app = tauri::test::mock_app();
        let npub = "npub1saltmissing";
        let read = read_salt_file(app.handle(), npub).unwrap();
        assert_eq!(read, None);
    }

    // Legacy `hash_pass` retained as a private golden vector for the hard-coded
    // salt path. It intentionally replicates the original v0.2.0 parameters
    // (96000 KiB, 4 iterations) rather than delegating to legacy_argon2_params(),
    // so it acts as a regression test against the real historical derivation.
    async fn hash_pass(password: String) -> [u8; 32] {
        let salt = LEGACY_SALT;
        let params = Params::new(96000, 4, 1, Some(32)).expect("valid params");
        let argon = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params);
        let mut key = [0u8; 32];
        argon
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .unwrap();
        key
    }
}
