//! EVM multi-account: phrase-derived (`bip44_v1`) and imported private keys.
//! See `docs/wallet/HD_DERIVATION_V1.md`.

use rand::Rng;
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::account_manager;
use crate::crypto;
use crate::db;
use crate::evm;

pub const SCHEME_BIP44_V1: &str = "bip44_v1";
pub const SCHEME_IMPORTED: &str = "imported_private_key";

const SETTING_ACTIVE: &str = "active_evm_account_id";
const SETTING_DEFAULT_SHARED: &str = "default_shared_evm_account_id";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvmAccountRow {
    pub id: String,
    pub scheme: String,
    pub hd_index: Option<u32>,
    pub address: String,
    pub label: String,
    pub is_active: bool,
    pub is_default_shared: bool,
}

/// One row for export / backup (includes decrypted private key).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvmAccountExportRow {
    pub id: String,
    pub scheme: String,
    pub hd_index: Option<u32>,
    pub address: String,
    pub label: String,
    pub private_key: String,
}

fn sql_get_setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("settings read: {}", e))?;
    Ok(v)
}

fn sql_set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("settings write: {}", e))?;
    Ok(())
}

fn hd_row_id(index: u32) -> String {
    format!("bip44-v1-{}", index)
}

fn new_import_id() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill(&mut b);
    format!("imp-{}", hex::encode(b))
}

/// Publishes Kind 0 (profile metadata) in the background; local DB and `profile_update` still update when it finishes.
fn spawn_kind0_republish_with_events<R: Runtime>(handle: AppHandle<R>) {
    tokio::spawn(async move {
        match crate::profile::republish_kind0_metadata_with_wallet_default().await {
            Ok(()) => {
                let _ = handle.emit("kind0_profile_published", true);
            }
            Err(e) => {
                let _ = handle.emit("kind0_profile_publish_failed", e);
            }
        }
    });
}

