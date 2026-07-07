use serde::{Deserialize, Serialize};
use rusqlite::OptionalExtension;
use tauri::{AppHandle, command, Runtime};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use once_cell::sync::Lazy;

use crate::{Profile, Status, Message, Chat, ChatType, Attachment, Reaction};
use crate::message::EditEntry;
use crate::crypto::{internal_encrypt, internal_decrypt};
use crate::stored_event::{StoredEvent, event_kind};

/// In-memory cache for chat_identifier → integer ID mappings
/// This avoids database lookups on every message operation
static CHAT_ID_CACHE: Lazy<Arc<RwLock<HashMap<String, i64>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// In-memory cache for npub → integer ID mappings
/// This avoids database lookups on every message operation
static USER_ID_CACHE: Lazy<Arc<RwLock<HashMap<String, i64>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

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
    muted: bool,
    #[serde(default)]
    blocked: bool,
    bot: bool,
    avatar_cached: String,
    banner_cached: String,
    #[serde(default)]
    evm_address: String,
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
            muted: false,
            blocked: false,
            bot: false,
            avatar_cached: String::new(),
            banner_cached: String::new(),
            evm_address: String::new(),
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
            muted: profile.muted,
            blocked: profile.blocked,
            bot: profile.bot,
            avatar_cached: profile.avatar_cached.clone(),
            banner_cached: profile.banner_cached.clone(),
            evm_address: profile.evm_address.clone(),
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
            last_updated: 0,      // Default value
            mine: false,          // Default value
            muted: self.muted,
            blocked: self.blocked,
            bot: self.bot,
            avatar_cached: self.avatar_cached.clone(),
            banner_cached: self.banner_cached.clone(),
            evm_address: self.evm_address.clone(),
        }
    }
}

// Function to get all profiles
pub async fn get_all_profiles<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<SlimProfile>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn.prepare("SELECT npub, name, display_name, nickname, lud06, lud16, banner, avatar, about, website, nip05, status_content, status_url, muted, blocked, bot, avatar_cached, banner_cached, evm_address FROM profiles")
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let profiles = stmt.query_map([], |row| {
        // Get cached paths and validate they exist on disk
        let avatar_cached: String = row.get(16)?;
        let banner_cached: String = row.get(17)?;

        // Only use cached paths if the files actually exist
        let validated_avatar_cached = if !avatar_cached.is_empty() && std::path::Path::new(&avatar_cached).exists() {
            avatar_cached
        } else {
            String::new()
        };
        let validated_banner_cached = if !banner_cached.is_empty() && std::path::Path::new(&banner_cached).exists() {
            banner_cached
        } else {
            String::new()
        };

        Ok(SlimProfile {
            id: row.get(0)?,  // npub column
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
            muted: row.get::<_, i32>(13)? != 0,
            blocked: row.get::<_, i32>(14)? != 0,
            bot: row.get::<_, i32>(15)? != 0,
            avatar_cached: validated_avatar_cached,
            banner_cached: validated_banner_cached,
            evm_address: row.get::<_, String>(18).unwrap_or_default(),
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
        "INSERT INTO profiles (npub, name, display_name, nickname, lud06, lud16, banner, avatar, about, website, nip05, status_content, status_url, muted, blocked, bot, avatar_cached, banner_cached, evm_address)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
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
            muted = excluded.muted,
            blocked = excluded.blocked,
            bot = excluded.bot,
            avatar_cached = excluded.avatar_cached,
            banner_cached = excluded.banner_cached,
            evm_address = excluded.evm_address",
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
            profile.muted as i32,
            profile.blocked as i32,
            profile.bot as i32,
            profile.avatar_cached,
            profile.banner_cached,
            profile.evm_address,
        ],
    ).map_err(|e| format!("Failed to insert profile: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
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
        ).map_err(|e| format!("Failed to insert pkey: {}", e))?;
        crate::account_manager::return_db_connection(conn);
        return Ok(());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["pkey", pkey],
    ).map_err(|e| format!("Failed to insert pkey: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[command]
pub fn get_pkey<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let result: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params!["pkey"],
        |row| row.get(0)
    ).ok();

    crate::account_manager::return_db_connection(conn);
    Ok(result)
}

#[command]
pub async fn set_evm_pkey<R: Runtime>(handle: AppHandle<R>, evm_pkey: String) -> Result<(), String> {
    if let Ok(Some(npub)) = crate::account_manager::get_pending_account() {
        crate::account_manager::init_profile_database(&handle, &npub).await?;
        crate::account_manager::set_current_account(npub.clone())?;
        crate::account_manager::clear_pending_account()?;

        let conn = crate::account_manager::get_db_connection(&handle)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params!["evm_pkey", evm_pkey],
        ).map_err(|e| format!("Failed to insert evm_pkey: {}", e))?;
        crate::account_manager::return_db_connection(conn);
        return Ok(());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["evm_pkey", evm_pkey],
    ).map_err(|e| format!("Failed to insert evm_pkey: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[command]
pub fn get_evm_pkey<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let result: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params!["evm_pkey"],
        |row| row.get(0)
    ).ok();

    crate::account_manager::return_db_connection(conn);
    Ok(result)
}

/// Active signing address only (`settings.evm_address`). Does not update `profiles.evm_address` (peer-facing default is separate).
pub async fn set_wallet_signing_evm_address<R: Runtime>(handle: AppHandle<R>, address: String) -> Result<(), String> {
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

/// Persists **`settings.evm_address`** (active signing address). Mine **`profiles.evm_address`** and Kind 0 are updated when the client publishes profile metadata (e.g. `update_profile` after onboarding).
#[command]
pub async fn set_evm_address<R: Runtime>(handle: AppHandle<R>, address: String) -> Result<(), String> {
    set_wallet_signing_evm_address(handle, address).await
}

/// Embedded wallet: payout address stored for a contact (`profiles.evm_address`).
pub fn get_profile_evm_address<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let r: Option<String> = conn
        .query_row(
            "SELECT evm_address FROM profiles WHERE npub = ?1",
            rusqlite::params![npub],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read profile evm_address: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(r.filter(|s| !s.trim().is_empty()))
}

/// Read `evm_address` from settings without repair (internal use).
pub(crate) fn read_stored_evm_address<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let result: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params!["evm_address"],
        |row| row.get(0)
    ).ok();
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
    let decrypted = match internal_decrypt(enc, None).await {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    let key_hex = decrypted.trim().strip_prefix("0x").unwrap_or(decrypted.trim());
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

fn normalize_treasury_chain(raw: Option<&str>) -> String {
    match raw
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .as_deref()
    {
        Some("mainnet") | Some("ethereum") | Some("eth") => "mainnet".to_string(),
        Some("arbitrum") | Some("arb") => "arbitrum".to_string(),
        Some("local") => "local".to_string(),
        Some("sepolia") | None => "sepolia".to_string(),
        _ => "sepolia".to_string(),
    }
}

fn normalize_infra_type(raw: &str) -> Result<String, String> {
    let s = raw.trim().to_ascii_lowercase();
    match s.as_str() {
        "sponsor" | "squad_sponsor" => Ok("sponsor".to_string()),
        "pacto_gov" | "pacto-gov" => Ok("pacto_gov".to_string()),
        "squad_admin" | "squad-admin" => Ok("squad_admin".to_string()),
        "standalone_safe" | "gnosis_safe" | "gnosis-safe" | "safe" => Ok("standalone_safe".to_string()),
        "bread_coop" | "bread-coop" | "bread" => Ok("bread_coop".to_string()),
        _ => Err(format!("unknown squad infra type: {}", raw.trim())),
    }
}

const SQUAD_INFRA_CANONICAL_REF_MAX: usize = 2048;
const SQUAD_INFRA_REVISION_MAX: usize = 64;
const SQUAD_INFRA_PAYLOAD_MAX: usize = 256_000;
const SQUAD_INFRA_ID_MAX: usize = 72;

fn new_squad_infra_id(entry_id: Option<&str>) -> String {
    if let Some(s) = entry_id.map(str::trim).filter(|s| !s.is_empty()) {
        if s.len() >= 8
            && s.len() <= SQUAD_INFRA_ID_MAX
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return s.to_string();
        }
    }
    format!(
        "si-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

fn new_treasury_row_id(entry_id: Option<&str>) -> String {
    if let Some(s) = entry_id.map(str::trim).filter(|s| !s.is_empty()) {
        if s.len() >= 8
            && s.len() <= 72
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return s.to_string();
        }
    }
    format!(
        "pt-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

fn upsert_parent_treasury_row<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    safe_address_norm: &str,
    chain: &str,
    label: &str,
    entry_id: Option<&str>,
) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err("parent_id is empty".to_string());
    }
    let chain_norm = normalize_treasury_chain(Some(chain));
    let conn = crate::account_manager::get_db_connection(handle)?;
    let id = new_treasury_row_id(entry_id);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO parent_treasury_safe (id, parent_id, safe_address, chain, label, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(parent_id, safe_address, chain) DO UPDATE SET
           label = CASE WHEN excluded.label != '' THEN excluded.label ELSE parent_treasury_safe.label END",
        rusqlite::params![
            id,
            pid,
            safe_address_norm,
            chain_norm,
            label,
            now_ms
        ],
    )
    .map_err(|e| format!("Failed to upsert parent_treasury_safe: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentTreasurySafeRow {
    pub id: String,
    pub parent_id: String,
    pub safe_address: String,
    pub chain: String,
    pub label: String,
    pub created_at_ms: i64,
}

/// Legacy: first stored Safe address for a parent (oldest `created_at_ms`). Prefer `list_parent_treasury_safes`.
#[command]
pub fn get_safe<R: Runtime>(handle: AppHandle<R>, parent_id: String) -> Result<Option<String>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(None);
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let result: Option<String> = conn
        .query_row(
            "SELECT safe_address FROM parent_treasury_safe WHERE parent_id = ?1 ORDER BY created_at_ms ASC LIMIT 1",
            rusqlite::params![pid],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read parent_treasury_safe: {}", e))?;
    let result = if result.is_none() {
        conn.query_row("SELECT safe_address FROM squad_safe WHERE squad_id = ?1", rusqlite::params![pid], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| format!("Failed to read squad_safe: {}", e))?
    } else {
        result
    };
    crate::account_manager::return_db_connection(conn);
    Ok(result)
}

/// Replace all treasury Safes for this parent with a single Sepolia entry (legacy Set Safe / migration).
#[command]
pub fn set_safe<R: Runtime>(handle: AppHandle<R>, parent_id: String, safe_address: String) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err("parent_id is empty".to_string());
    }
    let norm = crate::evm::normalize_hex_address(safe_address.trim())
        .ok_or_else(|| "Invalid EVM address".to_string())?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    conn.execute(
        "DELETE FROM parent_treasury_safe WHERE parent_id = ?1",
        rusqlite::params![pid],
    )
    .map_err(|e| format!("Failed to clear parent_treasury_safe: {}", e))?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = new_treasury_row_id(None);
    conn.execute(
        "INSERT INTO parent_treasury_safe (id, parent_id, safe_address, chain, label, created_at_ms) VALUES (?1, ?2, ?3, 'sepolia', '', ?4)",
        rusqlite::params![id, pid, norm, now_ms],
    )
    .map_err(|e| format!("Failed to insert parent_treasury_safe: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Idempotent add: merges by `(parent_id, safe_address, chain)`. Optional `entry_id` stabilizes row id on first insert.
#[command]
pub fn add_parent_treasury_safe<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    safe_address: String,
    chain: Option<String>,
    label: Option<String>,
    entry_id: Option<String>,
) -> Result<(), String> {
    let norm = crate::evm::normalize_hex_address(safe_address.trim())
        .ok_or_else(|| "Invalid EVM address".to_string())?;
    let ch = normalize_treasury_chain(chain.as_deref());
    let lb_raw = label.as_deref().unwrap_or("").trim();
    let lb = if lb_raw.len() > 200 {
        &lb_raw[..200]
    } else {
        lb_raw
    };
    upsert_parent_treasury_row(&handle, &parent_id, &norm, ch.as_str(), lb, entry_id.as_deref())
}

#[command]
pub fn list_parent_treasury_safes<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<ParentTreasurySafeRow>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(Vec::new());
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, safe_address, chain, label, created_at_ms FROM parent_treasury_safe WHERE parent_id = ?1 ORDER BY created_at_ms ASC",
        )
        .map_err(|e| format!("Failed to list parent_treasury_safe: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![pid], |row| {
            Ok(ParentTreasurySafeRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                safe_address: row.get(2)?,
                chain: row.get(3)?,
                label: row.get(4)?,
                created_at_ms: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query parent_treasury_safe: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    if out.is_empty() {
        let legacy: Option<String> = conn
            .query_row(
                "SELECT safe_address FROM squad_safe WHERE squad_id = ?1",
                rusqlite::params![pid],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to read squad_safe: {}", e))?;
        if let Some(addr) = legacy {
            out.push(ParentTreasurySafeRow {
                id: format!("legacy-{}", pid),
                parent_id: pid.to_string(),
                safe_address: addr,
                chain: "sepolia".to_string(),
                label: String::new(),
                created_at_ms: 0,
            });
        }
    }
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadInfraRow {
    pub id: String,
    pub parent_id: String,
    pub infra_type: String,
    pub chain: String,
    pub canonical_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pacto_gov_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_payload: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// True when a persisted `sponsor` infra row exists for this parent.
pub fn parent_has_sponsor_infra<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
) -> Result<bool, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(false);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM squad_infra WHERE parent_id = ?1 AND infra_type = 'sponsor'",
            rusqlite::params![pid],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query sponsor infra: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(count > 0)
}

#[command]
pub fn list_squad_infra<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<SquadInfraRow>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(Vec::new());
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, infra_type, chain, canonical_ref, pacto_gov_revision, provider_payload, created_at_ms, updated_at_ms \
             FROM squad_infra WHERE parent_id = ?1 ORDER BY created_at_ms ASC",
        )
        .map_err(|e| format!("Failed to list squad_infra: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![pid], |row| {
            Ok(SquadInfraRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                infra_type: row.get(2)?,
                chain: row.get(3)?,
                canonical_ref: row.get(4)?,
                pacto_gov_revision: row.get(5)?,
                provider_payload: row.get(6)?,
                created_at_ms: row.get(7)?,
                updated_at_ms: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to query squad_infra: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

/// Distinct on-chain refs from local `squad_infra` rows (for Advanced panel soft-deny warnings).
#[command]
pub fn list_squad_infra_canonical_refs<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT lower(trim(canonical_ref)) FROM squad_infra \
             WHERE canonical_ref IS NOT NULL AND trim(canonical_ref) != '' \
             ORDER BY 1",
        )
        .map_err(|e| format!("Failed to list squad_infra refs: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query squad_infra refs: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadContractAllowlistRow {
    pub id: String,
    pub parent_id: String,
    pub chain: String,
    pub contract_address: String,
    pub label: String,
    pub added_by_npub: String,
    pub abi_ref: Option<String>,
    pub notes: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

fn normalize_allowlist_chain(raw: &str) -> Result<String, String> {
    let c = raw.trim().to_ascii_lowercase();
    if c.is_empty() {
        return Err("Chain is required.".to_string());
    }
    Ok(c)
}

fn normalize_allowlist_address(raw: &str) -> Result<String, String> {
    crate::evm::normalize_hex_address(raw.trim())
        .ok_or_else(|| "Contract address must be a valid 0x address.".to_string())
}

pub fn allowlist_row_id(parent_id: &str, chain: &str, contract_address: &str) -> String {
    format!(
        "allowlist-{}-{}-{}",
        parent_id.trim(),
        chain.trim().to_ascii_lowercase(),
        contract_address.trim().to_ascii_lowercase()
    )
}

fn parent_has_pacto_gov_infra(conn: &rusqlite::Connection, parent_id: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM squad_infra WHERE parent_id = ?1 AND infra_type = 'pacto_gov'",
        rusqlite::params![parent_id],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

/// Interim v1: mutations require deployed Pacto Gov. Target: on-chain captain / allowlist-admin role.
fn require_allowlist_mutation_allowed(conn: &rusqlite::Connection, parent_id: &str) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err("parent_id is required.".to_string());
    }
    let _ = crate::account_manager::get_current_account()?;
    if !parent_has_pacto_gov_infra(conn, pid) {
        return Err(
            "Allowlist editing requires deployed Pacto Gov for this parent (interim captain-gated policy)."
                .to_string(),
        );
    }
    Ok(())
}

fn collect_hex_addresses_from_json_value(v: &serde_json::Value, out: &mut std::collections::HashSet<String>) {
    match v {
        serde_json::Value::String(s) => {
            if let Some(norm) = crate::evm::normalize_hex_address(s.trim()) {
                out.insert(norm.to_ascii_lowercase());
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_hex_addresses_from_json_value(item, out);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, val) in map {
                collect_hex_addresses_from_json_value(val, out);
            }
        }
        _ => {}
    }
}

/// Implicit allowlist: squad infra refs, treasury Safes, and curated deploy env targets for `(parent_id, chain)`.
pub fn implicit_allowlist_addresses<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    chain: &str,
) -> Result<Vec<String>, String> {
    let pid = parent_id.trim();
    let chain_norm = normalize_allowlist_chain(chain)?;
    if pid.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = std::collections::HashSet::new();
    let conn = crate::account_manager::get_db_connection(handle)?;

    if let Ok(mut stmt) = conn.prepare(
        "SELECT canonical_ref, provider_payload FROM squad_infra WHERE parent_id = ?1 AND lower(chain) = ?2",
    ) {
        let rows = stmt.query_map(rusqlite::params![pid, &chain_norm], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        });
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                if let Ok(addr) = normalize_allowlist_address(&row.0) {
                    out.insert(addr.to_ascii_lowercase());
                }
                if let Some(payload) = row.1 {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) {
                        collect_hex_addresses_from_json_value(&v, &mut out);
                    }
                }
            }
        }
    }

    if let Ok(mut stmt) = conn.prepare(
        "SELECT safe_address FROM parent_treasury_safe WHERE parent_id = ?1 AND lower(chain) = ?2",
    ) {
        let rows = stmt.query_map(rusqlite::params![pid, &chain_norm], |row| row.get::<_, String>(0));
        if let Ok(rows) = rows {
            for addr in rows.flatten() {
                if let Ok(norm) = normalize_allowlist_address(&addr) {
                    out.insert(norm.to_ascii_lowercase());
                }
            }
        }
    }

    crate::account_manager::return_db_connection(conn);

    if let Ok(gov) = crate::evm::pacto_chain_config::pacto_gov_deploy_addresses(&chain_norm) {
        out.insert(format!("{:#x}", gov.nave_pirata_factory).to_ascii_lowercase());
        out.insert(format!("{:#x}", gov.master_quartermaster).to_ascii_lowercase());
        out.insert(format!("{:#x}", gov.master_mutiny).to_ascii_lowercase());
        out.insert(format!("{:#x}", gov.master_treasury_authority).to_ascii_lowercase());
        out.insert(format!("{:#x}", gov.master_squad_admin_impl).to_ascii_lowercase());
        out.insert(format!("{:#x}", gov.master_squad_admin_ext_impl).to_ascii_lowercase());
        if let Some(a) = gov.nave_pirata_registry {
            out.insert(format!("{:#x}", a).to_ascii_lowercase());
        }
        if let Some(a) = gov.hats {
            out.insert(format!("{:#x}", a).to_ascii_lowercase());
        }
    }
    if let Ok(sp) = crate::evm::pacto_chain_config::squad_sponsor_deploy_addresses(&chain_norm) {
        out.insert(format!("{:#x}", sp.squad_sponsor_factory).to_ascii_lowercase());
        out.insert(format!("{:#x}", sp.pacto_sponsor_paymaster).to_ascii_lowercase());
        out.insert(format!("{:#x}", sp.entry_point).to_ascii_lowercase());
    }
    if let Some(net) = crate::evm::wallet_chain_config::network_by_key(&chain_norm) {
        if let Some(sf) =
            crate::evm::pacto_chain_config::safe_factory_addresses(&chain_norm, net.chain_id)
        {
            out.insert(format!("{:#x}", sf.proxy_factory).to_ascii_lowercase());
            out.insert(format!("{:#x}", sf.singleton).to_ascii_lowercase());
            out.insert(format!("{:#x}", sf.fallback_handler).to_ascii_lowercase());
        }
    }

    let mut v: Vec<String> = out.into_iter().collect();
    v.sort();
    Ok(v)
}

pub fn is_allowlisted_contract_target<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    chain: &str,
    to_address: &str,
) -> Result<bool, String> {
    let to_norm = normalize_allowlist_address(to_address)?;
    let to_lower = to_norm.to_ascii_lowercase();
    let implicit = implicit_allowlist_addresses(handle, parent_id, chain)?;
    if implicit.iter().any(|a| a == &to_lower) {
        return Ok(true);
    }
    let pid = parent_id.trim();
    let chain_norm = normalize_allowlist_chain(chain)?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM squad_contract_allowlist WHERE parent_id = ?1 AND lower(chain) = ?2 AND lower(contract_address) = ?3",
            rusqlite::params![pid, &chain_norm, &to_lower],
            |r| r.get(0),
        )
        .unwrap_or(0);
    crate::account_manager::return_db_connection(conn);
    Ok(n > 0)
}

#[command]
pub fn list_squad_contract_allowlist<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<SquadContractAllowlistRow>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(Vec::new());
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, chain, contract_address, label, added_by_npub, abi_ref, notes, created_at_ms, updated_at_ms \
             FROM squad_contract_allowlist WHERE parent_id = ?1 ORDER BY created_at_ms ASC",
        )
        .map_err(|e| format!("Failed to list squad_contract_allowlist: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![pid], |row| {
            Ok(SquadContractAllowlistRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                chain: row.get(2)?,
                contract_address: row.get(3)?,
                label: row.get(4)?,
                added_by_npub: row.get(5)?,
                abi_ref: row.get(6)?,
                notes: row.get(7)?,
                created_at_ms: row.get(8)?,
                updated_at_ms: row.get(9)?,
            })
        })
        .map_err(|e| format!("Failed to query squad_contract_allowlist: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[command]
pub fn upsert_squad_contract_allowlist<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    chain: String,
    contract_address: String,
    label: String,
    abi_ref: Option<String>,
    notes: Option<String>,
) -> Result<SquadContractAllowlistRow, String> {
    let pid = parent_id.trim();
    let chain_norm = normalize_allowlist_chain(&chain)?;
    let addr_norm = normalize_allowlist_address(&contract_address)?;
    let label_trim = label.trim().to_string();
    let added_by = crate::account_manager::get_current_account()?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    require_allowlist_mutation_allowed(&conn, pid)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = allowlist_row_id(pid, &chain_norm, &addr_norm);
    let abi = abi_ref
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let notes_out = notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let created_at_ms: i64 = conn
        .query_row(
            "SELECT created_at_ms FROM squad_contract_allowlist WHERE id = ?1",
            rusqlite::params![&id],
            |r| r.get(0),
        )
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO squad_contract_allowlist (id, parent_id, chain, contract_address, label, added_by_npub, abi_ref, notes, created_at_ms, updated_at_ms) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, abi_ref = excluded.abi_ref, notes = excluded.notes, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            &id,
            pid,
            &chain_norm,
            &addr_norm,
            &label_trim,
            &added_by,
            &abi,
            &notes_out,
            created_at_ms,
            now
        ],
    )
    .map_err(|e| format!("Failed to upsert squad_contract_allowlist: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(SquadContractAllowlistRow {
        id,
        parent_id: pid.to_string(),
        chain: chain_norm,
        contract_address: addr_norm,
        label: label_trim,
        added_by_npub: added_by,
        abi_ref: abi,
        notes: notes_out,
        created_at_ms,
        updated_at_ms: now,
    })
}

