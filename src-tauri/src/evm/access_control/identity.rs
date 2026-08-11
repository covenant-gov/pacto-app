//! Fail-closed roster EVM for ACL (binding only; no share-row or active-signer fallback).

use alloy::primitives::Address;
use rusqlite::OptionalExtension;
use tauri::{AppHandle, Runtime};

use crate::account_manager;
use crate::db;
use crate::evm::rpc::{parse_address, wallet_err_json};

/// Roster-bound EVM for the current account on `parent_id`, or ACL error.
pub fn resolve_acl_roster_address<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<Address, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "ACL_MISSING_PARENT",
            "parentId is required for access control",
            None,
        ));
    }
    let member = account_manager::get_current_account()
        .map_err(|e| wallet_err_json("ACL_NO_ACCOUNT", e, None))?;

    if let Some(account_id) = db::get_squad_member_evm_account_id(app, pid, Some(member.as_str()))?
    {
        let conn = account_manager::get_db_connection(app)?;
        let addr: Option<String> = conn
            .query_row(
                "SELECT address FROM evm_accounts WHERE id = ?1",
                rusqlite::params![account_id.as_str()],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| wallet_err_json("ACL_ROSTER", e.to_string(), None))?;
        account_manager::return_db_connection(conn);
        if let Some(a) = addr.and_then(|x| crate::evm::normalize_hex_address(x.trim())) {
            return parse_address(a.as_str()).map_err(|e| wallet_err_json("ACL_ROSTER", e, None));
        }
    }

    Err(wallet_err_json(
        "ACL_UNBOUND",
        "No squad EVM address linked for this parent; link a roster key before acting.",
        None,
    ))
}
