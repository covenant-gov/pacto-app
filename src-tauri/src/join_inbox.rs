//! Join inbox identity: encrypted local nsec for holders + MLS-synced public meta.

use nostr_sdk::prelude::*;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::crypto::{internal_decrypt, internal_encrypt};

pub const JOIN_INBOX_META_SCHEMA: &str = "pacto.squad.join_inbox.meta.v1";
pub const JOIN_INBOX_KEY_ROTATED_SCHEMA: &str = "pacto.squad.join_inbox.key_rotated.v1";
pub const JOIN_INBOX_ROTATE_PROMPT_SCHEMA: &str = "pacto.squad.join_inbox.rotate_prompt.v1";
pub const JOIN_INBOX_KEY_SHARE_SCHEMA: &str = "pacto.squad.join_inbox.key_share.v1";
pub const JOIN_INBOX_DM_SCHEMA: &str = "pacto.squad.join_inbox_dm.v1";
pub const JOIN_INBOX_RESPONSE_DM_SCHEMA: &str = "pacto.squad.join_inbox_response.v1";
pub const JOIN_INBOX_DM_LOOKBACK_SECS: u64 = 7 * 24 * 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInboxStateDto {
    pub squad_id: String,
    pub inbox_npub: String,
    pub holders: Vec<String>,
    pub key_epoch: i64,
    pub updated_at: i64,
    pub has_local_secret: bool,
    pub i_am_holder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInboxPublishBundle {
    pub state: JoinInboxStateDto,
    pub mls_announcements: Vec<String>,
    pub mls_inbox: Vec<String>,
    pub key_shares: Vec<JoinInboxKeyShareOut>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInboxKeyShareOut {
    pub recipient_npub: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinInboxMetaWire {
    schema: String,
    #[serde(rename = "pacto_virtual_bucket")]
    pacto_virtual_bucket: String,
    squad_id: String,
    inbox_npub: String,
    holders: Vec<String>,
    key_epoch: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinInboxKeyRotatedWire {
    schema: String,
    #[serde(rename = "pacto_virtual_bucket")]
    pacto_virtual_bucket: String,
    squad_id: String,
    inbox_npub: String,
    key_epoch: i64,
    rotated_by_npub: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinInboxRotatePromptWire {
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
struct JoinInboxKeyShareWire {
    schema: String,
    squad_id: String,
    inbox_npub: String,
    key_epoch: i64,
    nsec: String,
}

fn unix_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn table_exists(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn ensure_join_inbox_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    if !table_exists(conn, "join_inbox_meta")? || !table_exists(conn, "join_inbox_secret")? {
        return Err("join_inbox tables missing; run migrations".into());
    }
    absorb_legacy_squad_bot_tables(conn)?;
    Ok(())
}

fn absorb_legacy_squad_bot_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    if table_exists(conn, "squad_bot_meta")? {
        conn.execute_batch(
            r#"
            INSERT OR IGNORE INTO join_inbox_meta (parent_id, inbox_npub, holders_json, key_epoch, updated_at)
            SELECT parent_id, bot_npub, holders_json, key_epoch, updated_at FROM squad_bot_meta;
            DROP TABLE squad_bot_meta;
            "#,
        )
        .map_err(|e| format!("Failed to absorb squad_bot_meta: {e}"))?;
    }
    if table_exists(conn, "squad_bot_secret")? {
        conn.execute_batch(
            r#"
            INSERT OR IGNORE INTO join_inbox_secret (parent_id, key_epoch, inbox_npub, encrypted_nsec, updated_at)
            SELECT parent_id, key_epoch, bot_npub, encrypted_nsec, updated_at FROM squad_bot_secret;
            DROP TABLE squad_bot_secret;
            "#,
        )
        .map_err(|e| format!("Failed to absorb squad_bot_secret: {e}"))?;
    }
    Ok(())
}

pub fn delete_join_inbox_rows(conn: &rusqlite::Connection, parent_id: &str) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(());
    }
    if !table_exists(conn, "join_inbox_meta")? || !table_exists(conn, "join_inbox_secret")? {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM join_inbox_secret WHERE parent_id = ?1",
        params![pid],
    )
    .map_err(|e| format!("Failed to delete join_inbox_secret: {e}"))?;
    conn.execute(
        "DELETE FROM join_inbox_meta WHERE parent_id = ?1",
        params![pid],
    )
    .map_err(|e| format!("Failed to delete join_inbox_meta: {e}"))?;
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
    ensure_join_inbox_tables(conn)?;
    conn.query_row(
        "SELECT inbox_npub, holders_json, key_epoch, updated_at FROM join_inbox_meta WHERE parent_id = ?1",
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
    .map_err(|e| format!("Failed to read join_inbox_meta: {e}"))
}

fn upsert_meta_row(
    conn: &rusqlite::Connection,
    parent_id: &str,
    inbox_npub: &str,
    holders: &[String],
    key_epoch: i64,
    updated_at: i64,
) -> Result<(), String> {
    ensure_join_inbox_tables(conn)?;
    let hj = holders_json(holders)?;
    conn.execute(
        r#"INSERT INTO join_inbox_meta (parent_id, inbox_npub, holders_json, key_epoch, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(parent_id) DO UPDATE SET
             inbox_npub = excluded.inbox_npub,
             holders_json = excluded.holders_json,
             key_epoch = excluded.key_epoch,
             updated_at = excluded.updated_at"#,
        params![parent_id, inbox_npub, hj, key_epoch, updated_at],
    )
    .map_err(|e| format!("Failed to upsert join_inbox_meta: {e}"))?;
    Ok(())
}

fn has_secret_row(conn: &rusqlite::Connection, parent_id: &str) -> Result<bool, String> {
    ensure_join_inbox_tables(conn)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM join_inbox_secret WHERE parent_id = ?1",
            params![parent_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn secret_epoch(conn: &rusqlite::Connection, parent_id: &str) -> Result<Option<i64>, String> {
    ensure_join_inbox_tables(conn)?;
    conn.query_row(
        "SELECT key_epoch FROM join_inbox_secret WHERE parent_id = ?1",
        params![parent_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn store_secret_encrypted(
    conn: &rusqlite::Connection,
    parent_id: &str,
    inbox_npub: &str,
    key_epoch: i64,
    encrypted_nsec: &str,
) -> Result<(), String> {
    ensure_join_inbox_tables(conn)?;
    let now = unix_now_secs();
    conn.execute(
        r#"INSERT INTO join_inbox_secret (parent_id, key_epoch, inbox_npub, encrypted_nsec, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(parent_id) DO UPDATE SET
             key_epoch = excluded.key_epoch,
             inbox_npub = excluded.inbox_npub,
             encrypted_nsec = excluded.encrypted_nsec,
             updated_at = excluded.updated_at"#,
        params![parent_id, key_epoch, inbox_npub, encrypted_nsec, now],
    )
    .map_err(|e| format!("Failed to upsert join_inbox_secret: {e}"))?;
    Ok(())
}

async fn encrypt_nsec(nsec: &str) -> String {
    internal_encrypt(nsec.to_string()).await
}

fn read_secret_row(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<(String, i64, String), String> {
    ensure_join_inbox_tables(conn)?;
    conn.query_row(
        "SELECT inbox_npub, key_epoch, encrypted_nsec FROM join_inbox_secret WHERE parent_id = ?1",
        params![parent_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|_| "No local Join inbox key (not a holder on this device)".to_string())
}

async fn decrypt_nsec(encrypted: String) -> Result<String, String> {
    internal_decrypt(encrypted)
        .await
        .map_err(|_| "Failed to decrypt Join inbox key".to_string())
}

fn delete_secret(conn: &rusqlite::Connection, parent_id: &str) -> Result<(), String> {
    ensure_join_inbox_tables(conn)?;
    conn.execute(
        "DELETE FROM join_inbox_secret WHERE parent_id = ?1",
        params![parent_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn current_npub() -> Result<String, String> {
    crate::account_manager::get_current_account()
}

pub fn meta_content(
    squad_id: &str,
    inbox_npub: &str,
    holders: &[String],
    key_epoch: i64,
    updated_at: i64,
) -> Result<String, String> {
    let wire = JoinInboxMetaWire {
        schema: JOIN_INBOX_META_SCHEMA.into(),
        pacto_virtual_bucket: "announcements".into(),
        squad_id: squad_id.into(),
        inbox_npub: inbox_npub.into(),
        holders: holders.to_vec(),
        key_epoch,
        updated_at,
    };
    serde_json::to_string(&wire).map_err(|e| e.to_string())
}

fn key_rotated_content(
    squad_id: &str,
    inbox_npub: &str,
    key_epoch: i64,
    rotated_by: &str,
    updated_at: i64,
) -> Result<String, String> {
    let wire = JoinInboxKeyRotatedWire {
        schema: JOIN_INBOX_KEY_ROTATED_SCHEMA.into(),
        pacto_virtual_bucket: "announcements".into(),
        squad_id: squad_id.into(),
        inbox_npub: inbox_npub.into(),
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
    let wire = JoinInboxRotatePromptWire {
        schema: JOIN_INBOX_ROTATE_PROMPT_SCHEMA.into(),
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
    inbox_npub: &str,
    key_epoch: i64,
    nsec: &str,
) -> Result<String, String> {
    let wire = JoinInboxKeyShareWire {
        schema: JOIN_INBOX_KEY_SHARE_SCHEMA.into(),
        squad_id: squad_id.into(),
        inbox_npub: inbox_npub.into(),
        key_epoch,
        nsec: nsec.into(),
    };
    serde_json::to_string(&wire).map_err(|e| e.to_string())
}

fn state_dto(
    squad_id: &str,
    inbox_npub: &str,
    holders: &[String],
    key_epoch: i64,
    updated_at: i64,
    has_local_secret: bool,
    me: &str,
) -> JoinInboxStateDto {
    JoinInboxStateDto {
        squad_id: squad_id.into(),
        inbox_npub: inbox_npub.into(),
        holders: holders.to_vec(),
        key_epoch,
        updated_at,
        has_local_secret,
        i_am_holder: holders.iter().any(|h| h == me),
    }
}

pub async fn is_mls_member(group_id: &str, npub: &str) -> Result<bool, String> {
    let view = mls_group_view(group_id).await?;
    Ok(view.members.iter().any(|m| m == npub))
}

struct MlsGroupView {
    creator_npub: Option<String>,
    members: Vec<String>,
}

/// Bech32 npub from stored MLS `creator_pubkey` (npub or hex). Welcome path often stores hex.
pub fn normalize_creator_npub(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(pk) = PublicKey::parse(s) {
        return pk.to_bech32().ok();
    }
    if let Ok(pk) = PublicKey::from_hex(s) {
        return pk.to_bech32().ok();
    }
    None
}

async fn mls_group_view(group_id: &str) -> Result<MlsGroupView, String> {
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
            let meta = meta_groups.iter().find(|g| {
                g.group_id == group_id
                    || (!g.engine_group_id.is_empty() && g.engine_group_id == group_id)
            });
            let creator_npub = meta
                .map(|g| g.creator_pubkey.as_str())
                .and_then(normalize_creator_npub);
            let engine_id = meta
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
                return Ok(MlsGroupView {
                    creator_npub,
                    members: Vec::new(),
                });
            };
            let gid = GroupId::from_slice(&gid_bytes);
            let Ok(pk_list) = engine.get_members(&gid) else {
                return Ok(MlsGroupView {
                    creator_npub,
                    members: Vec::new(),
                });
            };
            Ok(MlsGroupView {
                creator_npub,
                members: pk_list
                    .into_iter()
                    .filter_map(|pk| pk.to_bech32().ok())
                    .collect(),
            })
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

fn require_holder(holders: &[String], me: &str) -> Result<(), String> {
    if holders.iter().any(|h| h == me) {
        Ok(())
    } else {
        Err("Only Join inbox holders can perform this action".into())
    }
}

/// Mint when local meta is absent: known MLS creator only, or any member when creator is unknown.
pub fn may_mint_join_inbox(
    me: &str,
    creator_npub: Option<&str>,
    _members: &[String],
) -> Result<(), String> {
    if let Some(creator) = creator_npub.filter(|c| !c.is_empty()) {
        if creator == me {
            return Ok(());
        }
        return Err(
            "Only the squad creator can initialize Join inbox — ask them to open Settings → Join inbox holders"
                .into(),
        );
    }
    Ok(())
}

pub fn is_same_epoch_split(
    secret_inbox: &str,
    secret_epoch: i64,
    meta_inbox: &str,
    meta_epoch: i64,
) -> bool {
    secret_epoch == meta_epoch && secret_inbox != meta_inbox
}

/// Load Join inbox `Keys` for a holder with a matching local secret.
pub async fn inbox_keys_for_holder<R: Runtime>(
    handle: &AppHandle<R>,
    squad_id: &str,
) -> Result<(Keys, String), String> {
    let squad_id = squad_id.trim();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub()?;
    let (inbox_npub_meta, holders, key_epoch, enc) = {
        let conn = crate::account_manager::get_db_connection(handle)?;
        let (inbox_npub, holders, key_epoch, _) =
            read_meta_row(&conn, squad_id)?.ok_or_else(|| {
                "Join inbox not initialized — open Join inbox settings first".to_string()
            })?;
        require_holder(&holders, &me)?;
        let (secret_inbox, secret_epoch, enc) = read_secret_row(&conn, squad_id)?;
        crate::account_manager::return_db_connection(conn);
        if secret_inbox != inbox_npub || secret_epoch != key_epoch {
            return Err("Local Join inbox key is stale — ask a holder to re-share or rotate".into());
        }
        (inbox_npub, holders, key_epoch, enc)
    };
    let _ = (holders, key_epoch);
    let nsec = decrypt_nsec(enc).await?;
    let keys = Keys::parse(&nsec).map_err(|_| "Invalid stored Join inbox nsec".to_string())?;
    let derived = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    if derived != inbox_npub_meta {
        return Err("Stored Join inbox nsec does not match inbox npub".into());
    }
    Ok((keys, inbox_npub_meta))
}

pub fn inbox_npub_for_squad<R: Runtime>(
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
    Ok(row.map(|(inbox_npub, _, _, _)| inbox_npub))
}

#[tauri::command]
pub async fn join_inbox_init<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<JoinInboxPublishBundle, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub()?;
    {
        let conn = crate::account_manager::get_db_connection(&handle)?;
        ensure_join_inbox_tables(&conn)?;
        if let Some((inbox_npub, holders, key_epoch, updated_at)) = read_meta_row(&conn, &squad_id)?
        {
            let has = has_secret_row(&conn, &squad_id)?;
            crate::account_manager::return_db_connection(conn);
            let state = state_dto(
                &squad_id, &inbox_npub, &holders, key_epoch, updated_at, has, &me,
            );
            return Ok(JoinInboxPublishBundle {
                state,
                mls_announcements: vec![],
                mls_inbox: vec![],
                key_shares: vec![],
            });
        }
        crate::account_manager::return_db_connection(conn);
    }

    let view = mls_group_view(&squad_id).await.unwrap_or(MlsGroupView {
        creator_npub: None,
        members: Vec::new(),
    });
    may_mint_join_inbox(&me, view.creator_npub.as_deref(), &view.members)?;

    let keys = Keys::generate();
    let inbox_npub = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    let nsec = keys.secret_key().to_bech32().map_err(|e| e.to_string())?;
    let holders = vec![me.clone()];
    let key_epoch = 1i64;
    let updated_at = unix_now_secs();
    let enc = encrypt_nsec(&nsec).await;

    let conn = crate::account_manager::get_db_connection(&handle)?;
    store_secret_encrypted(&conn, &squad_id, &inbox_npub, key_epoch, &enc)?;
    upsert_meta_row(&conn, &squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;
    let meta = meta_content(&squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;
    let state = state_dto(
        &squad_id, &inbox_npub, &holders, key_epoch, updated_at, true, &me,
    );
    crate::account_manager::return_db_connection(conn);
    Ok(JoinInboxPublishBundle {
        state,
        mls_announcements: vec![meta],
        mls_inbox: vec![],
        key_shares: vec![],
    })
}

#[tauri::command]
pub async fn join_inbox_get_state<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<Option<JoinInboxStateDto>, String> {
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub().unwrap_or_default();
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let row = read_meta_row(&conn, &squad_id)?;
    let has = has_secret_row(&conn, &squad_id)?;
    crate::account_manager::return_db_connection(conn);
    Ok(row.map(|(inbox_npub, holders, key_epoch, updated_at)| {
        state_dto(
            &squad_id, &inbox_npub, &holders, key_epoch, updated_at, has, &me,
        )
    }))
}

#[tauri::command]
pub async fn join_inbox_reclaim_if_split<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<JoinInboxPublishBundle, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub()?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let Some((meta_inbox, holders, meta_epoch, updated_at)) = read_meta_row(&conn, &squad_id)?
    else {
        crate::account_manager::return_db_connection(conn);
        return Err("Join inbox not initialized".into());
    };
    if !has_secret_row(&conn, &squad_id)? {
        let has = false;
        let state = state_dto(
            &squad_id, &meta_inbox, &holders, meta_epoch, updated_at, has, &me,
        );
        crate::account_manager::return_db_connection(conn);
        return Ok(JoinInboxPublishBundle {
            state,
            mls_announcements: vec![],
            mls_inbox: vec![],
            key_shares: vec![],
        });
    }
    let (secret_inbox, secret_epoch, enc) = read_secret_row(&conn, &squad_id)?;
    if !is_same_epoch_split(&secret_inbox, secret_epoch, &meta_inbox, meta_epoch) {
        let has = true;
        let state = state_dto(
            &squad_id, &meta_inbox, &holders, meta_epoch, updated_at, has, &me,
        );
        crate::account_manager::return_db_connection(conn);
        return Ok(JoinInboxPublishBundle {
            state,
            mls_announcements: vec![],
            mls_inbox: vec![],
            key_shares: vec![],
        });
    }
    crate::account_manager::return_db_connection(conn);

    let nsec = decrypt_nsec(enc).await?;
    let keys = Keys::parse(&nsec).map_err(|_| "Invalid stored Join inbox nsec".to_string())?;
    let derived = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    if derived != secret_inbox {
        return Err("Stored Join inbox nsec does not match inbox npub".into());
    }

    let restored_holders = vec![me.clone()];
    let key_epoch = meta_epoch.saturating_add(1);
    let updated_at = unix_now_secs();
    let enc = encrypt_nsec(&nsec).await;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    store_secret_encrypted(&conn, &squad_id, &secret_inbox, key_epoch, &enc)?;
    upsert_meta_row(
        &conn,
        &squad_id,
        &secret_inbox,
        &restored_holders,
        key_epoch,
        updated_at,
    )?;
    let meta = meta_content(
        &squad_id,
        &secret_inbox,
        &restored_holders,
        key_epoch,
        updated_at,
    )?;
    let state = state_dto(
        &squad_id,
        &secret_inbox,
        &restored_holders,
        key_epoch,
        updated_at,
        true,
        &me,
    );
    crate::account_manager::return_db_connection(conn);
    Ok(JoinInboxPublishBundle {
        state,
        mls_announcements: vec![meta],
        mls_inbox: vec![],
        key_shares: vec![],
    })
}

#[tauri::command]
pub async fn join_inbox_add_holder<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
    holder_npub: String,
) -> Result<JoinInboxPublishBundle, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
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
    let (inbox_npub, mut holders, key_epoch, _) =
        read_meta_row(&conn, &squad_id)?.ok_or_else(|| "Join inbox not initialized".to_string())?;
    require_holder(&holders, &me)?;
    if !has_secret_row(&conn, &squad_id)? {
        crate::account_manager::return_db_connection(conn);
        return Err("Local Join inbox key required to add holders".into());
    }
    if holders.iter().any(|h| h == &holder_npub) {
        let has = true;
        let updated_at = unix_now_secs();
        let state = state_dto(
            &squad_id, &inbox_npub, &holders, key_epoch, updated_at, has, &me,
        );
        crate::account_manager::return_db_connection(conn);
        return Ok(JoinInboxPublishBundle {
            state,
            mls_announcements: vec![],
            mls_inbox: vec![],
            key_shares: vec![],
        });
    }
    holders.push(holder_npub.clone());
    let updated_at = unix_now_secs();
    let (_bn, _epoch, enc) = read_secret_row(&conn, &squad_id)?;
    upsert_meta_row(&conn, &squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;
    let meta = meta_content(&squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;
    crate::account_manager::return_db_connection(conn);
    let nsec = decrypt_nsec(enc).await?;
    let share = key_share_content(&squad_id, &inbox_npub, key_epoch, &nsec)?;
    let state = state_dto(
        &squad_id, &inbox_npub, &holders, key_epoch, updated_at, true, &me,
    );
    Ok(JoinInboxPublishBundle {
        state,
        mls_announcements: vec![meta],
        mls_inbox: vec![],
        key_shares: vec![JoinInboxKeyShareOut {
            recipient_npub: holder_npub,
            content: share,
        }],
    })
}

#[tauri::command]
pub async fn join_inbox_remove_holder<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
    holder_npub: String,
) -> Result<JoinInboxPublishBundle, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
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
    let (inbox_npub, mut holders, key_epoch, _) =
        read_meta_row(&conn, &squad_id)?.ok_or_else(|| "Join inbox not initialized".to_string())?;
    require_holder(&holders, &me)?;
    if holders.len() <= 1 && holders.iter().any(|h| h == &holder_npub) {
        crate::account_manager::return_db_connection(conn);
        return Err("Cannot remove the last Join inbox holder; add another holder first".into());
    }
    let before = holders.len();
    holders.retain(|h| h != &holder_npub);
    if holders.len() == before {
        crate::account_manager::return_db_connection(conn);
        return Err("Npub is not a Join inbox holder".into());
    }
    let updated_at = unix_now_secs();
    upsert_meta_row(&conn, &squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;
    if holder_npub == me {
        delete_secret(&conn, &squad_id)?;
    }
    let meta = meta_content(&squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;
    let prompt = rotate_prompt_content(&squad_id, key_epoch, &holder_npub, updated_at)?;
    let has = has_secret_row(&conn, &squad_id)?;
    let state = state_dto(
        &squad_id, &inbox_npub, &holders, key_epoch, updated_at, has, &me,
    );
    crate::account_manager::return_db_connection(conn);
    Ok(JoinInboxPublishBundle {
        state,
        mls_announcements: vec![meta],
        mls_inbox: vec![prompt],
        key_shares: vec![],
    })
}

#[tauri::command]
pub async fn join_inbox_rotate_key<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<JoinInboxPublishBundle, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let me = current_npub()?;
    if !is_mls_member(&squad_id, &me).await? {
        return Err("You must be a current MLS member to rotate the Join inbox key".into());
    }

    let (holders, old_epoch) = {
        let conn = crate::account_manager::get_db_connection(&handle)?;
        let (_old_inbox, holders, old_epoch, _) = read_meta_row(&conn, &squad_id)?
            .ok_or_else(|| "Join inbox not initialized".to_string())?;
        require_holder(&holders, &me)?;
        if !has_secret_row(&conn, &squad_id)? {
            crate::account_manager::return_db_connection(conn);
            return Err("Local Join inbox key required to rotate".into());
        }
        crate::account_manager::return_db_connection(conn);
        (holders, old_epoch)
    };

    let view = mls_group_view(&squad_id).await?;
    let holders: Vec<String> = holders
        .into_iter()
        .filter(|h| view.members.iter().any(|m| m == h))
        .collect();
    if holders.is_empty() {
        return Err("No current MLS members remain as holders".into());
    }

    let keys = Keys::generate();
    let inbox_npub = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    let nsec = keys.secret_key().to_bech32().map_err(|e| e.to_string())?;
    let key_epoch = old_epoch.saturating_add(1);
    let updated_at = unix_now_secs();
    let enc = encrypt_nsec(&nsec).await;

    let conn = crate::account_manager::get_db_connection(&handle)?;
    store_secret_encrypted(&conn, &squad_id, &inbox_npub, key_epoch, &enc)?;
    upsert_meta_row(&conn, &squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;

    let meta = meta_content(&squad_id, &inbox_npub, &holders, key_epoch, updated_at)?;
    let rotated = key_rotated_content(&squad_id, &inbox_npub, key_epoch, &me, updated_at)?;
    let share = key_share_content(&squad_id, &inbox_npub, key_epoch, &nsec)?;
    let key_shares = holders
        .iter()
        .filter(|h| *h != &me)
        .map(|h| JoinInboxKeyShareOut {
            recipient_npub: h.clone(),
            content: share.clone(),
        })
        .collect();
    let state = state_dto(
        &squad_id, &inbox_npub, &holders, key_epoch, updated_at, true, &me,
    );
    crate::account_manager::return_db_connection(conn);
    Ok(JoinInboxPublishBundle {
        state,
        mls_announcements: vec![meta, rotated],
        mls_inbox: vec![],
        key_shares,
    })
}

/// Apply MLS-synced public meta. Same-epoch inbox npub is sticky.
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
    if schema != JOIN_INBOX_META_SCHEMA && schema != JOIN_INBOX_KEY_ROTATED_SCHEMA {
        return Ok(false);
    }
    let squad_id = val
        .get("squadId")
        .or_else(|| val.get("squad_id"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing squadId".to_string())?;
    let inbox_npub = val
        .get("inboxNpub")
        .or_else(|| val.get("inbox_npub"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| s.starts_with("npub1"))
        .ok_or_else(|| "missing inboxNpub".to_string())?;
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

    let holders = if schema == JOIN_INBOX_META_SCHEMA {
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

    if let Some((existing_inbox, existing_holders, existing_epoch, existing_updated)) =
        read_meta_row(conn, squad_id)?
    {
        if key_epoch < existing_epoch {
            return Ok(false);
        }
        if key_epoch == existing_epoch {
            if existing_inbox != inbox_npub {
                return Ok(false);
            }
            if updated_at <= existing_updated && existing_holders == holders {
                return Ok(false);
            }
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
        inbox_npub,
        &holders_final,
        key_epoch,
        updated_at,
    )?;
    Ok(true)
}

pub async fn apply_key_share_from_content<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
) -> Result<bool, String> {
    let trimmed = content.trim();
    if !trimmed.starts_with('{') {
        return Ok(false);
    }
    let wire: JoinInboxKeyShareWire = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    if wire.schema != JOIN_INBOX_KEY_SHARE_SCHEMA {
        return Ok(false);
    }
    let squad_id = wire.squad_id.trim();
    let inbox_npub = wire.inbox_npub.trim();
    let nsec = wire.nsec.trim();
    if squad_id.is_empty() || !inbox_npub.starts_with("npub1") || !nsec.starts_with("nsec1") {
        return Ok(false);
    }
    let keys = Keys::parse(nsec).map_err(|_| "Invalid Join inbox nsec in key share".to_string())?;
    let derived = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    if derived != inbox_npub {
        return Err("Key share nsec does not match inboxNpub".into());
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
    store_secret_encrypted(&conn, squad_id, inbox_npub, wire.key_epoch, &enc)?;
    crate::account_manager::return_db_connection(conn);
    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInboxJoinDmDto {
    pub request_id: String,
    pub squad_id: String,
    pub squad_name: String,
    pub broadcast_event_id: String,
    pub requester_npub: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinInboxJoinDmWire {
    schema: String,
    request_id: String,
    squad_id: String,
    squad_name: String,
    broadcast_event_id: String,
}

fn parse_join_dm_content(content: &str) -> Option<JoinInboxJoinDmWire> {
    let wire: JoinInboxJoinDmWire = serde_json::from_str(content.trim()).ok()?;
    if wire.schema != JOIN_INBOX_DM_SCHEMA {
        return None;
    }
    if wire.squad_id.trim().is_empty()
        || wire.request_id.trim().is_empty()
        || wire.squad_name.trim().is_empty()
        || wire.broadcast_event_id.trim().is_empty()
    {
        return None;
    }
    Some(wire)
}

#[tauri::command]
pub async fn join_inbox_sync_join_dms<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
) -> Result<Vec<JoinInboxJoinDmDto>, String> {
    let squad_id = squad_id.trim().to_string();
    if squad_id.is_empty() {
        return Err("squadId is required".into());
    }
    let (inbox_keys, inbox_npub) = inbox_keys_for_holder(&handle, &squad_id).await?;
    let inbox_pk = inbox_keys.public_key();

    let client =
        crate::get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    let since = unix_now_secs().saturating_sub(JOIN_INBOX_DM_LOOKBACK_SECS as i64);
    let filter = Filter::new()
        .pubkey(inbox_pk)
        .kind(Kind::GiftWrap)
        .since(Timestamp::from(since as u64))
        .limit(200);

    let events = client
        .fetch_events_from(
            crate::trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(12),
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut out: Vec<JoinInboxJoinDmDto> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for event in events {
        let unwrapped = match UnwrappedGift::from_gift_wrap(&inbox_keys, &event).await {
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
        if requester_npub == inbox_npub {
            continue;
        }
        let request_id = wire.request_id.trim().to_string();
        if !seen.insert(request_id.clone()) {
            continue;
        }
        out.push(JoinInboxJoinDmDto {
            request_id,
            squad_id: wire.squad_id.trim().to_string(),
            squad_name: wire.squad_name.trim().to_string(),
            broadcast_event_id: wire.broadcast_event_id.trim().to_string(),
            requester_npub,
            created_at: rumor.created_at.as_secs() as i64,
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinInboxResponseWire {
    schema: String,
    squad_id: String,
    request_id: String,
    status: String,
}

fn valid_join_response_content(content: &str, squad_id: &str) -> bool {
    let Ok(wire) = serde_json::from_str::<JoinInboxResponseWire>(content.trim()) else {
        return false;
    };
    wire.schema == JOIN_INBOX_RESPONSE_DM_SCHEMA
        && wire.squad_id.trim() == squad_id
        && !wire.request_id.trim().is_empty()
        && matches!(wire.status.as_str(), "accepted" | "rejected")
}

#[tauri::command]
pub async fn join_inbox_send_join_response<R: Runtime>(
    handle: AppHandle<R>,
    squad_id: String,
    requester_npub: String,
    content: String,
) -> Result<(), String> {
    let squad_id = squad_id.trim().to_string();
    let requester = PublicKey::parse(requester_npub.trim()).map_err(|e| e.to_string())?;
    if !valid_join_response_content(&content, &squad_id) {
        return Err("Invalid join response".into());
    }

    let (inbox_keys, _) = inbox_keys_for_holder(&handle, &squad_id).await?;
    let rumor = EventBuilder::private_msg_rumor(requester, content).build(inbox_keys.public_key());
    let gift_wrap = EventBuilder::gift_wrap(&inbox_keys, &requester, rumor, [])
        .await
        .map_err(|e| e.to_string())?;
    let client =
        crate::get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    let send_output = client
        .send_event_to(
            crate::trusted_relays::trusted_relays().iter().cloned(),
            &gift_wrap,
        )
        .await
        .map_err(|e| e.to_string())?;
    crate::record_send_outcome(&gift_wrap, &send_output);
    Ok(())
}

#[cfg(test)]
pub fn can_add_holder(
    members: &[String],
    actor: &str,
    target: &str,
    holders: &[String],
) -> Result<(), String> {
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

#[cfg(test)]
pub fn next_epoch_after_rotate(current: i64) -> i64 {
    current.saturating_add(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().expect("mem");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

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
        let raw = meta_content("squad1", "npub1inbox", &["npub1a".into()], 1, 100).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["schema"], JOIN_INBOX_META_SCHEMA);
        assert_eq!(v["pacto_virtual_bucket"], "announcements");
        assert_eq!(v["inboxNpub"], "npub1inbox");
        assert_eq!(v["keyEpoch"], 1);
        assert!(v.get("botNpub").is_none());
    }

    #[test]
    fn parse_join_dm_accepts_schema() {
        let raw = r#"{"schema":"pacto.squad.join_inbox_dm.v1","requestId":"r1","squadId":"s1","squadName":"Pirates","broadcastEventId":"e1"}"#;
        let wire = parse_join_dm_content(raw).expect("parse");
        assert_eq!(wire.squad_id, "s1");
        assert_eq!(wire.request_id, "r1");
    }

    #[test]
    fn parse_join_dm_rejects_legacy_and_other() {
        let legacy = r#"{"schema":"pacto.squad.bot_join_dm.v1","requestId":"r1","squadId":"s1","squadName":"Pirates","broadcastEventId":"e1"}"#;
        assert!(parse_join_dm_content(legacy).is_none());
        let other = r#"{"schema":"other","requestId":"r1","squadId":"s1","squadName":"Pirates","broadcastEventId":"e1"}"#;
        assert!(parse_join_dm_content(other).is_none());
    }

    #[test]
    fn join_response_requires_matching_squad_and_request() {
        let raw = r#"{"schema":"pacto.squad.join_inbox_response.v1","squadId":"s1","requestId":"r1","status":"accepted"}"#;
        assert!(valid_join_response_content(raw, "s1"));
        assert!(!valid_join_response_content(raw, "s2"));
        assert!(!valid_join_response_content(
            r#"{"schema":"pacto.squad.join_inbox_response.v1","squadId":"s1","requestId":"","status":"accepted"}"#,
            "s1"
        ));
    }

    #[test]
    fn may_mint_allows_creator_even_with_other_members() {
        let members = vec!["npub1creator".into(), "npub1joiner".into()];
        assert!(may_mint_join_inbox("npub1creator", Some("npub1creator"), &members).is_ok());
        let err = may_mint_join_inbox("npub1joiner", Some("npub1creator"), &members).unwrap_err();
        assert!(err.contains("Only the squad creator"));
        assert!(!err.contains("already exists"));
    }

    #[test]
    fn may_mint_when_creator_unknown_allows_any_member() {
        assert!(may_mint_join_inbox("npub1a", None, &["npub1a".into()]).is_ok());
        assert!(may_mint_join_inbox("npub1a", None, &["npub1a".into(), "npub1b".into()]).is_ok());
    }

    #[test]
    fn normalize_creator_npub_accepts_npub_and_hex() {
        let keys = Keys::generate();
        let npub = keys.public_key().to_bech32().unwrap();
        let hex = keys.public_key().to_hex();
        assert_eq!(normalize_creator_npub(&npub).as_deref(), Some(npub.as_str()));
        assert_eq!(normalize_creator_npub(&hex).as_deref(), Some(npub.as_str()));
        assert_eq!(normalize_creator_npub(""), None);
        assert_eq!(normalize_creator_npub("not-a-key"), None);
    }

    #[test]
    fn same_epoch_split_fingerprint() {
        assert!(is_same_epoch_split("npub1a", 1, "npub1b", 1));
        assert!(!is_same_epoch_split("npub1a", 1, "npub1a", 1));
        assert!(!is_same_epoch_split("npub1a", 1, "npub1b", 2));
    }

    #[test]
    fn apply_meta_accepts_first_row() {
        let conn = mem_conn();
        let raw = meta_content("s1", "npub1inboxa", &["npub1creator".into()], 1, 10).unwrap();
        assert!(apply_meta_from_content(&conn, &raw).unwrap());
        let (inbox, holders, epoch, _) = read_meta_row(&conn, "s1").unwrap().unwrap();
        assert_eq!(inbox, "npub1inboxa");
        assert_eq!(holders, vec!["npub1creator".to_string()]);
        assert_eq!(epoch, 1);
    }

    #[test]
    fn apply_meta_rejects_lower_epoch() {
        let conn = mem_conn();
        let first = meta_content("s1", "npub1inboxa", &["npub1creator".into()], 2, 10).unwrap();
        apply_meta_from_content(&conn, &first).unwrap();
        let older = meta_content("s1", "npub1inboxb", &["npub1joiner".into()], 1, 20).unwrap();
        assert!(!apply_meta_from_content(&conn, &older).unwrap());
        let (inbox, _, epoch, _) = read_meta_row(&conn, "s1").unwrap().unwrap();
        assert_eq!(inbox, "npub1inboxa");
        assert_eq!(epoch, 2);
    }

    #[test]
    fn apply_meta_rejects_same_epoch_different_inbox() {
        let conn = mem_conn();
        let first = meta_content("s1", "npub1inboxa", &["npub1creator".into()], 1, 10).unwrap();
        apply_meta_from_content(&conn, &first).unwrap();
        let fork = meta_content("s1", "npub1inboxb", &["npub1joiner".into()], 1, 99).unwrap();
        assert!(!apply_meta_from_content(&conn, &fork).unwrap());
        let (inbox, holders, _, _) = read_meta_row(&conn, "s1").unwrap().unwrap();
        assert_eq!(inbox, "npub1inboxa");
        assert_eq!(holders, vec!["npub1creator".to_string()]);
    }

    #[test]
    fn apply_meta_same_epoch_same_inbox_updates_holders() {
        let conn = mem_conn();
        let first = meta_content("s1", "npub1inboxa", &["npub1creator".into()], 1, 10).unwrap();
        apply_meta_from_content(&conn, &first).unwrap();
        let added = meta_content(
            "s1",
            "npub1inboxa",
            &["npub1creator".into(), "npub1hold".into()],
            1,
            20,
        )
        .unwrap();
        assert!(apply_meta_from_content(&conn, &added).unwrap());
        let (_, holders, _, _) = read_meta_row(&conn, "s1").unwrap().unwrap();
        assert_eq!(
            holders,
            vec!["npub1creator".to_string(), "npub1hold".to_string()]
        );
    }

    #[test]
    fn apply_meta_higher_epoch_accepts_new_inbox() {
        let conn = mem_conn();
        let first = meta_content("s1", "npub1inboxa", &["npub1creator".into()], 1, 10).unwrap();
        apply_meta_from_content(&conn, &first).unwrap();
        store_secret_encrypted(&conn, "s1", "npub1inboxa", 1, "enc").unwrap();
        let rotated = meta_content("s1", "npub1inboxb", &["npub1creator".into()], 2, 30).unwrap();
        assert!(apply_meta_from_content(&conn, &rotated).unwrap());
        let (inbox, _, epoch, _) = read_meta_row(&conn, "s1").unwrap().unwrap();
        assert_eq!(inbox, "npub1inboxb");
        assert_eq!(epoch, 2);
        assert!(!has_secret_row(&conn, "s1").unwrap());
    }

    #[test]
    fn apply_meta_ignores_legacy_schema() {
        let conn = mem_conn();
        let legacy = r#"{"schema":"pacto.squad_bot.meta.v1","squadId":"s1","botNpub":"npub1x","holders":["npub1a"],"keyEpoch":1,"updatedAt":1}"#;
        assert!(!apply_meta_from_content(&conn, legacy).unwrap());
        assert!(read_meta_row(&conn, "s1").unwrap().is_none());
    }

    #[test]
    fn key_share_without_meta_does_not_write_holders() {
        let conn = mem_conn();
        store_secret_encrypted(&conn, "s1", "npub1inboxa", 1, "enc").unwrap();
        assert!(read_meta_row(&conn, "s1").unwrap().is_none());
        assert!(has_secret_row(&conn, "s1").unwrap());
    }
}
