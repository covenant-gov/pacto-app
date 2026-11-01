use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Runtime};

use crate::crypto::{internal_decrypt, internal_encrypt};
use crate::{Profile, Status};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SlimProfile {
    pub id: String,
    name: String,
    display_name: String,
    nickname: String,
    lud06: String,
    lud16: String,
    banner: String,
    avatar: String,
    about: String,
    website: String,
    nip05: String,
    status: Status,
    #[serde(default)]
    blocked: bool,
    bot: bool,
    avatar_cached: String,
    banner_cached: String,
    // Omitting: messages, last_updated, mine
}

impl Default for SlimProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            display_name: String::new(),
            nickname: String::new(),
            lud06: String::new(),
            lud16: String::new(),
            banner: String::new(),
            avatar: String::new(),
            about: String::new(),
            website: String::new(),
            nip05: String::new(),
            status: Status::new(),
            blocked: false,
            bot: false,
            avatar_cached: String::new(),
            banner_cached: String::new(),
        }
    }
}

impl From<&Profile> for SlimProfile {
    fn from(profile: &Profile) -> Self {
        SlimProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            display_name: profile.display_name.clone(),
            nickname: profile.nickname.clone(),
            lud06: profile.lud06.clone(),
            lud16: profile.lud16.clone(),
            banner: profile.banner.clone(),
            avatar: profile.avatar.clone(),
            about: profile.about.clone(),
            website: profile.website.clone(),
            nip05: profile.nip05.clone(),
            status: profile.status.clone(),
            blocked: profile.blocked,
            bot: profile.bot,
            avatar_cached: profile.avatar_cached.clone(),
            banner_cached: profile.banner_cached.clone(),
        }
    }
}

impl SlimProfile {
    // Convert back to full Profile
    pub fn to_profile(&self) -> crate::Profile {
        crate::Profile {
            id: self.id.clone(),
            name: self.name.clone(),
            display_name: self.display_name.clone(),
            nickname: self.nickname.clone(),
            lud06: self.lud06.clone(),
            lud16: self.lud16.clone(),
            banner: self.banner.clone(),
            avatar: self.avatar.clone(),
            about: self.about.clone(),
            website: self.website.clone(),
            nip05: self.nip05.clone(),
            status: self.status.clone(),
            last_updated: 0, // Default value
            mine: false,     // Default value
            blocked: self.blocked,
            bot: self.bot,
            avatar_cached: self.avatar_cached.clone(),
            banner_cached: self.banner_cached.clone(),
        }
    }
}

// Function to get all profiles
pub async fn get_all_profiles<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<SlimProfile>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn.prepare("SELECT npub, name, display_name, nickname, lud06, lud16, banner, avatar, about, website, nip05, status_content, status_url, blocked, bot, avatar_cached, banner_cached FROM profiles")
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let profiles = stmt
        .query_map([], |row| {
            // Get cached paths and validate they exist on disk
            let avatar_cached: String = row.get(15)?;
            let banner_cached: String = row.get(16)?;

            // Only use cached paths if the files actually exist
            let validated_avatar_cached =
                if !avatar_cached.is_empty() && std::path::Path::new(&avatar_cached).exists() {
                    avatar_cached
                } else {
                    String::new()
                };
            let validated_banner_cached =
                if !banner_cached.is_empty() && std::path::Path::new(&banner_cached).exists() {
                    banner_cached
                } else {
                    String::new()
                };

            Ok(SlimProfile {
                id: row.get(0)?, // npub column
                name: row.get(1)?,
                display_name: row.get(2)?,
                nickname: row.get(3)?,
                lud06: row.get(4)?,
                lud16: row.get(5)?,
                banner: row.get(6)?,
                avatar: row.get(7)?,
                about: row.get(8)?,
                website: row.get(9)?,
                nip05: row.get(10)?,
                status: crate::Status {
                    title: row.get(11)?,
                    purpose: String::new(), // Not stored separately
                    url: row.get(12)?,
                },
                blocked: row.get::<_, i32>(13)? != 0,
                bot: row.get::<_, i32>(14)? != 0,
                avatar_cached: validated_avatar_cached,
                banner_cached: validated_banner_cached,
            })
        })
        .map_err(|e| format!("Failed to query profiles: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect profiles: {}", e))?;

    drop(stmt); // Explicitly drop stmt before returning connection
    crate::account_manager::return_db_connection(conn);
    Ok(profiles)
}

