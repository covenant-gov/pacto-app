//! Squad-owned sticker packs: the image asset pipeline and the four pack commands
//! exposed to the frontend. Pack rows and MLS announce ingestion live in `db.rs`;
//! this module owns encrypt/upload/fetch and command wiring only. A pack's wire
//! state travels as an MLS announce sent from the frontend (see
//! `src/lib/announcements.ts`); Rust only persists and serves it.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::crypto::{self, EncryptionParams};
use crate::db;
use crate::util;

/// One sticker image within a pack. `key`/`nonce` are hex, exactly as
/// `crypto::EncryptionParams` produces them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerEntry {
    pub shortcode: String,
    pub url: String,
    pub key: String,
    pub nonce: String,
    pub mime: String,
    pub size: u64,
}

/// A squad sticker pack as sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerPackDto {
    pub squad_id: String,
    pub pack_id: String,
    pub name: String,
    pub entries: Vec<StickerEntry>,
    pub updated_at: i64,
    pub updated_by: String,
    pub deleted: bool,
}

impl StickerPackDto {
    fn from_row(row: db::StickerPackRow) -> Result<Self, String> {
        let entries: Vec<StickerEntry> = serde_json::from_str(&row.entries).map_err(|e| {
            format!(
                "Corrupt sticker pack entries for {}/{}: {}",
                row.squad_id, row.pack_id, e
            )
        })?;
        Ok(Self {
            squad_id: row.squad_id,
            pack_id: row.pack_id,
            name: row.name,
            entries,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
            deleted: row.deleted,
        })
    }
}

/// Result of encrypting and uploading a sticker image.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerImageUploadDto {
    pub url: String,
    pub key: String,
    pub nonce: String,
    pub mime: String,
    pub size: u64,
}

/// Sniffs and validates that `bytes` is real image data before it is ever
/// encrypted or uploaded. Always sniffs from the bytes themselves — a
/// caller-declared file name is never trusted for content served to other
/// squad members.
fn sniff_sticker_image(bytes: &[u8]) -> Result<(String, String), String> {
    if bytes.is_empty() {
        return Err("Sticker image data is empty".to_string());
    }
    let (extension, mime) = util::sniff_extension_and_mime(bytes, "");
    if !util::is_image_mime(&mime) {
        return Err(format!(
            "Unrecognized sticker image data (sniffed as \"{}\")",
            mime
        ));
    }
    Ok((extension, mime))
}

/// Encrypts sticker bytes with fresh AES-256-GCM parameters. Pure and
/// network-free so an upload failure never leaves an orphaned key.
fn encrypt_sticker_bytes(bytes: &[u8]) -> Result<(Vec<u8>, EncryptionParams), String> {
    let params = crypto::generate_encryption_params();
    let ciphertext = crypto::encrypt_data(bytes, &params)?;
    Ok((ciphertext, params))
}

/// Sniffs, encrypts, and uploads a sticker image to Blossom. Composes the same
/// four functions `send_file_bytes` does: sniff, generate params, encrypt,
/// upload-with-failover. The blob is opaque ciphertext on the wire, matching
/// every other attachment Pacto stores — the real MIME type only ever appears
/// in the returned DTO, which the caller carries in the MLS announce.
#[tauri::command]
pub async fn upload_sticker_image(
    bytes: Vec<u8>,
    _file_name: String,
) -> Result<StickerImageUploadDto, String> {
    let (_extension, mime) = sniff_sticker_image(&bytes)?;
    let size = bytes.len() as u64;
    let (ciphertext, params) = encrypt_sticker_bytes(&bytes)?;

    let client = crate::get_nostr_client()?;
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let servers = crate::get_blossom_blob_servers();
    let no_op_progress: crate::blossom::ProgressCallback = std::sync::Arc::new(|_, _| Ok(()));

    let url = crate::blossom::upload_blob_with_progress_and_failover(
        signer,
        servers,
        ciphertext,
        Some("application/octet-stream"),
        no_op_progress,
        Some(3),
        Some(std::time::Duration::from_secs(2)),
    )
    .await?;

    Ok(StickerImageUploadDto {
        url,
        key: params.key,
        nonce: params.nonce,
        mime,
        size,
    })
}

