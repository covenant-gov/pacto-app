//! Squad Admin roster mutations: createRole, enable/disableExecutor, enableFullPermission.

use alloy::primitives::{Address, B256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::access_control::GovCapability;
use super::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    createRoleCall, disableExecutorCall, enableExecutorCall, enableFullPermissionCall,
};
use super::gov_module_write::send_gov_module_call;
use super::gov_read::{connect_gov_read_provider, parse_top_hat_id};
use super::nave_pirata_read::{read_nave_pirata_deployment, read_war_game_active_deployment};
use super::pacto_chain_config;
use super::privilege_role_id::{
    decode_privilege_role_id, parse_role_id_hex, PrivilegeRoleIdDecodeError,
    PRIVILEGE_KNOWN_ACTION_MASK,
};
use super::rpc::{parse_address, wallet_err_json};
use super::sponsor_userop::parse_war_game_userop_context;
use super::squad_sponsor_common::squad_id_from_parent_id;
use super::wallet_chain_config;
use crate::db;

fn parse_packed_role_id(role_id: &str) -> Result<B256, String> {
    let role = parse_role_id_hex(role_id).map_err(|e| wallet_err_json("INVALID_ROLE", e, None))?;
    let decoded = decode_privilege_role_id(role).map_err(|e| {
        let msg = match e {
            PrivilegeRoleIdDecodeError::UnknownVersion => "unknown privilege role version",
            PrivilegeRoleIdDecodeError::ReservedNonzero => "privilege role reserved byte must be 0",
        };
        wallet_err_json("INVALID_ROLE", msg, None)
    })?;
    if decoded.flags & !PRIVILEGE_KNOWN_ACTION_MASK != 0 {
        return Err(wallet_err_json(
            "INVALID_ROLE",
            "unknown/reserved privilege flag bits must be 0 when encoding v1",
            None,
        ));
    }
    Ok(role)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadAdminWriteResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub squad_admin_proxy: String,
    pub funded_by: String,
}

async fn squad_admin_write<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    squad_admin_proxy: String,
    calldata: Vec<u8>,
    capability: GovCapability,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminWriteResult, String> {
    let admin = parse_address(squad_admin_proxy.trim())
        .map_err(|e| wallet_err_json("INVALID_SQUAD_ADMIN", e, None))?;

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let parent = resolve_squad_admin_parent(
        &app,
        parent_id.as_str(),
        admin,
        net.key.as_str(),
        rpc_urls.clone(),
    )
    .await?;

    let (tx_hash, chain, chain_id, funded_by) =
        send_gov_module_call(app, network, parent, admin, calldata, capability, rpc_urls).await?;
    super::squad_privilege_enforce::invalidate_exec_state_cache(chain.as_str(), admin);

    Ok(SquadAdminWriteResult {
        tx_hash,
        chain,
        chain_id,
        squad_admin_proxy: format!("{:#x}", admin),
        funded_by,
    })
}

async fn resolve_squad_admin_parent<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    admin: Address,
    network: &str,
    rpc_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let from_infra = db::parent_id_for_canonical_infra_ref(app, &format!("{admin:#x}"))?
        .filter(|s| !s.trim().is_empty());
    let pid = parent_id.trim();
    match (pid.is_empty(), from_infra) {
        (_, Some(infra)) if pid.is_empty() => Ok(infra),
        (_, Some(infra)) if pid == infra.trim() => Ok(pid.to_string()),
        (_, Some(_)) => Err(wallet_err_json(
            "PARENT_MISMATCH",
            "client parentId does not match infra for this Squad Admin",
            None,
        )),
        (false, None) => {
            if parent_mentions_squad_admin_on_chain(app, pid, admin, network, rpc_urls).await? {
                Ok(pid.to_string())
            } else {
                Err(wallet_err_json(
                    "MISSING_PARENT",
                    "Squad Admin proxy is not linked to this parent",
                    None,
                ))
            }
        }
        (true, None) => Err(wallet_err_json(
            "MISSING_PARENT",
            "could not resolve parent for squad admin write",
            None,
        )),
    }
}

fn squad_admin_from_deployment_matches(admin: Address, squad_admin_proxy: &str) -> bool {
    parse_address(squad_admin_proxy).ok() == Some(admin)
}