#[command]
pub fn remove_squad_contract_allowlist<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    id: String,
) -> Result<(), String> {
    let pid = parent_id.trim();
    let row_id = id.trim();
    if pid.is_empty() || row_id.is_empty() {
        return Err("parent_id and id are required.".to_string());
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    require_allowlist_mutation_allowed(&conn, pid)?;
    let n = conn
        .execute(
            "DELETE FROM squad_contract_allowlist WHERE id = ?1 AND parent_id = ?2",
            rusqlite::params![row_id, pid],
        )
        .map_err(|e| format!("Failed to remove squad_contract_allowlist: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    if n == 0 {
        return Err("Allowlist row not found.".to_string());
    }
    Ok(())
}

pub fn try_apply_squad_contract_allowlist_announce<R: Runtime>(handle: &AppHandle<R>, content: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return,
    };
    if parsed.get("type").and_then(|v| v.as_str()) != Some("squad_contract_allowlist_updated") {
        return;
    }
    let p = match parsed.get("payload") {
        Some(v) => v,
        None => return,
    };
    let parent_id = match p.get("parent_id").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let action = p.get("action").and_then(|v| v.as_str()).unwrap_or("upsert");
    let entry_id = p
        .get("entry_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if action == "remove" {
        if let Some(id) = entry_id {
            let conn = match crate::account_manager::get_db_connection(handle) {
                Ok(c) => c,
                Err(_) => return,
            };
            let _ = conn.execute(
                "DELETE FROM squad_contract_allowlist WHERE id = ?1 AND parent_id = ?2",
                rusqlite::params![id, parent_id],
            );
            crate::account_manager::return_db_connection(conn);
        }
        return;
    }
    let chain = match p.get("chain").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return,
    };
    let contract_address = match p.get("contract_address").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return,
    };
    let label = p
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let added_by = p
        .get("added_by_npub")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if added_by.is_empty() {
        return;
    }
    let abi_ref = p
        .get("abi_ref")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let notes = p.get("notes").and_then(|v| v.as_str()).map(str::to_string);
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return,
    };
    let chain_norm = match normalize_allowlist_chain(&chain) {
        Ok(c) => c,
        Err(_) => {
            crate::account_manager::return_db_connection(conn);
            return;
        }
    };
    let addr_norm = match normalize_allowlist_address(&contract_address) {
        Ok(a) => a,
        Err(_) => {
            crate::account_manager::return_db_connection(conn);
            return;
        }
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = entry_id
        .map(str::to_string)
        .unwrap_or_else(|| allowlist_row_id(parent_id, &chain_norm, &addr_norm));
    let created_at_ms: i64 = conn
        .query_row(
            "SELECT created_at_ms FROM squad_contract_allowlist WHERE id = ?1",
            rusqlite::params![&id],
            |r| r.get(0),
        )
        .unwrap_or(now);
    let _ = conn.execute(
        "INSERT INTO squad_contract_allowlist (id, parent_id, chain, contract_address, label, added_by_npub, abi_ref, notes, created_at_ms, updated_at_ms) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, abi_ref = excluded.abi_ref, notes = excluded.notes, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            &id,
            parent_id,
            &chain_norm,
            &addr_norm,
            label.trim(),
            added_by,
            &abi_ref,
            &notes,
            created_at_ms,
            now
        ],
    );
    crate::account_manager::return_db_connection(conn);
}

#[cfg(test)]
mod allowlist_tests {
    use super::allowlist_row_id;

    #[test]
    fn stable_allowlist_row_id_normalizes_address_case() {
        let id = allowlist_row_id(
            "parent-1",
            "sepolia",
            "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefAB",
        );
        assert_eq!(
            id,
            "allowlist-parent-1-sepolia-0xabcdefabcdefabcdefabcdefabcdefabcdefab"
        );
    }
}