/// Cache directory for decrypted sticker renders, global (not per-account) like
/// `image_cache`, since a pack's ciphertext is identical for every member who
/// holds the announce key.
fn sticker_cache_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let app_data = crate::test_sandbox::test_data_dir(handle)
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let dir = app_data.join("cache").join("stickers");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create sticker cache directory: {}", e))?;
    Ok(dir)
}

/// Cache key derived from the source URL **and the decryption key**, so a hit
/// needs no network round trip yet still requires possession of the key. Keying
/// on the URL alone would let a cache hit skip decryption entirely, serving
/// plaintext to a caller presenting the wrong key — and, because this cache is
/// global rather than per-account, to a second account on the same machine that
/// never held the key at all.
fn sticker_cache_key(url: &str, key: &str) -> String {
    let mut material = Vec::with_capacity(url.len() + key.len() + 1);
    material.extend_from_slice(url.as_bytes());
    material.push(0);
    material.extend_from_slice(key.as_bytes());
    util::calculate_file_hash(&material)
}

fn find_cached_sticker(cache_dir: &std::path::Path, cache_key: &str) -> Option<String> {
    let entries = std::fs::read_dir(cache_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(cache_key) {
            return Some(entry.path().to_string_lossy().to_string());
        }
    }
    None
}

/// Validates that `key`/`nonce` decode to hex of exactly the length
/// `crypto::decrypt_data` requires. Called before any network request: an
/// attacker-controlled MLS announce entry must not be able to make this
/// client issue a GET at all, let alone reach `GenericArray::from_slice`.
fn validate_sticker_crypto_params(key: &str, nonce: &str) -> Result<(), String> {
    let key_bytes = hex::decode(key).map_err(|e| format!("Invalid key hex: {}", e))?;
    if key_bytes.len() != crypto::AES_KEY_LEN {
        return Err(format!(
            "Invalid key hex: expected {} bytes, got {}",
            crypto::AES_KEY_LEN,
            key_bytes.len()
        ));
    }
    let nonce_bytes = hex::decode(nonce).map_err(|e| format!("Invalid nonce hex: {}", e))?;
    if nonce_bytes.len() != crypto::AES_NONCE_LEN {
        return Err(format!(
            "Invalid nonce hex: expected {} bytes, got {}",
            crypto::AES_NONCE_LEN,
            nonce_bytes.len()
        ));
    }
    Ok(())
}

