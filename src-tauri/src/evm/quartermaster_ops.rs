//! Quartermaster crew roster reads and writes.

use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::access_control::GovCapability;
use super::contracts::hats::IHats::hatSupplyCall;
use super::contracts::pacto_gov::read_bindings::IQuartermaster::{
    bootstrapCrewCall, cancelAddCrewCall, cancelRemoveCrewCall, crewChangeDelayCall,
    crewHatIdCall, executeAddCrewCall, executeRemoveCrewCall, mutinyActiveCall,
    pendingCrewAddAtCall, pendingCrewRemoveAtCall, requestAddCrewCall, requestRemoveCrewCall,
};
use super::gov_module_write::{resolve_parent_id_for_module, send_gov_module_call};
use super::gov_read::connect_gov_read_provider;
use super::pacto_chain_config;
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterStatusDto {
    pub crew_change_delay_secs: String,
    pub mutiny_active: bool,
    pub crew_hat_supply: Option<u32>,
    pub bootstrap_available: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterPendingDto {
    pub address: String,
    pub pending_add_at: String,
    pub pending_remove_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterWriteResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub quartermaster: String,
}

#[tauri::command]
pub async fn get_quartermaster_status<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    quartermaster: String,
) -> Result<QuartermasterStatusDto, String> {
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;
    let delay = eth_call_decode(&provider, qm, &crewChangeDelayCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let mutiny_active = eth_call_decode(&provider, qm, &mutinyActiveCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;

    let crew_hat_id = eth_call_decode(&provider, qm, &crewHatIdCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let net_key = network.to_lowercase();
    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net_key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let hats = addrs.hats.ok_or_else(|| {
        wallet_err_json(
            "HATS_CONFIG",
            "PACTO_HATS is not configured for this network",
            None,
        )
    })?;
    let supply: u32 = eth_call_decode(
        &provider,
        hats,
        &hatSupplyCall {
            _hatId: crew_hat_id,
        },
    )
    .await
    .map_err(|e| wallet_err_json("QM_READ", e, None))?;

    Ok(QuartermasterStatusDto {
        crew_change_delay_secs: delay.to_string(),
        mutiny_active,
        crew_hat_supply: Some(supply),
        bootstrap_available: Some(supply == 0 && !mutiny_active),
    })
}

#[tauri::command]
pub async fn get_quartermaster_pending<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    quartermaster: String,
    address: String,
) -> Result<QuartermasterPendingDto, String> {
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let addr =
        parse_address(address.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;
    let add_at = eth_call_decode(
        &provider,
        qm,
        &pendingCrewAddAtCall { _candidate: addr },
    )
    .await
    .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let remove_at = eth_call_decode(
        &provider,
        qm,
        &pendingCrewRemoveAtCall { _crew: addr },
    )
    .await
    .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    Ok(QuartermasterPendingDto {
        address: format!("{:#x}", addr),
        pending_add_at: add_at.to_string(),
        pending_remove_at: remove_at.to_string(),
    })
}

async fn qm_write<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    calldata: Vec<u8>,
    capability: GovCapability,
) -> Result<QuartermasterWriteResult, String> {
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", qm))?;
    let (tx_hash, chain, chain_id) =
        send_gov_module_call(app, network, parent, qm, calldata, capability).await?;
    Ok(QuartermasterWriteResult {
        tx_hash,
        chain,
        chain_id,
        quartermaster: format!("{:#x}", qm),
    })
}

#[tauri::command]
pub async fn quartermaster_request_add_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidate: String,
) -> Result<QuartermasterWriteResult, String> {
    let addr = parse_address(candidate.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = requestAddCrewCall { _candidate: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_cancel_add_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidate: String,
) -> Result<QuartermasterWriteResult, String> {
    let addr = parse_address(candidate.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = cancelAddCrewCall { _candidate: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_execute_add_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidate: String,
) -> Result<QuartermasterWriteResult, String> {
    let addr = parse_address(candidate.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = executeAddCrewCall { _candidate: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterExecute,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_bootstrap_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidates: Vec<String>,
) -> Result<QuartermasterWriteResult, String> {
    if candidates.is_empty() {
        return Err(wallet_err_json(
            "INVALID_CANDIDATES",
            "Select at least one squad member to bootstrap as crew.",
            None,
        ));
    }
    let mut addrs = Vec::with_capacity(candidates.len());
    for raw in candidates {
        let addr = parse_address(raw.trim())
            .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
        addrs.push(addr);
    }
    let calldata = bootstrapCrewCall {
        _candidates: addrs,
    }
    .abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_request_remove_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    crew: String,
) -> Result<QuartermasterWriteResult, String> {
    let addr =
        parse_address(crew.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = requestRemoveCrewCall { _crew: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_cancel_remove_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    crew: String,
) -> Result<QuartermasterWriteResult, String> {
    let addr =
        parse_address(crew.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = cancelRemoveCrewCall { _crew: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_execute_remove_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    crew: String,
) -> Result<QuartermasterWriteResult, String> {
    let addr =
        parse_address(crew.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = executeRemoveCrewCall { _crew: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterExecute,
    )
    .await
}
