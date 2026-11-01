use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::{command, AppHandle, Emitter, Runtime};

use super::messaging::get_message_views;
use super::ids::resolve_chat_id_for_message_load;

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
        "pacto_gov_wargame" | "pacto-gov-wargame" | "pacto-gov_wargame" => {
            Ok("pacto_gov_wargame".to_string())
        }
        "squad_admin" | "squad-admin" => Ok("squad_admin".to_string()),
        "standalone_safe" | "gnosis_safe" | "gnosis-safe" | "safe" => {
            Ok("standalone_safe".to_string())
        }
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
pub fn get_safe<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Option<String>, String> {
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
        conn.query_row(
            "SELECT safe_address FROM squad_safe WHERE squad_id = ?1",
            rusqlite::params![pid],
            |row| row.get::<_, String>(0),
        )
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
pub fn set_safe<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    safe_address: String,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
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
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let norm = crate::evm::normalize_hex_address(safe_address.trim())
        .ok_or_else(|| "Invalid EVM address".to_string())?;
    let ch = normalize_treasury_chain(chain.as_deref());
    let lb_raw = label.as_deref().unwrap_or("").trim();
    let lb = if lb_raw.len() > 200 {
        &lb_raw[..200]
    } else {
        lb_raw
    };
    upsert_parent_treasury_row(
        &handle,
        &parent_id,
        &norm,
        ch.as_str(),
        lb,
        entry_id.as_deref(),
    )
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
pub(super) fn parent_has_sponsor_infra_conn(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM squad_infra WHERE parent_id = ?1 AND infra_type = 'sponsor'",
            rusqlite::params![parent_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query sponsor infra: {}", e))?;
    Ok(count > 0)
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
    let has = parent_has_sponsor_infra_conn(&conn, pid);
    crate::account_manager::return_db_connection(conn);
    has
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
pub fn list_squad_infra_canonical_refs<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<Vec<String>, String> {
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

/// Whether this parent already has a `pacto_gov` infra row (duplicate-deploy guard).
pub fn parent_has_pacto_gov_infra_row<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
) -> Result<bool, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(false);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let has = parent_has_pacto_gov_infra(&conn, pid);
    crate::account_manager::return_db_connection(conn);
    Ok(has)
}

/// Interim v1: mutations require deployed Pacto Gov. Target: on-chain captain / allowlist-admin role.
fn require_allowlist_mutation_allowed(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<(), String> {
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

fn collect_hex_addresses_from_json_value(
    v: &serde_json::Value,
    out: &mut std::collections::HashSet<String>,
) {
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
        let rows = stmt.query_map(rusqlite::params![pid, &chain_norm], |row| {
            row.get::<_, String>(0)
        });
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
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
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
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
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

/// True when payload parent/squad id matches the MLS chat (announcements group id).
pub fn side_effect_parent_matches_chat(chat_id: &str, payload_parent_id: &str) -> bool {
    let chat = chat_id.trim();
    let parent = payload_parent_id.trim();
    !chat.is_empty() && !parent.is_empty() && chat == parent
}

fn author_listed_in_participants<'a, I>(parts: I, author: &str) -> bool
where
    I: IntoIterator<Item = &'a str>,
{
    let author = author.trim();
    if author.is_empty() {
        return false;
    }
    parts.into_iter().any(|p| p.trim() == author)
}

/// True when `chats.participants` JSON for `chat_id` contains `author` (fail closed).
fn chat_db_participants_contain_author(
    conn: &rusqlite::Connection,
    chat_id: &str,
    author: &str,
) -> bool {
    let chat_id = chat_id.trim();
    let author = author.trim();
    if chat_id.is_empty() || author.is_empty() {
        return false;
    }
    let participants_json: Option<String> = conn
        .query_row(
            "SELECT participants FROM chats WHERE chat_identifier = ?1",
            rusqlite::params![chat_id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let Some(raw) = participants_json else {
        return false;
    };
    let Ok(parts) = serde_json::from_str::<Vec<String>>(&raw) else {
        return false;
    };
    author_listed_in_participants(parts.iter().map(|s| s.as_str()), author)
}

/// True when `author_npub` is treated as an MLS member of `chat_id` for announce side effects.
/// Prefer in-memory participants when populated; otherwise `chats.participants` in SQLite.
/// Fail closed when membership cannot be verified (no `mls_groups`-only shortcut).
pub(crate) fn is_author_mls_member_for_chat<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    author_npub: &str,
) -> bool {
    let chat_id = chat_id.trim();
    let author = author_npub.trim();
    if chat_id.is_empty() || author.is_empty() {
        return false;
    }

    if let Ok(state) = crate::STATE.try_lock() {
        if let Some(chat) = state.get_chat(chat_id) {
            let parts = chat.participants();
            if !parts.is_empty() {
                return author_listed_in_participants(parts.iter().map(|s| s.as_str()), author);
            }
        }
    }

    let Ok(conn) = crate::account_manager::get_db_connection(handle) else {
        return false;
    };
    let ok = chat_db_participants_contain_author(&conn, chat_id, author);
    crate::account_manager::return_db_connection(conn);
    ok
}

pub fn try_apply_squad_contract_allowlist_announce<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
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
    if !side_effect_parent_matches_chat(chat_id, parent_id) {
        return;
    }
    // Prefer MLS author; reject if payload claims a different adder.
    if let Some(claimed) = p
        .get("added_by_npub")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if claimed != author {
            return;
        }
    }
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        return;
    }
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
            author,
            &abi_ref,
            &notes,
            created_at_ms,
            now
        ],
    );
    crate::account_manager::return_db_connection(conn);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadTrackedTokenRow {
    pub id: String,
    pub parent_id: String,
    pub chain: String,
    pub token_address: String,
    pub symbol: String,
    pub decimals: u8,
    pub added_by_npub: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

pub fn tracked_token_row_id(parent_id: &str, chain: &str, token_address: &str) -> String {
    format!(
        "tracked-{}-{}-{}",
        parent_id.trim(),
        chain.trim().to_ascii_lowercase(),
        token_address.trim().to_ascii_lowercase()
    )
}

#[command]
pub fn list_squad_tracked_tokens<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<SquadTrackedTokenRow>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(Vec::new());
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, chain, token_address, symbol, decimals, added_by_npub, created_at_ms, updated_at_ms \
             FROM squad_tracked_tokens WHERE parent_id = ?1 ORDER BY created_at_ms ASC",
        )
        .map_err(|e| format!("Failed to list squad_tracked_tokens: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![pid], |row| {
            Ok(SquadTrackedTokenRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                chain: row.get(2)?,
                token_address: row.get(3)?,
                symbol: row.get(4)?,
                decimals: row.get::<_, i64>(5)? as u8,
                added_by_npub: row.get(6)?,
                created_at_ms: row.get(7)?,
                updated_at_ms: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to query squad_tracked_tokens: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[command]
pub async fn upsert_squad_tracked_token<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    chain: String,
    token_address: String,
    symbol: String,
    decimals: u8,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadTrackedTokenRow, String> {
    let pid = parent_id.trim().to_string();
    let chain_norm = normalize_allowlist_chain(&chain)?;
    let addr_norm = normalize_allowlist_address(&token_address)?;
    let symbol_trim = symbol.trim().to_string();
    if symbol_trim.is_empty() {
        return Err("Token symbol is required.".to_string());
    }
    if decimals > 36 {
        return Err("Token decimals out of range.".to_string());
    }
    crate::evm::access_control::require_capability(
        &handle,
        pid.as_str(),
        crate::evm::access_control::GovCapability::MutateTrackedTokens,
        rpc_urls,
        crate::evm::access_control::GovStack::Live,
    )
    .await?;
    let added_by = crate::account_manager::get_current_account()?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    require_allowlist_mutation_allowed(&conn, pid.as_str())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = tracked_token_row_id(pid.as_str(), &chain_norm, &addr_norm);
    let created_at_ms: i64 = conn
        .query_row(
            "SELECT created_at_ms FROM squad_tracked_tokens WHERE id = ?1",
            rusqlite::params![&id],
            |r| r.get(0),
        )
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO squad_tracked_tokens (id, parent_id, chain, token_address, symbol, decimals, added_by_npub, created_at_ms, updated_at_ms) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
         ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, decimals = excluded.decimals, updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            &id,
            pid.as_str(),
            &chain_norm,
            &addr_norm,
            &symbol_trim,
            decimals as i64,
            &added_by,
            created_at_ms,
            now
        ],
    )
    .map_err(|e| format!("Failed to upsert squad_tracked_tokens: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(SquadTrackedTokenRow {
        id,
        parent_id: pid,
        chain: chain_norm,
        token_address: addr_norm,
        symbol: symbol_trim,
        decimals,
        added_by_npub: added_by,
        created_at_ms,
        updated_at_ms: now,
    })
}

#[command]
pub async fn remove_squad_tracked_token<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<(), String> {
    let pid = parent_id.trim();
    let row_id = id.trim();
    if pid.is_empty() || row_id.is_empty() {
        return Err("parent_id and id are required.".to_string());
    }
    crate::evm::access_control::require_capability(
        &handle,
        pid,
        crate::evm::access_control::GovCapability::MutateTrackedTokens,
        rpc_urls,
        crate::evm::access_control::GovStack::Live,
    )
    .await?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    require_allowlist_mutation_allowed(&conn, pid)?;
    let n = conn
        .execute(
            "DELETE FROM squad_tracked_tokens WHERE id = ?1 AND parent_id = ?2",
            rusqlite::params![row_id, pid],
        )
        .map_err(|e| format!("Failed to remove squad_tracked_tokens: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    if n == 0 {
        return Err("Tracked token not found.".to_string());
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum TrackedTokenAnnouncePlan {
    Upsert {
        parent_id: String,
        chain: String,
        token_address: String,
        symbol: String,
        decimals: u8,
        entry_id: Option<String>,
    },
    Remove {
        parent_id: String,
        entry_id: String,
    },
}

/// Pure announce gates (type / parent match / author claim / required fields).
/// MLS-admin and DB writes stay in `try_apply_squad_tracked_tokens_announce`.
fn plan_tracked_tokens_announce(
    content: &str,
    chat_id: &str,
    author: &str,
) -> Option<TrackedTokenAnnouncePlan> {
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
    if parsed.get("type").and_then(|v| v.as_str()) != Some("squad_tracked_tokens_updated") {
        return None;
    }
    let p = parsed.get("payload")?;
    let parent_id = p
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    if !side_effect_parent_matches_chat(chat_id, parent_id) {
        return None;
    }
    if let Some(claimed) = p
        .get("added_by_npub")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if claimed != author {
            return None;
        }
    }
    let action = p.get("action").and_then(|v| v.as_str()).unwrap_or("upsert");
    let entry_id = p
        .get("entry_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if action == "remove" {
        let id = entry_id?;
        return Some(TrackedTokenAnnouncePlan::Remove {
            parent_id: parent_id.to_string(),
            entry_id: id,
        });
    }
    let chain = p
        .get("chain")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let token_address = p
        .get("token_address")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let symbol = p
        .get("symbol")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if symbol.is_empty() {
        return None;
    }
    let decimals = match p.get("decimals").and_then(|v| v.as_u64()) {
        Some(d) if d <= 36 => d as u8,
        _ => return None,
    };
    Some(TrackedTokenAnnouncePlan::Upsert {
        parent_id: parent_id.to_string(),
        chain,
        token_address,
        symbol,
        decimals,
        entry_id,
    })
}

pub fn try_apply_squad_tracked_tokens_announce<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let Some(plan) = plan_tracked_tokens_announce(content, chat_id, author) else {
        return;
    };
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        eprintln!(
            "[squad_tracked_tokens_announce] author not MLS admin author={} chat={}",
            author, chat_id
        );
        return;
    }
    match plan {
        TrackedTokenAnnouncePlan::Remove {
            parent_id,
            entry_id,
        } => {
            let conn = match crate::account_manager::get_db_connection(handle) {
                Ok(c) => c,
                Err(_) => return,
            };
            let _ = conn.execute(
                "DELETE FROM squad_tracked_tokens WHERE id = ?1 AND parent_id = ?2",
                rusqlite::params![entry_id, parent_id],
            );
            crate::account_manager::return_db_connection(conn);
        }
        TrackedTokenAnnouncePlan::Upsert {
            parent_id,
            chain,
            token_address,
            symbol,
            decimals,
            entry_id,
        } => {
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
            let addr_norm = match normalize_allowlist_address(&token_address) {
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
                .unwrap_or_else(|| tracked_token_row_id(&parent_id, &chain_norm, &addr_norm));
            let created_at_ms: i64 = conn
                .query_row(
                    "SELECT created_at_ms FROM squad_tracked_tokens WHERE id = ?1",
                    rusqlite::params![&id],
                    |r| r.get(0),
                )
                .unwrap_or(now);
            let _ = conn.execute(
                "INSERT INTO squad_tracked_tokens (id, parent_id, chain, token_address, symbol, decimals, added_by_npub, created_at_ms, updated_at_ms) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
                 ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, decimals = excluded.decimals, updated_at_ms = excluded.updated_at_ms",
                rusqlite::params![
                    &id,
                    parent_id,
                    &chain_norm,
                    &addr_norm,
                    &symbol,
                    decimals as i64,
                    author,
                    created_at_ms,
                    now
                ],
            );
            crate::account_manager::return_db_connection(conn);
        }
    }
}

#[cfg(test)]
mod allowlist_tests {
    use super::{
        allowlist_row_id, author_listed_in_participants, chat_db_participants_contain_author,
        side_effect_parent_matches_chat,
    };

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

    #[test]
    fn side_effect_parent_must_match_chat() {
        assert!(side_effect_parent_matches_chat("grp-a", "grp-a"));
        assert!(side_effect_parent_matches_chat(" grp-a ", "grp-a"));
        assert!(!side_effect_parent_matches_chat("grp-a", "grp-b"));
        assert!(!side_effect_parent_matches_chat("", "grp-a"));
        assert!(!side_effect_parent_matches_chat("grp-a", ""));
    }

    #[test]
    fn author_listed_in_participants_matches_trimmed() {
        assert!(author_listed_in_participants(
            ["npub1a", " npub1b "],
            "npub1b"
        ));
        assert!(!author_listed_in_participants(["npub1a"], "npub1b"));
        assert!(!author_listed_in_participants(["npub1a"], ""));
        assert!(!author_listed_in_participants([], "npub1a"));
    }

    #[test]
    fn roster_snapshot_author_must_be_chat_participant() {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        conn.execute_batch(
            r#"
            CREATE TABLE chats (
                chat_identifier TEXT PRIMARY KEY,
                participants TEXT NOT NULL DEFAULT '[]'
            );
            "#,
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO chats (chat_identifier, participants) VALUES ('grp-1', ?1)",
            rusqlite::params![r#"["npub1member"]"#],
        )
        .expect("chat");
        assert!(!chat_db_participants_contain_author(
            &conn,
            "grp-1",
            "npub1outsider"
        ));
    }

    #[test]
    fn chat_db_participants_require_author_in_json_not_merely_mls_group_row() {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        conn.execute_batch(
            r#"
            CREATE TABLE chats (
                chat_identifier TEXT PRIMARY KEY,
                participants TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE mls_groups (
                group_id TEXT PRIMARY KEY,
                engine_group_id TEXT NOT NULL DEFAULT ''
            );
            "#,
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO mls_groups (group_id, engine_group_id) VALUES ('grp-1', 'eng-1')",
            [],
        )
        .expect("mls");
        // Group exists but chat participants empty / missing → fail closed.
        assert!(!chat_db_participants_contain_author(
            &conn,
            "grp-1",
            "npub1author"
        ));

        conn.execute(
            "INSERT INTO chats (chat_identifier, participants) VALUES ('grp-1', ?1)",
            rusqlite::params![r#"["npub1peer","npub1author"]"#],
        )
        .expect("chat");
        assert!(chat_db_participants_contain_author(
            &conn,
            "grp-1",
            "npub1author"
        ));
        assert!(!chat_db_participants_contain_author(
            &conn,
            "grp-1",
            "npub1stranger"
        ));
        assert!(!chat_db_participants_contain_author(&conn, "grp-1", ""));
    }
}

#[cfg(test)]
mod tracked_token_tests {
    use super::{
        normalize_allowlist_address, normalize_allowlist_chain, parent_has_pacto_gov_infra,
        plan_tracked_tokens_announce, tracked_token_row_id, TrackedTokenAnnouncePlan,
    };

    fn tracked_schema(conn: &rusqlite::Connection) {
        conn.execute_batch(
            r#"
            CREATE TABLE squad_infra (
                id TEXT PRIMARY KEY NOT NULL,
                parent_id TEXT NOT NULL,
                infra_type TEXT NOT NULL,
                chain TEXT,
                canonical_ref TEXT NOT NULL,
                pacto_gov_revision TEXT,
                provider_payload TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE TABLE squad_tracked_tokens (
                id TEXT PRIMARY KEY NOT NULL,
                parent_id TEXT NOT NULL,
                chain TEXT NOT NULL,
                token_address TEXT NOT NULL,
                symbol TEXT NOT NULL DEFAULT '',
                decimals INTEGER NOT NULL DEFAULT 18,
                added_by_npub TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX idx_squad_tracked_tokens_unique
                ON squad_tracked_tokens(parent_id, chain, token_address);
            "#,
        )
        .expect("schema");
    }

    #[test]
    fn stable_tracked_token_row_id_normalizes_case() {
        let id = tracked_token_row_id(
            "parent-1",
            "SEPOLIA",
            "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefAB",
        );
        assert_eq!(
            id,
            "tracked-parent-1-sepolia-0xabcdefabcdefabcdefabcdefabcdefabcdefab"
        );
    }

    #[test]
    fn normalize_chain_and_address() {
        assert_eq!(normalize_allowlist_chain(" Sepolia ").unwrap(), "sepolia");
        assert!(normalize_allowlist_chain("").is_err());
        let addr =
            normalize_allowlist_address("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD").unwrap();
        assert_eq!(addr.to_ascii_lowercase(), addr);
        assert!(normalize_allowlist_address("not-an-address").is_err());
    }

    #[test]
    fn mutation_gate_requires_pacto_gov_infra_row() {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        tracked_schema(&conn);
        assert!(!parent_has_pacto_gov_infra(&conn, "parent-1"));
        conn.execute(
            "INSERT INTO squad_infra (id, parent_id, infra_type, chain, canonical_ref, created_at_ms, updated_at_ms)
             VALUES ('pg-1', 'parent-1', 'pacto_gov', 'sepolia', '1', 1, 1)",
            [],
        )
        .expect("insert");
        assert!(parent_has_pacto_gov_infra(&conn, "parent-1"));
    }

    #[test]
    fn wargame_infra_does_not_satisfy_pacto_gov_gate() {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        tracked_schema(&conn);
        conn.execute(
            "INSERT INTO squad_infra (id, parent_id, infra_type, chain, canonical_ref, created_at_ms, updated_at_ms)
             VALUES ('pgw-1', 'parent-1', 'pacto_gov_wargame', 'sepolia', '1', 1, 1)",
            [],
        )
        .expect("insert");
        assert!(!parent_has_pacto_gov_infra(&conn, "parent-1"));
    }

    #[test]
    fn upsert_list_remove_tracked_token_round_trip() {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        tracked_schema(&conn);
        let pid = "parent-1";
        let chain = "sepolia";
        let addr = "0x1111111111111111111111111111111111111111";
        let id = tracked_token_row_id(pid, chain, addr);
        conn.execute(
            "INSERT INTO squad_tracked_tokens
             (id, parent_id, chain, token_address, symbol, decimals, added_by_npub, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![&id, pid, chain, addr, "USDC", 6_i64, "npub1adder", 10_i64, 10_i64],
        )
        .expect("insert");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM squad_tracked_tokens WHERE parent_id = ?1",
                rusqlite::params![pid],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(count, 1);
        conn.execute(
            "UPDATE squad_tracked_tokens SET symbol = ?1, updated_at_ms = ?2 WHERE id = ?3",
            rusqlite::params!["USDC2", 20_i64, &id],
        )
        .expect("update");
        let symbol: String = conn
            .query_row(
                "SELECT symbol FROM squad_tracked_tokens WHERE id = ?1",
                rusqlite::params![&id],
                |r| r.get(0),
            )
            .expect("symbol");
        assert_eq!(symbol, "USDC2");
        let n = conn
            .execute(
                "DELETE FROM squad_tracked_tokens WHERE id = ?1 AND parent_id = ?2",
                rusqlite::params![&id, pid],
            )
            .expect("delete");
        assert_eq!(n, 1);
    }

    #[test]
    fn announce_plan_filters_auth_and_parent_mismatches() {
        let author = "npub1author";
        let chat = "parent-1";
        let good = r#"{"type":"squad_tracked_tokens_updated","payload":{"parent_id":"parent-1","action":"upsert","chain":"sepolia","token_address":"0x1111111111111111111111111111111111111111","symbol":"USDC","decimals":6,"added_by_npub":"npub1author"}}"#;
        assert_eq!(
            plan_tracked_tokens_announce(good, chat, author),
            Some(TrackedTokenAnnouncePlan::Upsert {
                parent_id: "parent-1".into(),
                chain: "sepolia".into(),
                token_address: "0x1111111111111111111111111111111111111111".into(),
                symbol: "USDC".into(),
                decimals: 6,
                entry_id: None,
            })
        );
        // wrong type
        assert!(plan_tracked_tokens_announce(
            r#"{"type":"other","payload":{"parent_id":"parent-1"}}"#,
            chat,
            author
        )
        .is_none());
        // parent/chat mismatch
        assert!(plan_tracked_tokens_announce(good, "parent-other", author).is_none());
        // claimed author mismatch
        let wrong_author = r#"{"type":"squad_tracked_tokens_updated","payload":{"parent_id":"parent-1","action":"upsert","chain":"sepolia","token_address":"0x1111111111111111111111111111111111111111","symbol":"USDC","decimals":6,"added_by_npub":"npub1other"}}"#;
        assert!(plan_tracked_tokens_announce(wrong_author, chat, author).is_none());
        // remove requires entry_id
        assert!(plan_tracked_tokens_announce(
            r#"{"type":"squad_tracked_tokens_updated","payload":{"parent_id":"parent-1","action":"remove"}}"#,
            chat,
            author
        )
        .is_none());
        let remove = r#"{"type":"squad_tracked_tokens_updated","payload":{"parent_id":"parent-1","action":"remove","entry_id":"tracked-1"}}"#;
        assert_eq!(
            plan_tracked_tokens_announce(remove, chat, author),
            Some(TrackedTokenAnnouncePlan::Remove {
                parent_id: "parent-1".into(),
                entry_id: "tracked-1".into(),
            })
        );
        // empty symbol / bad decimals
        assert!(plan_tracked_tokens_announce(
            r#"{"type":"squad_tracked_tokens_updated","payload":{"parent_id":"parent-1","chain":"sepolia","token_address":"0x1111111111111111111111111111111111111111","symbol":"","decimals":6}}"#,
            chat,
            author
        )
        .is_none());
        assert!(plan_tracked_tokens_announce(
            r#"{"type":"squad_tracked_tokens_updated","payload":{"parent_id":"parent-1","chain":"sepolia","token_address":"0x1111111111111111111111111111111111111111","symbol":"USDC","decimals":99}}"#,
            chat,
            author
        )
        .is_none());
    }
}

#[cfg(test)]
mod squad_infra_row_id_tests {
    use super::{
        pacto_gov_infra_row_id, pacto_gov_treasury_row_id, pacto_gov_wargame_infra_row_id,
        squad_admin_infra_row_id, squad_sponsor_infra_row_id, SQUAD_INFRA_ID_MAX,
    };

    const LONG_PARENT: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    #[test]
    fn short_parent_uses_direct_pacto_gov_id() {
        let parent = "smoke-squad-alpha";
        assert_eq!(
            pacto_gov_infra_row_id(parent),
            format!("pacto-gov-{parent}")
        );
    }

    #[test]
    fn long_parent_hashes_pacto_gov_ids_within_limit() {
        assert_eq!(LONG_PARENT.len(), 64);
        let gov = pacto_gov_infra_row_id(LONG_PARENT);
        let treasury = pacto_gov_treasury_row_id(LONG_PARENT);
        let sponsor = squad_sponsor_infra_row_id(LONG_PARENT);
        let admin = squad_admin_infra_row_id(LONG_PARENT);
        let wargame = pacto_gov_wargame_infra_row_id(LONG_PARENT);

        for id in [&gov, &treasury, &sponsor, &admin, &wargame] {
            assert!(id.len() <= SQUAD_INFRA_ID_MAX);
        }
        assert!(gov.starts_with("pg-"));
        assert!(treasury.starts_with("pgt-"));
        assert!(wargame.starts_with("pgw-"));
        assert_eq!(
            gov,
            "pg-68025c1968089de1fee3538c1da6fb961996d68a176ad60013a5d8bba755508f"
        );
        assert_eq!(gov, pacto_gov_infra_row_id(LONG_PARENT));
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerPackRow {
    pub squad_id: String,
    pub pack_id: String,
    pub name: String,
    /// Raw JSON text of `StickerEntry[]`, exactly as stored — not parsed here.
    pub entries: String,
    pub updated_at: i64,
    pub updated_by: String,
    pub deleted: bool,
}

const STICKER_PACK_COLUMNS: &str =
    "squad_id, pack_id, name, entries, updated_at, updated_by, deleted";

/// Persist a local sticker-pack edit (create, rename, re-order, or `deleted: true` tombstone)
/// and stamp `updated_at` from the system clock. The caller sends the MLS announce using the
/// returned row so the announced `updated_at` matches what was persisted.
pub fn upsert_sticker_pack_inner<R: Runtime>(
    handle: &AppHandle<R>,
    squad_id: &str,
    pack_id: &str,
    name: &str,
    entries_json: &str,
    updated_by: &str,
    deleted: bool,
) -> Result<StickerPackRow, String> {
    let sid = squad_id.trim();
    if sid.is_empty() {
        return Err("squad_id is empty".to_string());
    }
    let pid = pack_id.trim();
    if pid.is_empty() {
        return Err("pack_id is empty".to_string());
    }
    let nm = name.trim();
    if nm.is_empty() {
        return Err("name is empty".to_string());
    }
    let author = updated_by.trim();
    if author.is_empty() {
        return Err("updated_by is empty".to_string());
    }
    match serde_json::from_str::<serde_json::Value>(entries_json) {
        Ok(serde_json::Value::Array(_)) => {}
        _ => return Err("entries is not a JSON array".to_string()),
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let conn = crate::account_manager::get_db_connection(handle)?;
    conn.execute(
        &format!(
            "INSERT INTO sticker_packs ({STICKER_PACK_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT(squad_id, pack_id) DO UPDATE SET \
               name = excluded.name, \
               entries = excluded.entries, \
               updated_at = excluded.updated_at, \
               updated_by = excluded.updated_by, \
               deleted = excluded.deleted"
        ),
        rusqlite::params![sid, pid, nm, entries_json, now_ms, author, deleted as i64],
    )
    .map_err(|e| format!("Failed to upsert sticker_pack: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(StickerPackRow {
        squad_id: sid.to_string(),
        pack_id: pid.to_string(),
        name: nm.to_string(),
        entries: entries_json.to_string(),
        updated_at: now_ms,
        updated_by: author.to_string(),
        deleted,
    })
}

/// Every non-deleted sticker pack in this account's database — i.e. every squad the account
/// belongs to, since only squads it has synced announcements for have rows here.
pub fn load_sticker_packs<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<StickerPackRow>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {STICKER_PACK_COLUMNS} FROM sticker_packs WHERE deleted = 0 ORDER BY squad_id, pack_id"
        ))
        .map_err(|e| format!("Failed to prepare sticker_packs query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StickerPackRow {
                squad_id: row.get(0)?,
                pack_id: row.get(1)?,
                name: row.get(2)?,
                entries: row.get(3)?,
                updated_at: row.get(4)?,
                updated_by: row.get(5)?,
                deleted: row.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| format!("Failed to query sticker_packs: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[cfg(test)]
mod sticker_pack_local_storage_tests {

    fn test_conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    #[test]
    fn migrated_schema_has_sticker_packs_table_with_pk() {
        let conn = test_conn();
        let cols: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('sticker_packs')")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for expected in [
            "squad_id",
            "pack_id",
            "name",
            "entries",
            "updated_at",
            "updated_by",
            "deleted",
        ] {
            assert!(
                cols.contains(&expected.to_string()),
                "missing column {expected}"
            );
        }
    }
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

/// Stable SQLite row id for the pacto-gov infra entry for this parent.
pub fn pacto_gov_infra_row_id(parent_id: &str) -> String {
    let pid = parent_id.trim();
    let direct = format!("pacto-gov-{pid}");
    if direct.len() <= SQUAD_INFRA_ID_MAX {
        direct
    } else {
        format!(
            "pg-{}",
            hex::encode(alloy::primitives::keccak256(pid.as_bytes()).as_slice())
        )
    }
}

/// Stable SQLite row id for the war-game stack entry for this parent.
pub fn pacto_gov_wargame_infra_row_id(parent_id: &str) -> String {
    let pid = parent_id.trim();
    let direct = format!("pacto-gov-wargame-{pid}");
    if direct.len() <= SQUAD_INFRA_ID_MAX {
        direct
    } else {
        format!(
            "pgw-{}",
            hex::encode(alloy::primitives::keccak256(pid.as_bytes()).as_slice())
        )
    }
}

/// Stable SQLite row id for the pacto-gov treasury entry for this parent.
pub fn pacto_gov_treasury_row_id(parent_id: &str) -> String {
    let pid = parent_id.trim();
    let direct = format!("pacto-gov-treasury-{pid}");
    if direct.len() <= SQUAD_INFRA_ID_MAX {
        direct
    } else {
        format!(
            "pgt-{}",
            hex::encode(alloy::primitives::keccak256(pid.as_bytes()).as_slice())
        )
    }
}

/// Stored top hat id (`canonical_ref`) for the parent's `pacto_gov` row, if any.
pub fn pacto_gov_top_hat_id_for_parent<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
) -> Result<Option<String>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(None);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let row: Option<String> = conn
        .query_row(
            "SELECT trim(canonical_ref) FROM squad_infra \
             WHERE parent_id = ?1 AND infra_type = 'pacto_gov' \
             AND canonical_ref IS NOT NULL AND trim(canonical_ref) != '' \
             ORDER BY updated_at_ms DESC LIMIT 1",
            rusqlite::params![pid],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("pacto_gov top hat lookup: {e}"))?;
    crate::account_manager::return_db_connection(conn);
    Ok(row)
}

/// Persist or refresh the pacto-gov infra row after deploy (and for announce ingest).
/// `canonical_ref` is the top hat id string.
pub fn persist_pacto_gov_infra<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    chain: &str,
    top_hat_id: &str,
    provider_payload: &str,
) -> Result<(), String> {
    let hat = top_hat_id.trim();
    if hat.is_empty() {
        return Err("top_hat_id must be non-empty".to_string());
    }
    upsert_squad_infra_inner(
        handle,
        pacto_gov_infra_row_id(parent_id).as_str(),
        parent_id,
        "pacto_gov",
        Some(chain),
        hat,
        None,
        Some(provider_payload),
    )
}

/// Stored war-game provider payload for this parent, if any.
pub fn pacto_gov_wargame_payload_for_parent<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
) -> Result<Option<String>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(None);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let row: Option<String> = conn
        .query_row(
            "SELECT provider_payload FROM squad_infra \
             WHERE parent_id = ?1 AND infra_type = 'pacto_gov_wargame' \
             ORDER BY updated_at_ms DESC LIMIT 1",
            rusqlite::params![pid],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("pacto_gov_wargame payload lookup: {e}"))?;
    crate::account_manager::return_db_connection(conn);
    Ok(row.filter(|s| !s.trim().is_empty()))
}

/// Persist or refresh the war-game infra row after deploy. Never writes `pacto_gov`.
pub fn persist_pacto_gov_wargame_infra<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    chain: &str,
    top_hat_id: &str,
    provider_payload: &str,
) -> Result<(), String> {
    let hat = top_hat_id.trim();
    if hat.is_empty() {
        return Err("top_hat_id must be non-empty".to_string());
    }
    upsert_squad_infra_inner(
        handle,
        pacto_gov_wargame_infra_row_id(parent_id).as_str(),
        parent_id,
        "pacto_gov_wargame",
        Some(chain),
        hat,
        None,
        Some(provider_payload),
    )
}

/// Persist governance treasury Safe after Pacto Gov deploy (idempotent).
pub fn persist_pacto_gov_treasury_safe<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    chain: &str,
    safe_address: &str,
) -> Result<(), String> {
    let norm = crate::evm::normalize_hex_address(safe_address.trim())
        .ok_or_else(|| "invalid safe address".to_string())?;
    upsert_parent_treasury_row(
        handle,
        parent_id,
        norm.as_str(),
        chain,
        "",
        Some(pacto_gov_treasury_row_id(parent_id).as_str()),
    )
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
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
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
/// `chat_id` must match `payload.squad_id` (MLS announcements group id).
/// Requires MLS message author and `payload.squad_id` == `chat_id`. Author must be the MLS group creator.
pub fn apply_parent_safe_announce<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
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
    if !side_effect_parent_matches_chat(chat_id, parent_id) {
        return;
    }
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        return;
    }
    let safe_address = match p.get("safe_address").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let Some(norm) = crate::evm::normalize_hex_address(safe_address) else {
        return;
    };
    let chain = normalize_treasury_chain(p.get("chain").and_then(|v| v.as_str()));
    let lb_raw = p.get("label").and_then(|v| v.as_str()).unwrap_or("").trim();
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
/// Requires MLS message author and `payload.parent_id` == `chat_id`. Author must be an MLS group member.
pub fn maybe_upsert_governance_from_announce<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
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
    if !side_effect_parent_matches_chat(chat_id, parent_id) {
        return;
    }
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        return;
    }
    let provider = match p.get("provider").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    if normalize_infra_type(provider).ok().as_deref() == Some("pacto_gov_wargame") {
        return;
    }
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
    let provider_payload_str = p
        .get("provider_payload")
        .and_then(|v| v.as_str())
        .and_then(|s| {
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

fn json_nonempty_str<'a>(p: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    p.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn json_round_u64(v: &serde_json::Value) -> Option<u64> {
    if let Some(s) = v.get("round").and_then(|x| x.as_str()) {
        return s.trim().parse().ok().filter(|n| *n > 0);
    }
    if let Some(n) = v.get("round").and_then(|x| x.as_u64()) {
        return (n > 0).then_some(n);
    }
    v.get("round")
        .and_then(|x| x.as_i64())
        .and_then(|n| u64::try_from(n).ok())
        .filter(|n| *n > 0)
}

fn war_game_round_snapshot(payload: &serde_json::Value) -> serde_json::Value {
    let mut obj = payload.as_object().cloned().unwrap_or_default();
    obj.remove("priorRounds");
    obj.remove("pendingNext");
    obj.insert("status".into(), serde_json::json!("retired"));
    serde_json::Value::Object(obj)
}

fn prior_round_number(v: &serde_json::Value) -> Option<u64> {
    json_round_u64(v)
}

fn push_unique_prior_round(priors: &mut Vec<serde_json::Value>, snap: serde_json::Value) {
    let Some(round) = prior_round_number(&snap) else {
        return;
    };
    if priors.iter().any(|p| prior_round_number(p) == Some(round)) {
        return;
    }
    priors.push(snap);
}

fn union_prior_rounds(
    stored: Option<&serde_json::Value>,
    incoming: Option<&serde_json::Value>,
) -> Vec<serde_json::Value> {
    let mut out: Vec<serde_json::Value> = Vec::new();
    if let Some(arr) = stored.and_then(|v| v.as_array()) {
        for item in arr {
            push_unique_prior_round(&mut out, item.clone());
        }
    }
    if let Some(arr) = incoming.and_then(|v| v.as_array()) {
        for item in arr {
            push_unique_prior_round(&mut out, item.clone());
        }
    }
    out.sort_by_key(|p| prior_round_number(p).unwrap_or(0));
    const WAR_GAME_PRIOR_ROUNDS_MAX: usize = 300;
    const WAR_GAME_PRIOR_ROUNDS_MAX_BYTES: usize = 128 * 1024;
    if out.len() > WAR_GAME_PRIOR_ROUNDS_MAX {
        out.drain(0..out.len() - WAR_GAME_PRIOR_ROUNDS_MAX);
    }
    while !out.is_empty() {
        let bytes = serde_json::to_vec(&out).map(|b| b.len()).unwrap_or(0);
        if bytes <= WAR_GAME_PRIOR_ROUNDS_MAX_BYTES {
            break;
        }
        out.remove(0);
    }
    out
}

fn cap_prior_rounds_in_place(v: &mut serde_json::Value) {
    let merged = union_prior_rounds(None, v.get("priorRounds"));
    if let Some(obj) = v.as_object_mut() {
        if merged.is_empty() {
            obj.remove("priorRounds");
        } else {
            obj.insert("priorRounds".into(), serde_json::Value::Array(merged));
        }
    }
}

fn strip_incoming_pending_next(mut v: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = v.as_object_mut() {
        obj.remove("pendingNext");
    }
    v
}

/// Merge an incoming war-game payload with the stored singleton.
/// Lower rounds never replace Active; they only append to `priorRounds`.
/// `pendingNext` is local-only and never accepted from an MLS announce.
pub fn merge_war_game_provider_payloads(stored: Option<&str>, incoming: &str) -> String {
    let Ok(incoming_raw) = serde_json::from_str::<serde_json::Value>(incoming) else {
        return incoming.to_string();
    };
    let mut incoming_v = strip_incoming_pending_next(incoming_raw);
    cap_prior_rounds_in_place(&mut incoming_v);
    let Some(incoming_round) = json_round_u64(&incoming_v) else {
        return incoming_v.to_string();
    };
    let Some(stored_s) = stored.map(str::trim).filter(|s| !s.is_empty()) else {
        return incoming_v.to_string();
    };
    let Ok(stored_v) = serde_json::from_str::<serde_json::Value>(stored_s) else {
        return incoming_v.to_string();
    };
    let stored_round = json_round_u64(&stored_v).unwrap_or(0);

    if incoming_round < stored_round {
        let mut kept = stored_v;
        let snap = war_game_round_snapshot(&incoming_v);
        let merged = union_prior_rounds(kept.get("priorRounds"), Some(&serde_json::json!([snap])));
        if let Some(obj) = kept.as_object_mut() {
            obj.insert("priorRounds".into(), serde_json::Value::Array(merged));
        }
        return kept.to_string();
    }

    if incoming_round > stored_round {
        let mut out = incoming_v;
        let snap = war_game_round_snapshot(&stored_v);
        let merged = union_prior_rounds(
            stored_v.get("priorRounds"),
            Some(&serde_json::json!([snap])),
        );
        if let Some(obj) = out.as_object_mut() {
            obj.insert("priorRounds".into(), serde_json::Value::Array(merged));
        }
        return out.to_string();
    }

    let mut out = incoming_v;
    let merged = union_prior_rounds(stored_v.get("priorRounds"), out.get("priorRounds"));
    let local_pending = stored_v.get("pendingNext").cloned();
    if let Some(obj) = out.as_object_mut() {
        if merged.is_empty() {
            obj.remove("priorRounds");
        } else {
            obj.insert("priorRounds".into(), serde_json::Value::Array(merged));
        }
        if let Some(pending) = local_pending {
            obj.insert("pendingNext".into(), pending);
        }
    }
    out.to_string()
}

fn pacto_gov_wargame_stored_row<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
) -> Option<(String, String)> {
    let conn = crate::account_manager::get_db_connection(handle).ok()?;
    let row = conn
        .query_row(
            "SELECT canonical_ref, provider_payload FROM squad_infra \
             WHERE parent_id = ?1 AND infra_type = 'pacto_gov_wargame' \
             ORDER BY updated_at_ms DESC LIMIT 1",
            rusqlite::params![parent_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    crate::account_manager::return_db_connection(conn);
    row.filter(|(hat, payload)| !hat.trim().is_empty() && !payload.trim().is_empty())
}

/// If content is a `war_game_updated` announce JSON, upsert `pacto_gov_wargame` (never `pacto_gov`).
pub fn maybe_upsert_war_game_from_announce<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return,
    };
    if parsed.get("type").and_then(|v| v.as_str()) != Some("war_game_updated") {
        return;
    }
    let p = match parsed.get("payload") {
        Some(v) => v,
        None => return,
    };
    let parent_id = match json_nonempty_str(p, "parent_id") {
        Some(s) => s,
        _ => return,
    };
    if !side_effect_parent_matches_chat(chat_id, parent_id) {
        return;
    }
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        return;
    }
    if !matches!(
        json_nonempty_str(p, "action"),
        Some("deploy" | "redeploy" | "retire")
    ) {
        return;
    }
    let Some(canonical_ref) = json_nonempty_str(p, "canonical_ref") else {
        return;
    };
    if json_nonempty_str(p, "round").is_none()
        || json_nonempty_str(p, "game_squad_id").is_none()
        || json_nonempty_str(p, "sponsor").is_none()
    {
        return;
    }
    let Some(provider_payload) = json_nonempty_str(p, "provider_payload") else {
        return;
    };
    let incoming_v = match serde_json::from_str::<serde_json::Value>(provider_payload) {
        Ok(v) => v,
        Err(_) => return,
    };
    if json_nonempty_str(&incoming_v, "gameSquadId").is_none()
        || json_round_u64(&incoming_v).is_none()
        || json_nonempty_str(&incoming_v, "sponsor").is_none()
    {
        return;
    }
    let incoming_round = json_round_u64(&incoming_v).unwrap_or(0);
    let stored = pacto_gov_wargame_stored_row(handle, parent_id);
    let stored_round = stored
        .as_ref()
        .and_then(|(_, payload)| serde_json::from_str::<serde_json::Value>(payload).ok())
        .and_then(|v| json_round_u64(&v))
        .unwrap_or(0);
    let merged = merge_war_game_provider_payloads(
        stored.as_ref().map(|(_, payload)| payload.as_str()),
        provider_payload,
    );
    let hat = if incoming_round < stored_round {
        stored
            .as_ref()
            .map(|(h, _)| h.as_str())
            .filter(|h| !h.is_empty())
            .unwrap_or(canonical_ref)
    } else {
        canonical_ref
    };
    let chain = json_nonempty_str(p, "chain").unwrap_or("sepolia");
    let _ = persist_pacto_gov_wargame_infra(handle, parent_id, chain, hat, merged.as_str());
}

/// Max sticker entries a single pack announce may declare, and the max serialized
/// `entries` JSON size, in bytes — both bound what one squad member can make every
/// other client store and render.
const STICKER_PACK_MAX_ENTRIES: usize = 300;
const STICKER_PACK_MAX_ENTRIES_BYTES: usize = 128 * 1024;

/// If content is a `sticker_pack_updated` announce JSON, upsert `sticker_packs`.
/// Wire format: `payload.squad_id`, `payload.pack_id`, `payload.name`, `payload.entries` (array),
/// `payload.updated_at` (unix milliseconds), `payload.deleted`.
/// Requires MLS message author and `payload.squad_id` == `chat_id`. Author must be an MLS group member.
/// Last-write-wins on `updated_at`: unlike governance, two squad members can plausibly edit a pack
/// in the same sync window, so an incoming announce that is older than or equal to the stored row
/// (including a `deleted: true` tombstone racing a newer edit) is a no-op, not an overwrite. The
/// comparison and write happen in one atomic `UPSERT ... WHERE`, so concurrent ingests can't race
/// each other into applying a stale value. `entries` beyond `STICKER_PACK_MAX_ENTRIES` items or
/// `STICKER_PACK_MAX_ENTRIES_BYTES` bytes is also a no-op, same as any other malformed announce.
pub fn maybe_upsert_sticker_pack_from_announce<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return,
    };
    if parsed.get("type").and_then(|v| v.as_str()) != Some("sticker_pack_updated") {
        return;
    }
    let p = match parsed.get("payload") {
        Some(v) => v,
        None => return,
    };
    let squad_id = match p.get("squad_id").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    if !side_effect_parent_matches_chat(chat_id, squad_id) {
        return;
    }
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        return;
    }
    let pack_id = match p.get("pack_id").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let name = match p.get("name").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return,
    };
    let entries_val = match p.get("entries") {
        Some(v) if v.is_array() => v,
        _ => return,
    };
    if entries_val.as_array().map(Vec::len).unwrap_or(0) > STICKER_PACK_MAX_ENTRIES {
        return;
    }
    let entries_json = entries_val.to_string();
    if entries_json.len() > STICKER_PACK_MAX_ENTRIES_BYTES {
        return;
    }
    let Some(updated_at) = p.get("updated_at").and_then(|v| v.as_i64()) else {
        return;
    };
    let deleted = p.get("deleted").and_then(|v| v.as_bool()).unwrap_or(false);

    let Ok(conn) = crate::account_manager::get_db_connection(handle) else {
        return;
    };
    let changed = conn
        .execute(
            &format!(
                "INSERT INTO sticker_packs ({STICKER_PACK_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT(squad_id, pack_id) DO UPDATE SET \
                   name = excluded.name, \
                   entries = excluded.entries, \
                   updated_at = excluded.updated_at, \
                   updated_by = excluded.updated_by, \
                   deleted = excluded.deleted \
                 WHERE excluded.updated_at > sticker_packs.updated_at"
            ),
            rusqlite::params![squad_id, pack_id, name, entries_json, updated_at, author, deleted as i64],
        )
        .unwrap_or(0);
    crate::account_manager::return_db_connection(conn);
    if changed > 0 {
        emit_sticker_packs_updated(handle);
    }
}

/// Emit `sticker_packs_updated` with the current non-deleted pack list (camelCase, `entries`
/// parsed into a JSON array). Call after any local save and after any accepted announce ingest.
pub fn emit_sticker_packs_updated<R: Runtime>(handle: &AppHandle<R>) {
    let Ok(rows) = load_sticker_packs(handle) else {
        return;
    };
    let packs: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            let entries: serde_json::Value = serde_json::from_str(&row.entries)
                .unwrap_or_else(|_| serde_json::Value::Array(Vec::new()));
            serde_json::json!({
                "squadId": row.squad_id,
                "packId": row.pack_id,
                "name": row.name,
                "entries": entries,
                "updatedAt": row.updated_at,
                "updatedBy": row.updated_by,
                "deleted": row.deleted,
            })
        })
        .collect();
    let _ = handle.emit(
        "sticker_packs_updated",
        serde_json::json!({ "packs": packs }),
    );
}