/// Downloads and decrypts a sticker image, mirroring `decrypt_and_save_attachment`
/// (`net::download` then `crypto::decrypt_data`). Caches the decrypted file on
/// disk keyed by the source URL and decryption key so repeated picker renders
/// never re-download.
#[tauri::command]
pub async fn fetch_sticker_image<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    key: String,
    nonce: String,
) -> Result<String, String> {
    validate_sticker_crypto_params(&key, &nonce)?;

    let cache_dir = sticker_cache_dir(&handle)?;
    let cache_key = sticker_cache_key(&url, &key);

    if let Some(cached) = find_cached_sticker(&cache_dir, &cache_key) {
        return Ok(cached);
    }

    let encrypted = crate::net::download(
        &url,
        &handle,
        &cache_key,
        Some(std::time::Duration::from_secs(30)),
    )
    .await
    .map_err(|e| e.to_string())?;
    let decrypted = crypto::decrypt_data(&encrypted, &key, &nonce)?;

    let (sniffed_ext, _mime) = util::sniff_extension_and_mime(&decrypted, "");
    let extension = if sniffed_ext.is_empty() {
        "bin".to_string()
    } else {
        sniffed_ext
    };
    let file_path = cache_dir.join(format!("{}.{}", cache_key, extension));
    std::fs::write(&file_path, &decrypted)
        .map_err(|e| format!("Failed to write cached sticker: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Loads every non-deleted sticker pack visible to the current account. `db::load_sticker_packs`
/// already scopes to this account's local database, which only ever holds packs
/// for squads the account has received MLS announces from.
fn list_sticker_pack_dtos<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<StickerPackDto>, String> {
    db::load_sticker_packs(handle)?
        .into_iter()
        .map(StickerPackDto::from_row)
        .collect()
}

/// Every non-deleted pack across every squad the account belongs to.
#[tauri::command]
pub fn list_sticker_packs<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<StickerPackDto>, String> {
    list_sticker_pack_dtos(&handle)
}

/// Persists a pack locally and stamps `updated_at` from the system clock — never
/// from the caller — then emits `sticker_packs_updated`. The caller sends the MLS
/// announce separately, using the `updated_at` on the returned DTO so the value
/// travelling over MLS matches what was actually persisted.
#[tauri::command]
pub fn save_sticker_pack<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
    pack_id: String,
    name: String,
    entries: Vec<StickerEntry>,
    deleted: bool,
) -> Result<StickerPackDto, String> {
    let updated_by = crate::account_manager::get_current_account()?;
    let entries_json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;

    let row = db::upsert_sticker_pack_inner(
        &handle,
        &squad_id,
        &pack_id,
        &name,
        &entries_json,
        &updated_by,
        deleted,
    )?;
    let dto = StickerPackDto::from_row(row)?;

    db::emit_sticker_packs_updated(&handle);

    Ok(dto)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gif_bytes() -> Vec<u8> {
        let mut bytes = b"GIF89a".to_vec();
        bytes.extend_from_slice(&[0u8; 32]);
        bytes
    }

    fn animated_webp_bytes() -> Vec<u8> {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 0]); // chunk size, unchecked by the sniffer
        bytes.extend_from_slice(b"WEBP");
        bytes.extend_from_slice(b"ANIM"); // animated-WebP chunk marker
        bytes.extend_from_slice(&[0u8; 16]);
        bytes
    }

    #[test]
    fn gif_round_trips_through_encrypt_and_decrypt() {
        let original = gif_bytes();
        let (extension, mime) = sniff_sticker_image(&original).expect("valid gif");
        assert_eq!(mime, "image/gif");
        assert_eq!(extension, "gif");

        let (ciphertext, params) = encrypt_sticker_bytes(&original).expect("encrypts");
        let decrypted =
            crypto::decrypt_data(&ciphertext, &params.key, &params.nonce).expect("decrypts");
        assert_eq!(decrypted, original);
    }

    #[test]
    fn animated_webp_round_trips_through_encrypt_and_decrypt() {
        let original = animated_webp_bytes();
        let (extension, mime) = sniff_sticker_image(&original).expect("valid webp");
        assert_eq!(mime, "image/webp");
        assert_eq!(extension, "webp");

        let (ciphertext, params) = encrypt_sticker_bytes(&original).expect("encrypts");
        let decrypted =
            crypto::decrypt_data(&ciphertext, &params.key, &params.nonce).expect("decrypts");
        assert_eq!(decrypted, original);
    }

    #[test]
    fn zero_byte_input_is_rejected_before_upload() {
        assert!(sniff_sticker_image(&[]).is_err());
    }

    #[test]
    fn unrecognized_magic_bytes_are_rejected_before_upload() {
        let junk = vec![0x13, 0x37, 0x00, 0xff, 0xde, 0xad, 0xbe, 0xef];
        assert!(sniff_sticker_image(&junk).is_err());
    }

    #[test]
    fn fetch_with_wrong_key_errors_instead_of_returning_garbage() {
        let original = gif_bytes();
        let params = crypto::generate_encryption_params();
        let ciphertext = crypto::encrypt_data(&original, &params).expect("encrypts");

        let wrong_key = crypto::generate_encryption_params().key;
        let result = crypto::decrypt_data(&ciphertext, &wrong_key, &params.nonce);
        assert!(result.is_err());
    }

    /// A URL-only cache key let a cache hit return plaintext without ever
    /// decrypting, so the `key` argument was ignored for any already-fetched
    /// sticker — and because this cache is global rather than per-account, a
    /// second account on the same machine could read a blob it never had the
    /// key for. The key must participate in the cache identity.
    #[test]
    fn cache_key_binds_to_the_decryption_key() {
        let url = "https://blossom.example/deadbeef.bin";
        let key_a = crypto::generate_encryption_params().key;
        let key_b = crypto::generate_encryption_params().key;
        assert_ne!(key_a, key_b);

        assert_ne!(
            sticker_cache_key(url, &key_a),
            sticker_cache_key(url, &key_b),
            "same URL under different keys must not share a cache entry"
        );
        assert_eq!(
            sticker_cache_key(url, &key_a),
            sticker_cache_key(url, &key_a),
            "cache key must stay stable for the same url and key"
        );
        assert_ne!(
            sticker_cache_key("https://blossom.example/other.bin", &key_a),
            sticker_cache_key(url, &key_a),
            "different URLs must not collide"
        );
    }

    /// Real-account round trip through `db::upsert_sticker_pack_inner`, mirroring
    /// the account setup `db.rs`'s own persistence tests use (e.g.
    /// `link_preview_survives_reload_from_db`).
    fn setup_test_account(test_npub: &str) -> tauri::App<tauri::test::MockRuntime> {
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();

        let app = tauri::test::mock_app();
        let handle = app.handle();

        let profile_dir =
            crate::account_manager::get_profile_directory(handle, test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);

        let db_path = crate::account_manager::get_database_path(handle, test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);

        app
    }

    #[test]
    fn save_sticker_pack_stamps_monotonic_updated_at_ignoring_client_input() {
        let app = setup_test_account("npub1stickerpacksavemonotonictest");
        let handle = app.handle().clone();

        // The command signature has no `updated_at` parameter at all — the
        // server-stamped clock is the only source, by construction.
        let first = save_sticker_pack(
            handle.clone(),
            "squad-1".to_string(),
            "pack-1".to_string(),
            "Pack One".to_string(),
            vec![],
            false,
        )
        .unwrap();
        assert!(first.updated_at > 0);

        // A short sleep guarantees the second save lands in a different
        // millisecond, so the strict `>` below is deterministic rather than
        // a race against how fast two calls happen to execute back to back.
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = save_sticker_pack(
            handle.clone(),
            "squad-1".to_string(),
            "pack-1".to_string(),
            "Pack One Renamed".to_string(),
            vec![],
            false,
        )
        .unwrap();
        // Millisecond-precision `updated_at` makes two saves issued back to
        // back distinct, not merely non-decreasing.
        assert!(second.updated_at > first.updated_at);
        assert_eq!(second.name, "Pack One Renamed");

        crate::account_manager::close_db_connection();
    }

    #[test]
    fn save_sticker_pack_deleted_removes_it_from_list() {
        let app = setup_test_account("npub1stickerpacksavedeletedtest");
        let handle = app.handle().clone();

        save_sticker_pack(
            handle.clone(),
            "squad-2".to_string(),
            "pack-2".to_string(),
            "Pack Two".to_string(),
            vec![],
            false,
        )
        .unwrap();
        let listed = list_sticker_packs(handle.clone()).unwrap();
        assert!(listed.iter().any(|p| p.pack_id == "pack-2"));

        save_sticker_pack(
            handle.clone(),
            "squad-2".to_string(),
            "pack-2".to_string(),
            "Pack Two".to_string(),
            vec![],
            true,
        )
        .unwrap();
        let listed_after_delete = list_sticker_packs(handle.clone()).unwrap();
        assert!(!listed_after_delete.iter().any(|p| p.pack_id == "pack-2"));

        crate::account_manager::close_db_connection();
    }

    #[test]
    fn validate_sticker_crypto_params_accepts_well_formed_hex() {
        let params = crypto::generate_encryption_params();
        assert!(validate_sticker_crypto_params(&params.key, &params.nonce).is_ok());
    }

    #[test]
    fn validate_sticker_crypto_params_rejects_empty_key() {
        let params = crypto::generate_encryption_params();
        let err = validate_sticker_crypto_params("", &params.nonce).unwrap_err();
        assert!(err.contains("Invalid key hex"));
    }

    #[test]
    fn validate_sticker_crypto_params_rejects_short_key() {
        let params = crypto::generate_encryption_params();
        // "aa" is valid hex but decodes to a single byte, far short of the
        // 32-byte AES-256 key `crypto::decrypt_data` requires.
        let err = validate_sticker_crypto_params("aa", &params.nonce).unwrap_err();
        assert!(err.contains("Invalid key hex"));
    }

    #[test]
    fn validate_sticker_crypto_params_rejects_short_nonce() {
        let params = crypto::generate_encryption_params();
        let err = validate_sticker_crypto_params(&params.key, "bb").unwrap_err();
        assert!(err.contains("Invalid nonce hex"));
    }

    #[test]
    fn validate_sticker_crypto_params_rejects_non_hex() {
        let params = crypto::generate_encryption_params();
        assert!(validate_sticker_crypto_params("not-hex", &params.nonce).is_err());
        assert!(validate_sticker_crypto_params(&params.key, "not-hex").is_err());
    }
}
