//! Squad bot identity: encrypted local nsec for holders + MLS-synced public meta.

use nostr_sdk::prelude::*;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::crypto::{internal_decrypt, internal_encrypt};

pub const SQUAD_BOT_META_SCHEMA: &str = "pacto.squad_bot.meta.v1";
pub const SQUAD_BOT_KEY_ROTATED_SCHEMA: &str = "pacto.squad_bot.key_rotated.v1";
pub const SQUAD_BOT_ROTATE_PROMPT_SCHEMA: &str = "pacto.squad_bot.rotate_prompt.v1";
pub const SQUAD_BOT_KEY_SHARE_SCHEMA: &str = "pacto.squad_bot.key_share.v1";
pub const SQUAD_BOT_JOIN_DM_SCHEMA: &str = "pacto.squad.bot_join_dm.v1";
pub const SQUAD_BOT_JOIN_DM_LOOKBACK_SECS: u64 = 7 * 24 * 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadBotStateDto {
    pub squad_id: String,
    pub bot_npub: String,
    pub holders: Vec<String>,
    pub key_epoch: i64,
    pub updated_at: i64,
    pub has_local_secret: bool,
    pub i_am_holder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadBotPublishBundle {
    pub state: SquadBotStateDto,
    /// MLS announcements-bucket JSON (meta and/or key_rotated).
    pub mls_announcements: Vec<String>,
    /// MLS inbox-bucket JSON (rotate prompts).
    pub mls_inbox: Vec<String>,
    /// NIP-17 key shares: (recipient_npub, content).
    pub key_shares: Vec<SquadBotKeyShareOut>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadBotKeyShareOut {
    pub recipient_npub: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SquadBotMetaWire {
    schema: String,
    #[serde(rename = "pacto_virtual_bucket")]
    pacto_virtual_bucket: String,
    squad_id: String,
    bot_npub: String,
    holders: Vec<String>,
    key_epoch: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SquadBotKeyRotatedWire {
    schema: String,
    #[serde(rename = "pacto_virtual_bucket")]
    pacto_virtual_bucket: String,
    squad_id: String,
    bot_npub: String,
    key_epoch: i64,
    rotated_by_npub: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SquadBotRotatePromptWire {
    schema: String,
    #[serde(rename = "pacto_virtual_bucket")]
    pacto_virtual_bucket: String,
    squad_id: String,
    key_epoch: i64,
    reason: String,
    removed_holder_npub: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SquadBotKeyShareWire {
    schema: String,
    squad_id: String,
    bot_npub: String,
    key_epoch: i64,
    nsec: String,
}

fn unix_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn ensure_squad_bot_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS squad_bot_meta (
            parent_id TEXT PRIMARY KEY NOT NULL,
            bot_npub TEXT NOT NULL,
            holders_json TEXT NOT NULL,
            key_epoch INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS squad_bot_secret (
            parent_id TEXT PRIMARY KEY NOT NULL,
            key_epoch INTEGER NOT NULL,
            bot_npub TEXT NOT NULL,
            encrypted_nsec TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Failed to create squad_bot tables: {e}"))?;
    Ok(())
}

pub fn delete_squad_bot_rows(conn: &rusqlite::Connection, parent_id: &str) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(());
    }
    ensure_squad_bot_tables(conn)?;
    conn.execute(
        "DELETE FROM squad_bot_secret WHERE parent_id = ?1",
        params![pid],
    )
    .map_err(|e| format!("Failed to delete squad_bot_secret: {e}"))?;
    conn.execute(
        "DELETE FROM squad_bot_meta WHERE parent_id = ?1",
        params![pid],
    )
    .map_err(|e| format!("Failed to delete squad_bot_meta: {e}"))?;
    Ok(())
}

fn holders_json(holders: &[String]) -> Result<String, String> {
    serde_json::to_string(holders).map_err(|e| e.to_string())
}

fn parse_holders(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("npub1"))
        .collect()
}

fn read_meta_row(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<Option<(String, Vec<String>, i64, i64)>, String> {
    ensure_squad_bot_tables(conn)?;
    conn.query_row(
        "SELECT bot_npub, holders_json, key_epoch, updated_at FROM squad_bot_meta WHERE parent_id = ?1",
        params![parent_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                parse_holders(&row.get::<_, String>(1)?),
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read squad_bot_meta: {e}"))
}

fn upsert_meta_row(
    conn: &rusqlite::Connection,
    parent_id: &str,
    bot_npub: &str,
    holders: &[String],
    key_epoch: i64,
    updated_at: i64,
) -> Result<(), String> {
    ensure_squad_bot_tables(conn)?;
    let hj = holders_json(holders)?;
    conn.execute(
        r#"INSERT INTO squad_bot_meta (parent_id, bot_npub, holders_json, key_epoch, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(parent_id) DO UPDATE SET
             bot_npub = excluded.bot_npub,
             holders_json = excluded.holders_json,
             key_epoch = excluded.key_epoch,
             updated_at = excluded.updated_at"#,
        params![parent_id, bot_npub, hj, key_epoch, updated_at],
    )
    .map_err(|e| format!("Failed to upsert squad_bot_meta: {e}"))?;
    Ok(())
}

fn has_secret_row(conn: &rusqlite::Connection, parent_id: &str) -> Result<bool, String> {
    ensure_squad_bot_tables(conn)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM squad_bot_secret WHERE parent_id = ?1",
            params![parent_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn secret_epoch(conn: &rusqlite::Connection, parent_id: &str) -> Result<Option<i64>, String> {
    ensure_squad_bot_tables(conn)?;
    conn.query_row(
        "SELECT key_epoch FROM squad_bot_secret WHERE parent_id = ?1",
        params![parent_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn store_secret_encrypted(
    conn: &rusqlite::Connection,
    parent_id: &str,
    bot_npub: &str,
    key_epoch: i64,
    encrypted_nsec: &str,
) -> Result<(), String> {
    ensure_squad_bot_tables(conn)?;
    let now = unix_now_secs();
    conn.execute(
        r#"INSERT INTO squad_bot_secret (parent_id, key_epoch, bot_npub, encrypted_nsec, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(parent_id) DO UPDATE SET
             key_epoch = excluded.key_epoch,
             bot_npub = excluded.bot_npub,
             encrypted_nsec = excluded.encrypted_nsec,
             updated_at = excluded.updated_at"#,
        params![parent_id, key_epoch, bot_npub, encrypted_nsec, now],
    )
    .map_err(|e| format!("Failed to upsert squad_bot_secret: {e}"))?;
    Ok(())
}

async fn encrypt_nsec(nsec: &str) -> String {
    internal_encrypt(nsec.to_string(), None).await
}

fn read_secret_row(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<(String, i64, String), String> {
    ensure_squad_bot_tables(conn)?;
    conn.query_row(
        "SELECT bot_npub, key_epoch, encrypted_nsec FROM squad_bot_secret WHERE parent_id = ?1",
        params![parent_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|_| "No local squad bot secret (not a key holder on this device)".to_string())
}

async fn decrypt_nsec(encrypted: String) -> Result<String, String> {
    internal_decrypt(encrypted, None)
        .await
        .map_err(|_| "Failed to decrypt squad bot secret".to_string())
}

fn delete_secret(conn: &rusqlite::Connection, parent_id: &str) -> Result<(), String> {
    ensure_squad_bot_tables(conn)?;
    conn.execute(
        "DELETE FROM squad_bot_secret WHERE parent_id = ?1",
        params![parent_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn current_npub() -> Result<String, String> {
    crate::account_manager::get_current_account()
}

fn meta_content(squad_id: &str, bot_npub: &str, holders: &[String], key_epoch: i64, updated_at: i64) -> Result<String, String> {
    let wire = SquadBotMetaWire {
        schema: SQUAD_BOT_META_SCHEMA.into(),
        pacto_virtual_bucket: "announcements".into(),
        squad_id: squad_id.into(),
        bot_npub: bot_npub.into(),
        holders: holders.to_vec(),
        key_epoch,
        updated_at,
    };
    serde_json::to_string(&wire).map_err(|e| e.to_string())
}

fn key_rotated_content(
    squad_id: &str,
    bot_npub: &str,
    key_epoch: i64,
    rotated_by: &str,
    updated_at: i64,
) -> Result<String, String> {
    let wire = SquadBotKeyRotatedWire {
        schema: SQUAD_BOT_KEY_ROTATED_SCHEMA.into(),
        pacto_virtual_bucket: "announcements".into(),
        squad_id: squad_id.into(),
        bot_npub: bot_npub.into(),
        key_epoch,
        rotated_by_npub: rotated_by.into(),
        updated_at,
    };
    serde_json::to_string(&wire).map_err(|e| e.to_string())
}

fn rotate_prompt_content(
    squad_id: &str,
    key_epoch: i64,
    removed: &str,
    updated_at: i64,
) -> Result<String, String> {
    let wire = SquadBotRotatePromptWire {
        schema: SQUAD_BOT_ROTATE_PROMPT_SCHEMA.into(),
        pacto_virtual_bucket: "inbox".into(),
        squad_id: squad_id.into(),
        key_epoch,
        reason: "holder_removed".into(),
        removed_holder_npub: removed.into(),
        updated_at,
    };
    serde_json::to_string(&wire).map_err(|e| e.to_string())
}

fn key_share_content(
    squad_id: &str,
    bot_npub: &str,
    key_epoch: i64,
    nsec: &str,
) -> Result<String, String> {
    let wire = SquadBotKeyShareWire {
        schema: SQUAD_BOT_KEY_SHARE_SCHEMA.into(),
        squad_id: squad_id.into(),
        bot_npub: bot_npub.into(),
        key_epoch,
        nsec: nsec.into(),
    };
    serde_json::to_string(&wire).map_err(|e| e.to_string())
}

fn state_dto(
    squad_id: &str,
    bot_npub: &str,
    holders: &[String],
    key_epoch: i64,
    updated_at: i64,
    has_local_secret: bool,
    me: &str,
) -> SquadBotStateDto {
    SquadBotStateDto {
        squad_id: squad_id.into(),
        bot_npub: bot_npub.into(),
        holders: holders.to_vec(),
        key_epoch,
        updated_at,
        has_local_secret,
        i_am_holder: holders.iter().any(|h| h == me),
    }
}

/// True if `npub` is in the announcements MLS member list (fail closed on error).
pub async fn is_mls_member(group_id: &str, npub: &str) -> Result<bool, String> {
    let members = list_mls_member_npubs(group_id).await?;
    Ok(members.iter().any(|m| m == npub))
}

async fn list_mls_member_npubs(group_id: &str) -> Result<Vec<String>, String> {
    let group_id = group_id.to_string();
    tokio::task::spawn_blocking(move || {
        let handle = crate::TAURI_APP
            .get()
            .ok_or_else(|| "App handle not initialized".to_string())?
            .clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = crate::mls::MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            let meta_groups = mls.read_groups().await.unwrap_or_default();
            let engine_id = meta_groups
                .iter()
                .find(|g| g.group_id == group_id || (!g.engine_group_id.is_empty() && g.engine_group_id == group_id))
                .map(|g| {
                    if !g.engine_group_id.is_empty() {
                        g.engine_group_id.clone()
                    } else {
                        g.group_id.clone()
                    }
                })
                .unwrap_or_else(|| group_id.clone());
            let engine = mls.engine().map_err(|e| e.to_string())?;
            use mdk_core::prelude::GroupId;
            let Ok(gid_bytes) = hex::decode(&engine_id) else {
                return Ok(Vec::new());
            };
            let gid = GroupId::from_slice(&gid_bytes);
            let Ok(pk_list) = engine.get_members(&gid) else {
                return Ok(Vec::new());
            };
            Ok(pk_list
                .into_iter()
                .filter_map(|pk| pk.to_bech32().ok())
                .collect())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

fn require_holder(holders: &[String], me: &str) -> Result<(), String> {
    if holders.iter().any(|h| h == me) {
        Ok(())
    } else {
        Err("Only bot key holders can perform this action".into())
    }
}

/// Load bot `Keys` for the current account when they are a holder with a local secret.
pub async fn bot_keys_for_holder<R: Runtime>(
    handle: &AppHandle<R>,
    squad_id: &str,
) -> Result<(Keys, String), String> {
    let squad_id = squad_id.trim();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub()?;
    let (bot_npub_meta, holders, key_epoch, enc) = {
        let conn = crate::account_manager::get_db_connection(handle)?;
        let (bot_npub, holders, key_epoch, _) = read_meta_row(&conn, squad_id)?
            .ok_or_else(|| "Squad bot not initialized — open Join inbox settings first".to_string())?;
        require_holder(&holders, &me)?;
        let (secret_bot, secret_epoch, enc) = read_secret_row(&conn, squad_id)?;
        crate::account_manager::return_db_connection(conn);
        if secret_bot != bot_npub || secret_epoch != key_epoch {
            return Err("Local bot secret is stale — ask a holder to re-share or rotate".into());
        }
        (bot_npub, holders, key_epoch, enc)
    };
    let _ = (holders, key_epoch);
    let nsec = decrypt_nsec(enc).await?;
    let keys = Keys::parse(&nsec).map_err(|_| "Invalid stored bot nsec".to_string())?;
    let derived = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    if derived != bot_npub_meta {
        return Err("Stored bot nsec does not match bot npub".into());
    }
    Ok((keys, bot_npub_meta))
}

/// Bot npub from meta (no secret required) — for active-broadcast lookups.
pub fn bot_npub_for_squad<R: Runtime>(
    handle: &AppHandle<R>,
    squad_id: &str,
) -> Result<Option<String>, String> {
    let squad_id = squad_id.trim();
    if squad_id.is_empty() {
        return Ok(None);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let row = read_meta_row(&conn, squad_id)?;
    crate::account_manager::return_db_connection(conn);
    Ok(row.map(|(bot_npub, _, _, _)| bot_npub))
}

/// Create bot identity for a new squad (creator = sole holder). Idempotent if already present.
#[tauri::command]
pub async fn squad_bot_init<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<SquadBotPublishBundle, String> {
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub()?;
    {
        let conn = crate::account_manager::get_db_connection(&handle)?;
        ensure_squad_bot_tables(&conn)?;
        if let Some((bot_npub, holders, key_epoch, updated_at)) = read_meta_row(&conn, &squad_id)? {
            let has = has_secret_row(&conn, &squad_id)?;
            crate::account_manager::return_db_connection(conn);
            let state = state_dto(&squad_id, &bot_npub, &holders, key_epoch, updated_at, has, &me);
            return Ok(SquadBotPublishBundle {
                state,
                mls_announcements: vec![],
                mls_inbox: vec![],
                key_shares: vec![],
            });
        }
        crate::account_manager::return_db_connection(conn);
    }

    let keys = Keys::generate();
    let bot_npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let holders = vec![me.clone()];
    let key_epoch = 1i64;
    let updated_at = unix_now_secs();
    let enc = encrypt_nsec(&nsec).await;

    let conn = crate::account_manager::get_db_connection(&handle)?;
    store_secret_encrypted(&conn, &squad_id, &bot_npub, key_epoch, &enc)?;
    upsert_meta_row(&conn, &squad_id, &bot_npub, &holders, key_epoch, updated_at)?;
    let meta = meta_content(&squad_id, &bot_npub, &holders, key_epoch, updated_at)?;
    let state = state_dto(
        &squad_id,
        &bot_npub,
        &holders,
        key_epoch,
        updated_at,
        true,
        &me,
    );
    crate::account_manager::return_db_connection(conn);
    Ok(SquadBotPublishBundle {
        state,
        mls_announcements: vec![meta],
        mls_inbox: vec![],
        key_shares: vec![],
    })
}

#[tauri::command]
pub async fn squad_bot_get_state<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<Option<SquadBotStateDto>, String> {
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub().unwrap_or_default();
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let row = read_meta_row(&conn, &squad_id)?;
    let has = has_secret_row(&conn, &squad_id)?;
    crate::account_manager::return_db_connection(conn);
    Ok(row.map(|(bot_npub, holders, key_epoch, updated_at)| {
        state_dto(&squad_id, &bot_npub, &holders, key_epoch, updated_at, has, &me)
    }))
}

#[tauri::command]
pub async fn squad_bot_add_holder<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
    holder_npub: String,
) -> Result<SquadBotPublishBundle, String> {
    let squad_id = squad_id.trim().to_string();
    let holder_npub = holder_npub.trim().to_string();
    if squad_id.is_empty() || !holder_npub.starts_with("npub1") {
        return Err("squadId and holderNpub are required".into());
    }
    let me = current_npub()?;
    if !is_mls_member(&squad_id, &holder_npub).await? {
        return Err("Holder must be a current MLS member of this squad".into());
    }
    if !is_mls_member(&squad_id, &me).await? {
        return Err("You must be a current MLS member to manage holders".into());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    let (bot_npub, mut holders, key_epoch, _) = read_meta_row(&conn, &squad_id)?
        .ok_or_else(|| "Squad bot not initialized".to_string())?;
    require_holder(&holders, &me)?;
    if !has_secret_row(&conn, &squad_id)? {
        crate::account_manager::return_db_connection(conn);
        return Err("Local bot secret required to add holders".into());
    }
    if holders.iter().any(|h| h == &holder_npub) {
        let has = true;
        let updated_at = unix_now_secs();
        let state = state_dto(&squad_id, &bot_npub, &holders, key_epoch, updated_at, has, &me);
        crate::account_manager::return_db_connection(conn);
        return Ok(SquadBotPublishBundle {
            state,
            mls_announcements: vec![],
            mls_inbox: vec![],
            key_shares: vec![],
        });
    }
    holders.push(holder_npub.clone());
    let updated_at = unix_now_secs();
    let (_bn, _epoch, enc) = read_secret_row(&conn, &squad_id)?;
    upsert_meta_row(&conn, &squad_id, &bot_npub, &holders, key_epoch, updated_at)?;
    let meta = meta_content(&squad_id, &bot_npub, &holders, key_epoch, updated_at)?;
    crate::account_manager::return_db_connection(conn);
    let nsec = decrypt_nsec(enc).await?;
    let share = key_share_content(&squad_id, &bot_npub, key_epoch, &nsec)?;
    let state = state_dto(&squad_id, &bot_npub, &holders, key_epoch, updated_at, true, &me);
    Ok(SquadBotPublishBundle {
        state,
        mls_announcements: vec![meta],
        mls_inbox: vec![],
        key_shares: vec![SquadBotKeyShareOut {
            recipient_npub: holder_npub,
            content: share,
        }],
    })
}

#[tauri::command]
pub async fn squad_bot_remove_holder<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
    holder_npub: String,
) -> Result<SquadBotPublishBundle, String> {
    let squad_id = squad_id.trim().to_string();
    let holder_npub = holder_npub.trim().to_string();
    if squad_id.is_empty() || !holder_npub.starts_with("npub1") {
        return Err("squadId and holderNpub are required".into());
    }
    let me = current_npub()?;
    if !is_mls_member(&squad_id, &me).await? {
        return Err("You must be a current MLS member to manage holders".into());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    let (bot_npub, mut holders, key_epoch, _) = read_meta_row(&conn, &squad_id)?
        .ok_or_else(|| "Squad bot not initialized".to_string())?;
    require_holder(&holders, &me)?;
    if holders.len() <= 1 && holders.iter().any(|h| h == &holder_npub) {
        crate::account_manager::return_db_connection(conn);
        return Err("Cannot remove the last bot key holder; add another holder first".into());
    }
    let before = holders.len();
    holders.retain(|h| h != &holder_npub);
    if holders.len() == before {
        crate::account_manager::return_db_connection(conn);
        return Err("Npub is not a bot key holder".into());
    }
    let updated_at = unix_now_secs();
    upsert_meta_row(&conn, &squad_id, &bot_npub, &holders, key_epoch, updated_at)?;
    if holder_npub == me {
        delete_secret(&conn, &squad_id)?;
    }
    let meta = meta_content(&squad_id, &bot_npub, &holders, key_epoch, updated_at)?;
    let prompt = rotate_prompt_content(&squad_id, key_epoch, &holder_npub, updated_at)?;
    let has = has_secret_row(&conn, &squad_id)?;
    let state = state_dto(&squad_id, &bot_npub, &holders, key_epoch, updated_at, has, &me);
    crate::account_manager::return_db_connection(conn);
    Ok(SquadBotPublishBundle {
        state,
        mls_announcements: vec![meta],
        mls_inbox: vec![prompt],
        key_shares: vec![],
    })
}

#[tauri::command]
pub async fn squad_bot_rotate_key<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<SquadBotPublishBundle, String> {
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub()?;
    if !is_mls_member(&squad_id, &me).await? {
        return Err("You must be a current MLS member to rotate the bot key".into());
    }

    let (holders, old_epoch) = {
        let conn = crate::account_manager::get_db_connection(&handle)?;
        let (_old_bot, holders, old_epoch, _) = read_meta_row(&conn, &squad_id)?
            .ok_or_else(|| "Squad bot not initialized".to_string())?;
        require_holder(&holders, &me)?;
        if !has_secret_row(&conn, &squad_id)? {
            crate::account_manager::return_db_connection(conn);
            return Err("Local bot secret required to rotate".into());
        }
        crate::account_manager::return_db_connection(conn);
        (holders, old_epoch)
    };

    let members = list_mls_member_npubs(&squad_id).await?;
    let holders: Vec<String> = holders
        .into_iter()
        .filter(|h| members.iter().any(|m| m == h))
        .collect();
    if holders.is_empty() {
        return Err("No current MLS members remain as holders".into());
    }

    let keys = Keys::generate();
    let bot_npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let key_epoch = old_epoch.saturating_add(1);
    let updated_at = unix_now_secs();
    let enc = encrypt_nsec(&nsec).await;

    let conn = crate::account_manager::get_db_connection(&handle)?;
    store_secret_encrypted(&conn, &squad_id, &bot_npub, key_epoch, &enc)?;
    upsert_meta_row(&conn, &squad_id, &bot_npub, &holders, key_epoch, updated_at)?;

    let meta = meta_content(&squad_id, &bot_npub, &holders, key_epoch, updated_at)?;
    let rotated = key_rotated_content(&squad_id, &bot_npub, key_epoch, &me, updated_at)?;
    let share = key_share_content(&squad_id, &bot_npub, key_epoch, &nsec)?;
    let key_shares = holders
        .iter()
        .filter(|h| *h != &me)
        .map(|h| SquadBotKeyShareOut {
            recipient_npub: h.clone(),
            content: share.clone(),
        })
        .collect();
    let state = state_dto(&squad_id, &bot_npub, &holders, key_epoch, updated_at, true, &me);
    crate::account_manager::return_db_connection(conn);
    Ok(SquadBotPublishBundle {
        state,
        mls_announcements: vec![meta, rotated],
        mls_inbox: vec![],
        key_shares,
    })
}

/// Apply MLS-synced public meta (higher epoch wins; same epoch updates holders).
pub fn apply_meta_from_content(conn: &rusqlite::Connection, content: &str) -> Result<bool, String> {
    let trimmed = content.trim();
    if !trimmed.starts_with('{') {
        return Ok(false);
    }
    let val: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    let schema = val.get("schema").and_then(|x| x.as_str()).unwrap_or("");
    if schema != SQUAD_BOT_META_SCHEMA && schema != SQUAD_BOT_KEY_ROTATED_SCHEMA {
        return Ok(false);
    }
    let squad_id = val
        .get("squadId")
        .or_else(|| val.get("squad_id"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing squadId".to_string())?;
    let bot_npub = val
        .get("botNpub")
        .or_else(|| val.get("bot_npub"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| s.starts_with("npub1"))
        .ok_or_else(|| "missing botNpub".to_string())?;
    let key_epoch = val
        .get("keyEpoch")
        .or_else(|| val.get("key_epoch"))
        .and_then(|x| x.as_i64())
        .ok_or_else(|| "missing keyEpoch".to_string())?;
    let updated_at = val
        .get("updatedAt")
        .or_else(|| val.get("updated_at"))
        .and_then(|x| x.as_i64())
        .unwrap_or_else(unix_now_secs);

    let holders = if schema == SQUAD_BOT_META_SCHEMA {
        val.get("holders")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| s.starts_with("npub1"))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else if let Some((_, existing, _, _)) = read_meta_row(conn, squad_id)? {
        existing
    } else {
        Vec::new()
    };

    if let Some((existing_bot, existing_holders, existing_epoch, existing_updated)) =
        read_meta_row(conn, squad_id)?
    {
        if key_epoch < existing_epoch {
            return Ok(false);
        }
        if key_epoch == existing_epoch
            && updated_at <= existing_updated
            && existing_bot == bot_npub
            && existing_holders == holders
        {
            return Ok(false);
        }
        if key_epoch > existing_epoch {
            if let Some(sec_epoch) = secret_epoch(conn, squad_id)? {
                if sec_epoch < key_epoch {
                    delete_secret(conn, squad_id)?;
                }
            }
        }
    }

    let holders_final = if holders.is_empty() {
        read_meta_row(conn, squad_id)?
            .map(|(_, h, _, _)| h)
            .unwrap_or_default()
    } else {
        holders
    };
    upsert_meta_row(
        conn,
        squad_id,
        bot_npub,
        &holders_final,
        key_epoch,
        updated_at,
    )?;
    Ok(true)
}

/// Apply inbound NIP-17 key share (stores encrypted nsec for this device).
pub async fn apply_key_share_from_content<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
) -> Result<bool, String> {
    let trimmed = content.trim();
    if !trimmed.starts_with('{') {
        return Ok(false);
    }
    let wire: SquadBotKeyShareWire = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    if wire.schema != SQUAD_BOT_KEY_SHARE_SCHEMA {
        return Ok(false);
    }
    let squad_id = wire.squad_id.trim();
    let bot_npub = wire.bot_npub.trim();
    let nsec = wire.nsec.trim();
    if squad_id.is_empty() || !bot_npub.starts_with("npub1") || !nsec.starts_with("nsec1") {
        return Ok(false);
    }
    // Verify nsec matches bot_npub.
    let keys = Keys::parse(nsec).map_err(|_| "Invalid bot nsec in key share".to_string())?;
    let derived = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    if derived != bot_npub {
        return Err("Key share nsec does not match botNpub".into());
    }

    let me = current_npub()?;
    let enc = encrypt_nsec(nsec).await;
    let conn = crate::account_manager::get_db_connection(handle)?;
    if let Some((_, holders, _, _)) = read_meta_row(&conn, squad_id)? {
        if !holders.iter().any(|h| h == &me) {
            crate::account_manager::return_db_connection(conn);
            return Err("Key share rejected: not listed as a holder".into());
        }
    }
    store_secret_encrypted(&conn, squad_id, bot_npub, wire.key_epoch, &enc)?;
    if read_meta_row(&conn, squad_id)?.is_none() {
        upsert_meta_row(
            &conn,
            squad_id,
            bot_npub,
            &[me],
            wire.key_epoch,
            unix_now_secs(),
        )?;
    }
    crate::account_manager::return_db_connection(conn);
    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadBotJoinDmDto {
    pub request_id: String,
    pub squad_id: String,
    pub squad_name: String,
    pub broadcast_event_id: String,
    pub requester_npub: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SquadBotJoinDmWire {
    schema: String,
    squad_id: String,
    squad_name: String,
    broadcast_event_id: String,
}

fn parse_join_dm_content(content: &str) -> Option<SquadBotJoinDmWire> {
    let wire: SquadBotJoinDmWire = serde_json::from_str(content.trim()).ok()?;
    if wire.schema != SQUAD_BOT_JOIN_DM_SCHEMA {
        return None;
    }
    if wire.squad_id.trim().is_empty()
        || wire.squad_name.trim().is_empty()
        || wire.broadcast_event_id.trim().is_empty()
    {
        return None;
    }
    Some(wire)
}

/// Fetch gift wraps addressed to this squad's bot and return parsed join DMs.
#[tauri::command]
pub async fn squad_bot_sync_join_dms<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<Vec<SquadBotJoinDmDto>, String> {
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let (bot_keys, bot_npub) = bot_keys_for_holder(&handle, &squad_id).await?;
    let bot_pk = bot_keys.public_key();

    let client = crate::get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    let since = unix_now_secs().saturating_sub(SQUAD_BOT_JOIN_DM_LOOKBACK_SECS as i64);
    let filter = Filter::new()
        .pubkey(bot_pk)
        .kind(Kind::GiftWrap)
        .since(Timestamp::from(since as u64))
        .limit(200);

    let events = client
        .fetch_events_from(
            crate::TRUSTED_RELAYS.to_vec(),
            filter,
            std::time::Duration::from_secs(12),
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut out: Vec<SquadBotJoinDmDto> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for event in events {
        let unwrapped = match UnwrappedGift::from_gift_wrap(&bot_keys, &event).await {
            Ok(u) => u,
            Err(_) => continue,
        };
        let rumor = unwrapped.rumor;
        if rumor.kind != Kind::PrivateDirectMessage {
            continue;
        }
        let Some(wire) = parse_join_dm_content(&rumor.content) else {
            continue;
        };
        if wire.squad_id.trim() != squad_id {
            continue;
        }
        let requester_npub = match unwrapped.sender.to_bech32() {
            Ok(n) => n,
            Err(_) => continue,
        };
        if requester_npub == bot_npub {
            continue;
        }
        let request_id = rumor
            .id
            .map(|id| id.to_hex())
            .unwrap_or_else(|| event.id.to_hex());
        if !seen.insert(request_id.clone()) {
            continue;
        }
        out.push(SquadBotJoinDmDto {
            request_id,
            squad_id: wire.squad_id.trim().to_string(),
            squad_name: wire.squad_name.trim().to_string(),
            broadcast_event_id: wire.broadcast_event_id.trim().to_string(),
            requester_npub,
            created_at: rumor.created_at.as_u64() as i64,
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Pure helpers for unit tests (membership / holder list rules).
pub fn can_add_holder(members: &[String], actor: &str, target: &str, holders: &[String]) -> Result<(), String> {
    if !members.iter().any(|m| m == actor) {
        return Err("actor not a member".into());
    }
    if !members.iter().any(|m| m == target) {
        return Err("target not a member".into());
    }
    if !holders.iter().any(|h| h == actor) {
        return Err("actor not a holder".into());
    }
    Ok(())
}

pub fn next_epoch_after_rotate(current: i64) -> i64 {
    current.saturating_add(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_holder_requires_member_and_actor_holder() {
        let members = vec!["npub1a".into(), "npub1b".into()];
        let holders = vec!["npub1a".into()];
        assert!(can_add_holder(&members, "npub1a", "npub1b", &holders).is_ok());
        assert!(can_add_holder(&members, "npub1b", "npub1a", &holders).is_err());
        assert!(can_add_holder(&members, "npub1a", "npub1c", &holders).is_err());
    }

    #[test]
    fn rotate_bumps_epoch() {
        assert_eq!(next_epoch_after_rotate(1), 2);
        assert_eq!(next_epoch_after_rotate(0), 1);
    }

    #[test]
    fn meta_roundtrip_json() {
        let raw = meta_content("squad1", "npub1bot", &["npub1a".into()], 1, 100).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["schema"], SQUAD_BOT_META_SCHEMA);
        assert_eq!(v["pacto_virtual_bucket"], "announcements");
        assert_eq!(v["keyEpoch"], 1);
    }

    #[test]
    fn parse_join_dm_accepts_schema() {
        let raw = r#"{"schema":"pacto.squad.bot_join_dm.v1","squadId":"s1","squadName":"Pirates","broadcastEventId":"e1"}"#;
        let wire = parse_join_dm_content(raw).expect("parse");
        assert_eq!(wire.squad_id, "s1");
    }

    #[test]
    fn parse_join_dm_rejects_other_schema() {
        let raw = r#"{"schema":"other","squadId":"s1","squadName":"Pirates","broadcastEventId":"e1"}"#;
        assert!(parse_join_dm_content(raw).is_none());
    }
}