fn upsert_squad_infra_inner<R: Runtime>(
    handle: &AppHandle<R>,
    id: &str,
    parent_id: &str,
    infra_type: &str,
    chain: Option<&str>,
    canonical_ref: &str,
    pacto_gov_revision: Option<&str>,
    provider_payload: Option<&str>,
) -> Result<(), String> {
    let row_id = id.trim();
    if row_id.is_empty() {
        return Err("id is empty".to_string());
    }
    if row_id.len() > SQUAD_INFRA_ID_MAX {
        return Err(format!("id exceeds {} characters", SQUAD_INFRA_ID_MAX));
    }
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err("parent_id is empty".to_string());
    }
    let kind = normalize_infra_type(infra_type)?;
    let chain_norm = normalize_treasury_chain(chain);
    let cref = canonical_ref.trim();
    if cref.is_empty() {
        return Err("canonical_ref is empty".to_string());
    }
    if cref.len() > SQUAD_INFRA_CANONICAL_REF_MAX {
        return Err(format!(
            "canonical_ref exceeds {} characters",
            SQUAD_INFRA_CANONICAL_REF_MAX
        ));
    }
    let rev: Option<String> = pacto_gov_revision
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.len() > SQUAD_INFRA_REVISION_MAX {
                s[..SQUAD_INFRA_REVISION_MAX].to_string()
            } else {
                s.to_string()
            }
        });
    let payload = provider_payload.map(str::trim).filter(|s| !s.is_empty());
    if payload.map(|p| p.len()).unwrap_or(0) > SQUAD_INFRA_PAYLOAD_MAX {
        return Err(format!(
            "provider_payload exceeds {} characters",
            SQUAD_INFRA_PAYLOAD_MAX
        ));
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let existing_created: Option<i64> = conn
        .query_row(
            "SELECT created_at_ms FROM squad_infra WHERE id = ?1",
            rusqlite::params![row_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read squad_infra created_at: {}", e))?;
    let created_ms = existing_created.unwrap_or(now_ms);
    conn.execute(
        "INSERT INTO squad_infra (id, parent_id, infra_type, chain, canonical_ref, pacto_gov_revision, provider_payload, created_at_ms, updated_at_ms) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
         ON CONFLICT(id) DO UPDATE SET \
           parent_id = excluded.parent_id, \
           infra_type = excluded.infra_type, \
           chain = excluded.chain, \
           canonical_ref = excluded.canonical_ref, \
           pacto_gov_revision = excluded.pacto_gov_revision, \
           provider_payload = excluded.provider_payload, \
           updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            row_id,
            pid,
            kind,
            chain_norm,
            cref,
            rev,
            payload,
            created_ms,
            now_ms,
        ],
    )
    .map_err(|e| format!("Failed to upsert squad_infra: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Stable SQLite row id for the sponsor infra entry for this parent.
pub fn squad_sponsor_infra_row_id(parent_id: &str) -> String {
    let pid = parent_id.trim();
    let direct = format!("sponsor-{pid}");
    if direct.len() <= SQUAD_INFRA_ID_MAX {
        direct
    } else {
        format!(
            "sp-{}",
            hex::encode(alloy::primitives::keccak256(pid.as_bytes()).as_slice())
        )
    }
}

/// Persist or refresh the sponsor infra row after deploy (and for announce ingest).
pub fn persist_sponsor_infra<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    chain: &str,
    sponsor_address: &str,
    provider_payload: &str,
) -> Result<(), String> {
    let norm = crate::evm::normalize_hex_address(sponsor_address.trim())
        .ok_or_else(|| "invalid sponsor address".to_string())?;
    upsert_squad_infra_inner(
        handle,
        squad_sponsor_infra_row_id(parent_id).as_str(),
        parent_id,
        "sponsor",
        Some(chain),
        norm.as_str(),
        None,
        Some(provider_payload),
    )
}

/// Stable SQLite row id for the squad-admin infra entry for this parent.
pub fn squad_admin_infra_row_id(parent_id: &str) -> String {
    let pid = parent_id.trim();
    let direct = format!("squad-admin-{pid}");
    if direct.len() <= SQUAD_INFRA_ID_MAX {
        direct
    } else {
        format!(
            "sa-{}",
            hex::encode(alloy::primitives::keccak256(pid.as_bytes()).as_slice())
        )
    }
}

/// Persist or refresh the squad-admin infra row after deploy (and for announce ingest).
pub fn persist_squad_admin_infra<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    chain: &str,
    squad_admin_proxy: &str,
    provider_payload: &str,
) -> Result<(), String> {
    let norm = crate::evm::normalize_hex_address(squad_admin_proxy.trim())
        .ok_or_else(|| "invalid squad admin address".to_string())?;
    upsert_squad_infra_inner(
        handle,
        squad_admin_infra_row_id(parent_id).as_str(),
        parent_id,
        "squad_admin",
        Some(chain),
        norm.as_str(),
        None,
        Some(provider_payload),
    )
}

/// Insert or replace a squad infra row keyed by stable `id`. Preserves `created_at_ms` on update.
#[command]
pub fn upsert_squad_infra<R: Runtime>(
    handle: AppHandle<R>,
    id: String,
    parent_id: String,
    infra_type: String,
    chain: Option<String>,
    canonical_ref: String,
    pacto_gov_revision: Option<String>,
    provider_payload: Option<String>,
) -> Result<(), String> {
    upsert_squad_infra_inner(
        &handle,
        id.as_str(),
        parent_id.as_str(),
        infra_type.as_str(),
        chain.as_deref(),
        canonical_ref.as_str(),
        pacto_gov_revision.as_deref(),
        provider_payload.as_deref(),
    )
}

/// If content is a squad_safe_updated announce JSON, upsert a treasury row (idempotent per parent + address + chain).
/// Wire format uses `squad_id` for the parent id. Optional: `chain`, `label`, `entry_id`.
pub fn apply_parent_safe_announce<R: Runtime>(handle: &AppHandle<R>, content: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return,
    };
    if parsed.get("type").and_then(|v| v.as_str()) != Some("squad_safe_updated") {
        return;
    }
    let p = match parsed.get("payload") {
        Some(v) => v,
        None => return,
    };
    let parent_id = match p.get("squad_id").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let safe_address = match p.get("safe_address").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let Some(norm) = crate::evm::normalize_hex_address(safe_address) else {
        return;
    };
    let chain = normalize_treasury_chain(p.get("chain").and_then(|v| v.as_str()));
    let lb_raw = p
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let lb = if lb_raw.len() > 200 {
        &lb_raw[..200]
    } else {
        lb_raw
    };
    let entry_id = p.get("entry_id").and_then(|v| v.as_str());
    let _ = upsert_parent_treasury_row(handle, parent_id, &norm, chain.as_str(), lb, entry_id);
}

/// If content is a `governance_updated` announce JSON, upsert `squad_infra` (merge by `entry_id` or generated id).
/// Wire format: `payload.parent_id`, `payload.provider`, `payload.canonical_ref`; optional `chain`, `pacto_gov_revision`, `provider_payload`, `entry_id`.
pub fn maybe_upsert_governance_from_announce<R: Runtime>(handle: &AppHandle<R>, content: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return,
    };
    if parsed.get("type").and_then(|v| v.as_str()) != Some("governance_updated") {
        return;
    }
    let p = match parsed.get("payload") {
        Some(v) => v,
        None => return,
    };
    let parent_id = match p.get("parent_id").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let provider = match p.get("provider").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let canonical_ref = match p.get("canonical_ref").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let chain = p.get("chain").and_then(|v| v.as_str()).and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let pacto_rev = p
        .get("pacto_gov_revision")
        .and_then(|v| v.as_str())
        .and_then(|s| {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });
    let provider_payload_str = p.get("provider_payload").and_then(|v| v.as_str()).and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let entry_id = p.get("entry_id").and_then(|v| v.as_str());
    let row_id = new_squad_infra_id(entry_id);
    let _ = upsert_squad_infra_inner(
        handle,
        row_id.as_str(),
        parent_id,
        provider,
        chain,
        canonical_ref,
        pacto_rev,
        provider_payload_str,
    );
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadMemberEvmRow {
    pub member_npub: String,
    pub evm_address: String,
    pub updated_at_ms: i64,
}

/// Persist this account's squad-visible EVM address for a parent (same id as squad/network root and announcements MLS group in current UX).
#[command]
pub fn upsert_squad_member_evm<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    evm_address: String,
) -> Result<(), String> {
    let member_npub = crate::account_manager::get_current_account()?;
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Err("parent_id is empty".to_string());
    }
    let norm = crate::evm::normalize_hex_address(evm_address.trim())
        .ok_or_else(|| "Invalid EVM address".to_string())?;
    crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(&handle, norm.as_str())?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO squad_member_evm (parent_id, member_npub, evm_address, updated_at_ms) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(parent_id, member_npub) DO UPDATE SET evm_address = excluded.evm_address, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![parent, member_npub.as_str(), norm, now_ms],
    )
    .map_err(|e| format!("Failed to upsert squad_member_evm: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[command]
pub fn list_squad_member_evm<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    alt_parent_id: Option<String>,
) -> Result<Vec<SquadMemberEvmRow>, String> {
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Ok(Vec::new());
    }
    let alt = alt_parent_id
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && *s != parent)
        .map(|s| s.to_string());

    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT member_npub, evm_address, updated_at_ms FROM squad_member_evm WHERE parent_id = ?1 ORDER BY member_npub ASC",
        )
        .map_err(|e| format!("Failed to list squad_member_evm: {}", e))?;

    let mut best: std::collections::HashMap<String, SquadMemberEvmRow> =
        std::collections::HashMap::new();
    let mut take_rows = |pid: &str| -> Result<(), String> {
        let rows = stmt
            .query_map(rusqlite::params![pid], |row| {
                Ok(SquadMemberEvmRow {
                    member_npub: row.get(0)?,
                    evm_address: row.get(1)?,
                    updated_at_ms: row.get(2)?,
                })
            })
            .map_err(|e| format!("Failed to query squad_member_evm: {}", e))?;
        for r in rows {
            let row = r.map_err(|e| e.to_string())?;
            best.entry(row.member_npub.clone())
                .and_modify(|existing| {
                    if row.updated_at_ms > existing.updated_at_ms {
                        *existing = row.clone();
                    }
                })
                .or_insert(row);
        }
        Ok(())
    };

    take_rows(parent)?;
    if let Some(ref a) = alt {
        take_rows(a)?;
    }

    drop(stmt);
    crate::account_manager::return_db_connection(conn);

    let mut out: Vec<SquadMemberEvmRow> = best.into_values().collect();
    out.sort_by(|a, b| a.member_npub.cmp(&b.member_npub));
    Ok(out)
}

/// Lookup squad/network `parent_id` for an on-chain infra address (e.g. Squad Admin proxy).
pub fn parent_id_for_canonical_infra_ref<R: Runtime>(
    handle: &AppHandle<R>,
    canonical_ref: &str,
) -> Result<Option<String>, String> {
    let Some(norm) = crate::evm::normalize_hex_address(canonical_ref.trim()) else {
        return Ok(None);
    };
    let conn = crate::account_manager::get_db_connection(handle)?;
    let parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM squad_infra WHERE lower(canonical_ref) = lower(?1) ORDER BY updated_at_ms DESC LIMIT 1",
            rusqlite::params![norm.as_str()],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to lookup squad_infra parent: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(parent.filter(|s| !s.trim().is_empty()))
}

/// Local per-squad roster signing account binding for the current user.
#[command]
pub fn upsert_squad_member_evm_account<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    evm_account_id: String,
) -> Result<SquadMemberEvmRow, String> {
    let member_npub = crate::account_manager::get_current_account()?;
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Err("parent_id is empty".to_string());
    }
    let account_id = evm_account_id.trim();
    if account_id.is_empty() {
        return Err("evm_account_id is empty".to_string());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    let purpose: String = conn
        .query_row(
            "SELECT purpose FROM evm_accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |r| r.get(0),
        )
        .map_err(|_| "Unknown EVM account.".to_string())?;
    if purpose.trim().eq_ignore_ascii_case("advanced") {
        crate::account_manager::return_db_connection(conn);
        return Err(
            "Advanced-purpose EVM accounts cannot be linked to squad rosters.".to_string(),
        );
    }
    let address: String = conn
        .query_row(
            "SELECT address FROM evm_accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |r| r.get(0),
        )
        .map_err(|_| "Unknown EVM account.".to_string())?;
    crate::account_manager::return_db_connection(conn);

    let norm = crate::evm::normalize_hex_address(address.trim())
        .ok_or_else(|| "Invalid EVM address".to_string())?;
    crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(&handle, norm.as_str())?;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let conn = crate::account_manager::get_db_connection(&handle)?;
    conn.execute(
        "INSERT INTO squad_member_evm_account (parent_id, member_npub, evm_account_id, updated_at_ms) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(parent_id, member_npub) DO UPDATE SET evm_account_id = excluded.evm_account_id, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![parent, member_npub.as_str(), account_id, now_ms],
    )
    .map_err(|e| format!("Failed to upsert squad_member_evm_account: {}", e))?;
    conn.execute(
        "INSERT INTO squad_member_evm (parent_id, member_npub, evm_address, updated_at_ms) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(parent_id, member_npub) DO UPDATE SET evm_address = excluded.evm_address, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![parent, member_npub.as_str(), norm, now_ms],
    )
    .map_err(|e| format!("Failed to upsert squad_member_evm: {}", e))?;
    crate::account_manager::return_db_connection(conn);

    Ok(SquadMemberEvmRow {
        member_npub,
        evm_address: norm,
        updated_at_ms: now_ms,
    })
}

