//! Squad Admin roster mutations: createRole, enableExecutor, enableFullPermission.

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, B256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::access_control::{require_capability, with_gov_write_lock, GovCapability, GovStack};
use super::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    createRoleCall, enableExecutorCall, enableFullPermissionCall,
};
use super::gov_read::{connect_gov_read_provider, parse_top_hat_id, rpc_urls_or_default};
use super::nave_pirata_read::{read_nave_pirata_deployment, read_war_game_active_deployment};
use super::pacto_chain_config;
use super::rpc::signer::{
    load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
};
use super::rpc::{
    connect_signing_provider, contract_call_request, parse_address, send_and_confirm,
    wallet_err_json,
};
use super::sponsor_userop::parse_war_game_userop_context;
use super::wallet_chain_config;
use crate::db;

pub fn bytes32_role_tag(label: &str) -> Result<B256, String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err("role label must be non-empty".to_string());
    }
    if trimmed.len() > crate::app_config::ROLE_LABEL_MAX_LENGTH as usize {
        return Err(format!(
            "role label must be at most {} ASCII characters",
            crate::app_config::ROLE_LABEL_MAX_LENGTH
        ));
    }
    if !trimmed.is_ascii() {
        return Err("role label must be ASCII".to_string());
    }
    let mut buf = [0u8; 32];
    buf[..trimmed.len()].copy_from_slice(trimmed.as_bytes());
    Ok(B256::from(buf))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadAdminWriteResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub squad_admin_proxy: String,
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

    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let parent = resolve_squad_admin_parent(
        &app,
        parent_id.as_str(),
        admin,
        net.key.as_str(),
        rpc_urls.clone(),
    )
    .await?;

    let stack =
        GovStack::for_wargame_target_corroborated(&app, parent.as_str(), admin, rpc_urls.clone())
            .await?;
    require_capability(&app, parent.as_str(), capability, rpc_urls, stack).await?;
    require_roster_treasury_signing_allowed(app.clone(), parent.as_str()).await?;

    let (signer, wallet) = load_squad_roster_embedded_signer(app.clone(), parent.as_str()).await?;
    // Key by signer EOA: multiple parents can resolve to the same roster key.
    let _write_guard = with_gov_write_lock(signer.address()).await;
    let provider = connect_signing_provider(&urls, wallet).await?;
    let tx = contract_call_request(admin, calldata).with_chain_id(net.chain_id);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for squad admin confirmation. The transaction may still confirm — do not resubmit the same calldata; check the explorer with the returned tx hash.",
    )
    .await?;

    Ok(SquadAdminWriteResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        squad_admin_proxy: format!("{:#x}", admin),
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
            if let Some(ctx) = parse_war_game_userop_context(payload) {
                match read_war_game_active_deployment(
                    &provider,
                    registry,
                    ctx.game_squad_id,
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
    role_label: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminWriteResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let role = bytes32_role_tag(role_label.as_str())
        .map_err(|e| wallet_err_json("INVALID_ROLE", e, None))?;
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
    role_label: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminWriteResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;
    let role = bytes32_role_tag(role_label.as_str())
        .map_err(|e| wallet_err_json("INVALID_ROLE", e, None))?;
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
    use super::{bytes32_role_tag, squad_admin_from_deployment_matches};
    use alloy::primitives::address;

    #[test]
    fn bytes32_role_tag_rejects_empty_and_overlong() {
        assert!(bytes32_role_tag("").is_err());
        assert!(
            bytes32_role_tag(&"a".repeat(crate::app_config::ROLE_LABEL_MAX_LENGTH + 1)).is_err()
        );
        assert!(bytes32_role_tag("FULL").is_ok());
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
