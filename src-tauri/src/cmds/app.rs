//! Misc app-level commands: EVM hash signing, platform feature flags, maintenance, relaunch.
use nostr_sdk::prelude::*;
use crate::{audio, evm, image_cache, session};

use tauri::{AppHandle, Manager, Runtime};

/// Sign a 32-byte Ethereum hash (hex string) with the stored EVM key.
/// Returns a 65-byte signature as 0x-prefixed hex (r || s || v) where v is 27 or 28.
#[tauri::command]
pub(crate) async fn sign_evm_hash<R: Runtime>(
    handle: AppHandle<R>,
    hash_hex: String,
) -> Result<String, String> {
    session::heartbeat();
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    // Decode hash (32 bytes).
    let trimmed = hash_hex.trim();
    let s = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if s.len() != 64 {
        return Err("Hash must be 32 bytes (64 hex chars)".to_string());
    }
    let hash_bytes = hex::decode(s).map_err(|e| format!("Invalid hash hex: {}", e))?;
    if hash_bytes.len() != 32 {
        return Err("Hash must be exactly 32 bytes".to_string());
    }

    let evm_private_key =
        evm::evm_accounts::decrypt_active_evm_private_key_plaintext(handle.clone())
            .await
            .map_err(|_| "Failed to resolve EVM signing key".to_string())?;

    let key_hex = evm_private_key
        .trim()
        .strip_prefix("0x")
        .unwrap_or(&evm_private_key);
    let key_bytes = hex::decode(key_hex).map_err(|e| format!("Invalid EVM key hex: {}", e))?;

    use secp256k1::{ecdsa::RecoverableSignature, Message, Secp256k1, SecretKey};

    let sk = SecretKey::from_slice(&key_bytes).map_err(|_| "Invalid EVM secret key".to_string())?;
    let msg = Message::from_digest_slice(&hash_bytes)
        .map_err(|_| "Hash must be a 32-byte message".to_string())?;
    let secp = Secp256k1::new();
    let sig: RecoverableSignature = secp.sign_ecdsa_recoverable(&msg, &sk);

    let (rec_id, compact) = sig.serialize_compact();
    let rec: i32 = rec_id.to_i32();
    if rec != 0 && rec != 1 {
        return Err("Unexpected recovery id".to_string());
    }
    let v: u8 = 27 + (rec as u8); // 27 or 28

    let mut out = [0u8; 65];
    out[..64].copy_from_slice(&compact[..]);
    out[64] = v;

    Ok(format!("0x{}", hex::encode(out)))
}

/// Updates the OS taskbar badge with the count of unread messages
/// Platform feature list structure
#[derive(serde::Serialize, Clone)]
pub(crate) struct PlatformFeatures {
    transcription: bool,
    notification_sounds: bool,
    os: String,
    is_mobile: bool,
    debug_mode: bool,
}

/// Returns a list of platform-specific features available
#[tauri::command]
pub(crate) async fn get_platform_features() -> PlatformFeatures {
    let os = if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };

    let is_mobile = cfg!(target_os = "android") || cfg!(target_os = "ios");

    PlatformFeatures {
        transcription: cfg!(all(not(target_os = "android"), feature = "whisper")),
        notification_sounds: cfg!(desktop),
        os: os.to_string(),
        is_mobile,
        debug_mode: cfg!(debug_assertions),
    }
}

/// Run periodic maintenance tasks to keep memory usage low
/// Called every ~45s from the JS profile sync loop
///
/// Current tasks:
/// - Purge expired notification sound cache (10 min TTL, desktop only)
/// - Cleanup stale in-progress download tracking entries
///
/// Future tasks could include:
/// - Image cache cleanup
/// - Temporary file cleanup
/// - Memory pressure responses
#[tauri::command]
pub(crate) async fn run_maintenance() {
    // Audio: purge expired notification sound cache (desktop only)
    #[cfg(desktop)]
    audio::check_cache_ttl();

    // Cleanup stale download tracking entries
    image_cache::cleanup_stale_downloads().await;
}

/// Restart the app from the Rust side after an updater install.
///
/// Going through `tauri::process::restart` directly (instead of the JS
/// `plugin-process` relaunch API) avoids a known race on macOS where the
/// event loop can exit before the new process is spawned, leaving the app
/// closed after a successful update.
#[cfg(desktop)]
#[tauri::command]
pub(crate) fn relaunch_app(app_handle: AppHandle) {
    app_handle.cleanup_before_exit();
    tauri::process::restart(&app_handle.env());
}