#[cfg(test)]
mod sticker_pack_announce_tests {
    use super::*;

    /// Fresh mock app + migrated on-disk db for `test_npub`, current account switched to it.
    fn setup(test_npub: &str) -> tauri::App<tauri::test::MockRuntime> {
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();
        let app = tauri::test::mock_app();
        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);
        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);
        app
    }

    fn insert_chat_with_participants<R: Runtime>(
        handle: &AppHandle<R>,
        chat_id: &str,
        participants: &[&str],
    ) {
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        let json = serde_json::to_string(participants).unwrap();
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata) \
             VALUES (?1, 0, ?2, '', 1000, '{}')",
            rusqlite::params![chat_id, json],
        )
        .unwrap();
        crate::account_manager::return_db_connection(conn);
    }

    struct StoredSticker {
        name: String,
        entries: String,
        updated_at: i64,
        updated_by: String,
        deleted: bool,
    }

    fn stored_row<R: Runtime>(
        handle: &AppHandle<R>,
        squad_id: &str,
        pack_id: &str,
    ) -> Option<StoredSticker> {
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        let row = conn
            .query_row(
                "SELECT name, entries, updated_at, updated_by, deleted FROM sticker_packs \
                 WHERE squad_id = ?1 AND pack_id = ?2",
                rusqlite::params![squad_id, pack_id],
                |r| {
                    Ok(StoredSticker {
                        name: r.get(0)?,
                        entries: r.get(1)?,
                        updated_at: r.get(2)?,
                        updated_by: r.get(3)?,
                        deleted: r.get::<_, i64>(4)? != 0,
                    })
                },
            )
            .optional()
            .unwrap();
        crate::account_manager::return_db_connection(conn);
        row
    }

    fn announce(
        squad_id: &str,
        pack_id: &str,
        name: &str,
        entries_json: &str,
        updated_at: i64,
        deleted: bool,
    ) -> String {
        format!(
            r#"{{"pacto_virtual_bucket":"announcements","type":"sticker_pack_updated","payload":{{"squad_id":"{squad_id}","pack_id":"{pack_id}","name":"{name}","entries":{entries_json},"updated_at":{updated_at},"deleted":{deleted}}}}}"#
        )
    }

    #[test]
    fn member_announce_upserts_pack() {
        let app = setup("npub1stickermemberupsert");
        insert_chat_with_participants(app.handle(), "squad-1", &["npub1author"]);
        let content = announce(
            "squad-1",
            "pack-1",
            "Pack One",
            r#"[{"shortcode":"wave","url":"https://x","key":"aa","nonce":"bb","mime":"image/png","size":10}]"#,
            1000,
            false,
        );
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &content,
            "squad-1",
            Some("npub1author"),
        );
        let row = stored_row(app.handle(), "squad-1", "pack-1").expect("row");
        assert_eq!(row.name, "Pack One");
        assert_eq!(row.updated_at, 1000);
        assert_eq!(row.updated_by, "npub1author");
        assert!(!row.deleted);
    }

    #[test]
    fn non_member_announce_writes_nothing() {
        let app = setup("npub1stickernonmember");
        insert_chat_with_participants(app.handle(), "squad-2", &["npub1someoneelse"]);
        let content = announce("squad-2", "pack-1", "Pack One", "[]", 1000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &content,
            "squad-2",
            Some("npub1stranger"),
        );
        assert!(stored_row(app.handle(), "squad-2", "pack-1").is_none());
    }

    #[test]
    fn squad_id_mismatch_is_dropped() {
        let app = setup("npub1stickermismatch");
        insert_chat_with_participants(app.handle(), "squad-3", &["npub1author"]);
        let content = announce("other-squad", "pack-1", "Pack One", "[]", 1000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &content,
            "squad-3",
            Some("npub1author"),
        );
        assert!(stored_row(app.handle(), "squad-3", "pack-1").is_none());
        assert!(stored_row(app.handle(), "other-squad", "pack-1").is_none());
    }

    #[test]
    fn older_or_equal_updated_at_leaves_row_untouched() {
        let app = setup("npub1stickerolderequal");
        insert_chat_with_participants(app.handle(), "squad-4", &["npub1author"]);
        let first = announce("squad-4", "pack-1", "Original", "[]", 2000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &first,
            "squad-4",
            Some("npub1author"),
        );
        let equal = announce("squad-4", "pack-1", "Equal Attempt", "[]", 2000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &equal,
            "squad-4",
            Some("npub1author"),
        );
        let older = announce("squad-4", "pack-1", "Older Attempt", "[]", 1000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &older,
            "squad-4",
            Some("npub1author"),
        );
        let row = stored_row(app.handle(), "squad-4", "pack-1").unwrap();
        assert_eq!(row.name, "Original");
        assert_eq!(row.updated_at, 2000);
    }

    #[test]
    fn newer_updated_at_replaces_fields() {
        let app = setup("npub1stickernewer");
        insert_chat_with_participants(app.handle(), "squad-5", &["npub1author", "npub1author2"]);
        let first = announce(
            "squad-5",
            "pack-1",
            "Original",
            r#"[{"shortcode":"a","url":"u1","key":"k1","nonce":"n1","mime":"image/png","size":1}]"#,
            1000,
            false,
        );
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &first,
            "squad-5",
            Some("npub1author"),
        );
        let second = announce(
            "squad-5",
            "pack-1",
            "Renamed",
            r#"[{"shortcode":"b","url":"u2","key":"k2","nonce":"n2","mime":"image/png","size":2}]"#,
            2000,
            false,
        );
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &second,
            "squad-5",
            Some("npub1author2"),
        );
        let row = stored_row(app.handle(), "squad-5", "pack-1").unwrap();
        assert_eq!(row.name, "Renamed");
        assert_eq!(row.updated_at, 2000);
        assert_eq!(row.updated_by, "npub1author2");
        assert!(row.entries.contains("\"b\""));
    }

    #[test]
    fn out_of_order_announces_converge_on_greatest_updated_at() {
        let app = setup("npub1stickerooo");
        insert_chat_with_participants(app.handle(), "squad-6", &["npub1author"]);

        // Newer arrives first; a stale older one arrives late and must not win.
        let newer = announce("squad-6", "pack-1", "Newer", "[]", 5000, false);
        let older = announce("squad-6", "pack-1", "Older", "[]", 3000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &newer,
            "squad-6",
            Some("npub1author"),
        );
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &older,
            "squad-6",
            Some("npub1author"),
        );
        let row = stored_row(app.handle(), "squad-6", "pack-1").unwrap();
        assert_eq!(row.name, "Newer");
        assert_eq!(row.updated_at, 5000);

        // Reverse order on a fresh pack in the same squad: older first, then a genuinely newer one.
        let older2 = announce("squad-6", "pack-2", "Older2", "[]", 3000, false);
        let newer2 = announce("squad-6", "pack-2", "Newer2", "[]", 5000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &older2,
            "squad-6",
            Some("npub1author"),
        );
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &newer2,
            "squad-6",
            Some("npub1author"),
        );
        let row2 = stored_row(app.handle(), "squad-6", "pack-2").unwrap();
        assert_eq!(row2.name, "Newer2");
        assert_eq!(row2.updated_at, 5000);
    }

    #[test]
    fn deleted_tombstones_and_resists_late_older_resurrection() {
        let app = setup("npub1stickertombstone");
        insert_chat_with_participants(app.handle(), "squad-7", &["npub1author"]);
        let live = announce("squad-7", "pack-1", "Alive", "[]", 1000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &live,
            "squad-7",
            Some("npub1author"),
        );
        let tombstone = announce("squad-7", "pack-1", "Alive", "[]", 2000, true);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &tombstone,
            "squad-7",
            Some("npub1author"),
        );
        let row = stored_row(app.handle(), "squad-7", "pack-1").unwrap();
        assert!(row.deleted, "row should be tombstoned");

        // A late-arriving, older, non-deleted announce must not resurrect it.
        let resurrect_attempt = announce("squad-7", "pack-1", "Resurrected", "[]", 1500, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &resurrect_attempt,
            "squad-7",
            Some("npub1author"),
        );
        let row2 = stored_row(app.handle(), "squad-7", "pack-1").unwrap();
        assert!(
            row2.deleted,
            "tombstone must survive a stale older announce"
        );
        assert_eq!(row2.name, "Alive");
    }

    #[test]
    fn malformed_or_incomplete_content_is_a_noop() {
        let app = setup("npub1stickermalformed");
        insert_chat_with_participants(app.handle(), "squad-8", &["npub1author"]);

        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            "not json",
            "squad-8",
            Some("npub1author"),
        );
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            r#"{"type":"sticker_pack_updated"}"#,
            "squad-8",
            Some("npub1author"),
        );
        let bad_entries = announce(
            "squad-8",
            "pack-1",
            "Bad Entries",
            "\"not-an-array\"",
            1000,
            false,
        );
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &bad_entries,
            "squad-8",
            Some("npub1author"),
        );

        assert!(stored_row(app.handle(), "squad-8", "pack-1").is_none());
    }

    #[test]
    fn announce_exceeding_entry_count_cap_is_a_noop() {
        let app = setup("npub1stickertoomanyentries");
        insert_chat_with_participants(app.handle(), "squad-9", &["npub1author"]);
        let entries: Vec<serde_json::Value> = (0..(STICKER_PACK_MAX_ENTRIES + 1))
            .map(|i| {
                serde_json::json!({
                    "shortcode": format!("s{i}"),
                    "url": "https://x",
                    "key": "aa",
                    "nonce": "bb",
                    "mime": "image/png",
                    "size": 10
                })
            })
            .collect();
        let entries_json = serde_json::to_string(&entries).unwrap();
        let content = announce("squad-9", "pack-1", "Too Many", &entries_json, 1000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &content,
            "squad-9",
            Some("npub1author"),
        );
        assert!(stored_row(app.handle(), "squad-9", "pack-1").is_none());
    }

    #[test]
    fn announce_exceeding_entries_byte_cap_is_a_noop() {
        let app = setup("npub1stickertoobig");
        insert_chat_with_participants(app.handle(), "squad-10", &["npub1author"]);
        let huge_url = "u".repeat(STICKER_PACK_MAX_ENTRIES_BYTES + 1);
        let entries_json = serde_json::to_string(&serde_json::json!([{
            "shortcode": "big",
            "url": huge_url,
            "key": "aa",
            "nonce": "bb",
            "mime": "image/png",
            "size": 10
        }]))
        .unwrap();
        let content = announce("squad-10", "pack-1", "Too Big", &entries_json, 1000, false);
        maybe_upsert_sticker_pack_from_announce(
            app.handle(),
            &content,
            "squad-10",
            Some("npub1author"),
        );
        assert!(stored_row(app.handle(), "squad-10", "pack-1").is_none());
    }
}