// Public command to set a profile
#[command]
pub async fn set_profile<R: Runtime>(handle: AppHandle<R>, profile: Profile) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    conn.execute(
        "INSERT INTO profiles (npub, name, display_name, nickname, lud06, lud16, banner, avatar, about, website, nip05, status_content, status_url, blocked, bot, avatar_cached, banner_cached)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(npub) DO UPDATE SET
            name = excluded.name,
            display_name = excluded.display_name,
            nickname = excluded.nickname,
            lud06 = excluded.lud06,
            lud16 = excluded.lud16,
            banner = excluded.banner,
            avatar = excluded.avatar,
            about = excluded.about,
            website = excluded.website,
            nip05 = excluded.nip05,
            status_content = excluded.status_content,
            status_url = excluded.status_url,
            blocked = excluded.blocked,
            bot = excluded.bot,
            avatar_cached = excluded.avatar_cached,
            banner_cached = excluded.banner_cached",
        rusqlite::params![
            profile.id,  // This is the npub
            profile.name,
            profile.display_name,
            profile.nickname,
            profile.lud06,
            profile.lud16,
            profile.banner,
            profile.avatar,
            profile.about,
            profile.website,
            profile.nip05,
            profile.status.title,
            profile.status.url,
            profile.blocked as i32,
            profile.bot as i32,
            profile.avatar_cached,
            profile.banner_cached,
        ],
    ).map_err(|e| format!("Failed to insert profile: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Persist Kind 0 receipt and profile row in one transaction before UI observe.
pub fn persist_kind0_publish<R: Runtime>(
    handle: AppHandle<R>,
    profile: &Profile,
    receipt_json: String,
) -> Result<(), String> {
    crate::account_manager::get_current_account()
        .map_err(|_| "No current account".to_string())?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let write_result = (|| -> Result<(), String> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin kind0 persist transaction: {e}"))?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params!["kind0_publish_receipt", &receipt_json],
        )
        .map_err(|e| format!("Failed to persist kind0 receipt: {e}"))?;
        tx.execute(
            "INSERT INTO profiles (npub, name, display_name, nickname, lud06, lud16, banner, avatar, about, website, nip05, status_content, status_url, blocked, bot, avatar_cached, banner_cached)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(npub) DO UPDATE SET
                name = excluded.name,
                display_name = excluded.display_name,
                nickname = excluded.nickname,
                lud06 = excluded.lud06,
                lud16 = excluded.lud16,
                banner = excluded.banner,
                avatar = excluded.avatar,
                about = excluded.about,
                website = excluded.website,
                nip05 = excluded.nip05,
                status_content = excluded.status_content,
                status_url = excluded.status_url,
                blocked = excluded.blocked,
                bot = excluded.bot,
                avatar_cached = excluded.avatar_cached,
                banner_cached = excluded.banner_cached",
            rusqlite::params![
                profile.id,
                profile.name,
                profile.display_name,
                profile.nickname,
                profile.lud06,
                profile.lud16,
                profile.banner,
                profile.avatar,
                profile.about,
                profile.website,
                profile.nip05,
                profile.status.title,
                profile.status.url,
                profile.blocked as i32,
                profile.bot as i32,
                profile.avatar_cached,
                profile.banner_cached,
            ],
        )
        .map_err(|e| format!("Failed to persist kind0 profile: {e}"))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit kind0 persist: {e}"))?;
        Ok(())
    })();
    crate::account_manager::return_db_connection(conn);
    write_result
}

