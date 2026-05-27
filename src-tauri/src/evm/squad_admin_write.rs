//! Squad Admin roster mutations: createRole, enableExecutor, enableFullPermission.

use alloy::primitives::B256;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    createRoleCall, enableExecutorCall, enableFullPermissionCall,
};
use super::rpc::{
    connect_signing_provider, contract_call_request, parse_address, send_and_confirm,
    wallet_err_json,
};
use super::rpc::signer::{
    load_embedded_signer, load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
    require_treasury_signing_allowed,
};
use super::wallet_chain_config;
use crate::db;

pub fn bytes32_role_tag(label: &str) -> Result<B256, String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err("role label must be non-empty".to_string());
    }
    if trimmed.len() > 32 {
        return Err("role label must be at most 32 ASCII characters".to_string());
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
    squad_admin_proxy: String,
    calldata: Vec<u8>,
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

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    let parent_id = db::parent_id_for_canonical_infra_ref(&app, squad_admin_proxy.trim())?
        .unwrap_or_default();
    let (_signer, wallet) = if parent_id.trim().is_empty() {
        require_treasury_signing_allowed(app.clone()).await?;
        load_embedded_signer(app.clone()).await?
    } else {
        require_roster_treasury_signing_allowed(app.clone(), parent_id.trim()).await?;
        load_squad_roster_embedded_signer(app.clone(), parent_id.trim()).await?
    };
    let provider = connect_signing_provider(&urls, wallet).await?;
    let tx = contract_call_request(admin, calldata);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for squad admin transaction confirmation.",
    )
    .await?;

    Ok(SquadAdminWriteResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        squad_admin_proxy: format!("{:#x}", admin),
    })
}

#[tauri::command]
pub async fn squad_admin_create_role<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    squad_admin_proxy: String,
    role_label: String,
) -> Result<SquadAdminWriteResult, String> {
    let role = bytes32_role_tag(role_label.as_str())
        .map_err(|e| wallet_err_json("INVALID_ROLE", e, None))?;
    let calldata = createRoleCall { _role: role }.abi_encode();
    squad_admin_write(app, network, squad_admin_proxy, calldata).await
}

#[tauri::command]
pub async fn squad_admin_enable_executor<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    squad_admin_proxy: String,
    executor_address: String,
    role_label: String,
) -> Result<SquadAdminWriteResult, String> {
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;
    let role = bytes32_role_tag(role_label.as_str())
        .map_err(|e| wallet_err_json("INVALID_ROLE", e, None))?;
    let calldata = enableExecutorCall {
        _executor: exec,
        _role: role,
    }
    .abi_encode();
    squad_admin_write(app, network, squad_admin_proxy, calldata).await
}

#[tauri::command]
pub async fn squad_admin_enable_full_permission<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    squad_admin_proxy: String,
    executor_address: String,
    enable: bool,
) -> Result<SquadAdminWriteResult, String> {
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;
    let calldata = enableFullPermissionCall {
        _executor: exec,
        _enable: enable,
    }
    .abi_encode();
    squad_admin_write(app, network, squad_admin_proxy, calldata).await
}

#[cfg(test)]
mod tests {
    use super::bytes32_role_tag;

    #[test]
    fn role_tag_matches_left_padded_ascii() {
        let role = bytes32_role_tag("TREASURY").unwrap();
        let mut expected = [0u8; 32];
        expected[..8].copy_from_slice(b"TREASURY");
        assert_eq!(role.as_slice(), expected);
    }
}
