//! Deploy a full Nave Pirata stack via `INavePirataFactory.deployNavePirata` using the embedded EVM key.
//!
//! Deployment infra addresses: `pacto_chain_config` (`PACTO_*` env vars; see `.env.example`).

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::rpc::types::TransactionReceipt;
use alloy::sol_types::SolCall;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::INavePirataFactory::{
    deployNavePirataCall, CrewVoteMode, DeployParams, SquadParams,
};
use super::pacto_chain_config;
use super::rpc::{
    connect_signing_provider, contract_call_request, parse_salt_nonce, parse_address,
    send_and_confirm, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::rpc::signer::{load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed};
use super::squad_sponsor_common::require_sponsor_infra_for_parent;
use super::wallet_chain_config;

/// Matches `script/Constants.sol` production-style defaults (`CREW_CHANGE_DELAY`, `PROPOSAL_EXPIRY`, etc.).
const DEFAULT_CREW_CHANGE_DELAY_SEC: u64 = 7 * 24 * 3600;
const DEFAULT_PROPOSAL_EXPIRY_SEC: u64 = 7 * 24 * 3600;
const DEFAULT_QUORUM_BPS: u64 = 3000;

fn nave_pirata_deployed_topic0() -> B256 {
    B256::from_slice(
        keccak256("NavePirataDeployed(uint256,address,address,address,address,address,address)").as_slice(),
    )
}

fn address_from_word(data: &[u8], word_index: usize) -> Result<Address, String> {
    let start = word_index
        .checked_mul(32)
        .ok_or_else(|| "word index overflow".to_string())?;
    let end = start
        .checked_add(32)
        .ok_or_else(|| "word offset overflow".to_string())?;
    if data.len() < end {
        return Err("log data too short for address words".to_string());
    }
    Ok(Address::from_slice(&data[start + 12..start + 32]))
}

fn addresses_from_nave_pirata_deployed_log(
    log: &alloy::rpc::types::Log,
    factory: Address,
) -> Result<(U256, Address, Address, Address, Address, Address, Address), String> {
    if log.address() != factory {
        return Err("log address mismatch".to_string());
    }
    let topics = log.topics();
    if topics.first() != Some(&nave_pirata_deployed_topic0()) {
        return Err("unexpected event topic".to_string());
    }
    if topics.len() < 3 {
        return Err("NavePirataDeployed: expected at least 3 topics".to_string());
    }
    let top_hat = U256::from_be_slice(topics[1].as_slice());
    let captain = Address::from_slice(&topics[2].as_slice()[12..32]);
    let data = log.data().data.as_ref();
    let safe = address_from_word(data, 0)?;
    let quartermaster = address_from_word(data, 1)?;
    let mutiny = address_from_word(data, 2)?;
    let treasury = address_from_word(data, 3)?;
    let squad_admin = address_from_word(data, 4)?;
    Ok((top_hat, captain, safe, quartermaster, mutiny, treasury, squad_admin))
}

fn nave_pirata_addresses_from_receipt(
    receipt: &TransactionReceipt,
    factory: Address,
) -> Result<(U256, Address, Address, Address, Address, Address, Address), String> {
    for log in receipt.logs() {
        if let Ok(all) = addresses_from_nave_pirata_deployed_log(log, factory) {
            return Ok(all);
        }
    }
    Err("no NavePirataDeployed log from factory in receipt".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavePirataDeployResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub top_hat_id: String,
    pub safe_address: String,
    pub quartermaster: String,
    pub mutiny_module: String,
    pub treasury_authority: String,
    pub squad_admin_proxy: String,
    /// JSON string for `squad_infra.provider_payload` / announces (`v`, addresses, parent id).
    pub provider_payload: String,
}

#[tauri::command]
pub async fn deploy_nave_pirata_for_parent<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    captain: String,
    metadata_uri: String,
    salt_nonce: Option<String>,
) -> Result<NavePirataDeployResult, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }
    require_sponsor_infra_for_parent(&app, pid)?;

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net.key).map_err(|e| {
        wallet_err_json("NAVE_PIRATA_CONFIG", e, None)
    })?;

    let captain_addr = parse_address(captain.trim())
        .map_err(|e| wallet_err_json("INVALID_CAPTAIN", e, None))?;

    let meta = metadata_uri.trim().to_string();
    if meta.is_empty() {
        return Err(wallet_err_json(
            "INVALID_METADATA",
            "metadata_uri must be non-empty",
            None,
        ));
    }

    let salt = parse_salt_nonce(salt_nonce)
        .map_err(|e| wallet_err_json("INVALID_SALT_NONCE", e, None))?;

    let squad_params = SquadParams {
        crewChangeDelay: U256::from(DEFAULT_CREW_CHANGE_DELAY_SEC),
        proposalExpiry: U256::from(DEFAULT_PROPOSAL_EXPIRY_SEC),
        crewVoteMode: CrewVoteMode::MAJORITY_SNAPSHOT,
        quorumBps: U256::from(DEFAULT_QUORUM_BPS),
    };

    let params = DeployParams {
        captain: captain_addr,
        metadataURI: meta.clone(),
        squadParams: squad_params,
        quartermasterMasterCopy: addrs.master_quartermaster,
        mutinyMasterCopy: addrs.master_mutiny,
        treasuryAuthorityMasterCopy: addrs.master_treasury_authority,
        squadAdminImplementation: addrs.master_squad_admin_impl,
        saltNonce: salt,
    };

    let calldata = deployNavePirataCall { _params: params }.abi_encode();
    let factory = addrs.nave_pirata_factory;

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    require_roster_treasury_signing_allowed(app.clone(), pid).await?;
    let (_signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;
    let provider = connect_signing_provider(&urls, wallet).await?;

    let tx = contract_call_request(factory, calldata);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for confirmation.",
    )
    .await?;

    let (top_hat, _captain_out, safe_a, qm_a, mm_a, ta_a, admin_a) =
        nave_pirata_addresses_from_receipt(&receipt, factory).map_err(|e| {
            wallet_err_json_with_tx_hash(
                "PARSE_RECEIPT",
                e,
                None,
                format!("0x{:x}", receipt.transaction_hash),
            )
        })?;

    let top_hat_str = top_hat.to_string();
    let payload = json!({
        "v": 1,
        "parentId": parent_id.trim(),
        "safe": format!("{:#x}", safe_a),
        "quartermaster": format!("{:#x}", qm_a),
        "mutinyModule": format!("{:#x}", mm_a),
        "treasuryAuthority": format!("{:#x}", ta_a),
        "squadAdminProxy": format!("{:#x}", admin_a),
    })
    .to_string();

    Ok(NavePirataDeployResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        top_hat_id: top_hat_str,
        safe_address: format!("{:#x}", safe_a),
        quartermaster: format!("{:#x}", qm_a),
        mutiny_module: format!("{:#x}", mm_a),
        treasury_authority: format!("{:#x}", ta_a),
        squad_admin_proxy: format!("{:#x}", admin_a),
        provider_payload: payload,
    })
}