#[command]
pub fn get_theme<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    // Try SQL if account is selected
    if let Ok(_npub) = crate::account_manager::get_current_account() {
        return get_sql_setting(handle.clone(), "theme".to_string());
    }
    Ok(None)
}

#[command]
pub async fn set_pkey<R: Runtime>(handle: AppHandle<R>, pkey: String) -> Result<(), String> {
    // Check if there's a pending account (new account creation flow)
    if let Ok(Some(npub)) = crate::account_manager::get_pending_account() {
        // Initialize database for the pending account
        crate::account_manager::init_profile_database(&handle, &npub).await?;
        crate::account_manager::set_current_account(npub.clone())?;
        crate::account_manager::clear_pending_account()?;

        // Now save the pkey to the newly created database
        let conn = crate::account_manager::get_db_connection(&handle)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params!["pkey", pkey],
        )
        .map_err(|e| format!("Failed to insert pkey: {}", e))?;
        crate::account_manager::return_db_connection(conn);
        #[cfg(debug_assertions)]
        {
            let _ = crate::sandbox_handle::record_npub(&npub);
        }
        maybe_mark_backup_verified_for_test_auth(&handle);
        return Ok(());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["pkey", pkey],
    )
    .map_err(|e| format!("Failed to insert pkey: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    maybe_mark_backup_verified_for_test_auth(&handle);
    Ok(())
}

/// Sandbox/demo accounts created through the UI still need `backup_verified`
/// or squad-invite Accept is a silent no-op. `dev_login` already sets this;
/// honor the same env flag after PIN save so Create Account matches.
#[cfg(debug_assertions)]
fn maybe_mark_backup_verified_for_test_auth<R: Runtime>(handle: &AppHandle<R>) {
    if std::env::var("PACTO_ALLOW_TEST_AUTH").unwrap_or_default() != "1" {
        return;
    }
    if let Err(e) = set_sql_setting(
        handle.clone(),
        "backup_verified".to_string(),
        "true".to_string(),
    ) {
        eprintln!("[db] could not mark backup_verified under test auth: {e}");
    }
}

#[cfg(not(debug_assertions))]
fn maybe_mark_backup_verified_for_test_auth<R: Runtime>(_handle: &AppHandle<R>) {}

#[command]
pub fn get_pkey<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["pkey"],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);
    Ok(result)
}

#[command]
pub async fn set_evm_pkey<R: Runtime>(
    handle: AppHandle<R>,
    evm_pkey: String,
) -> Result<(), String> {
    if let Ok(Some(npub)) = crate::account_manager::get_pending_account() {
        crate::account_manager::init_profile_database(&handle, &npub).await?;
        crate::account_manager::set_current_account(npub.clone())?;
        crate::account_manager::clear_pending_account()?;

        let conn = crate::account_manager::get_db_connection(&handle)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params!["evm_pkey", evm_pkey],
        )
        .map_err(|e| format!("Failed to insert evm_pkey: {}", e))?;
        crate::account_manager::return_db_connection(conn);
        return Ok(());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["evm_pkey", evm_pkey],
    )
    .map_err(|e| format!("Failed to insert evm_pkey: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[command]
pub fn get_evm_pkey<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["evm_pkey"],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);
    Ok(result)
}

/// Active signing address only (`settings.evm_address`). Does not touch `profiles`.
pub async fn set_wallet_signing_evm_address<R: Runtime>(
    handle: AppHandle<R>,
    address: String,
) -> Result<(), String> {
    let trimmed = address.trim().to_string();
    let conn = crate::account_manager::get_db_connection(&handle)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["evm_address", &trimmed],
    )
    .map_err(|e| format!("Failed to insert evm_address: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Persists **`settings.evm_address`** (active signing address).
#[command]
pub async fn set_evm_address<R: Runtime>(
    handle: AppHandle<R>,
    address: String,
) -> Result<(), String> {
    set_wallet_signing_evm_address(handle, address).await
}

/// Read `evm_address` from settings without repair (internal use).
pub(crate) fn read_stored_evm_address<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["evm_address"],
            |row| row.get(0),
        )
        .ok();
    crate::account_manager::return_db_connection(conn);
    Ok(result)
}

