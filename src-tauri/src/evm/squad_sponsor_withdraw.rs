//! Withdraw pro-rata ETH from a squad sponsor clone via `ISquadSponsorBase.withdraw()`.
//! Caller picks which local EVM account holds shares (msg.sender).

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, U256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::{withdrawCall, withdrawableCall};
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::load_embedded_signer_for_account_id;
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, parse_address,
    send_and_confirm, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::squad_sponsor_common::{
    read_squad_record, require_parent_member, squad_id_from_parent_id,
};
use super::squad_sponsor_read::read_sponsor_pool;
use super::wallet_chain_config;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorWithdrawResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub sponsor_address: String,
    pub signer_address: String,
    pub pool_balance_wei: String,
}

async fn resolve_sponsor_for_parent<P: alloy::providers::Provider>(
    provider: &P,
    factory: Address,
    parent_id: &str,
    sponsor_address: Option<&str>,
) -> Result<Address, String> {
    let squad_id = squad_id_from_parent_id(parent_id);
    if let Some(raw) = sponsor_address.map(str::trim).filter(|s| !s.is_empty()) {
        let addr = parse_address(raw).map_err(|e| wallet_err_json("INVALID_SPONSOR", e, None))?;
        let (reg, _, _) = read_squad_record(provider, factory, squad_id)
            .await
            .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
        if reg != addr {
            return Err(wallet_err_json(
                "SPONSOR_REGISTRY",
                "sponsor address does not match factory registry for parent id",
                None,
            ));
        }
        return Ok(addr);
    }
    read_squad_record(provider, factory, squad_id)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))
        .map(|(addr, _, _)| addr)
}

#[tauri::command]
pub async fn get_squad_sponsor_withdrawable<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    account_address: String,
    sponsor_address: Option<String>,
) -> Result<String, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }
    require_parent_member(&app, pid).await?;

    let depositor = parse_address(account_address.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };
    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let read_provider = connect_read_provider(&urls).await?;
    let sponsor = resolve_sponsor_for_parent(
        &read_provider,
        addrs.squad_sponsor_factory,
        pid,
        sponsor_address.as_deref(),
    )
    .await?;

    let amount: U256 = eth_call_decode(
        &read_provider,
        sponsor,
        &withdrawableCall { sponsor: depositor },
    )
    .await
    .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    Ok(amount.to_string())
}

#[tauri::command]
pub async fn withdraw_squad_sponsor<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    account_id: String,
    sponsor_address: Option<String>,
) -> Result<SquadSponsorWithdrawResult, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }
    require_parent_member(&app, pid).await?;

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let (signer, wallet) = load_embedded_signer_for_account_id(app.clone(), &account_id).await?;
    let signer_addr = signer.address();

    let read_provider = connect_read_provider(&urls).await?;
    let sponsor = resolve_sponsor_for_parent(
        &read_provider,
        addrs.squad_sponsor_factory,
        pid,
        sponsor_address.as_deref(),
    )
    .await?;

    let withdrawable: U256 = eth_call_decode(
        &read_provider,
        sponsor,
        &withdrawableCall {
            sponsor: signer_addr,
        },
    )
    .await
    .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    if withdrawable.is_zero() {
        return Err(wallet_err_json(
            "NO_SHARES",
            "This EVM key does not have deposited funds to withdraw",
            None,
        ));
    }

    let provider = connect_signing_provider(&urls, wallet).await?;
    let calldata = withdrawCall {}.abi_encode();
    let tx = contract_call_request(sponsor, calldata).with_chain_id(net.chain_id);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for sponsor withdraw confirmation.",
    )
    .await?;

    let read_provider = connect_read_provider(&urls).await?;
    let (pool_balance, _, _, _) = read_sponsor_pool(&read_provider, sponsor)
        .await
        .map_err(|e| {
            wallet_err_json_with_tx_hash(
                "SPONSOR_READ",
                e,
                None,
                format!("0x{:x}", receipt.transaction_hash),
            )
        })?;

    Ok(SquadSponsorWithdrawResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        sponsor_address: format!("{:#x}", sponsor),
        signer_address: format!("{:#x}", signer_addr),
        pool_balance_wei: pool_balance.to_string(),
    })
}