pub(crate) fn get_squad_member_evm_account_id<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    member_npub: Option<&str>,
) -> Result<Option<String>, String> {
    let member = match member_npub.map(str::trim).filter(|s| !s.is_empty()) {
        Some(m) => m.to_string(),
        None => crate::account_manager::get_current_account()?,
    };
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Ok(None);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let id: Option<String> = conn
        .query_row(
            "SELECT evm_account_id FROM squad_member_evm_account WHERE parent_id = ?1 AND member_npub = ?2",
            rusqlite::params![parent, member.as_str()],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read squad_member_evm_account: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(id.filter(|s| !s.trim().is_empty()))
}

#[derive(serde::Serialize)]
pub struct EvmAccountSquadBindingRow {
    pub evm_account_id: String,
    pub parent_id: String,
}

/// All squad roster bindings for the current user keyed by EVM account id.
#[command]
pub fn list_evm_account_squad_bindings<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<Vec<EvmAccountSquadBindingRow>, String> {
    let member_npub = crate::account_manager::get_current_account()?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT evm_account_id, parent_id FROM squad_member_evm_account WHERE member_npub = ?1 ORDER BY parent_id",
        )
        .map_err(|e| format!("Failed to prepare squad binding query: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![member_npub.as_str()], |r| {
            Ok(EvmAccountSquadBindingRow {
                evm_account_id: r.get(0)?,
                parent_id: r.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to list squad bindings: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Failed to read squad binding row: {}", e))?);
    }
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[cfg(test)]
mod squad_binding_list_tests {
    use super::EvmAccountSquadBindingRow;

    fn list_bindings_for_member(
        conn: &rusqlite::Connection,
        member_npub: &str,
    ) -> rusqlite::Result<Vec<EvmAccountSquadBindingRow>> {
        let mut stmt = conn.prepare(
            "SELECT evm_account_id, parent_id FROM squad_member_evm_account WHERE member_npub = ?1 ORDER BY parent_id",
        )?;
        let rows = stmt.query_map(rusqlite::params![member_npub], |r| {
            Ok(EvmAccountSquadBindingRow {
                evm_account_id: r.get(0)?,
                parent_id: r.get(1)?,
            })
        })?;
        rows.collect()
    }

    #[test]
    fn lists_bindings_for_member_ordered_by_parent_id() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE squad_member_evm_account (
                parent_id TEXT NOT NULL,
                member_npub TEXT NOT NULL,
                evm_account_id TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (parent_id, member_npub)
            );",
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO squad_member_evm_account (parent_id, member_npub, evm_account_id, updated_at_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["squad-z", "npub1member", "acc-1", 1_i64],
        )
        .expect("insert z");
        conn.execute(
            "INSERT INTO squad_member_evm_account (parent_id, member_npub, evm_account_id, updated_at_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["squad-a", "npub1member", "acc-1", 2_i64],
        )
        .expect("insert a");
        conn.execute(
            "INSERT INTO squad_member_evm_account (parent_id, member_npub, evm_account_id, updated_at_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["squad-a", "npub1other", "acc-2", 3_i64],
        )
        .expect("insert other member");

        let rows = list_bindings_for_member(&conn, "npub1member").expect("query");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].parent_id, "squad-a");
        assert_eq!(rows[1].parent_id, "squad-z");
        assert!(rows.iter().all(|r| r.evm_account_id == "acc-1"));
    }
}

pub(crate) fn roster_evm_address_for_member<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    member_npub: &str,
) -> Result<Option<String>, String> {
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Ok(None);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let addr: Option<String> = conn
        .query_row(
            "SELECT evm_address FROM squad_member_evm WHERE parent_id = ?1 AND member_npub = ?2",
            rusqlite::params![parent, member_npub.trim()],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read squad_member_evm: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(addr
        .and_then(|a| crate::evm::normalize_hex_address(a.trim()))
        .filter(|s| !s.is_empty()))
}

/// Resolve roster-bound `0x` address: per-squad account binding → roster row → active squad signer.
#[command]
pub fn resolve_squad_roster_evm_address<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    member_npub: Option<String>,
) -> Result<Option<String>, String> {
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Ok(None);
    }
    let member = match member_npub
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        Some(m) => m.to_string(),
        None => crate::account_manager::get_current_account()?,
    };

    if let Some(account_id) = get_squad_member_evm_account_id(&handle, parent, Some(member.as_str()))? {
        let conn = crate::account_manager::get_db_connection(&handle)?;
        let addr: Option<String> = conn
            .query_row(
                "SELECT address FROM evm_accounts WHERE id = ?1",
                rusqlite::params![account_id.as_str()],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to read evm_accounts: {}", e))?;
        crate::account_manager::return_db_connection(conn);
        if let Some(a) = addr.and_then(|x| crate::evm::normalize_hex_address(x.trim())) {
            return Ok(Some(a));
        }
    }

    if let Some(addr) = roster_evm_address_for_member(&handle, parent, member.as_str())? {
        return Ok(Some(addr));
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    let active_id: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'active_evm_account_id'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("settings read: {}", e))?;
    let addr = if let Some(id) = active_id.filter(|s| !s.trim().is_empty()) {
        conn.query_row(
            "SELECT address FROM evm_accounts WHERE id = ?1 AND lower(purpose) = 'squad'",
            rusqlite::params![id.as_str()],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read active squad account: {}", e))?
    } else {
        None
    };
    crate::account_manager::return_db_connection(conn);
    Ok(addr.and_then(|a| crate::evm::normalize_hex_address(a.trim())))
}

/// Re-apply automation side effects for persisted MLS rows (governance, treasury, roster EVM).
pub async fn replay_automation_side_effects_for_chat<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
) -> Result<u32, String> {
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    let messages = get_message_views(handle, chat_int_id, 2000, 0, None).await?;
    for msg in &messages {
        apply_inbox_virtual_bucket_side_effects(
            handle,
            msg.virtual_bucket.as_deref(),
            &msg.content,
            msg.npub.as_deref(),
        );
    }
    Ok(messages.len() as u32)
}

/// Applies treasury (`squad_safe_updated`), governance (`governance_updated`), and roster EVM (`squad_member_evm_share`)
/// side effects when the MLS chat row is classified into the **inbox** virtual bucket (routing ADR).
/// Squad sponsor `governance_updated` announces also ingest from **announcements** so all members sync infra.
pub fn apply_inbox_virtual_bucket_side_effects<R: Runtime>(
    handle: &AppHandle<R>,
    virtual_bucket: Option<&str>,
    content: &str,
    author_npub: Option<&str>,
) {
    let derived_bucket = virtual_bucket.map(str::to_string).or_else(|| {
        crate::virtual_channel_bucket::normalize_virtual_bucket_for_message(
            crate::stored_event::event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        )
    });
    let effective_bucket = derived_bucket.as_deref();

    // Sponsor infra must sync for every squad member even when bucket metadata was missing on ingest.
    if is_sponsor_governance_announce_content(content) {
        maybe_upsert_governance_from_announce(handle, content);
    }

    if effective_bucket == Some("inbox") {
        try_apply_squad_member_evm_share(handle, content, author_npub);
        apply_parent_safe_announce(handle, content);
        maybe_upsert_governance_from_announce(handle, content);
        try_apply_squad_contract_allowlist_announce(handle, content);
        return;
    }
    if effective_bucket == Some("announcements") && is_sponsor_governance_announce_content(content) {
        return;
    }
}

fn is_sponsor_governance_announce_content(content: &str) -> bool {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(content.trim()) else {
        return false;
    };
    if val.get("type").and_then(|x| x.as_str()) != Some("governance_updated") {
        return false;
    }
    val.get("payload")
        .and_then(|p| p.get("provider"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().eq_ignore_ascii_case("sponsor"))
        .unwrap_or(false)
}

/// If `content` is a `squad_member_evm_share` JSON from MLS, store a normalized address for `author_npub` only.
pub fn try_apply_squad_member_evm_share<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return,
    };
    if parsed.get("type").and_then(|v| v.as_str()) != Some("squad_member_evm_share") {
        return;
    }
    let version_ok = match parsed.get("version") {
        None => true,
        Some(v) => v.as_u64() == Some(1),
    };
    if !version_ok {
        return;
    }
    let Some(p) = parsed.get("payload").filter(|v| v.is_object()) else {
        return;
    };
    let Some(parent_id) = p
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    let Some(raw_addr) = p
        .get("evm_address")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    let Some(norm) = crate::evm::normalize_hex_address(raw_addr) else {
        return;
    };
    if crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(handle, norm.as_str()).is_err() {
        return;
    }

    let Ok(conn) = crate::account_manager::get_db_connection(handle) else {
        return;
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let _ = conn.execute(
        "INSERT INTO squad_member_evm (parent_id, member_npub, evm_address, updated_at_ms) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(parent_id, member_npub) DO UPDATE SET evm_address = excluded.evm_address, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![parent_id, author, norm, now_ms],
    );
    crate::account_manager::return_db_connection(conn);
}

/// For each `member_npub`, if there is no `squad_member_evm` row yet for `parent_id`, insert one from
/// `profiles.evm_address` when it validates. Does not overwrite existing roster rows.
#[command]
pub fn backfill_squad_member_evm_missing_from_profiles<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    member_npubs: Vec<String>,
) -> Result<u32, String> {
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Ok(0);
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut inserted: u32 = 0;
    for npub_raw in member_npubs {
        let npub = npub_raw.trim();
        if npub.is_empty() {
            continue;
        }
        let exists = conn
            .query_row(
                "SELECT 1 FROM squad_member_evm WHERE parent_id = ?1 AND member_npub = ?2 LIMIT 1",
                rusqlite::params![parent, npub],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| format!("Failed to check squad_member_evm: {}", e))?
            .is_some();
        if exists {
            continue;
        }
        let Some(raw) = get_profile_evm_address(&handle, npub)? else {
            continue;
        };
        let Some(norm) = crate::evm::normalize_hex_address(raw.trim()) else {
            continue;
        };
        if crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(&handle, norm.as_str()).is_err() {
            continue;
        };
        conn.execute(
            "INSERT INTO squad_member_evm (parent_id, member_npub, evm_address, updated_at_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![parent, npub, norm, now_ms],
        )
        .map_err(|e| format!("Failed to backfill squad_member_evm: {}", e))?;
        inserted += 1;
    }
    crate::account_manager::return_db_connection(conn);
    Ok(inserted)
}

#[command]
pub async fn set_seed<R: Runtime>(handle: AppHandle<R>, seed: String) -> Result<(), String> {
    let encrypted_seed = internal_encrypt(seed, None).await;

    let conn = crate::account_manager::get_db_connection(&handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["seed", encrypted_seed],
    ).map_err(|e| format!("Failed to insert seed: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[command]
pub async fn get_seed<R: Runtime>(handle: AppHandle<R>) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let encrypted_seed: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params!["seed"],
        |row| row.get(0)
    ).ok();

    crate::account_manager::return_db_connection(conn);

    if let Some(encrypted) = encrypted_seed {
        match internal_decrypt(encrypted, None).await {
            Ok(decrypted) => return Ok(Some(decrypted)),
            Err(_) => return Err("Failed to decrypt seed phrase".to_string()),
        }
    }

    Ok(None)
}

/// Set a setting value in SQL database
#[command]
pub fn set_sql_setting<R: Runtime>(handle: AppHandle<R>, key: String, value: String) -> Result<(), String> {
    if let Ok(_npub) = crate::account_manager::get_current_account() {
        let conn = crate::account_manager::get_db_connection(&handle)?;

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![&key, &value],
        ).map_err(|e| format!("Failed to set setting: {}", e))?;

        crate::account_manager::return_db_connection(conn);
        return Ok(());
    }
    Ok(())
}

/// Get a setting value from SQL database
#[command]
pub fn get_sql_setting<R: Runtime>(handle: AppHandle<R>, key: String) -> Result<Option<String>, String> {
    if let Ok(_npub) = crate::account_manager::get_current_account() {
        let conn = crate::account_manager::get_db_connection(&handle)?;

        let result: Option<String> = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![&key],
            |row| row.get(0)
        ).ok();

        crate::account_manager::return_db_connection(conn);
        return Ok(result);
    }
    Ok(None)
}


#[command]
pub fn remove_setting<R: Runtime>(handle: AppHandle<R>, key: String) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let rows_affected = conn.execute(
        "DELETE FROM settings WHERE key = ?1",
        rusqlite::params![key],
    ).map_err(|e| format!("Failed to delete setting: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(rows_affected > 0)
}

/// Slim version of Chat for database storage
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SlimChatDB {
    pub id: String,  // The semantic ID (npub or group_id) - used in code
    pub chat_type: ChatType,
    pub participants: Vec<String>,
    pub last_read: String,
    pub created_at: u64,
    pub metadata: crate::ChatMetadata,
    pub muted: bool,
}

/// Helper function to get or create integer chat ID from identifier
/// Uses in-memory cache for maximum speed, only hits DB on cache miss
fn get_or_create_chat_id<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<i64, String> {
    // Check cache first (fast path - no DB access)
    {
        let cache = CHAT_ID_CACHE.read().unwrap();
        if let Some(&id) = cache.get(chat_identifier) {
            return Ok(id);
        }
    }

    // Cache miss - check database
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Try to get existing ID from database
    let existing_id: Option<i64> = conn.query_row(
        "SELECT id FROM chats WHERE chat_identifier = ?1",
        rusqlite::params![chat_identifier],
        |row| row.get(0)
    ).ok();

    let id = if let Some(id) = existing_id {
        id
    } else {
        // Create new chat entry with minimal data
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Determine chat type and participants based on chat_identifier format
        // DM chats have npub as identifier, MLS groups have hex group ID
        let (chat_type, participants_json) = if chat_identifier.starts_with("npub1") {
            // DM chat: participant is the other party (the chat_identifier itself)
            (0, format!("[\"{}\"]", chat_identifier))
        } else {
            // MLS group: participants managed separately, start with empty
            (1, "[]".to_string())
        };

        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata, muted)
             VALUES (?1, ?2, ?3, '', ?4, '{}', 0)",
            rusqlite::params![chat_identifier, chat_type, participants_json, now as i64],
        ).map_err(|e| format!("Failed to create chat: {}", e))?;

        // Get the auto-generated ID
        conn.last_insert_rowid()
    };

    // Return connection to pool
    crate::account_manager::return_db_connection(conn);

    // Update cache with the ID (write to both DB and cache)
    {
        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.insert(chat_identifier.to_string(), id);
    }

    Ok(id)
}

/// Virtual channel ids (UI-only, no MLS history row until first real message elsewhere).
fn is_pseudo_chat_identifier(id: &str) -> bool {
    id == "__dashboard__"
}

/// Resolve `chats.id` for loading message history. MLS groups get a DB row on demand so a brand-new
/// channel does not error before the first persisted message. DMs (`npub1`) and pseudo channels stay lookup-only.
pub fn resolve_chat_id_for_message_load<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<i64, String> {
    if chat_identifier.starts_with("npub1") || is_pseudo_chat_identifier(chat_identifier) {
        get_chat_id_by_identifier(handle, chat_identifier)
    } else {
        get_or_create_chat_id(handle, chat_identifier)
    }
}

/// Helper function to get integer chat ID from identifier (lookup only, no creation)
/// Returns an error if the chat doesn't exist
pub fn get_chat_id_by_identifier<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<i64, String> {
    // Check cache first (fast path - no DB access)
    {
        let cache = CHAT_ID_CACHE.read().unwrap();
        if let Some(&id) = cache.get(chat_identifier) {
            return Ok(id);
        }
    }

    // Cache miss - check database
    let conn = crate::account_manager::get_db_connection(handle)?;

    let id: i64 = conn.query_row(
        "SELECT id FROM chats WHERE chat_identifier = ?1",
        rusqlite::params![chat_identifier],
        |row| row.get(0)
    ).map_err(|_| format!("Chat not found: {}", chat_identifier))?;

    crate::account_manager::return_db_connection(conn);

    // Update cache
    {
        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.insert(chat_identifier.to_string(), id);
    }

    Ok(id)
}