/// If the encrypted EVM key decrypts, recompute the **canonical** Ethereum address (same as
/// MetaMask) and persist it when it differs from stored `evm_address` (fixes legacy bug that
/// hashed the leading `0x04` byte).
pub async fn repair_evm_address_if_needed<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let enc = match get_evm_pkey(handle.clone())? {
        Some(e) => e,
        None => return Ok(()),
    };
    let decrypted = match internal_decrypt(enc).await {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    let key_hex = decrypted
        .trim()
        .strip_prefix("0x")
        .unwrap_or(decrypted.trim());
    let key_bytes = hex::decode(key_hex).map_err(|e| format!("Invalid EVM key hex: {}", e))?;
    if key_bytes.len() != 32 {
        return Ok(());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&key_bytes);
    let correct = crate::evm::address_from_evm_secret_32(&arr)?;
    let stored = read_stored_evm_address(handle.clone())?;
    let matches = stored
        .as_deref()
        .and_then(crate::evm::normalize_hex_address)
        .zip(crate::evm::normalize_hex_address(&correct))
        .map(|(a, b)| a == b)
        .unwrap_or(false);
    if matches {
        return Ok(());
    }
    set_wallet_signing_evm_address(handle.clone(), correct).await?;
    Ok(())
}

#[command]
pub async fn get_evm_address<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let _ = repair_evm_address_if_needed(&handle).await;
    read_stored_evm_address(handle)
}