#[cfg(test)]
mod war_game_announce_tests {
    use super::*;

    fn setup(test_npub: &str) -> tauri::App<tauri::test::MockRuntime> {
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();
        let app = tauri::test::mock_app();
        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);
        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);
        app
    }

    fn insert_chat_with_participants<R: Runtime>(
        handle: &AppHandle<R>,
        chat_id: &str,
        participants: &[&str],
    ) {
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        let json = serde_json::to_string(participants).unwrap();
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata) \
             VALUES (?1, 0, ?2, '', 1000, '{}')",
            rusqlite::params![chat_id, json],
        )
        .unwrap();
        crate::account_manager::return_db_connection(conn);
    }

    fn stored_wargame<R: Runtime>(
        handle: &AppHandle<R>,
        parent_id: &str,
    ) -> Option<(String, String, String)> {
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        let row = conn
            .query_row(
                "SELECT id, infra_type, provider_payload FROM squad_infra \
                 WHERE parent_id = ?1 AND infra_type = 'pacto_gov_wargame'",
                rusqlite::params![parent_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .unwrap();
        crate::account_manager::return_db_connection(conn);
        row
    }

    fn pacto_gov_count<R: Runtime>(handle: &AppHandle<R>, parent_id: &str) -> i64 {
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM squad_infra WHERE parent_id = ?1 AND infra_type = 'pacto_gov'",
                rusqlite::params![parent_id],
                |r| r.get(0),
            )
            .unwrap();
        crate::account_manager::return_db_connection(conn);
        n
    }

    fn announce_round(
        parent_id: &str,
        action: &str,
        round: &str,
        sponsor: &str,
        hat: &str,
    ) -> String {
        let payload = serde_json::json!({
            "v": 1,
            "status": "active",
            "round": round,
            "gameSquadId": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "sponsor": sponsor,
        })
        .to_string();
        serde_json::json!({
            "pacto_virtual_bucket": "announcements",
            "type": "war_game_updated",
            "payload": {
                "parent_id": parent_id,
                "action": action,
                "canonical_ref": hat,
                "chain": "sepolia",
                "entry_id": pacto_gov_wargame_infra_row_id(parent_id),
                "round": round,
                "game_squad_id": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "sponsor": sponsor,
                "provider_payload": payload,
            }
        })
        .to_string()
    }

    fn announce(parent_id: &str, action: &str) -> String {
        announce_round(
            parent_id,
            action,
            "1",
            "0x5555555555555555555555555555555555555555",
            "42",
        )
    }

    #[test]
    fn merge_older_round_keeps_active_and_archives_incoming() {
        let stored = r#"{"round":"3","status":"active","sponsor":"0x3"}"#;
        let incoming = r#"{"round":"1","status":"active","sponsor":"0x1"}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(Some(stored), incoming))
                .unwrap();
        assert_eq!(v["round"], "3");
        assert_eq!(v["sponsor"], "0x3");
        assert_eq!(v["priorRounds"][0]["round"], "1");
        assert_eq!(v["priorRounds"][0]["status"], "retired");
    }

    #[test]
    fn merge_newer_round_archives_stored_active() {
        let stored = r#"{"round":"1","status":"active","sponsor":"0x1"}"#;
        let incoming = r#"{"round":"2","status":"active","sponsor":"0x2"}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(Some(stored), incoming))
                .unwrap();
        assert_eq!(v["round"], "2");
        assert_eq!(v["sponsor"], "0x2");
        assert_eq!(v["priorRounds"][0]["round"], "1");
        assert_eq!(v["priorRounds"][0]["status"], "retired");
    }

    #[test]
    fn merge_strips_incoming_pending_next() {
        let incoming = r#"{"round":"1","status":"active","sponsor":"0x1","pendingNext":{"topHatId":"99","deployTxHash":"0xevil"}}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(None, incoming)).unwrap();
        assert_eq!(v["round"], "1");
        assert!(v.get("pendingNext").is_none());
    }

    #[test]
    fn merge_same_round_keeps_stored_pending_next() {
        let stored = r#"{"round":"1","status":"active","sponsor":"0x1","pendingNext":{"topHatId":"99","deployTxHash":"0xabc"}}"#;
        let incoming = r#"{"round":"1","status":"active","sponsor":"0x1","pendingNext":{"topHatId":"1","deployTxHash":"0xevil"}}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(Some(stored), incoming))
                .unwrap();
        assert_eq!(v["pendingNext"]["topHatId"], "99");
        assert_eq!(v["pendingNext"]["deployTxHash"], "0xabc");
    }

    #[test]
    fn merge_newer_round_drops_stored_pending_next() {
        let stored =
            r#"{"round":"1","status":"active","sponsor":"0x1","pendingNext":{"topHatId":"99"}}"#;
        let incoming = r#"{"round":"2","status":"active","sponsor":"0x2"}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(Some(stored), incoming))
                .unwrap();
        assert_eq!(v["round"], "2");
        assert!(v.get("pendingNext").is_none());
    }

    #[test]
    fn merge_pass_through_without_round_strips_pending_next() {
        let incoming = r#"{"status":"pending_sponsor","pendingNext":{"topHatId":"99"}}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(None, incoming)).unwrap();
        assert_eq!(v["status"], "pending_sponsor");
        assert!(v.get("pendingNext").is_none());
    }

    #[test]
    fn merge_prior_rounds_keeps_newest_300() {
        let priors: Vec<serde_json::Value> = (1..=300)
            .map(|i| serde_json::json!({"round": i.to_string(), "status": "retired"}))
            .collect();
        let stored = serde_json::json!({
            "status": "active",
            "round": "301",
            "priorRounds": priors,
        })
        .to_string();
        let incoming = serde_json::json!({
            "status": "active",
            "round": "302",
        })
        .to_string();
        let v: serde_json::Value = serde_json::from_str(&merge_war_game_provider_payloads(
            Some(stored.as_str()),
            incoming.as_str(),
        ))
        .unwrap();
        let arr = v["priorRounds"].as_array().expect("priorRounds");
        assert_eq!(arr.len(), 300);
        assert_eq!(arr[0]["round"], "2");
        assert_eq!(arr[299]["round"], "301");
    }

    #[test]
    fn merge_pass_through_caps_prior_rounds() {
        let priors: Vec<serde_json::Value> = (1..=301)
            .map(|i| serde_json::json!({"round": i.to_string(), "status": "retired"}))
            .collect();
        let incoming = serde_json::json!({
            "status": "pending_sponsor",
            "priorRounds": priors,
        })
        .to_string();
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(None, incoming.as_str()))
                .unwrap();
        let arr = v["priorRounds"].as_array().expect("priorRounds");
        assert_eq!(arr.len(), 300);
        assert_eq!(arr[0]["round"], "2");
        assert_eq!(arr[299]["round"], "301");
    }

    #[test]
    fn merge_prior_rounds_evicts_oldest_to_stay_under_byte_cap() {
        let bulky = "x".repeat(20_000);
        let priors: Vec<serde_json::Value> = (1..=10)
            .map(|i| {
                serde_json::json!({
                    "round": i.to_string(),
                    "status": "retired",
                    "blob": bulky,
                })
            })
            .collect();
        let incoming = serde_json::json!({
            "status": "active",
            "round": "11",
            "priorRounds": priors,
        })
        .to_string();
        let v: serde_json::Value =
            serde_json::from_str(&merge_war_game_provider_payloads(None, incoming.as_str()))
                .unwrap();
        let arr = v["priorRounds"].as_array().expect("priorRounds");
        let bytes = serde_json::to_vec(arr).unwrap().len();
        assert!(bytes <= 128 * 1024, "bytes={bytes}");
        assert!(arr.len() < 10);
        assert_eq!(arr.last().unwrap()["round"], "10");
    }

    #[test]
    fn member_announce_upserts_wargame_not_pacto_gov() {
        let app = setup("npub1wargameannounceupsert");
        insert_chat_with_participants(app.handle(), "squad-wg", &["npub1author"]);
        maybe_upsert_war_game_from_announce(
            app.handle(),
            &announce("squad-wg", "deploy"),
            "squad-wg",
            Some("npub1author"),
        );
        let row = stored_wargame(app.handle(), "squad-wg").expect("wargame row");
        assert_eq!(row.0, pacto_gov_wargame_infra_row_id("squad-wg"));
        assert_eq!(row.1, "pacto_gov_wargame");
        assert!(row.2.contains("gameSquadId"));
        assert_eq!(pacto_gov_count(app.handle(), "squad-wg"), 0);
    }

    #[test]
    fn wargame_announce_is_monotonic_on_round() {
        let app = setup("npub1wargamemonotonic");
        insert_chat_with_participants(app.handle(), "squad-wg-mono", &["npub1author"]);
        maybe_upsert_war_game_from_announce(
            app.handle(),
            &announce_round(
                "squad-wg-mono",
                "deploy",
                "1",
                "0x1111111111111111111111111111111111111111",
                "42",
            ),
            "squad-wg-mono",
            Some("npub1author"),
        );
        maybe_upsert_war_game_from_announce(
            app.handle(),
            &announce_round(
                "squad-wg-mono",
                "redeploy",
                "2",
                "0x2222222222222222222222222222222222222222",
                "99",
            ),
            "squad-wg-mono",
            Some("npub1author"),
        );
        let after_newer = stored_wargame(app.handle(), "squad-wg-mono").expect("wargame row");
        let newer: serde_json::Value = serde_json::from_str(&after_newer.2).unwrap();
        assert_eq!(newer["round"], "2");
        assert_eq!(
            newer["sponsor"],
            "0x2222222222222222222222222222222222222222"
        );
        let priors = newer["priorRounds"].as_array().expect("priorRounds");
        assert_eq!(priors.len(), 1);
        assert_eq!(priors[0]["round"], "1");
        assert_eq!(priors[0]["status"], "retired");

        maybe_upsert_war_game_from_announce(
            app.handle(),
            &announce_round(
                "squad-wg-mono",
                "deploy",
                "1",
                "0x1111111111111111111111111111111111111111",
                "42",
            ),
            "squad-wg-mono",
            Some("npub1author"),
        );
        let after_older = stored_wargame(app.handle(), "squad-wg-mono").expect("wargame row");
        let kept: serde_json::Value = serde_json::from_str(&after_older.2).unwrap();
        assert_eq!(kept["round"], "2");
        assert_eq!(
            kept["sponsor"],
            "0x2222222222222222222222222222222222222222"
        );
        let priors = kept["priorRounds"].as_array().expect("priorRounds");
        assert_eq!(priors.len(), 1);
        assert_eq!(priors[0]["round"], "1");
        assert_eq!(priors[0]["status"], "retired");
    }

    #[test]
    fn governance_updated_wargame_provider_does_not_upsert() {
        let app = setup("npub1wargamegovskip");
        insert_chat_with_participants(app.handle(), "squad-wg", &["npub1author"]);
        let content = serde_json::json!({
            "type": "governance_updated",
            "payload": {
                "parent_id": "squad-wg",
                "provider": "pacto_gov_wargame",
                "canonical_ref": "42",
            }
        })
        .to_string();
        maybe_upsert_governance_from_announce(
            app.handle(),
            &content,
            "squad-wg",
            Some("npub1author"),
        );
        assert!(stored_wargame(app.handle(), "squad-wg").is_none());
        assert_eq!(pacto_gov_count(app.handle(), "squad-wg"), 0);
    }

    #[test]
    fn non_member_announce_is_noop() {
        let app = setup("npub1wargamenonmember");
        insert_chat_with_participants(app.handle(), "squad-wg", &["npub1author"]);
        maybe_upsert_war_game_from_announce(
            app.handle(),
            &announce("squad-wg", "deploy"),
            "squad-wg",
            Some("npub1stranger"),
        );
        assert!(stored_wargame(app.handle(), "squad-wg").is_none());
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadMemberEvmRow {
    pub member_npub: String,
    pub evm_address: String,
    pub updated_at_ms: i64,
    #[serde(default)]
    pub issued_at: i64,
    #[serde(default)]
    pub bind_signature: String,
}

/// Persist this account's squad-visible EVM address for a parent (same id as squad/network root and announcements MLS group in current UX).
#[command]
pub fn upsert_squad_member_evm<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    evm_address: String,
    issued_at: Option<i64>,
    bind_signature: Option<String>,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let member_npub = crate::account_manager::get_current_account()?;
    let parent = parent_id.trim();
    if parent.is_empty() {
        return Err("parent_id is empty".to_string());
    }
    let norm = crate::evm::normalize_hex_address(evm_address.trim())
        .ok_or_else(|| "Invalid EVM address".to_string())?;
    crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(&handle, norm.as_str())?;
    let (issued, sig) = crate::evm::roster_bind_cert::require_verified_bind_cert_for_upsert(
        parent,
        member_npub.as_str(),
        norm.as_str(),
        issued_at,
        bind_signature,
    )?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let applied = upsert_certified_squad_member_evm(
        &conn,
        parent,
        member_npub.as_str(),
        norm.as_str(),
        issued,
        sig.as_str(),
        now_ms,
    );
    crate::account_manager::return_db_connection(conn);
    applied.map(|_| ())
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
            "SELECT member_npub, evm_address, updated_at_ms, issued_at, bind_signature FROM squad_member_evm WHERE parent_id = ?1 ORDER BY member_npub ASC",
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
                    issued_at: row.get(3)?,
                    bind_signature: row.get(4)?,
                })
            })
            .map_err(|e| format!("Failed to query squad_member_evm: {}", e))?;
        for r in rows {
            let row = r.map_err(|e| e.to_string())?;
            if !is_certified_squad_member_evm_row(row.issued_at, row.bind_signature.as_str()) {
                continue;
            }
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
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
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
    let purpose_addr: Result<(String, String), String> = (|| {
        let purpose: String = conn
            .query_row(
                "SELECT purpose FROM evm_accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |r| r.get(0),
            )
            .map_err(|_| "Unknown EVM account.".to_string())?;
        if purpose.trim().eq_ignore_ascii_case("advanced") {
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
        Ok((purpose, address))
    })();
    let (_purpose, address) = match purpose_addr {
        Ok(v) => v,
        Err(e) => {
            crate::account_manager::return_db_connection(conn);
            return Err(e);
        }
    };

    let norm = match crate::evm::normalize_hex_address(address.trim()) {
        Some(n) => n,
        None => {
            crate::account_manager::return_db_connection(conn);
            return Err("Invalid EVM address".to_string());
        }
    };
    if let Err(e) =
        crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(&handle, norm.as_str())
    {
        crate::account_manager::return_db_connection(conn);
        return Err(e);
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let write_result = (|| -> Result<(), String> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin squad EVM upsert transaction: {}", e))?;
        tx.execute(
            "INSERT INTO squad_member_evm_account (parent_id, member_npub, evm_account_id, updated_at_ms) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(parent_id, member_npub) DO UPDATE SET evm_account_id = excluded.evm_account_id, updated_at_ms = excluded.updated_at_ms",
            rusqlite::params![parent, member_npub.as_str(), account_id, now_ms],
        )
        .map_err(|e| format!("Failed to upsert squad_member_evm_account: {}", e))?;
        tx.execute(
            "INSERT INTO squad_member_evm (parent_id, member_npub, evm_address, updated_at_ms, issued_at, bind_signature) VALUES (?1, ?2, ?3, ?4, 0, '')
             ON CONFLICT(parent_id, member_npub) DO UPDATE SET evm_address = excluded.evm_address, updated_at_ms = excluded.updated_at_ms, issued_at = 0, bind_signature = ''",
            rusqlite::params![parent, member_npub.as_str(), norm, now_ms],
        )
        .map_err(|e| format!("Failed to upsert squad_member_evm: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit squad EVM upsert: {}", e))?;
        Ok(())
    })();
    crate::account_manager::return_db_connection(conn);
    write_result?;

    Ok(SquadMemberEvmRow {
        member_npub,
        evm_address: norm,
        updated_at_ms: now_ms,
        issued_at: 0,
        bind_signature: String::new(),
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

pub(crate) fn is_certified_squad_member_evm_row(issued_at: i64, bind_signature: &str) -> bool {
    issued_at > 0 && !bind_signature.trim().is_empty()
}

#[cfg(test)]
mod certified_roster_list_tests {
    use super::is_certified_squad_member_evm_row;

    #[test]
    fn certified_row_filter_excludes_unsigned_backfill() {
        assert!(!is_certified_squad_member_evm_row(0, ""));
        assert!(!is_certified_squad_member_evm_row(0, "0xabc"));
        assert!(!is_certified_squad_member_evm_row(100, "  "));
        assert!(is_certified_squad_member_evm_row(100, "0xabc"));
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

/// Resolve roster-bound `0x` address: per-squad account binding only.
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

    if let Some(account_id) =
        get_squad_member_evm_account_id(&handle, parent, Some(member.as_str()))?
    {
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

    Ok(None)
}

/// Re-apply automation side effects for persisted MLS rows (governance, treasury, roster EVM).
pub async fn replay_automation_side_effects_for_chat<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
) -> Result<u32, String> {
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    let messages = get_message_views(handle, chat_int_id, 2000, 0, None).await?;
    for msg in &messages {
        apply_mls_virtual_bucket_side_effects(
            handle,
            chat_id,
            msg.virtual_bucket.as_deref(),
            &msg.content,
            msg.npub.as_deref(),
        );
    }
    Ok(messages.len() as u32)
}

/// Applies treasury (`squad_safe_updated`), governance (`governance_updated`), and roster EVM (`squad_member_evm_share`)
/// side effects when the MLS chat row is classified into virtual buckets (routing ADR).
/// Squad sponsor `governance_updated` announces also ingest from **announcements** so all members sync infra.
/// Roster EVM shares are routed to **announcements** (ADR rule 6) and must upsert here — not only under `inbox`.
/// `chat_id` is the MLS group id (squad announcements id); payload parent ids must match it.
pub fn apply_mls_virtual_bucket_side_effects<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
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

    // Squad-wide governance deploys sync even when bucket metadata was missing on ingest.
    if is_announcements_governance_announce_content(content) {
        maybe_upsert_governance_from_announce(handle, content, chat_id, author_npub);
    }
    maybe_upsert_war_game_from_announce(handle, content, chat_id, author_npub);
    crate::squad_gov_replica::maybe_upsert_from_announce(handle, content, chat_id, author_npub);

    // Sticker pack announces are always announcements-bucket traffic; ingest unconditionally,
    // same as governance above, so sync works even if bucket derivation was skipped upstream.
    maybe_upsert_sticker_pack_from_announce(handle, content, chat_id, author_npub);

    // `squad_member_evm_share` is announcements-bucket traffic; apply regardless of inbox gate.
    if effective_bucket == Some("announcements")
        || effective_bucket == Some("inbox")
        || effective_bucket.is_none()
    {
        try_apply_squad_member_evm_share(handle, content, chat_id, author_npub);
        try_apply_squad_evm_roster_snapshot(handle, content, chat_id, author_npub);
    }

    if effective_bucket == Some("announcements") || effective_bucket.is_none() {
        try_apply_join_inbox_meta(handle, content, chat_id);
    }

    if effective_bucket == Some("inbox") {
        apply_parent_safe_announce(handle, content, chat_id, author_npub);
        maybe_upsert_governance_from_announce(handle, content, chat_id, author_npub);
        try_apply_squad_contract_allowlist_announce(handle, content, chat_id, author_npub);
        try_apply_squad_tracked_tokens_announce(handle, content, chat_id, author_npub);
        return;
    }
    if effective_bucket == Some("announcements")
        && is_announcements_governance_announce_content(content)
    {
        return;
    }
}

fn try_apply_join_inbox_meta<R: Runtime>(handle: &AppHandle<R>, content: &str, chat_id: &str) {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(content.trim()) else {
        return;
    };
    let schema = val.get("schema").and_then(|x| x.as_str()).unwrap_or("");
    if schema != crate::join_inbox::JOIN_INBOX_META_SCHEMA
        && schema != crate::join_inbox::JOIN_INBOX_KEY_ROTATED_SCHEMA
    {
        return;
    }
    let Some(squad_id) = val
        .get("squadId")
        .or_else(|| val.get("squad_id"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    if !side_effect_parent_matches_chat(chat_id, squad_id) {
        return;
    }
    let Ok(conn) = crate::account_manager::get_db_connection(handle) else {
        return;
    };
    if let Err(e) = crate::join_inbox::apply_meta_from_content(&conn, content) {
        eprintln!("[join_inbox] apply meta failed: {e}");
    }
    crate::account_manager::return_db_connection(conn);
}

fn is_announcements_governance_announce_content(content: &str) -> bool {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(content.trim()) else {
        return false;
    };
    if val.get("type").and_then(|x| x.as_str()) != Some("governance_updated") {
        return false;
    }
    val.get("payload")
        .and_then(|p| p.get("provider"))
        .and_then(|x| x.as_str())
        .map(|s| {
            let p = s.trim();
            p.eq_ignore_ascii_case("sponsor") || p.eq_ignore_ascii_case("pacto_gov")
        })
        .unwrap_or(false)
}

fn json_issued_at(v: Option<&serde_json::Value>) -> Option<i64> {
    let v = v?;
    match v {
        serde_json::Value::Number(n) => n.as_i64().or_else(|| n.as_u64().map(|u| u as i64)),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RosterBindCertIngest {
    pub parent_id: String,
    pub member_npub: String,
    pub evm_address: String,
    pub issued_at: i64,
    pub signature: String,
}

fn roster_bind_cert_from_json(
    p: &serde_json::Value,
    parent_id: &str,
) -> Option<RosterBindCertIngest> {
    let member_npub = p
        .get("member_npub")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let raw_addr = p
        .get("evm_address")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let evm_address = crate::evm::normalize_hex_address(raw_addr)?;
    let issued_at = json_issued_at(p.get("issued_at")).filter(|n| *n > 0)?;
    let signature = p
        .get("signature")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    Some(RosterBindCertIngest {
        parent_id: parent_id.to_string(),
        member_npub,
        evm_address,
        issued_at,
        signature,
    })
}

pub(crate) fn upsert_certified_squad_member_evm(
    conn: &rusqlite::Connection,
    parent_id: &str,
    member_npub: &str,
    evm_address: &str,
    issued_at: i64,
    bind_signature: &str,
    now_ms: i64,
) -> Result<bool, String> {
    let changed = conn
        .execute(
            "INSERT INTO squad_member_evm \
             (parent_id, member_npub, evm_address, updated_at_ms, issued_at, bind_signature) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(parent_id, member_npub) DO UPDATE SET \
               evm_address = excluded.evm_address, \
               updated_at_ms = excluded.updated_at_ms, \
               issued_at = excluded.issued_at, \
               bind_signature = excluded.bind_signature \
             WHERE excluded.issued_at >= squad_member_evm.issued_at",
            rusqlite::params![
                parent_id,
                member_npub,
                evm_address,
                now_ms,
                issued_at,
                bind_signature
            ],
        )
        .map_err(|e| format!("Failed to upsert squad_member_evm: {e}"))?;
    Ok(changed > 0)
}

pub(crate) fn apply_verified_roster_bind_cert(
    conn: &rusqlite::Connection,
    chat_id: &str,
    cert: &RosterBindCertIngest,
) -> bool {
    if !side_effect_parent_matches_chat(chat_id, &cert.parent_id) {
        return false;
    }
    if crate::evm::roster_bind_cert::verify_squad_roster_bind_cert(
        &cert.parent_id,
        &cert.member_npub,
        &cert.evm_address,
        cert.issued_at as u64,
        &cert.signature,
    )
    .is_err()
    {
        return false;
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    upsert_certified_squad_member_evm(
        conn,
        &cert.parent_id,
        &cert.member_npub,
        &cert.evm_address,
        cert.issued_at,
        &cert.signature,
        now_ms,
    )
    .unwrap_or(false)
}

/// v2 certified share: MLS author must equal payload.member_npub.
pub(crate) fn parse_v2_squad_member_evm_share(
    content: &str,
    author_npub: &str,
) -> Option<RosterBindCertIngest> {
    let author = author_npub.trim();
    if author.is_empty() {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
    if parsed.get("type").and_then(|v| v.as_str()) != Some("squad_member_evm_share") {
        return None;
    }
    if parsed.get("version").and_then(|v| v.as_u64()) != Some(2) {
        return None;
    }
    let p = parsed.get("payload").filter(|v| v.is_object())?;
    let parent_id = p
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let cert = roster_bind_cert_from_json(p, parent_id)?;
    if cert.member_npub != author {
        return None;
    }
    Some(cert)
}

pub fn try_apply_squad_member_evm_share<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let Some(cert) = parse_v2_squad_member_evm_share(content, author) else {
        return;
    };
    if crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(
        handle,
        cert.evm_address.as_str(),
    )
    .is_err()
    {
        return;
    }
    let Ok(conn) = crate::account_manager::get_db_connection(handle) else {
        return;
    };
    if !apply_verified_roster_bind_cert(&conn, chat_id, &cert) {
        eprintln!(
            "[roster_bind] apply squad_member_evm_share failed parent={} member={}",
            cert.parent_id, cert.member_npub
        );
    }
    crate::account_manager::return_db_connection(conn);
}

/// Certified roster snapshot. Forwarder must be an MLS member; each cert is independent.
pub(crate) fn parse_squad_evm_roster_snapshot_certs(
    content: &str,
) -> Option<(String, Vec<RosterBindCertIngest>)> {
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
    if parsed.get("type").and_then(|v| v.as_str()) != Some("squad_evm_roster_snapshot") {
        return None;
    }
    if parsed.get("version").and_then(|v| v.as_u64()).unwrap_or(1) != 1 {
        return None;
    }
    let p = parsed.get("payload").filter(|v| v.is_object())?;
    let parent_id = p
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let members = p.get("members").and_then(|v| v.as_array())?;
    let certs = members
        .iter()
        .filter_map(|raw| roster_bind_cert_from_json(raw, &parent_id))
        .collect::<Vec<_>>();
    Some((parent_id, certs))
}

pub fn try_apply_squad_evm_roster_snapshot<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let Some((parent_id, members)) = parse_squad_evm_roster_snapshot_certs(content) else {
        return;
    };
    if !side_effect_parent_matches_chat(chat_id, &parent_id) {
        return;
    }
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        return;
    }
    let Ok(conn) = crate::account_manager::get_db_connection(handle) else {
        return;
    };
    for cert in members {
        if crate::evm::evm_accounts::ensure_address_allowed_on_squad_roster(
            handle,
            cert.evm_address.as_str(),
        )
        .is_err()
        {
            continue;
        }
        if !apply_verified_roster_bind_cert(&conn, chat_id, &cert) {
            eprintln!(
                "[roster_bind] apply roster snapshot cert failed parent={} member={}",
                cert.parent_id, cert.member_npub
            );
        }
    }
    crate::account_manager::return_db_connection(conn);
}