/// Helper function to get or create integer user ID from npub
/// Uses in-memory cache for maximum speed, only hits DB on cache miss
fn get_or_create_user_id<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
) -> Result<Option<i64>, String> {
    // If npub is empty, return None (for messages without author)
    if npub.is_empty() {
        return Ok(None);
    }

    // Check cache first (fast path - no DB access)
    {
        let cache = USER_ID_CACHE.read().unwrap();
        if let Some(&id) = cache.get(npub) {
            return Ok(Some(id));
        }
    }

    // Cache miss - check database
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Try to get existing ID from database
    let existing_id: Option<i64> = conn.query_row(
        "SELECT id FROM profiles WHERE npub = ?1",
        rusqlite::params![npub],
        |row| row.get(0)
    ).ok();

    let id = if let Some(id) = existing_id {
        id
    } else {
        // Create new profile entry with minimal data (just the npub)
        conn.execute(
            "INSERT INTO profiles (npub, name, display_name) VALUES (?1, '', '')",
            rusqlite::params![npub],
        ).map_err(|e| format!("Failed to create profile stub: {}", e))?;

        // Get the auto-generated ID
        conn.last_insert_rowid()
    };

    // Return connection to pool
    crate::account_manager::return_db_connection(conn);

    // Update cache with the ID (write to both DB and cache)
    {
        let mut cache = USER_ID_CACHE.write().unwrap();
        cache.insert(npub.to_string(), id);
    }

    Ok(Some(id))
}

/// Preload all ID mappings into memory cache on app startup
/// This ensures all subsequent lookups are instant (no DB access)
pub async fn preload_id_caches<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let _npub = match crate::account_manager::get_current_account() {
        Ok(n) => n,
        Err(_) => return Ok(()), // No account selected, skip
    };

    let conn = crate::account_manager::get_db_connection(handle)?;

    // Load all chat ID mappings
    {
        let mut stmt = conn.prepare("SELECT chat_identifier, id FROM chats")
            .map_err(|e| format!("Failed to prepare chat query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }).map_err(|e| format!("Failed to query chats: {}", e))?;

        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.clear();

        for row in rows {
            let (identifier, id) = row.map_err(|e| format!("Failed to read chat row: {}", e))?;
            cache.insert(identifier, id);
        }
    }

    // Load all user ID mappings
    {
        let mut stmt = conn.prepare("SELECT npub, id FROM profiles")
            .map_err(|e| format!("Failed to prepare profile query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }).map_err(|e| format!("Failed to query profiles: {}", e))?;

        let mut cache = USER_ID_CACHE.write().unwrap();
        cache.clear();

        for row in rows {
            let (npub, id) = row.map_err(|e| format!("Failed to read profile row: {}", e))?;
            cache.insert(npub, id);
        }
    }

    // Return connection to pool
    crate::account_manager::return_db_connection(conn);

    Ok(())
}

/// Clear ID caches (useful when switching accounts)
pub fn clear_id_caches() {
    CHAT_ID_CACHE.write().unwrap().clear();
    USER_ID_CACHE.write().unwrap().clear();
}

impl From<&Chat> for SlimChatDB {
    fn from(chat: &Chat) -> Self {
        SlimChatDB {
            id: chat.id().clone(),
            chat_type: chat.chat_type().clone(),
            participants: chat.participants().clone(),
            last_read: chat.last_read().clone(),
            created_at: chat.created_at(),
            metadata: chat.metadata().clone(),
            muted: chat.muted(),
        }
    }
}

impl SlimChatDB {
    // Convert back to full Chat (messages will be loaded separately)
    pub fn to_chat(&self) -> Chat {
        let mut chat = Chat::new(self.id.clone(), self.chat_type.clone(), self.participants.clone());
        chat.last_read = self.last_read.clone();
        chat.created_at = self.created_at;
        chat.metadata = self.metadata.clone();
        chat.muted = self.muted;
        chat
    }
}

/// Get all chats from the database
pub async fn get_all_chats<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<SlimChatDB>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn.prepare("SELECT chat_identifier, chat_type, participants, last_read, created_at, metadata, muted FROM chats ORDER BY created_at DESC")
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let rows = stmt.query_map([], |row| {
        let participants_json: String = row.get(2)?;
        let participants: Vec<String> = serde_json::from_str(&participants_json).unwrap_or_default();

        let metadata_json: String = row.get(5)?;
        let metadata: crate::ChatMetadata = serde_json::from_str(&metadata_json).unwrap_or_default();

        let chat_type_int: i32 = row.get(1)?;
        let chat_type = crate::ChatType::from_i32(chat_type_int);

        Ok(SlimChatDB {
            id: row.get(0)?,  // chat_identifier (the semantic ID)
            chat_type,
            participants,
            last_read: row.get(3)?,
            created_at: row.get::<_, i64>(4)? as u64,
            metadata,
            muted: row.get::<_, i32>(6)? != 0,
        })
    })
    .map_err(|e| format!("Failed to query chats: {}", e))?;

    let chats: Vec<SlimChatDB> = rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect chats: {}", e))?;

    drop(stmt); // Explicitly drop stmt before returning connection
    crate::account_manager::return_db_connection(conn);
    Ok(chats)
}

/// Save a single chat to the database
pub async fn save_chat<R: Runtime>(handle: AppHandle<R>, chat: &Chat) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let slim_chat = SlimChatDB::from(chat);
    let chat_identifier = &slim_chat.id;

    let chat_type_int = slim_chat.chat_type.to_i32();
    let participants_json = serde_json::to_string(&slim_chat.participants)
        .unwrap_or_else(|_| "[]".to_string());
    let metadata_json = serde_json::to_string(&slim_chat.metadata)
        .unwrap_or_else(|_| "{}".to_string());

    // Use INSERT ... ON CONFLICT DO UPDATE to avoid triggering CASCADE delete
    conn.execute(
        "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata, muted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(chat_identifier) DO UPDATE SET
            chat_type = excluded.chat_type,
            participants = excluded.participants,
            last_read = excluded.last_read,
            metadata = excluded.metadata,
            muted = excluded.muted",
        rusqlite::params![
            chat_identifier,
            chat_type_int,
            participants_json,
            slim_chat.last_read,
            slim_chat.created_at as i64,
            metadata_json,
            slim_chat.muted as i32,
        ],
    ).map_err(|e| format!("Failed to upsert chat: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Delete a chat and all its messages from the database.
/// `chat_identifier` is the npub for DMs or group_id for MLS; events are CASCADE deleted.
pub async fn delete_chat<R: Runtime>(handle: AppHandle<R>, chat_identifier: &str) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let chat_int_id = get_chat_id_by_identifier(&handle, chat_identifier)?;

    conn.execute(
        "DELETE FROM chats WHERE id = ?1",
        rusqlite::params![chat_int_id],
    )
    .map_err(|e| format!("Failed to delete chat: {}", e))?;

    {
        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.remove(chat_identifier);
    }

    println!("[DB] Deleted chat and messages: {} (id {})", chat_identifier, chat_int_id);

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Save a single message to the database (efficient for incremental updates)
///
/// This function saves to the `events` table using the flat event architecture.
/// The old `messages` table is no longer written to - it only exists for
/// backward compatibility with migrated data (read-only fallback).
pub async fn save_message<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: &str,
    message: &Message
) -> Result<(), String> {
    // Get or create integer chat ID
    let chat_int_id = get_or_create_chat_id(&handle, chat_id)?;

    // Get or create integer user ID from npub
    let user_int_id = if let Some(ref npub_str) = message.npub {
        get_or_create_user_id(&handle, npub_str)?
    } else {
        None
    };

    // Save to events table (flat event architecture)
    let event = message_to_stored_event(message, chat_int_id, user_int_id);
    save_event(&handle, &event).await?;

    // Also save any reactions as separate kind=7 events
    for reaction in &message.reactions {
        // Check if reaction event already exists to avoid duplicates
        if !event_exists(&handle, &reaction.id)? {
            let user_id = get_or_create_user_id(&handle, &reaction.author_id)?;
            let is_mine = if let Ok(current_npub) = crate::account_manager::get_current_account() {
                reaction.author_id == current_npub
            } else {
                false
            };
            save_reaction_event(&handle, reaction, chat_int_id, user_id, is_mine).await?;
        }
    }

    Ok(())
}

/// Convert a Message to a StoredEvent for the flat event architecture
fn message_to_stored_event(message: &Message, chat_id: i64, user_id: Option<i64>) -> StoredEvent {
    // Determine event kind based on whether message has attachments
    let kind = if let Some(k) = message.rumor_kind {
        k
    } else if !message.attachments.is_empty() {
        event_kind::FILE_ATTACHMENT
    } else {
        event_kind::PRIVATE_DIRECT_MESSAGE
    };

    // Build tags array
    let mut tags: Vec<Vec<String>> = Vec::new();

    // Add millisecond precision tag
    let ms = message.at % 1000;
    if ms > 0 {
        tags.push(vec!["ms".to_string(), ms.to_string()]);
    }

    // Add reply reference tag if present
    if !message.replied_to.is_empty() {
        tags.push(vec![
            "e".to_string(),
            message.replied_to.clone(),
            "".to_string(),
            "reply".to_string(),
        ]);
    }

    // Add attachments as JSON tag for file messages
    if !message.attachments.is_empty() {
        if let Ok(attachments_json) = serde_json::to_string(&message.attachments) {
            tags.push(vec!["attachments".to_string(), attachments_json]);
        }
    }

    let virtual_bucket = message.virtual_bucket.clone().or_else(|| {
        crate::virtual_channel_bucket::normalize_virtual_bucket_for_message(kind, &message.content, &tags)
    });

    StoredEvent {
        id: message.id.clone(),
        kind,
        chat_id,
        user_id,
        content: message.content.clone(),
        tags,
        reference_id: None,
        created_at: message.at / 1000, // Convert ms to seconds
        received_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        mine: message.mine,
        pending: message.pending,
        failed: message.failed,
        wrapper_event_id: message.wrapper_event_id.clone(),
        npub: message.npub.clone(),
        virtual_bucket,
    }
}

/// Save multiple messages for a specific chat (batch operation)
///
/// This uses the flat event architecture - each message is stored as an event.
/// Reactions are stored as separate kind=7 events.
pub async fn save_chat_messages<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: &str,
    messages: &[Message]
) -> Result<(), String> {
    // Skip if no messages to save
    if messages.is_empty() {
        return Ok(());
    }

    // Save each message using the event-based save_message function
    for message in messages {
        if let Err(e) = save_message(handle.clone(), chat_id, message).await {
            eprintln!("Failed to save message {}: {}", &message.id[..8.min(message.id.len())], e);
        }
    }

    Ok(())
}

// ============================================================================
// MLS Metadata SQL Functions
// ============================================================================

/// Save MLS groups to SQL database (plaintext columns)
pub async fn save_mls_groups<R: Runtime>(
    handle: AppHandle<R>,
    groups: &[crate::mls::MlsGroupMetadata],
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    // Store each group in the mls_groups table (all fields as columns)
    for group in groups {
        conn.execute(
            "INSERT OR REPLACE INTO mls_groups (group_id, engine_group_id, creator_pubkey, name, avatar_ref, created_at, updated_at, evicted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                group.group_id,
                group.engine_group_id,
                group.creator_pubkey,
                group.name,
                group.avatar_ref,
                group.created_at as i64,
                group.updated_at as i64,
                group.evicted as i32,
            ],
        ).map_err(|e| format!("Failed to save MLS group {}: {}", group.group_id, e))?;
    }

    println!("[SQL] Saved {} MLS groups to mls_groups table", groups.len());
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Save a single MLS group to SQL database (plaintext columns) - more efficient for adding new groups
pub async fn save_mls_group<R: Runtime>(
    handle: AppHandle<R>,
    group: &crate::mls::MlsGroupMetadata,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    // Insert or replace a single group
    conn.execute(
        "INSERT OR REPLACE INTO mls_groups (group_id, engine_group_id, creator_pubkey, name, avatar_ref, created_at, updated_at, evicted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            group.group_id,
            group.engine_group_id,
            group.creator_pubkey,
            group.name,
            group.avatar_ref,
            group.created_at as i64,
            group.updated_at as i64,
            group.evicted as i32,
        ],
    ).map_err(|e| format!("Failed to save MLS group {}: {}", group.group_id, e))?;

    println!("[SQL] Saved 1 MLS group to mls_groups table");
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Load MLS groups from SQL database (plaintext columns)
pub async fn load_mls_groups<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<crate::mls::MlsGroupMetadata>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Load from mls_groups table
    let mut stmt = conn.prepare(
        "SELECT group_id, engine_group_id, creator_pubkey, name, avatar_ref, created_at, updated_at, evicted FROM mls_groups"
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt.query_map([], |row| {
        Ok(crate::mls::MlsGroupMetadata {
            group_id: row.get(0)?,
            engine_group_id: row.get(1)?,
            creator_pubkey: row.get(2)?,
            name: row.get(3)?,
            avatar_ref: row.get(4)?,
            created_at: row.get::<_, i64>(5)? as u64,
            updated_at: row.get::<_, i64>(6)? as u64,
            evicted: row.get::<_, i32>(7)? != 0,
        })
    }).map_err(|e| format!("Failed to query mls_groups: {}", e))?;

    let groups: Vec<crate::mls::MlsGroupMetadata> = rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect groups: {}", e))?;

    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(groups)
}

/// Save MLS keypackage index to SQL database (plaintext)
pub async fn save_mls_keypackages<R: Runtime>(
    handle: AppHandle<R>,
    packages: &[serde_json::Value],
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    // Clear existing keypackages
    conn.execute("DELETE FROM mls_keypackages", [])
        .map_err(|e| format!("Failed to clear MLS keypackages: {}", e))?;

    // Insert new keypackages
    for pkg in packages {
        let owner_pubkey = pkg.get("owner_pubkey").and_then(|v| v.as_str()).unwrap_or("");
        let device_id = pkg.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
        let keypackage_ref = pkg.get("keypackage_ref").and_then(|v| v.as_str()).unwrap_or("");
        let fetched_at = pkg.get("fetched_at").and_then(|v| v.as_u64()).unwrap_or(0);
        let expires_at = pkg.get("expires_at").and_then(|v| v.as_u64()).unwrap_or(0);

        conn.execute(
            "INSERT INTO mls_keypackages (owner_pubkey, device_id, keypackage_ref, fetched_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![owner_pubkey, device_id, keypackage_ref, fetched_at as i64, expires_at as i64],
        ).map_err(|e| format!("Failed to insert MLS keypackage: {}", e))?;
    }

    println!("[SQL] Saved {} MLS keypackages", packages.len());
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Load MLS keypackage index from SQL database (plaintext)
pub async fn load_mls_keypackages<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn.prepare(
        "SELECT owner_pubkey, device_id, keypackage_ref, fetched_at, expires_at FROM mls_keypackages"
    ).map_err(|e| format!("Failed to prepare MLS keypackages query: {}", e))?;

    let rows = stmt.query_map([], |row| {
        let fetched_at: i64 = row.get(3)?;
        let expires_at: i64 = row.get(4)?;
        Ok(serde_json::json!({
            "owner_pubkey": row.get::<_, String>(0)?,
            "device_id": row.get::<_, String>(1)?,
            "keypackage_ref": row.get::<_, String>(2)?,
            "fetched_at": fetched_at as u64,
            "expires_at": expires_at as u64,
        }))
    }).map_err(|e| format!("Failed to query MLS keypackages: {}", e))?;

    let packages: Vec<serde_json::Value> = rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect MLS keypackages: {}", e))?;

    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(packages)
}

/// Save MLS event cursors to SQL database (plaintext)
pub async fn save_mls_event_cursors<R: Runtime>(
    handle: AppHandle<R>,
    cursors: &HashMap<String, crate::mls::EventCursor>,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    for (group_id, cursor) in cursors {
        conn.execute(
            "INSERT OR REPLACE INTO mls_event_cursors (group_id, last_seen_event_id, last_seen_at)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![group_id, &cursor.last_seen_event_id, cursor.last_seen_at as i64],
        ).map_err(|e| format!("Failed to save MLS event cursor: {}", e))?;
    }

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Load MLS event cursors from SQL database (plaintext)
pub async fn load_mls_event_cursors<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<HashMap<String, crate::mls::EventCursor>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn.prepare(
        "SELECT group_id, last_seen_event_id, last_seen_at FROM mls_event_cursors"
    ).map_err(|e| format!("Failed to prepare MLS event cursors query: {}", e))?;

    let rows = stmt.query_map([], |row| {
        let group_id: String = row.get(0)?;
        let last_seen_at: i64 = row.get(2)?;
        let cursor = crate::mls::EventCursor {
            last_seen_event_id: row.get(1)?,
            last_seen_at: last_seen_at as u64,
        };
        Ok((group_id, cursor))
    }).map_err(|e| format!("Failed to query MLS event cursors: {}", e))?;

    let cursors: HashMap<String, crate::mls::EventCursor> = rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| format!("Failed to collect MLS event cursors: {}", e))?;

    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(cursors)
}

/// Save MLS device ID to SQL database (plaintext)
pub async fn save_mls_device_id<R: Runtime>(
    handle: AppHandle<R>,
    device_id: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('mls_device_id', ?1)",
        rusqlite::params![device_id],
    ).map_err(|e| format!("Failed to save MLS device ID to SQL: {}", e))?;

    println!("[SQL] Saved MLS device ID");
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Load MLS device ID from SQL database (plaintext)
pub async fn load_mls_device_id<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let device_id: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = 'mls_device_id'",
        [],
        |row| row.get(0)
    ).ok();

    crate::account_manager::return_db_connection(conn);
    Ok(device_id)
}