/// Pairwise DM wallet exchange: read persisted payout address for `peer_npub` (current account scope).
pub fn get_dm_peer_evm_stored<R: Runtime>(
    handle: &AppHandle<R>,
    peer_npub: &str,
) -> Result<Option<String>, String> {
    let my_npub = crate::account_manager::get_current_account()?;
    let peer = peer_npub.trim();
    if peer.is_empty() {
        return Ok(None);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let r: Option<String> = conn
        .query_row(
            "SELECT evm_address FROM dm_peer_evm WHERE my_npub = ?1 AND peer_npub = ?2",
            rusqlite::params![my_npub.as_str(), peer],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read dm_peer_evm: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(r.filter(|s| !s.trim().is_empty()))
}

#[command]
pub fn get_dm_peer_evm_address<R: Runtime>(
    handle: AppHandle<R>,
    peer_npub: String,
) -> Result<Option<String>, String> {
    get_dm_peer_evm_stored(&handle, &peer_npub)
}

#[command]
pub fn set_dm_peer_evm_address<R: Runtime>(
    handle: AppHandle<R>,
    peer_npub: String,
    address: String,
) -> Result<(), String> {
    let my_npub = crate::account_manager::get_current_account()?;
    let peer = peer_npub.trim();
    if peer.is_empty() {
        return Err("peer_npub is empty".to_string());
    }
    let norm = crate::evm::normalize_hex_address(address.trim())
        .ok_or_else(|| "Invalid EVM address".to_string())?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO dm_peer_evm (my_npub, peer_npub, evm_address, updated_at_ms) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(my_npub, peer_npub) DO UPDATE SET evm_address = excluded.evm_address, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![my_npub.as_str(), peer, norm, now_ms],
    )
    .map_err(|e| format!("Failed to set dm_peer_evm: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Cached Username NFT claim for the active account.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameClaimRow {
    pub npub: String,
    pub username: String,
    pub npub_hash: String,
    pub token_id: String,
    pub link_event_id: Option<String>,
    pub policy_version: i64,
    pub network: String,
    pub updated_at_ms: i64,
}

/// Fields required to upsert a successful username claim / rotation cache row.
pub struct UsernameClaimUpsert {
    pub username: String,
    pub npub_hash: String,
    pub token_id: String,
    /// `Some(id)` sets the link; `None` preserves existing unless `invalidate_link_event_id`.
    pub link_event_id: Option<String>,
    /// When true, force `link_event_id` to NULL (used after address rotation if republish fails).
    pub invalidate_link_event_id: bool,
    pub policy_version: i64,
    pub network: String,
}

fn upsert_username_claim_conn(
    conn: &rusqlite::Connection,
    npub: &str,
    row: &UsernameClaimUpsert,
) -> Result<(), String> {
    let npub = npub.trim();
    if npub.is_empty() {
        return Err("npub is required".to_string());
    }
    let username = row.username.trim();
    if username.is_empty() {
        return Err("username is required".to_string());
    }
    let npub_hash = row.npub_hash.trim();
    if npub_hash.is_empty() {
        return Err("npub_hash is required".to_string());
    }
    let token_id = row.token_id.trim();
    if token_id.is_empty() {
        return Err("token_id is required".to_string());
    }
    let network = row.network.trim();
    if network.is_empty() {
        return Err("network is required".to_string());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let link = if row.invalidate_link_event_id {
        None
    } else {
        row.link_event_id
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
    };
    let invalidate = if row.invalidate_link_event_id {
        1i64
    } else {
        0i64
    };
    conn.execute(
        "INSERT INTO username_claims (
            npub, username, npub_hash, token_id, link_event_id,
            policy_version, network, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(npub) DO UPDATE SET
            username = excluded.username,
            npub_hash = excluded.npub_hash,
            token_id = excluded.token_id,
            link_event_id = CASE
                WHEN ?9 = 1 THEN NULL
                ELSE COALESCE(excluded.link_event_id, username_claims.link_event_id)
            END,
            policy_version = excluded.policy_version,
            network = excluded.network,
            updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            npub,
            username,
            npub_hash,
            token_id,
            link,
            row.policy_version,
            network,
            now,
            invalidate,
        ],
    )
    .map_err(|e| format!("Failed to upsert username_claims: {e}"))?;
    Ok(())
}

fn get_username_claim_conn(
    conn: &rusqlite::Connection,
    npub: &str,
) -> Result<Option<UsernameClaimRow>, String> {
    let npub = npub.trim();
    if npub.is_empty() {
        return Ok(None);
    }
    let mut stmt = conn
        .prepare(
            "SELECT npub, username, npub_hash, token_id, link_event_id,
                    policy_version, network, updated_at_ms
             FROM username_claims WHERE npub = ?1",
        )
        .map_err(|e| format!("Failed to prepare username_claims read: {e}"))?;
    let mut rows = stmt
        .query(rusqlite::params![npub])
        .map_err(|e| format!("Failed to query username_claims: {e}"))?;
    match rows.next() {
        Ok(Some(row)) => Ok(Some(UsernameClaimRow {
            npub: row.get(0).map_err(|e| e.to_string())?,
            username: row.get(1).map_err(|e| e.to_string())?,
            npub_hash: row.get(2).map_err(|e| e.to_string())?,
            token_id: row.get(3).map_err(|e| e.to_string())?,
            link_event_id: row.get(4).map_err(|e| e.to_string())?,
            policy_version: row.get(5).map_err(|e| e.to_string())?,
            network: row.get(6).map_err(|e| e.to_string())?,
            updated_at_ms: row.get(7).map_err(|e| e.to_string())?,
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Failed to read username_claims: {e}")),
    }
}

pub fn upsert_username_claim<R: Runtime>(
    handle: &AppHandle<R>,
    row: &UsernameClaimUpsert,
) -> Result<(), String> {
    let npub = crate::account_manager::get_current_account()?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = upsert_username_claim_conn(&conn, &npub, row);
    crate::account_manager::return_db_connection(conn);
    result
}

pub fn get_username_claim<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Option<UsernameClaimRow>, String> {
    let npub = crate::account_manager::get_current_account()?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = get_username_claim_conn(&conn, &npub);
    crate::account_manager::return_db_connection(conn);
    result
}

#[cfg(test)]
mod username_claims_cache_tests {
    use super::{
        get_username_claim_conn, upsert_username_claim_conn, UsernameClaimUpsert,
    };

    fn sample(link: Option<&str>, invalidate: bool) -> UsernameClaimUpsert {
        UsernameClaimUpsert {
            username: "alice".into(),
            npub_hash: "0x".to_string() + &"ab".repeat(32),
            token_id: "1".into(),
            link_event_id: link.map(|s| s.to_string()),
            invalidate_link_event_id: invalidate,
            policy_version: 3,
            network: "sepolia".into(),
        }
    }

    #[test]
    fn upsert_get_and_coalesce_preserve_link_event_id() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        upsert_username_claim_conn(&conn, "npub1alice", &sample(Some("evt-1"), false))
            .expect("insert");
        let row = get_username_claim_conn(&conn, "npub1alice")
            .expect("get")
            .expect("row");
        assert_eq!(row.username, "alice");
        assert_eq!(row.link_event_id.as_deref(), Some("evt-1"));

        // Rotation-style upsert with None preserves the prior link.
        let mut rotate = sample(None, false);
        rotate.username = "alice".into();
        rotate.token_id = "1".into();
        upsert_username_claim_conn(&conn, "npub1alice", &rotate).expect("preserve");
        let preserved = get_username_claim_conn(&conn, "npub1alice")
            .expect("get")
            .expect("row");
        assert_eq!(preserved.link_event_id.as_deref(), Some("evt-1"));

        // Explicit set overwrites.
        upsert_username_claim_conn(&conn, "npub1alice", &sample(Some("evt-2"), false))
            .expect("set");
        let updated = get_username_claim_conn(&conn, "npub1alice")
            .expect("get")
            .expect("row");
        assert_eq!(updated.link_event_id.as_deref(), Some("evt-2"));

        // Invalidate clears even when link_event_id is None.
        upsert_username_claim_conn(&conn, "npub1alice", &sample(None, true)).expect("clear");
        let cleared = get_username_claim_conn(&conn, "npub1alice")
            .expect("get")
            .expect("row");
        assert!(cleared.link_event_id.is_none());
    }
}

#[command]
pub async fn set_seed<R: Runtime>(handle: AppHandle<R>, seed: String) -> Result<(), String> {
    let encrypted_seed = internal_encrypt(seed).await;

    let conn = crate::account_manager::get_db_connection(&handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["seed", encrypted_seed],
    )
    .map_err(|e| format!("Failed to insert seed: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[command]
pub async fn get_seed<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let encrypted_seed: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["seed"],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);

    if let Some(encrypted) = encrypted_seed {
        match internal_decrypt(encrypted).await {
            Ok(decrypted) => return Ok(Some(decrypted)),
            Err(_) => return Err("Failed to decrypt seed phrase".to_string()),
        }
    }

    Ok(None)
}

/// Set a setting value in SQL database
#[command]
pub fn set_sql_setting<R: Runtime>(
    handle: AppHandle<R>,
    key: String,
    value: String,
) -> Result<(), String> {
    if let Ok(_npub) = crate::account_manager::get_current_account() {
        let conn = crate::account_manager::get_db_connection(&handle)?;

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![&key, &value],
        )
        .map_err(|e| format!("Failed to set setting: {}", e))?;

        crate::account_manager::return_db_connection(conn);
        return Ok(());
    }
    Ok(())
}

/// Get a setting value from SQL database
#[command]
pub fn get_sql_setting<R: Runtime>(
    handle: AppHandle<R>,
    key: String,
) -> Result<Option<String>, String> {
    if let Ok(_npub) = crate::account_manager::get_current_account() {
        let conn = crate::account_manager::get_db_connection(&handle)?;

        let result: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params![&key],
                |row| row.get(0),
            )
            .ok();

        crate::account_manager::return_db_connection(conn);
        return Ok(result);
    }
    Ok(None)
}

#[command]
pub fn remove_setting<R: Runtime>(handle: AppHandle<R>, key: String) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let rows_affected = conn
        .execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![key],
        )
        .map_err(|e| format!("Failed to delete setting: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(rows_affected > 0)
}

/// Days to retain successful sensitive-export audit rows.
const EXPORT_SUCCESS_RETENTION_DAYS: u64 = 90;

/// Days to retain failed sensitive-export audit rows.
const EXPORT_FAILURE_RETENTION_DAYS: u64 = 30;

/// Row in the sensitive export audit log.
#[derive(Clone, Debug)]
pub struct ExportLogRow {
    pub id: String,
    pub account_npub: String,
    pub export_type: String,
    pub attempted_at: u64,
    pub success: bool,
    pub error_code: Option<String>,
}

/// Log a sensitive export attempt to the account's database.
pub fn log_sensitive_export<R: Runtime>(
    handle: &AppHandle<R>,
    account_npub: &str,
    export_type: &str,
    success: bool,
    error_code: Option<&str>,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    log_sensitive_export_on_conn(&conn, account_npub, export_type, success, error_code)?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

pub(crate) fn log_sensitive_export_on_conn(
    conn: &rusqlite::Connection,
    account_npub: &str,
    export_type: &str,
    success: bool,
    error_code: Option<&str>,
) -> Result<(), String> {
    let id = format!(
        "{}-{}-{:x}",
        export_type,
        export_epoch_seconds(),
        rand::random::<u64>()
    );
    let attempted_at = export_epoch_seconds();
    conn.execute(
        "INSERT INTO sensitive_export_log (id, account_npub, export_type, attempted_at, success, error_code) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, account_npub, export_type, attempted_at, success as i64, error_code],
    )
    .map_err(|e| format!("Failed to log sensitive export: {}", e))?;
    Ok(())
}

/// List recent export attempts within the rolling `window_seconds` window.
pub fn list_recent_export_attempts<R: Runtime>(
    handle: &AppHandle<R>,
    account_npub: &str,
    window_seconds: u64,
) -> Result<Vec<ExportLogRow>, String> {
    prune_export_log(handle)?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    let rows = list_recent_export_attempts_on_conn(&conn, account_npub, window_seconds)?;
    crate::account_manager::return_db_connection(conn);
    Ok(rows)
}

pub(crate) fn list_recent_export_attempts_on_conn(
    conn: &rusqlite::Connection,
    account_npub: &str,
    window_seconds: u64,
) -> Result<Vec<ExportLogRow>, String> {
    let since = export_epoch_seconds().saturating_sub(window_seconds);
    let mut stmt = conn
        .prepare(
            "SELECT id, account_npub, export_type, attempted_at, success, error_code
             FROM sensitive_export_log
             WHERE account_npub = ?1 AND attempted_at >= ?2
             ORDER BY attempted_at DESC",
        )
        .map_err(|e| format!("Failed to prepare export log query: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![account_npub, since], |row| {
            Ok(ExportLogRow {
                id: row.get(0)?,
                account_npub: row.get(1)?,
                export_type: row.get(2)?,
                attempted_at: row.get(3)?,
                success: row.get::<_, i64>(4)? != 0,
                error_code: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query export log: {}", e))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Failed to read export log row: {}", e))?);
    }
    Ok(result)
}

/// Prune old export log entries: 90 days for successes, 30 days for failures.
pub fn prune_export_log<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    prune_export_log_on_conn(&conn)?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

pub(crate) fn prune_export_log_on_conn(conn: &rusqlite::Connection) -> Result<(), String> {
    let now = export_epoch_seconds();
    let success_cutoff = now.saturating_sub(EXPORT_SUCCESS_RETENTION_DAYS * 24 * 60 * 60);
    let failure_cutoff = now.saturating_sub(EXPORT_FAILURE_RETENTION_DAYS * 24 * 60 * 60);
    conn.execute(
        "DELETE FROM sensitive_export_log WHERE (success = 1 AND attempted_at < ?1) OR (success = 0 AND attempted_at < ?2)",
        rusqlite::params![success_cutoff, failure_cutoff],
    )
    .map_err(|e| format!("Failed to prune export log: {}", e))?;
    Ok(())
}

fn export_epoch_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

