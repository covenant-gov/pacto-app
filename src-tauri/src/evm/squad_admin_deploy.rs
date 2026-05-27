//! Deploy a standalone Squad Admin clone via `INavePirataFactory`.
//!
//! Variants: `ext_standalone` (address-gated `SquadAdminExt`) or `captain_hat` (hat-gated `SquadAdmin`).

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::INavePirataFactory::{
    deploySquadAdminExtStandaloneCall, deploySquadAdminStandaloneCaptainHatCall,
};
use super::pacto_chain_config;
use super::rpc::{
    connect_signing_provider, contract_call_request, parse_address, send_and_confirm,
    wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::rpc::signer::{
    load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
};
use super::squad_sponsor_common::require_sponsor_infra_for_parent;
use super::wallet_chain_config;
use crate::db;

fn squad_admin_ext_deployed_topic0() -> B256 {
    B256::from_slice(
        keccak256("SquadAdminExtStandaloneDeployed(address,address,address)").as_slice(),
    )
}

fn squad_admin_captain_hat_deployed_topic0() -> B256 {
    B256::from_slice(
        keccak256("SquadAdminStandaloneDeployed(address,address,uint256)").as_slice(),
    )
}

fn address_from_topic(topic: &B256) -> Address {
    Address::from_slice(&topic.as_slice()[12..32])
}

fn u256_from_word(data: &[u8], word_index: usize) -> Result<U256, String> {
    let start = word_index
        .checked_mul(32)
        .ok_or_else(|| "word index overflow".to_string())?;
    let end = start
        .checked_add(32)
        .ok_or_else(|| "word offset overflow".to_string())?;
    if data.len() < end {
        return Err("log data too short".to_string());
    }
    Ok(U256::from_be_slice(&data[start..end]))
}

fn squad_admin_ext_from_log(
    log: &alloy::rpc::types::Log,
    factory: Address,
) -> Result<(Address, Address, Address), String> {
    if log.address() != factory {
        return Err("log address mismatch".to_string());
    }
    let topics = log.topics();
    if topics.first() != Some(&squad_admin_ext_deployed_topic0()) {
        return Err("unexpected event topic".to_string());
    }
    if topics.len() < 4 {
        return Err("SquadAdminExtStandaloneDeployed: expected 4 topics".to_string());
    }
    Ok((
        address_from_topic(&topics[1]),
        address_from_topic(&topics[2]),
        address_from_topic(&topics[3]),
    ))
}

fn squad_admin_captain_hat_from_log(
    log: &alloy::rpc::types::Log,
    factory: Address,
) -> Result<(Address, Address, U256), String> {
    if log.address() != factory {
        return Err("log address mismatch".to_string());
    }
    let topics = log.topics();
    if topics.first() != Some(&squad_admin_captain_hat_deployed_topic0()) {
        return Err("unexpected event topic".to_string());
    }
    if topics.len() < 3 {
        return Err("SquadAdminStandaloneDeployed: expected at least 3 topics".to_string());
    }
    let clone = address_from_topic(&topics[1]);
    let implementation = address_from_topic(&topics[2]);
    let captain_hat_id = u256_from_word(log.data().data.as_ref(), 0)?;
    Ok((clone, implementation, captain_hat_id))
}

fn parse_variant(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "ext_standalone" | "ext" => Ok("ext_standalone"),
        "captain_hat" | "captain-hat" => Ok("captain_hat"),
        other => Err(format!("unknown squad admin deploy variant: {other}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadAdminDeployResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub squad_admin_proxy: String,
    pub variant: String,
    pub owner: Option<String>,
    pub captain_hat_id: Option<String>,
    pub implementation: String,
    pub provider_payload: String,
    pub infra_row_id: String,
}

#[tauri::command]
pub async fn deploy_squad_admin_for_parent<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    variant: String,
    owner: Option<String>,
    captain_hat_id: Option<String>,
) -> Result<SquadAdminDeployResult, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }
    require_sponsor_infra_for_parent(&app, pid)?;

    let variant_key = parse_variant(variant.as_str())
        .map_err(|e| wallet_err_json("INVALID_VARIANT", e, None))?;

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
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
    let (signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;

    let calldata = match variant_key {
        "ext_standalone" => {
            let owner_addr = match owner.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(raw) => parse_address(raw)
                    .map_err(|e| wallet_err_json("INVALID_OWNER", e, None))?,
                None => signer.address(),
            };
            deploySquadAdminExtStandaloneCall {
                squadAdminExtImplementation: addrs.master_squad_admin_ext_impl,
                owner: owner_addr,
            }
            .abi_encode()
        }
        "captain_hat" => {
            let hat_raw = captain_hat_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    wallet_err_json(
                        "INVALID_CAPTAIN_HAT",
                        "captain_hat_id is required for captain_hat variant",
                        None,
                    )
                })?;
            let hat = U256::from_str_radix(hat_raw, 10).map_err(|_| {
                wallet_err_json(
                    "INVALID_CAPTAIN_HAT",
                    "captain_hat_id must be a decimal uint256",
                    None,
                )
            })?;
            if hat.is_zero() {
                return Err(wallet_err_json(
                    "INVALID_CAPTAIN_HAT",
                    "captain_hat_id must be non-zero",
                    None,
                ));
            }
            deploySquadAdminStandaloneCaptainHatCall {
                squadAdminImplementation: addrs.master_squad_admin_impl,
                captainHatId: hat,
            }
            .abi_encode()
        }
        _ => unreachable!(),
    };

    let provider = connect_signing_provider(&urls, wallet).await?;
    let tx = contract_call_request(factory, calldata);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for squad admin deploy confirmation.",
    )
    .await?;

    let (proxy, implementation, owner_out, captain_hat_out) = match variant_key {
        "ext_standalone" => {
            let mut parsed: Option<(Address, Address, Address)> = None;
            for log in receipt.logs() {
                if let Ok(v) = squad_admin_ext_from_log(log, factory) {
                    parsed = Some(v);
                    break;
                }
            }
            let (clone, owner_addr, impl_addr) = parsed.ok_or_else(|| {
                wallet_err_json_with_tx_hash(
                    "PARSE_RECEIPT",
                    "no SquadAdminExtStandaloneDeployed log from factory in receipt",
                    None,
                    format!("0x{:x}", receipt.transaction_hash),
                )
            })?;
            (
                clone,
                impl_addr,
                Some(format!("{:#x}", owner_addr)),
                None,
            )
        }
        "captain_hat" => {
            let mut parsed: Option<(Address, Address, U256)> = None;
            for log in receipt.logs() {
                if let Ok(v) = squad_admin_captain_hat_from_log(log, factory) {
                    parsed = Some(v);
                    break;
                }
            }
            let (clone, impl_addr, hat) = parsed.ok_or_else(|| {
                wallet_err_json_with_tx_hash(
                    "PARSE_RECEIPT",
                    "no SquadAdminStandaloneDeployed log from factory in receipt",
                    None,
                    format!("0x{:x}", receipt.transaction_hash),
                )
            })?;
            (clone, impl_addr, None, Some(hat.to_string()))
        }
        _ => unreachable!(),
    };

    let proxy_hex = format!("{:#x}", proxy);
    let impl_hex = format!("{:#x}", implementation);
    let payload = json!({
        "v": 1,
        "parentId": pid,
        "variant": variant_key,
        "squadAdminProxy": proxy_hex,
        "owner": owner_out,
        "captainHatId": captain_hat_out,
        "implementation": impl_hex,
        "txHash": format!("0x{:x}", receipt.transaction_hash),
    })
    .to_string();

    let infra_row_id = db::squad_admin_infra_row_id(pid);
    db::persist_squad_admin_infra(
        &app,
        pid,
        net.key.as_str(),
        proxy_hex.as_str(),
        payload.as_str(),
    )
    .map_err(|e| wallet_err_json("PERSIST_SQUAD_ADMIN", e, None))?;

    Ok(SquadAdminDeployResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        squad_admin_proxy: proxy_hex,
        variant: variant_key.to_string(),
        owner: owner_out,
        captain_hat_id: captain_hat_out,
        implementation: impl_hex,
        provider_payload: payload,
        infra_row_id,
    })
}