/// Lightweight attachment reference for file deduplication
/// Contains only the data needed to reuse an existing upload
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AttachmentRef {
    /// The SHA256 hash of the original file (used as ID)
    pub hash: String,
    /// The message ID containing this attachment
    pub message_id: String,
    /// The chat ID containing this message
    pub chat_id: String,
    /// The encrypted file URL on the server
    pub url: String,
    /// The encryption key
    pub key: String,
    /// The encryption nonce
    pub nonce: String,
    /// The file extension
    pub extension: String,
    /// The encrypted file size
    pub size: u64,
}

/// Build a file hash index from all attachments in the database
/// This is used for file deduplication without loading full message content
/// Returns a HashMap of file_hash -> AttachmentRef
pub async fn build_file_hash_index<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<HashMap<String, AttachmentRef>, String> {
    use crate::stored_event::event_kind;

    let mut index: HashMap<String, AttachmentRef> = HashMap::new();

    let conn = crate::account_manager::get_db_connection(handle)?;

    // Query file attachment events (kind=15) from the events table
    // Attachments are stored in the tags field as JSON
    let attachment_data: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT e.id, c.chat_identifier, e.tags
             FROM events e
             JOIN chats c ON e.chat_id = c.id
             WHERE e.kind = ?1"
        ).map_err(|e| format!("Failed to prepare attachment query: {}", e))?;

        let rows = stmt.query_map(rusqlite::params![event_kind::FILE_ATTACHMENT], |row| {
            Ok((
                row.get::<_, String>(0)?, // event_id (message_id)
                row.get::<_, String>(1)?, // chat_identifier
                row.get::<_, String>(2)?, // tags JSON
            ))
        }).map_err(|e| format!("Failed to query attachments: {}", e))?;

        // Collect immediately to consume the iterator while stmt is still alive
        let result: Result<Vec<_>, _> = rows.collect();
        result.map_err(|e| format!("Failed to collect attachment rows: {}", e))?
    }; // stmt is dropped here

    // Return connection to pool before processing
    crate::account_manager::return_db_connection(conn);

    // Process the collected data
    const EMPTY_FILE_HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    for (message_id, chat_id, tags_json) in attachment_data {
        // Parse tags to find the "attachments" tag
        let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

        // Find the attachments tag: ["attachments", "<json>"]
        let attachments_json = tags.iter()
            .find(|tag| tag.first().map(|s| s.as_str()) == Some("attachments"))
            .and_then(|tag| tag.get(1))
            .map(|s| s.as_str())
            .unwrap_or("[]");

        // Parse the attachments JSON
        let attachments: Vec<crate::Attachment> = serde_json::from_str(attachments_json)
            .unwrap_or_default();

        // Add each attachment to the index (skip empty hashes and empty URLs)
        for attachment in attachments {
            if !attachment.id.is_empty()
                && attachment.id != EMPTY_FILE_HASH
                && !attachment.url.is_empty()
            {
                index.insert(attachment.id.clone(), AttachmentRef {
                    hash: attachment.id,
                    message_id: message_id.clone(),
                    chat_id: chat_id.clone(),
                    url: attachment.url,
                    key: attachment.key,
                    nonce: attachment.nonce,
                    extension: attachment.extension,
                    size: attachment.size,
                });
            }
        }
    }

    Ok(index)
}

/// Get paginated messages for a chat (newest first, with offset)
/// This allows loading messages on-demand instead of all at once
///
/// Parameters:
/// - chat_id: The chat identifier (npub for DMs, group_id for groups)
/// - limit: Maximum number of messages to return
/// - offset: Number of messages to skip from the newest
///
/// Returns messages in chronological order (oldest first within the batch)
/// NOTE: This now uses the events table via get_message_views
pub async fn get_chat_messages_paginated<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<Message>, String> {
    // Get integer chat ID
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    // Use the events-based message views
    get_message_views(handle, chat_int_id, limit, offset, None).await
}

/// Get the total message count for a chat
/// This is useful for the frontend to know how many messages exist without loading them all
pub async fn get_chat_message_count<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
) -> Result<usize, String> {
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Count message events (kind 14 = DM, kind 15 = file) from events table
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM events WHERE chat_id = ?1 AND kind IN (14, 15, 30078)",
        rusqlite::params![chat_int_id],
        |row| row.get(0)
    ).map_err(|e| format!("Failed to count messages: {}", e))?;

    crate::account_manager::return_db_connection(conn);

    Ok(count as usize)
}

/// Get the last N messages for a chat (for preview purposes)
/// This is optimized for getting just the most recent messages without loading the full history
pub async fn get_chat_last_messages<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    count: usize,
) -> Result<Vec<Message>, String> {
    // Get integer chat ID
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    // Use the events-based message views
    get_message_views(handle, chat_int_id, count, 0, None).await
}

/// For DM chats: whether there is at least one message from us and one from them.
/// Used by init_finished so the frontend can show Friends vs Requests vs Pending correctly
/// even when only the last message is loaded for preview.
pub fn get_dm_sent_received<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<(bool, bool), String> {
    let chat_int_id = get_chat_id_by_identifier(handle, chat_identifier)?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    let has_from_me: i32 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE chat_id = ?1 AND kind IN (14, 15) AND mine = 1)",
        rusqlite::params![chat_int_id],
        |row| row.get(0),
    ).map_err(|e| format!("get_dm_sent_received (from_me): {}", e))?;
    let has_from_them: i32 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE chat_id = ?1 AND kind IN (14, 15) AND mine = 0)",
        rusqlite::params![chat_int_id],
        |row| row.get(0),
    ).map_err(|e| format!("get_dm_sent_received (from_them): {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok((has_from_me != 0, has_from_them != 0))
}

/// Get messages around a specific message ID
/// Returns messages from (target - context_before) to the most recent
/// This is used for scrolling to old replied-to messages
pub async fn get_messages_around_id<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    target_message_id: &str,
    context_before: usize,
) -> Result<Vec<Message>, String> {
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;

    // First, find the timestamp of the target message (don't require chat_id match in case of edge cases)
    let target_timestamp: i64 = {
        let conn = crate::account_manager::get_db_connection(handle)?;
        // Try to find in the specified chat first
        let ts_result = conn.query_row(
            "SELECT created_at FROM events WHERE id = ?1 AND chat_id = ?2",
            rusqlite::params![target_message_id, chat_int_id],
            |row| row.get(0)
        );

        let ts = match ts_result {
            Ok(t) => t,
            Err(_) => {
                // Message not found in specified chat, try finding it anywhere
                conn.query_row(
                    "SELECT created_at FROM events WHERE id = ?1",
                    rusqlite::params![target_message_id],
                    |row| row.get(0)
                ).map_err(|e| format!("Target message not found in any chat: {}", e))?
            }
        };
        crate::account_manager::return_db_connection(conn);
        ts
    };

    // Count how many messages are older than the target in this chat
    let older_count: i64 = {
        let conn = crate::account_manager::get_db_connection(handle)?;
        let count = conn.query_row(
            "SELECT COUNT(*) FROM events WHERE chat_id = ?1 AND kind IN (14, 15, 30078) AND created_at < ?2",
            rusqlite::params![chat_int_id, target_timestamp],
            |row| row.get(0)
        ).map_err(|e| format!("Failed to count older messages: {}", e))?;
        crate::account_manager::return_db_connection(conn);
        count
    };

    // Get total message count for this chat
    let total_count = get_chat_message_count(handle, chat_id).await?;

    // Calculate the starting position (from oldest = 0)
    // We want messages from (target - context_before) to the newest
    let start_position = (older_count as usize).saturating_sub(context_before);

    // get_message_views uses ORDER BY created_at DESC, so:
    // - offset 0 = newest message
    // - To get messages from position P to newest with DESC ordering, use offset=0, limit=(total - P)
    let limit = total_count.saturating_sub(start_position);

    // offset = 0 to start from the newest and get all messages back to start_position
    get_message_views(handle, chat_int_id, limit, 0, None).await
}

/// Check if a message/event exists in the database by its ID
/// This is used to prevent duplicate processing during sync
pub async fn message_exists_in_db<R: Runtime>(
    handle: &AppHandle<R>,
    message_id: &str,
) -> Result<bool, String> {
    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(false), // No DB, let in-memory check handle it
    };

    // Check in events table (unified storage)
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
        rusqlite::params![message_id],
        |row| row.get(0)
    ).map_err(|e| format!("Failed to check event existence: {}", e))?;

    crate::account_manager::return_db_connection(conn);

    Ok(exists)
}

/// Check if a wrapper (giftwrap) event ID exists in the database
/// This allows skipping the expensive unwrap operation for already-processed events
pub async fn wrapper_event_exists<R: Runtime>(
    handle: &AppHandle<R>,
    wrapper_event_id: &str,
) -> Result<bool, String> {
    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(false), // No DB, can't check
    };

    // Check in events table (unified storage)
    let in_events: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE wrapper_event_id = ?1)",
        rusqlite::params![wrapper_event_id],
        |row| row.get(0)
    ).map_err(|e| format!("Failed to check wrapper event existence: {}", e))?;

    let in_discarded: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM discarded_giftwraps WHERE wrapper_id = ?1)",
            rusqlite::params![wrapper_event_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    crate::account_manager::return_db_connection(conn);

    Ok(in_events || in_discarded)
}

/// Remember a gift-wrap id we intentionally did not store (e.g. blocked DM peer) so historic sync skips re-decrypt.
pub async fn record_discarded_giftwrap<R: Runtime>(
    handle: &AppHandle<R>,
    wrapper_id: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO discarded_giftwraps (wrapper_id) VALUES (?1)",
        [wrapper_id],
    )
    .map_err(|e| format!("Failed to record discarded giftwrap: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Update the wrapper event ID for an existing event
/// This is called when we process an event that was previously stored without its wrapper ID
/// Returns: Ok(true) if updated, Ok(false) if event already had a wrapper_id (duplicate giftwrap)
pub async fn update_wrapper_event_id<R: Runtime>(
    handle: &AppHandle<R>,
    event_id: &str,
    wrapper_event_id: &str,
) -> Result<bool, String> {
    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(false), // No DB, nothing to update
    };

    // Update in events table (unified storage)
    let rows_updated = match conn.execute(
        "UPDATE events SET wrapper_event_id = ?1 WHERE id = ?2 AND (wrapper_event_id IS NULL OR wrapper_event_id = '')",
        rusqlite::params![wrapper_event_id, event_id],
    ) {
        Ok(n) => n,
        Err(e) => {
            crate::account_manager::return_db_connection(conn);
            return Err(format!("Failed to update wrapper event ID: {}", e));
        }
    };

    crate::account_manager::return_db_connection(conn);

    // Returns true if backfill succeeded, false if event already has a wrapper_id (duplicate giftwrap)
    Ok(rows_updated > 0)
}

/// Load recent wrapper_event_ids into a HashSet for fast duplicate detection
/// This preloads wrapper_ids from the last N days to avoid SQL queries during sync
pub async fn load_recent_wrapper_ids<R: Runtime>(
    handle: &AppHandle<R>,
    days: u64,
) -> Result<std::collections::HashSet<String>, String> {
    let mut wrapper_ids = std::collections::HashSet::new();

    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(wrapper_ids), // No DB, return empty set
    };

    // Calculate timestamp for N days ago (in seconds, matching events.created_at)
    let cutoff_secs = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs())
        .saturating_sub(days * 24 * 60 * 60);

    // Query all wrapper_event_ids from recent events
    let result: Result<Vec<String>, _> = {
        let mut stmt = conn.prepare(
            "SELECT wrapper_event_id FROM events
             WHERE wrapper_event_id IS NOT NULL
             AND wrapper_event_id != ''
             AND created_at >= ?1"
        ).map_err(|e| format!("Failed to prepare wrapper_id query: {}", e))?;

        let rows = stmt.query_map(rusqlite::params![cutoff_secs as i64], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| format!("Failed to query wrapper_ids: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect wrapper_ids: {}", e))
    };

    crate::account_manager::return_db_connection(conn);

    match result {
        Ok(ids) => {
            for id in ids {
                wrapper_ids.insert(id);
            }
            Ok(wrapper_ids)
        }
        Err(_) => {
            Ok(wrapper_ids) // Return empty set on error, will fall back to DB queries
        }
    }
}

