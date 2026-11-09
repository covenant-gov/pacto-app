//! Arrival/publish-time SquadAdmin packed-role checks for MLS/Commons actions.

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use super::access_control::resolve_acl_roster_address;
use super::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    hasExecutorRoleCall, isExecutorFullPermissionCall, isExecutorPausedCall, roleAtCall,
    roleCountCall,
};
use super::gov_read::connect_gov_read_provider;
use super::privilege_role_id::{
    decode_privilege_role_id, FLAG_BROADCAST, FLAG_CREATE_CHANNEL, FLAG_INVITE_ACCEPT,
    FLAG_MANAGE_NETWORK, PRIVILEGE_KNOWN_ACTION_MASK,
};
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};
use crate::db;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SquadPrivilegeAction {
    InviteAccept,
    /// Reserved for future Rust publish gates (TS already enforces).
    #[allow(dead_code)]
    CreateChannel,
    #[allow(dead_code)]
    Broadcast,
    #[allow(dead_code)]
    ManageNetwork,
}

impl SquadPrivilegeAction {
    fn flag_bit(self) -> u16 {
        match self {
            Self::InviteAccept => FLAG_INVITE_ACCEPT,
            Self::CreateChannel => FLAG_CREATE_CHANNEL,
            Self::Broadcast => FLAG_BROADCAST,
            Self::ManageNetwork => FLAG_MANAGE_NETWORK,
        }
    }
}

struct ResolvedAdmin {
    proxy: Address,
    chain: String,
}

fn resolve_squad_admin_proxy_from_infra<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<Option<ResolvedAdmin>, String> {
    let rows = db::list_squad_infra(app.clone(), parent_id.to_string())?;
    // Prefer dedicated squad_admin, then pacto_gov payload, then wargame.
    if let Some(row) = rows.iter().find(|r| r.infra_type == "squad_admin") {
        if let Some(proxy) = proxy_from_squad_admin_row(row) {
            return Ok(Some(ResolvedAdmin {
                proxy,
                chain: row.chain.clone(),
            }));
        }
    }
    if let Some(row) = rows.iter().find(|r| r.infra_type == "pacto_gov") {
        if let Some(proxy) = proxy_from_pacto_gov_payload(row) {
            return Ok(Some(ResolvedAdmin {
                proxy,
                chain: row.chain.clone(),
            }));
        }
    }
    if let Some(row) = rows.iter().find(|r| r.infra_type == "pacto_gov_wargame") {
        if let Some(proxy) = proxy_from_pacto_gov_payload(row) {
            return Ok(Some(ResolvedAdmin {
                proxy,
                chain: row.chain.clone(),
            }));
        }
    }
    Ok(None)
}

fn proxy_from_squad_admin_row(row: &db::SquadInfraRow) -> Option<Address> {
    if let Some(raw) = row.provider_payload.as_deref() {
        if let Ok(v) = serde_json::from_str::<Value>(raw) {
            if let Some(p) = v
                .get("squadAdminProxy")
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                return parse_address(p).ok();
            }
        }
    }
    parse_address(row.canonical_ref.trim()).ok()
}

fn proxy_from_pacto_gov_payload(row: &db::SquadInfraRow) -> Option<Address> {
    let raw = row.provider_payload.as_deref()?;
    let v: Value = serde_json::from_str(raw).ok()?;
    let p = v
        .get("squadAdminProxy")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    parse_address(p).ok()
}

async fn read_catalog_role_ids<P: Provider>(
    provider: &P,
    admin: Address,
) -> Result<Vec<B256>, String> {
    let count: U256 = eth_call_decode(provider, admin, &roleCountCall {})
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
    let n = usize::try_from(count).unwrap_or(usize::MAX).min(256);
    let mut roles = Vec::with_capacity(n);
    for i in 0..n {
        let role: B256 = eth_call_decode(
            provider,
            admin,
            &roleAtCall {
                _index: U256::from(i),
            },
        )
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
        roles.push(role);
    }
    Ok(roles)
}

/// Require current user's packed privilege for `action` on `parent_id`.
/// No SquadAdmin infra → allow. Unbound / RPC / pause / missing flag → deny.
pub async fn require_current_user_squad_privilege<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    action: SquadPrivilegeAction,
) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "PRIVILEGE_DENIED",
            "parentId is required for privilege checks",
            None,
        ));
    }
    let Some(admin) = resolve_squad_admin_proxy_from_infra(app, pid)? else {
        return Ok(());
    };

    let exec = resolve_acl_roster_address(app, pid)?;
    let (provider, _ctx) = connect_gov_read_provider(admin.chain.as_str(), None).await?;

    let paused: bool = eth_call_decode(
        &provider,
        admin.proxy,
        &isExecutorPausedCall { _executor: exec },
    )
    .await
    .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
    if paused {
        return Err(wallet_err_json(
            "PRIVILEGE_PAUSED",
            "Squad Admin executor is paused",
            None,
        ));
    }

    let full: bool = eth_call_decode(
        &provider,
        admin.proxy,
        &isExecutorFullPermissionCall { _executor: exec },
    )
    .await
    .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
    if full {
        return Ok(());
    }

    let catalog = read_catalog_role_ids(&provider, admin.proxy).await?;
    let needed = action.flag_bit();
    let mut known = 0u16;
    for role in catalog {
        let enabled: bool = eth_call_decode(
            &provider,
            admin.proxy,
            &hasExecutorRoleCall {
                _executor: exec,
                _role: role,
            },
        )
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
        if !enabled {
            continue;
        }
        if let Ok(decoded) = decode_privilege_role_id(role) {
            known |= decoded.known_flags & PRIVILEGE_KNOWN_ACTION_MASK;
        }
    }
    if known & needed == 0 {
        return Err(wallet_err_json(
            "PRIVILEGE_DENIED",
            "Missing Squad Admin privilege for this action",
            None,
        ));
    }
    Ok(())
}