async fn parent_mentions_squad_admin_on_chain<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    admin: Address,
    network: &str,
    rpc_urls: Option<Vec<String>>,
) -> Result<bool, String> {
    let rows = db::list_squad_infra(app.clone(), parent_id.to_string())?;
    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(network)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let (provider, rpc_ctx) = connect_gov_read_provider(network, rpc_urls).await?;

    if let Some(row) = rows.iter().find(|r| r.infra_type == "pacto_gov") {
        if let Some(registry) = addrs.nave_pirata_registry {
            if let Ok(top_hat) = parse_top_hat_id(row.canonical_ref.trim()) {
                match read_nave_pirata_deployment(
                    &provider,
                    registry,
                    top_hat,
                    rpc_ctx.key.as_str(),
                    rpc_ctx.chain_id,
                )
                .await
                {
                    Ok(d)
                        if squad_admin_from_deployment_matches(
                            admin,
                            d.squad_admin_proxy.as_str(),
                        ) =>
                    {
                        return Ok(true);
                    }
                    Ok(_) => {}
                    Err(e) => return Err(e),
                }
            }
        }
    }

    if let Some(row) = rows.iter().find(|r| r.infra_type == "pacto_gov_wargame") {
        if let (Some(registry), Some(payload)) =
            (addrs.war_game_registry, row.provider_payload.as_deref())
        {
            if parse_war_game_userop_context(payload).is_some() {
                match read_war_game_active_deployment(
                    &provider,
                    registry,
                    squad_id_from_parent_id(parent_id),
                    rpc_ctx.key.as_str(),
                    rpc_ctx.chain_id,
                )
                .await
                {
                    Ok(Some(d))
                        if squad_admin_from_deployment_matches(
                            admin,
                            d.squad_admin_proxy.as_str(),
                        ) =>
                    {
                        return Ok(true);
                    }
                    Ok(_) => {}
                    Err(e) => return Err(e),
                }
            }
        }
    }
    Ok(false)
}

#[tauri::command]
pub async fn squad_admin_create_role<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    squad_admin_proxy: String,
    role_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminWriteResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let role = parse_packed_role_id(role_id.as_str())?;
    let calldata = createRoleCall { _role: role }.abi_encode();
    squad_admin_write(
        app,
        network,
        parent_id,
        squad_admin_proxy,
        calldata,
        GovCapability::SquadAdminCreateRole,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn squad_admin_enable_executor<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    squad_admin_proxy: String,
    executor_address: String,
    role_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminWriteResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;
    let role = parse_packed_role_id(role_id.as_str())?;
    let calldata = enableExecutorCall {
        _executor: exec,
        _role: role,
    }
    .abi_encode();
    squad_admin_write(
        app,
        network,
        parent_id,
        squad_admin_proxy,
        calldata,
        GovCapability::SquadAdminEnableExecutor,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn squad_admin_disable_executor<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    squad_admin_proxy: String,
    executor_address: String,
    role_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminWriteResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;
    let role = parse_packed_role_id(role_id.as_str())?;
    let calldata = disableExecutorCall {
        _executor: exec,
        _role: role,
    }
    .abi_encode();
    squad_admin_write(
        app,
        network,
        parent_id,
        squad_admin_proxy,
        calldata,
        GovCapability::SquadAdminEnableExecutor,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn squad_admin_enable_full_permission<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    squad_admin_proxy: String,
    executor_address: String,
    enable: bool,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminWriteResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;
    let calldata = enableFullPermissionCall {
        _executor: exec,
        _enable: enable,
    }
    .abi_encode();
    squad_admin_write(
        app,
        network,
        parent_id,
        squad_admin_proxy,
        calldata,
        GovCapability::SquadAdminEnableFull,
        rpc_urls,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{parse_packed_role_id, squad_admin_from_deployment_matches};
    use alloy::primitives::address;

    #[test]
    fn parse_packed_role_id_rejects_bad_hex() {
        assert!(parse_packed_role_id("").is_err());
        assert!(parse_packed_role_id("0x1234").is_err());
        assert!(parse_packed_role_id(
            "0x4d61746500000000000000000000000000000000000000000000000000010007"
        )
        .is_ok());
        assert!(parse_packed_role_id(
            "0x5800000000000000000000000000000000000000000000000000000000000001"
        )
        .is_err());
        assert!(parse_packed_role_id(
            "0x5800000000000000000000000000000000000000000000000000000000020001"
        )
        .is_err());
        assert!(parse_packed_role_id(
            "0x58000000000000000000000000000000000000000000000000000000ab010001"
        )
        .is_err());
        assert!(parse_packed_role_id(
            "0x5800000000000000000000000000000000000000000000000000000000010021"
        )
        .is_ok());
        assert!(parse_packed_role_id(
            "0x5800000000000000000000000000000000000000000000000000000000010081"
        )
        .is_err());
    }

    #[test]
    fn squad_admin_match_ignores_json_substring_poison() {
        let admin = address!("0x4444444444444444444444444444444444444444");
        let other = address!("0x5412b91d05101d3bd802e4e8d4c576f0e525aeda");
        assert!(squad_admin_from_deployment_matches(
            admin,
            "0x4444444444444444444444444444444444444444"
        ));
        assert!(!squad_admin_from_deployment_matches(
            other,
            "0x4444444444444444444444444444444444444444"
        ));
    }
}