/// Update the downloaded status of an attachment in the database
pub fn update_attachment_downloaded_status<R: Runtime>(
    handle: &AppHandle<R>,
    _chat_id: &str,  // No longer needed - we query by event ID directly
    msg_id: &str,
    attachment_id: &str,
    downloaded: bool,
    path: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Get the current tags JSON from the events table
    let tags_json: String = conn.query_row(
        "SELECT tags FROM events WHERE id = ?1",
        rusqlite::params![msg_id],
        |row| row.get(0)
    ).map_err(|e| format!("Event not found: {}", e))?;

    // Parse the tags
    let mut tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

    // Find the "attachments" tag
    let attachments_tag_idx = tags.iter().position(|tag| {
        tag.first().map(|s| s.as_str()) == Some("attachments")
    });

    let attachments_json = attachments_tag_idx
        .and_then(|idx| tags.get(idx))
        .and_then(|tag| tag.get(1))
        .map(|s| s.as_str())
        .unwrap_or("[]");

    // Parse and update the attachment
    let mut attachments: Vec<Attachment> = serde_json::from_str(attachments_json).unwrap_or_default();

    if let Some(att) = attachments.iter_mut().find(|a| a.id == attachment_id) {
        att.downloaded = downloaded;
        att.downloading = false;
        att.path = path.to_string();
    } else {
        crate::account_manager::return_db_connection(conn);
        return Err("Attachment not found in event".to_string());
    }

    // Serialize the updated attachments back to JSON
    let updated_attachments_json = serde_json::to_string(&attachments)
        .map_err(|e| format!("Failed to serialize attachments: {}", e))?;

    // Update the tags array - either update existing "attachments" tag or add new one
    if let Some(idx) = attachments_tag_idx {
        tags[idx] = vec!["attachments".to_string(), updated_attachments_json];
    } else {
        tags.push(vec!["attachments".to_string(), updated_attachments_json]);
    }

    // Serialize the tags back to JSON
    let updated_tags_json = serde_json::to_string(&tags)
        .map_err(|e| format!("Failed to serialize tags: {}", e))?;

    // Update the event in the database
    conn.execute(
        "UPDATE events SET tags = ?1 WHERE id = ?2",
        rusqlite::params![updated_tags_json, msg_id],
    ).map_err(|e| format!("Failed to update event: {}", e))?;

    crate::account_manager::return_db_connection(conn);

    Ok(())
}

/// Vacuum the database to reclaim space and optimize performance
pub fn vacuum_database<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute_batch("VACUUM;")
        .map_err(|e| format!("Failed to vacuum database: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    println!("[DB] Database vacuumed successfully");
    Ok(())
}

/// Check if vacuum is needed and perform it if so
/// Vacuums if it hasn't been done in the last 7 days
pub async fn check_and_vacuum_if_needed<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Check when last vacuum was performed
    let last_vacuum: Option<i64> = conn.query_row(
        "SELECT value FROM settings WHERE key = 'last_vacuum'",
        [],
        |row| row.get(0)
    ).ok().and_then(|s: String| s.parse().ok());

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let seven_days_secs = 7 * 24 * 60 * 60;

    let should_vacuum = match last_vacuum {
        Some(last) => now - last > seven_days_secs,
        None => true, // Never vacuumed
    };

    crate::account_manager::return_db_connection(conn);

    if should_vacuum {
        vacuum_database(handle)?;

        // Update last vacuum timestamp
        let conn = crate::account_manager::get_db_connection(handle)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_vacuum', ?1)",
            rusqlite::params![now.to_string()],
        ).map_err(|e| format!("Failed to update last_vacuum: {}", e))?;
        crate::account_manager::return_db_connection(conn);
    }

    Ok(())
}

// ============================================================================
// Event Storage Functions (Flat Event-Based Architecture)
// ============================================================================

/// Save a StoredEvent to the events table
///
/// This is the primary storage function for the flat event architecture.
/// All events (messages, reactions, attachments, etc.) are stored as flat rows.
pub async fn save_event<R: Runtime>(
    handle: &AppHandle<R>,
    event: &StoredEvent,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Serialize tags to JSON
    let tags_json = serde_json::to_string(&event.tags)
        .unwrap_or_else(|_| "[]".to_string());

    // For message and edit events, encrypt the content
    let content = if event.kind == event_kind::PRIVATE_DIRECT_MESSAGE
        || event.kind == event_kind::MESSAGE_EDIT
    {
        internal_encrypt(event.content.clone(), None).await
    } else {
        event.content.clone()
    };

    // Use INSERT OR IGNORE to skip if event already exists (deduplication)
    conn.execute(
        r#"
        INSERT OR IGNORE INTO events (
            id, kind, chat_id, user_id, content, tags, reference_id,
            created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        "#,
        rusqlite::params![
            event.id,
            event.kind as i32,
            event.chat_id,
            event.user_id,
            content,
            tags_json,
            event.reference_id,
            event.created_at as i64,
            event.received_at as i64,
            event.mine as i32,
            event.pending as i32,
            event.failed as i32,
            event.wrapper_event_id,
            event.npub,
            event.virtual_bucket,
        ],
    ).map_err(|e| format!("Failed to save event: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Save a reaction as a kind=7 event in the events table
///
/// Reactions are stored as separate events referencing the message they react to.
/// This is the Nostr-standard way to store reactions (NIP-25).
pub async fn save_reaction_event<R: Runtime>(
    handle: &AppHandle<R>,
    reaction: &Reaction,
    chat_id: i64,
    user_id: Option<i64>,
    mine: bool,
) -> Result<(), String> {
    let event = StoredEvent {
        id: reaction.id.clone(),
        kind: event_kind::REACTION,
        chat_id,
        user_id,
        content: reaction.emoji.clone(),
        tags: vec![
            vec!["e".to_string(), reaction.reference_id.clone()],
        ],
        reference_id: Some(reaction.reference_id.clone()),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        received_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        mine,
        pending: false,
        failed: false,
        wrapper_event_id: None,
        npub: Some(reaction.author_id.clone()),
        virtual_bucket: None,
    };

    save_event(handle, &event).await
}

/// Save a message edit as a kind=16 event in the events table
///
/// Edit events reference the original message and contain the new content.
/// The content is encrypted just like DM content.
pub async fn save_edit_event<R: Runtime>(
    handle: &AppHandle<R>,
    edit_id: &str,
    message_id: &str,
    new_content: &str,
    chat_id: i64,
    user_id: Option<i64>,
    npub: &str,
) -> Result<(), String> {
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let event = StoredEvent {
        id: edit_id.to_string(),
        kind: event_kind::MESSAGE_EDIT,
        chat_id,
        user_id,
        content: new_content.to_string(),
        tags: vec![
            vec!["e".to_string(), message_id.to_string(), "".to_string(), "edit".to_string()],
        ],
        reference_id: Some(message_id.to_string()),
        created_at: now_secs,
        received_at: now_ms,
        mine: true,
        pending: false,
        failed: false,
        wrapper_event_id: None,
        npub: Some(npub.to_string()),
        virtual_bucket: None,
    };

    save_event(handle, &event).await
}

/// Check if an event exists in the events table
pub fn event_exists<R: Runtime>(
    handle: &AppHandle<R>,
    event_id: &str,
) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
        rusqlite::params![event_id],
        |row| row.get(0),
    ).map_err(|e| format!("Failed to check event existence: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(exists)
}

/// Check if an event exists by wrapper event ID (for deduplication during sync)
pub fn event_exists_by_wrapper<R: Runtime>(
    handle: &AppHandle<R>,
    wrapper_event_id: &str,
) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE wrapper_event_id = ?1)",
        rusqlite::params![wrapper_event_id],
        |row| row.get(0),
    ).map_err(|e| format!("Failed to check event by wrapper: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(exists)
}

/// Get events for a chat with pagination
///
/// Returns events ordered by created_at descending (newest first).
/// Optionally filter by event kinds.
pub async fn get_events<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: i64,
    kinds: Option<&[u16]>,
    limit: usize,
    offset: usize,
) -> Result<Vec<StoredEvent>, String> {
    // Do all SQLite work synchronously in a block to avoid Send issues
    let events: Vec<StoredEvent> = {
        let conn = crate::account_manager::get_db_connection(handle)?;

        // Build query based on whether kinds filter is provided
        let events = if let Some(k) = kinds {
            // Build numbered placeholders for the IN clause
            // chat_id=?1, kinds=?2,?3,..., limit=?N, offset=?N+1
            let kind_placeholders: String = (0..k.len())
                .map(|i| format!("?{}", i + 2))
                .collect::<Vec<_>>()
                .join(",");
            let limit_param = k.len() + 2;
            let offset_param = k.len() + 3;

            let sql = format!(
                r#"
                SELECT id, kind, chat_id, user_id, content, tags, reference_id,
                       created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
                FROM events
                WHERE chat_id = ?1 AND kind IN ({})
                ORDER BY created_at DESC
                LIMIT ?{} OFFSET ?{}
                "#,
                kind_placeholders, limit_param, offset_param
            );

            let mut stmt = conn.prepare(&sql)
                .map_err(|e| format!("Failed to prepare events query: {}", e))?;

            // Use rusqlite params! macro with dynamic kinds
            let result: Vec<StoredEvent> = match k.len() {
                1 => {
                    let rows = stmt.query_map(
                        rusqlite::params![chat_id, k[0] as i32, limit as i64, offset as i64],
                        parse_event_row
                    ).map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                },
                2 => {
                    let rows = stmt.query_map(
                        rusqlite::params![chat_id, k[0] as i32, k[1] as i32, limit as i64, offset as i64],
                        parse_event_row
                    ).map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                },
                3 => {
                    let rows = stmt.query_map(
                        rusqlite::params![chat_id, k[0] as i32, k[1] as i32, k[2] as i32, limit as i64, offset as i64],
                        parse_event_row
                    ).map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                },
                _ => return Err("Unsupported number of kinds".to_string()),
            };

            drop(stmt);
            result
        } else {
            let sql = r#"
                SELECT id, kind, chat_id, user_id, content, tags, reference_id,
                       created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
                FROM events
                WHERE chat_id = ?1
                ORDER BY created_at DESC
                LIMIT ?2 OFFSET ?3
            "#;

            let mut stmt = conn.prepare(sql)
                .map_err(|e| format!("Failed to prepare events query: {}", e))?;

            let rows = stmt.query_map(
                rusqlite::params![chat_id, limit as i64, offset as i64],
                parse_event_row
            ).map_err(|e| format!("Failed to query events: {}", e))?;
            let result: Vec<StoredEvent> = rows.filter_map(|r| r.ok()).collect();

            drop(stmt);
            result
        };

        crate::account_manager::return_db_connection(conn);
        events
    };

    // Decrypt message content for text messages (this is the async part)
    let mut decrypted_events = Vec::with_capacity(events.len());
    for mut event in events {
        if event.kind == event_kind::PRIVATE_DIRECT_MESSAGE {
            event.content = internal_decrypt(event.content, None).await
                .unwrap_or_else(|_| "[Decryption failed]".to_string());
        }
        decrypted_events.push(event);
    }

    Ok(decrypted_events)
}

/// Helper function to parse a row into a StoredEvent
fn parse_event_row(row: &rusqlite::Row) -> rusqlite::Result<StoredEvent> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

    Ok(StoredEvent {
        id: row.get(0)?,
        kind: row.get::<_, i32>(1)? as u16,
        chat_id: row.get(2)?,
        user_id: row.get(3)?,
        content: row.get(4)?,
        tags,
        reference_id: row.get(6)?,
        created_at: row.get::<_, i64>(7)? as u64,
        received_at: row.get::<_, i64>(8)? as u64,
        mine: row.get::<_, i32>(9)? != 0,
        pending: row.get::<_, i32>(10)? != 0,
        failed: row.get::<_, i32>(11)? != 0,
        wrapper_event_id: row.get(12)?,
        npub: row.get(13)?,
        virtual_bucket: row.get(14)?,
    })
}

/// Get events that reference specific message IDs
///
/// Used to fetch reactions and attachments for a set of messages.
/// This is the core function for building materialized views.
pub async fn get_related_events<R: Runtime>(
    handle: &AppHandle<R>,
    reference_ids: &[String],
) -> Result<Vec<StoredEvent>, String> {
    if reference_ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = crate::account_manager::get_db_connection(handle)?;

    let placeholders: String = reference_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        r#"
        SELECT id, kind, chat_id, user_id, content, tags, reference_id,
               created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
        FROM events
        WHERE reference_id IN ({})
        ORDER BY created_at ASC
        "#,
        placeholders
    );

    let mut stmt = conn.prepare(&sql)
        .map_err(|e| format!("Failed to prepare related events query: {}", e))?;

    let params: Vec<&dyn rusqlite::ToSql> = reference_ids.iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let events: Vec<StoredEvent> = stmt.query_map(params.as_slice(), |row| {
        let tags_json: String = row.get(5)?;
        let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

        Ok(StoredEvent {
            id: row.get(0)?,
            kind: row.get::<_, i32>(1)? as u16,
            chat_id: row.get(2)?,
            user_id: row.get(3)?,
            content: row.get(4)?,
            tags,
            reference_id: row.get(6)?,
            created_at: row.get::<_, i64>(7)? as u64,
            received_at: row.get::<_, i64>(8)? as u64,
            mine: row.get::<_, i32>(9)? != 0,
            pending: row.get::<_, i32>(10)? != 0,
            failed: row.get::<_, i32>(11)? != 0,
            wrapper_event_id: row.get(12)?,
            npub: row.get(13)?,
            virtual_bucket: row.get(14)?,
        })
    })
    .map_err(|e| format!("Failed to query related events: {}", e))?
    .filter_map(|r| r.ok())
    .collect();

    // Drop statement to release borrow on conn
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(events)
}