/// Address to publish on Kind 0: `evm_accounts.address` for `default_shared_evm_account_id` (initialized in `ensure_ready`).
pub async fn resolve_default_shared_evm_address_string<R: Runtime>(handle: AppHandle<R>) -> Option<String> {
    let _ = ensure_ready(handle.clone()).await.ok();
    let addr_opt = if let Ok(conn) = account_manager::get_db_connection(&handle) {
        let inner = if let Some(id) = sql_get_setting(&conn, SETTING_DEFAULT_SHARED).ok().flatten() {
            conn.query_row(
                "SELECT address FROM evm_accounts WHERE id = ?1",
                rusqlite::params![&id],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
        } else {
            None
        };
        account_manager::return_db_connection(conn);
        inner
    } else {
        None
    };
    addr_opt.filter(|s| !s.trim().is_empty())
}

fn count_accounts<R: Runtime>(handle: &AppHandle<R>) -> Result<i64, String> {
    let conn = account_manager::get_db_connection(handle)?;
    let c: i64 = conn
        .query_row("SELECT COUNT(*) FROM evm_accounts", [], |r| r.get(0))
        .unwrap_or(0);
    account_manager::return_db_connection(conn);
    Ok(c)
}

pub(crate) async fn get_mnemonic_for_hd<R: Runtime>(handle: AppHandle<R>) -> Result<String, String> {
    if let Some(m) = crate::mnemonic_seed_get() {
        return Ok(m);
    }
    db::get_seed(handle)
        .await?
        .ok_or_else(|| "Recovery phrase not loaded. Unlock the app again.".to_string())
}

async fn resolve_private_key_hex_for_account_id<R: Runtime>(
    handle: &AppHandle<R>,
    account_id: &str,
) -> Result<(String, String, String), String> {
    let conn = account_manager::get_db_connection(handle)?;
    let row: (String, Option<i64>, String, Option<String>) = conn
        .query_row(
            "SELECT scheme, hd_index, address, imported_enc FROM evm_accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .map_err(|_| "EVM account not found.".to_string())?;
    account_manager::return_db_connection(conn);

    let (scheme, hd_index, address, imported_enc) = row;
    match scheme.as_str() {
        SCHEME_BIP44_V1 => {
            let idx = hd_index.ok_or_else(|| "Derived account missing index.".to_string())? as u32;
            let phrase = get_mnemonic_for_hd(handle.clone()).await?;
            let (key_hex, addr2) = evm::derive_eth_bip44_v1_from_mnemonic_phrase(&phrase, idx)?;
            let norm = evm::normalize_hex_address(&addr2).unwrap_or(addr2);
            let stored = evm::normalize_hex_address(address.trim()).unwrap_or(address);
            if stored.to_lowercase() != norm.to_lowercase() {
                return Err("Derived account address mismatch (data may be corrupt).".to_string());
            }
            Ok((key_hex, norm, SCHEME_BIP44_V1.to_string()))
        }
        SCHEME_IMPORTED => {
            let enc = imported_enc.ok_or_else(|| "Imported account missing ciphertext.".to_string())?;
            let key_hex = crypto::internal_decrypt(enc, None)
                .await
                .map_err(|_| "Could not decrypt imported EVM key.".to_string())?;
            let trimmed = key_hex.trim();
            let h = trimmed
                .strip_prefix("0x")
                .or_else(|| trimmed.strip_prefix("0X"))
                .unwrap_or(trimmed);
            if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Imported EVM key has invalid length.".to_string());
            }
            let norm =
                evm::normalize_hex_address(address.trim()).unwrap_or_else(|| address.trim().to_string());
            Ok((format!("0x{}", h.to_lowercase()), norm, SCHEME_IMPORTED.to_string()))
        }
        _ => Err("Unknown EVM account scheme.".to_string()),
    }
}

async fn resolve_active_private_key_hex<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<(String, String, String), String> {
    let conn = account_manager::get_db_connection(handle)?;
    let active_id = sql_get_setting(&conn, SETTING_ACTIVE)?.ok_or_else(|| {
        "No active EVM account. Open Settings → Wallet to set up accounts.".to_string()
    })?;
    account_manager::return_db_connection(conn);
    resolve_private_key_hex_for_account_id(handle, &active_id).await
}

async fn persist_signing_material<R: Runtime>(
    handle: &AppHandle<R>,
    key_hex: &str,
    address: &str,
) -> Result<(), String> {
    let enc = crypto::internal_encrypt(key_hex.to_string(), None).await;
    db::set_evm_pkey(handle.clone(), enc).await?;
    db::set_wallet_signing_evm_address(handle.clone(), address.to_string()).await?;
    Ok(())
}

pub(crate) async fn sync_signing_material_from_active<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<(), String> {
    let (key_hex, addr, _) = resolve_active_private_key_hex(&handle).await?;
    persist_signing_material(&handle, &key_hex, &addr).await
}

fn fix_active_if_needed<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let conn = account_manager::get_db_connection(handle)?;
    let active_invalid = match sql_get_setting(&conn, SETTING_ACTIVE)? {
        Some(ref id) => {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM evm_accounts WHERE id = ?1",
                    rusqlite::params![id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            n == 0
        }
        None => true,
    };

    if active_invalid {
        let pick: Option<String> = conn
            .query_row(
                "SELECT id FROM evm_accounts ORDER BY scheme ASC, (hd_index IS NULL), hd_index ASC, id ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("evm_accounts: {}", e))?;
        if let Some(id) = pick {
            sql_set_setting(&conn, SETTING_ACTIVE, &id)?;
        }
    }

    let default_invalid = match sql_get_setting(&conn, SETTING_DEFAULT_SHARED)? {
        Some(ref id) => {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM evm_accounts WHERE id = ?1",
                    rusqlite::params![id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            n == 0
        }
        None => true,
    };

    if default_invalid {
        let pick: Option<String> = conn
            .query_row(
                "SELECT id FROM evm_accounts ORDER BY scheme ASC, (hd_index IS NULL), hd_index ASC, id ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("evm_accounts: {}", e))?;
        if let Some(id) = pick {
            sql_set_setting(&conn, SETTING_DEFAULT_SHARED, &id)?;
        }
    }

    account_manager::return_db_connection(conn);
    Ok(())
}

/// Create rows from seed or legacy `evm_pkey`, then align `evm_pkey` / `evm_address` with the active account.
pub async fn ensure_ready<R: Runtime>(handle: AppHandle<R>) -> Result<(), String> {
    // Align stored `evm_address` with decrypted key before legacy paths that require `len >= 42`.
    let _ = db::repair_evm_address_if_needed(&handle).await;
    if count_accounts(&handle)? > 0 {
        fix_active_if_needed(&handle)?;
        sync_signing_material_from_active(handle.clone()).await?;
        return Ok(());
    }

    let phrase = if let Some(m) = crate::mnemonic_seed_get() {
        Some(m)
    } else {
        db::get_seed(handle.clone()).await.ok().flatten()
    };

    if let Some(p) = phrase {
        let (key_hex, addr) = evm::derive_eth_bip44_v1_from_mnemonic_phrase(&p, 0)?;
        let id = hd_row_id(0);
        let conn = account_manager::get_db_connection(&handle)?;
        conn.execute(
            "INSERT INTO evm_accounts (id, scheme, hd_index, address, label, imported_enc) VALUES (?1, ?2, ?3, ?4, '', NULL)",
            rusqlite::params![&id, SCHEME_BIP44_V1, 0i64, &addr],
        )
        .map_err(|e| format!("evm_accounts insert: {}", e))?;
        sql_set_setting(&conn, SETTING_ACTIVE, &id)?;
        if sql_get_setting(&conn, SETTING_DEFAULT_SHARED)?.is_none() {
            sql_set_setting(&conn, SETTING_DEFAULT_SHARED, &id)?;
        }
        account_manager::return_db_connection(conn);
        persist_signing_material(&handle, &key_hex, &addr).await?;
        return Ok(());
    }

    if let Some(enc) = db::get_evm_pkey(handle.clone())? {
        let addr = db::read_stored_evm_address(handle.clone())?
            .filter(|a| a.len() >= 42)
            .ok_or_else(|| {
                "EVM accounts missing and address unknown. Use recovery phrase import.".to_string()
            })?;
        let id = new_import_id();
        let conn = account_manager::get_db_connection(&handle)?;
        conn.execute(
            "INSERT INTO evm_accounts (id, scheme, hd_index, address, label, imported_enc) VALUES (?1, ?2, NULL, ?3, '', ?4)",
            rusqlite::params![&id, SCHEME_IMPORTED, &addr, &enc],
        )
        .map_err(|e| format!("evm_accounts insert: {}", e))?;
        sql_set_setting(&conn, SETTING_ACTIVE, &id)?;
        if sql_get_setting(&conn, SETTING_DEFAULT_SHARED)?.is_none() {
            sql_set_setting(&conn, SETTING_DEFAULT_SHARED, &id)?;
        }
        account_manager::return_db_connection(conn);
        sync_signing_material_from_active(handle.clone()).await?;
    }

    Ok(())
}

pub(crate) async fn decrypt_active_evm_private_key_plaintext<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<String, String> {
    ensure_ready(handle.clone()).await?;
    let (key_hex, _, _) = resolve_active_private_key_hex(&handle).await?;
    Ok(key_hex)
}

pub async fn active_account_allows_treasury_signing<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<bool, String> {
    ensure_ready(handle.clone()).await?;
    let (_, _, scheme) = resolve_active_private_key_hex(&handle).await?;
    Ok(scheme == SCHEME_BIP44_V1)
}

#[tauri::command]
pub async fn list_evm_accounts<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<EvmAccountRow>, String> {
    ensure_ready(handle.clone()).await?;
    let conn = account_manager::get_db_connection(&handle)?;
    let active = sql_get_setting(&conn, SETTING_ACTIVE)?.unwrap_or_default();
    let default_sh = sql_get_setting(&conn, SETTING_DEFAULT_SHARED)?.unwrap_or_default();

    let mut stmt = conn
        .prepare("SELECT id, scheme, hd_index, address, label FROM evm_accounts ORDER BY scheme ASC, (hd_index IS NULL), hd_index ASC, id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect::<Vec<_>>();
    drop(stmt);
    account_manager::return_db_connection(conn);

    Ok(rows
        .into_iter()
        .map(|(id, scheme, hd_index, address, label)| EvmAccountRow {
            is_active: id == active,
            is_default_shared: id == default_sh,
            hd_index: hd_index.map(|i| i as u32),
            id,
            scheme,
            address,
            label,
        })
        .collect())
}

pub(crate) async fn export_all_evm_account_keys_plaintext<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<Vec<EvmAccountExportRow>, String> {
    ensure_ready(handle.clone()).await?;
    let accounts = list_evm_accounts(handle.clone()).await?;
    let mut out = Vec::with_capacity(accounts.len());
    for acc in accounts {
        let (private_key, _, _) = resolve_private_key_hex_for_account_id(&handle, &acc.id).await?;
        out.push(EvmAccountExportRow {
            id: acc.id,
            scheme: acc.scheme,
            hd_index: acc.hd_index,
            address: acc.address,
            label: acc.label,
            private_key,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn add_evm_account<R: Runtime>(
    handle: AppHandle<R>,
    label: String,
    set_active_signer: bool,
    set_default_shared: bool,
) -> Result<EvmAccountRow, String> {
    ensure_ready(handle.clone()).await?;
    let phrase = get_mnemonic_for_hd(handle.clone()).await?;
    let label_trimmed = label.trim().to_string();

    let conn = account_manager::get_db_connection(&handle)?;
    let max_idx: Option<i64> = conn
        .query_row(
            "SELECT MAX(hd_index) FROM evm_accounts WHERE scheme = ?1",
            rusqlite::params![SCHEME_BIP44_V1],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let next = (max_idx.unwrap_or(-1) + 1) as u32;
    account_manager::return_db_connection(conn);

    let (_key_hex, addr) = evm::derive_eth_bip44_v1_from_mnemonic_phrase(&phrase, next)?;
    let id = hd_row_id(next);

    let conn = account_manager::get_db_connection(&handle)?;
    conn.execute(
        "INSERT INTO evm_accounts (id, scheme, hd_index, address, label, imported_enc) VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        rusqlite::params![&id, SCHEME_BIP44_V1, next as i64, &addr, &label_trimmed],
    )
    .map_err(|e| format!("add account: {}", e))?;

    if set_active_signer {
        sql_set_setting(&conn, SETTING_ACTIVE, &id)?;
    }
    if set_default_shared {
        sql_set_setting(&conn, SETTING_DEFAULT_SHARED, &id)?;
    }

    let active = sql_get_setting(&conn, SETTING_ACTIVE)?.unwrap_or_default();
    let default_sh = sql_get_setting(&conn, SETTING_DEFAULT_SHARED)?.unwrap_or_default();
    account_manager::return_db_connection(conn);

    let republish = set_default_shared;
    sync_signing_material_from_active(handle.clone()).await?;

    if republish {
        spawn_kind0_republish_with_events(handle.clone());
    }

    let is_active = id == active;
    let is_default_shared = id == default_sh;
    Ok(EvmAccountRow {
        id,
        scheme: SCHEME_BIP44_V1.to_string(),
        hd_index: Some(next),
        address: addr,
        label: label_trimmed,
        is_active,
        is_default_shared,
    })
}

#[tauri::command]
pub async fn import_evm_account<R: Runtime>(
    handle: AppHandle<R>,
    private_key_hex: String,
    set_active_signer: bool,
) -> Result<EvmAccountRow, String> {
    ensure_ready(handle.clone()).await?;
    let trimmed = private_key_hex.trim();
    let h = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(
            "Private key must be 32 bytes (64 hex digits, optional 0x prefix).".to_string(),
        );
    }
    let mut sk = [0u8; 32];
    for i in 0..32 {
        sk[i] = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16)
            .map_err(|_| "Invalid hex in private key.".to_string())?;
    }
    let addr = evm::address_from_evm_secret_32(&sk)?;
    let conn = account_manager::get_db_connection(&handle)?;
    let dup: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM evm_accounts WHERE lower(address) = lower(?1)",
            rusqlite::params![&addr],
            |r| r.get(0),
        )
        .map_err(|e| format!("import account: {}", e))?;
    if dup > 0 {
        account_manager::return_db_connection(conn);
        return Err("This Ethereum account is already in your wallet.".to_string());
    }
    let key_plain = format!("0x{}", hex::encode(sk));
    let enc = crypto::internal_encrypt(key_plain, None).await;
    let id = new_import_id();
    conn.execute(
        "INSERT INTO evm_accounts (id, scheme, hd_index, address, label, imported_enc) VALUES (?1, ?2, NULL, ?3, '', ?4)",
        rusqlite::params![&id, SCHEME_IMPORTED, &addr, &enc],
    )
    .map_err(|e| format!("import account: {}", e))?;
    if set_active_signer {
        sql_set_setting(&conn, SETTING_ACTIVE, &id)?;
    }
    let active = sql_get_setting(&conn, SETTING_ACTIVE)?.unwrap_or_default();
    let default_sh = sql_get_setting(&conn, SETTING_DEFAULT_SHARED)?.unwrap_or_default();
    account_manager::return_db_connection(conn);
    sync_signing_material_from_active(handle.clone()).await?;
    let is_active = id == active;
    let is_default_shared = id == default_sh;
    Ok(EvmAccountRow {
        id,
        scheme: SCHEME_IMPORTED.to_string(),
        hd_index: None,
        address: addr,
        label: String::new(),
        is_active,
        is_default_shared,
    })
}

#[tauri::command]
pub async fn update_evm_account<R: Runtime>(
    handle: AppHandle<R>,
    account_id: String,
    label: String,
    set_active_signer: bool,
    set_default_shared: bool,
) -> Result<EvmAccountRow, String> {
    ensure_ready(handle.clone()).await?;
    let label_trimmed = label.trim().to_string();
    let conn = account_manager::get_db_connection(&handle)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM evm_accounts WHERE id = ?1",
            rusqlite::params![&account_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n == 0 {
        account_manager::return_db_connection(conn);
        return Err("Unknown EVM account.".to_string());
    }

    conn.execute(
        "UPDATE evm_accounts SET label = ?1 WHERE id = ?2",
        rusqlite::params![&label_trimmed, &account_id],
    )
    .map_err(|e| format!("update account: {}", e))?;

    if set_active_signer {
        sql_set_setting(&conn, SETTING_ACTIVE, &account_id)?;
    }
    if set_default_shared {
        sql_set_setting(&conn, SETTING_DEFAULT_SHARED, &account_id)?;
    }

    let active = sql_get_setting(&conn, SETTING_ACTIVE)?.unwrap_or_default();
    let default_sh = sql_get_setting(&conn, SETTING_DEFAULT_SHARED)?.unwrap_or_default();

    let row: (String, String, Option<i64>, String, String) = conn
        .query_row(
            "SELECT id, scheme, hd_index, address, label FROM evm_accounts WHERE id = ?1",
            rusqlite::params![&account_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    account_manager::return_db_connection(conn);

    if set_default_shared {
        spawn_kind0_republish_with_events(handle.clone());
    }

    sync_signing_material_from_active(handle.clone()).await?;

    let (id, scheme, hd_idx, address, label_out) = row;
    let is_active = id == active;
    let is_default_shared_row = id == default_sh;
    Ok(EvmAccountRow {
        id,
        scheme,
        hd_index: hd_idx.map(|i| i as u32),
        address,
        label: label_out,
        is_active,
        is_default_shared: is_default_shared_row,
    })
}

#[tauri::command]
pub async fn set_active_evm_account<R: Runtime>(
    handle: AppHandle<R>,
    account_id: String,
) -> Result<(), String> {
    ensure_ready(handle.clone()).await?;
    let conn = account_manager::get_db_connection(&handle)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM evm_accounts WHERE id = ?1",
            rusqlite::params![&account_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n == 0 {
        return Err("Unknown EVM account.".to_string());
    }
    sql_set_setting(&conn, SETTING_ACTIVE, &account_id)?;
    account_manager::return_db_connection(conn);
    sync_signing_material_from_active(handle.clone()).await?;
    Ok(())
}

#[tauri::command]
pub async fn set_default_shared_evm_account<R: Runtime>(
    handle: AppHandle<R>,
    account_id: String,
) -> Result<(), String> {
    ensure_ready(handle.clone()).await?;
    let conn = account_manager::get_db_connection(&handle)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM evm_accounts WHERE id = ?1",
            rusqlite::params![&account_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n == 0 {
        return Err("Unknown EVM account.".to_string());
    }
    sql_set_setting(&conn, SETTING_DEFAULT_SHARED, &account_id)?;
    account_manager::return_db_connection(conn);
    spawn_kind0_republish_with_events(handle.clone());
    Ok(())
}