/// Context data for a replied-to message
struct ReplyContext {
    content: String,
    npub: Option<String>,
    has_attachment: bool,
}

/// Fetch reply context for a list of message IDs
/// Returns a HashMap of message_id -> ReplyContext
async fn get_reply_contexts<R: Runtime>(
    handle: &AppHandle<R>,
    message_ids: &[String],
) -> Result<HashMap<String, ReplyContext>, String> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Do all SQLite work synchronously in a block to avoid Send issues
    let (events, edits): (Vec<(String, i32, String, Option<String>, i32)>, Vec<(String, String)>) = {
        let conn = crate::account_manager::get_db_connection(handle)?;

        // Build placeholders for IN clause
        let placeholders: String = (0..message_ids.len())
            .map(|i| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");

        // Query original messages
        let sql = format!(
            r#"
            SELECT id, kind, content, npub, mine
            FROM events
            WHERE id IN ({})
            "#,
            placeholders
        );

        let mut stmt = conn.prepare(&sql)
            .map_err(|e| format!("Failed to prepare reply context query: {}", e))?;

        // Build params as String refs for the query
        let params: Vec<&str> = message_ids.iter().map(|s| s.as_str()).collect();
        let params_dyn: Vec<&dyn rusqlite::ToSql> = params.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

        let rows = stmt.query_map(params_dyn.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?, // id
                row.get::<_, i32>(1)?,    // kind
                row.get::<_, String>(2)?, // content
                row.get::<_, Option<String>>(3)?, // npub
                row.get::<_, i32>(4)?,    // mine
            ))
        }).map_err(|e| format!("Failed to query reply contexts: {}", e))?;

        let events_result: Vec<(String, i32, String, Option<String>, i32)> = rows.filter_map(|r| r.ok()).collect();
        drop(stmt);

        // Query latest edits for these messages (most recent edit per message)
        let edit_sql = format!(
            r#"
            SELECT reference_id, content
            FROM events
            WHERE kind = {} AND reference_id IN ({})
            ORDER BY created_at DESC
            "#,
            event_kind::MESSAGE_EDIT,
            placeholders
        );

        let mut edit_stmt = conn.prepare(&edit_sql)
            .map_err(|e| format!("Failed to prepare edit query: {}", e))?;

        let edit_rows = edit_stmt.query_map(params_dyn.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?, // reference_id (original message id)
                row.get::<_, String>(1)?, // content (edited content)
            ))
        }).map_err(|e| format!("Failed to query edits: {}", e))?;

        let edits_result: Vec<(String, String)> = edit_rows.filter_map(|r| r.ok()).collect();
        drop(edit_stmt);

        crate::account_manager::return_db_connection(conn);
        (events_result, edits_result)
    };

    // Build a map of message_id -> latest edit content (first one since ordered DESC)
    let mut latest_edits: HashMap<String, String> = HashMap::new();
    for (ref_id, content) in edits {
        // Only keep the first (most recent) edit for each message
        latest_edits.entry(ref_id).or_insert(content);
    }

    // Process events and decrypt content (async part)
    let mut contexts = HashMap::new();
    for (id, kind, original_content, npub, mine) in events {
        let has_attachment = kind == event_kind::FILE_ATTACHMENT as i32;

        // DM messages don't store the sender npub directly. For our own outbound DMs
        // the npub column is NULL, so derive it from the current account so reply
        // bars can render "You" instead of "Unknown".
        let npub = if mine != 0 && npub.is_none() {
            crate::account_manager::get_current_account().ok()
        } else {
            npub
        };

        // Use latest edit content if available, otherwise use original
        let content_to_decrypt = latest_edits.get(&id).cloned().unwrap_or(original_content);

        // Decrypt content for text messages
        let decrypted_content = if kind == event_kind::PRIVATE_DIRECT_MESSAGE as i32 {
            internal_decrypt(content_to_decrypt, None).await
                .unwrap_or_else(|_| "[Decryption failed]".to_string())
        } else {
            // File attachments don't have displayable content
            String::new()
        };

        contexts.insert(id, ReplyContext {
            content: decrypted_content,
            npub,
            has_attachment,
        });
    }

    Ok(contexts)
}

/// Populate reply context for a single message before emitting to frontend
/// This is used for real-time messages that don't go through get_message_views
pub async fn populate_reply_context<R: Runtime>(
    handle: &AppHandle<R>,
    message: &mut Message,
) -> Result<(), String> {
    if message.replied_to.is_empty() {
        return Ok(());
    }

    let contexts = get_reply_contexts(handle, &[message.replied_to.clone()]).await?;

    if let Some(ctx) = contexts.get(&message.replied_to) {
        message.replied_to_content = Some(ctx.content.clone());
        message.replied_to_npub = ctx.npub.clone();
        message.replied_to_has_attachment = Some(ctx.has_attachment);
    }

    Ok(())
}

/// Get message events with their reactions composed (materialized view)
///
/// This function performs a single efficient query to get messages and their
/// related events, then composes them into Message structs for the frontend.
pub async fn get_message_views<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: i64,
    limit: usize,
    offset: usize,
    virtual_bucket_filter: Option<String>,
) -> Result<Vec<Message>, String> {
    // Step 1: Timeline rows (text, file attachment, dashboard poll create)
    let message_kinds = [
        event_kind::PRIVATE_DIRECT_MESSAGE,
        event_kind::FILE_ATTACHMENT,
        event_kind::APPLICATION_SPECIFIC,
    ];
    let message_events = get_events(handle, chat_id, Some(&message_kinds), limit, offset).await?;

    let message_events: Vec<StoredEvent> = message_events
        .into_iter()
        .filter(|e| {
            if e.kind != event_kind::APPLICATION_SPECIFIC {
                return true;
            }
            crate::dashboard_poll::try_parse_vote(e.content.trim()).is_none()
        })
        .collect();

    if message_events.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: Get related events (reactions, edits) for these messages
    let message_ids: Vec<String> = message_events.iter().map(|e| e.id.clone()).collect();
    let related_events = get_related_events(handle, &message_ids).await?;

    // Group reactions and edits by message ID
    let mut reactions_by_msg: HashMap<String, Vec<Reaction>> = HashMap::new();
    let mut edits_by_msg: HashMap<String, Vec<(u64, String)>> = HashMap::new(); // (timestamp, content)

    for event in related_events {
        if let Some(ref_id) = &event.reference_id {
            match event.kind {
                k if k == event_kind::REACTION => {
                    let reaction = Reaction {
                        id: event.id.clone(),
                        reference_id: ref_id.clone(),
                        author_id: event.npub.clone().unwrap_or_default(),
                        emoji: event.content.clone(),
                    };
                    reactions_by_msg.entry(ref_id.clone()).or_default().push(reaction);
                }
                k if k == event_kind::MESSAGE_EDIT => {
                    // Edit content is encrypted, decrypt it here
                    let decrypted_content = internal_decrypt(event.content.clone(), None).await
                        .unwrap_or_else(|_| event.content.clone());
                    let timestamp_ms = event.created_at * 1000; // Convert to ms
                    edits_by_msg.entry(ref_id.clone()).or_default().push((timestamp_ms, decrypted_content));
                }
                _ => {}
            }
        }
    }

    // Sort edits by timestamp (chronologically)
    for edits in edits_by_msg.values_mut() {
        edits.sort_by_key(|(ts, _)| *ts);
    }

    // Step 3: Parse attachments from event tags OR fall back to messages table
    // New events have attachments in tags, old migrated events need messages table lookup
    let mut attachments_by_msg: HashMap<String, Vec<Attachment>> = HashMap::new();
    let mut events_needing_legacy_lookup: Vec<String> = Vec::new();

    for event in &message_events {
        if event.kind != event_kind::FILE_ATTACHMENT {
            continue;
        }

        // Try to parse attachments from the "attachments" tag (new events)
        if let Some(attachments_json) = event.get_tag("attachments") {
            if let Ok(attachments) = serde_json::from_str::<Vec<Attachment>>(attachments_json) {
                attachments_by_msg.insert(event.id.clone(), attachments);
                continue;
            }
        }

        // No attachments tag found - this is an old migrated event, need legacy lookup
        events_needing_legacy_lookup.push(event.id.clone());
    }

    // Fall back to messages table for old migrated events without attachments tag
    // NOTE: This is a legacy fallback - the messages table may have been dropped
    if !events_needing_legacy_lookup.is_empty() {
        let conn = crate::account_manager::get_db_connection(handle)?;

        // Check if messages table exists before querying it
        let has_messages_table: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='messages'",
            [],
            |row| row.get::<_, i32>(0)
        ).map(|count| count > 0).unwrap_or(false);

        if has_messages_table {
            for msg_id in &events_needing_legacy_lookup {
                if let Ok(attachments_json) = conn.query_row::<String, _, _>(
                    "SELECT attachments FROM messages WHERE id = ?1",
                    rusqlite::params![msg_id],
                    |row| row.get(0),
                ) {
                    if let Ok(attachments) = serde_json::from_str::<Vec<Attachment>>(&attachments_json) {
                        attachments_by_msg.insert(msg_id.to_string(), attachments);
                    }
                }
            }
        }
        crate::account_manager::return_db_connection(conn);
    }

    // Step 4: Compose Message structs (with decryption and edit application)
    let mut messages = Vec::with_capacity(message_events.len());
    for event in message_events {
        // Calculate derived values before moving ownership
        let replied_to = event.get_reply_reference().unwrap_or("").to_string();
        let at = event.timestamp_ms();
        let reactions = reactions_by_msg.remove(&event.id).unwrap_or_default();

        // Get attachments from the lookup map (for kind=15 file messages)
        let attachments = attachments_by_msg.remove(&event.id).unwrap_or_default();

        // Get original content (already decrypted by get_events() where applicable)
        let original_content = if event.kind == event_kind::FILE_ATTACHMENT {
            // File attachment content is just an encrypted hash - don't display
            String::new()
        } else {
            event.content.clone()
        };

        let virtual_bucket = event.virtual_bucket.clone().or_else(|| {
            crate::virtual_channel_bucket::normalize_virtual_bucket_for_message(
                event.kind,
                &original_content,
                &event.tags,
            )
        });

        // Check for edits and build edit history
        let (content, edited, edit_history) = if let Some(edits) = edits_by_msg.remove(&event.id) {
            // Build edit history: original + all edits
            let mut history = Vec::with_capacity(edits.len() + 1);

            // Add original as first entry
            history.push(EditEntry {
                content: original_content.clone(),
                edited_at: at,
            });

            // Add all edits
            for (edit_ts, edit_content) in &edits {
                history.push(EditEntry {
                    content: edit_content.clone(),
                    edited_at: *edit_ts,
                });
            }

            // Use the latest edit's content
            let latest_content = edits.last()
                .map(|(_, c)| c.clone())
                .unwrap_or(original_content);

            (latest_content, true, Some(history))
        } else {
            (original_content, false, None)
        };

        let message = Message {
            id: event.id,
            content,
            replied_to,
            replied_to_content: None, // Populated below
            replied_to_npub: None,    // Populated below
            replied_to_has_attachment: None, // Populated below
            preview_metadata: None, // TODO: Parse from tags if needed
            attachments,
            reactions,
            at,
            pending: event.pending,
            failed: event.failed,
            mine: event.mine,
            npub: event.npub,
            wrapper_event_id: event.wrapper_event_id,
            edited,
            edit_history,
            rumor_kind: match event.kind {
                k if k == event_kind::APPLICATION_SPECIFIC => Some(k),
                _ => None,
            },
            virtual_bucket,
        };
        messages.push(message);
    }

    // Step 5: Fetch reply context for messages that have replies
    // Collect all replied_to IDs that are non-empty
    let reply_ids: Vec<String> = messages
        .iter()
        .filter(|m| !m.replied_to.is_empty())
        .map(|m| m.replied_to.clone())
        .collect();

    if !reply_ids.is_empty() {
        // Fetch the replied-to events from the database
        let reply_contexts = get_reply_contexts(handle, &reply_ids).await?;

        // Populate reply context for each message
        for message in &mut messages {
            if !message.replied_to.is_empty() {
                if let Some(ctx) = reply_contexts.get(&message.replied_to) {
                    message.replied_to_content = Some(ctx.content.clone());
                    message.replied_to_npub = ctx.npub.clone();
                    message.replied_to_has_attachment = Some(ctx.has_attachment);
                }
            }
        }
    }

    if let Some(want) = virtual_bucket_filter {
        let w = want.trim();
        if matches!(w, "announcements" | "inbox" | "polls") {
            messages.retain(|m| m.virtual_bucket.as_deref() == Some(w));
        }
    }

    Ok(messages)
}

/// Update an event's pending/failed status
pub fn update_event_status<R: Runtime>(
    handle: &AppHandle<R>,
    event_id: &str,
    pending: bool,
    failed: bool,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute(
        "UPDATE events SET pending = ?1, failed = ?2 WHERE id = ?3",
        rusqlite::params![pending as i32, failed as i32, event_id],
    ).map_err(|e| format!("Failed to update event status: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Delete an event by ID
pub fn delete_event<R: Runtime>(
    handle: &AppHandle<R>,
    event_id: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute(
        "DELETE FROM events WHERE id = ?1",
        rusqlite::params![event_id],
    ).map_err(|e| format!("Failed to delete event: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Get the total count of message events in a chat
pub fn get_message_count<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: i64,
) -> Result<i64, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM events WHERE chat_id = ?1 AND kind IN (?2, ?3)",
        rusqlite::params![
            chat_id,
            event_kind::PRIVATE_DIRECT_MESSAGE as i32,
            event_kind::FILE_ATTACHMENT as i32
        ],
        |row| row.get(0),
    ).map_err(|e| format!("Failed to count messages: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(count)
}

/// Get the storage version from settings
pub fn get_storage_version<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<i32, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let version: i32 = conn.query_row(
        "SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'storage_version'",
        [],
        |row| row.get(0),
    ).unwrap_or(1); // Default to version 1 (old format)

    crate::account_manager::return_db_connection(conn);
    Ok(version)
}