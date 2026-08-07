//! Withdraw pro-rata ETH from a squad sponsor clone via `ISquadSponsorBase.withdraw()`.
//! Caller picks which local EVM account holds shares (msg.sender).

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, U256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::{withdrawCall, withdrawableCall};
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::load_embedded_signer_for_account_id;
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, parse_address,
    send_and_confirm, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::squad_sponsor_common::{require_parent_member, resolve_sponsor_for_parent};
use super::squad_sponsor_deposit::{require_network_config, require_non_empty_parent_id};
use super::squad_sponsor_read::read_sponsor_pool;

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

/// Parsed depositor address for the withdrawable read.
fn parse_depositor_address(raw: &str) -> Result<Address, String> {
    parse_address(raw.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))
}

/// Withdraw requires a positive withdrawable balance for the signing key.
fn ensure_withdrawable_shares(amount: U256) -> Result<(), String> {
    if amount.is_zero() {
        return Err(wallet_err_json(
            "NO_SHARES",
            "This EVM key does not have deposited funds to withdraw",
            None,
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_squad_sponsor_withdrawable<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    account_address: String,
    sponsor_address: Option<String>,
    rpc_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let pid = require_non_empty_parent_id(&parent_id)?;
    require_parent_member(&app, pid).await?;

    let depositor = parse_depositor_address(&account_address)?;

    let net = require_network_config(&network)?;
    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = rpc_urls_or_default(net, rpc_urls.clone());
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
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadSponsorWithdrawResult, String> {
    let pid = require_non_empty_parent_id(&parent_id)?;
    require_parent_member(&app, pid).await?;

    let net = require_network_config(&network)?;

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = rpc_urls_or_default(net, rpc_urls.clone());
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
    ensure_withdrawable_shares(withdrawable)?;

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
    let (pool_balance, _, _, _) =
        read_sponsor_pool(&read_provider, sponsor)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn err_code(err: &str) -> String {
        serde_json::from_str::<serde_json::Value>(err)
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(String::from))
            .unwrap_or_default()
    }

    const ADDR_A: &str = "0x1111111111111111111111111111111111111111";

    #[test]
    fn parse_depositor_address_rejects_malformed() {
        let err = parse_depositor_address("not-an-address").unwrap_err();
        assert_eq!(err_code(&err), "INVALID_ADDRESS");
        assert_eq!(
            parse_depositor_address(&format!("  {ADDR_A}  ")).unwrap(),
            parse_address(ADDR_A).unwrap()
        );
    }

    #[test]
    fn ensure_withdrawable_shares_requires_positive_balance() {
        let err = ensure_withdrawable_shares(U256::ZERO).unwrap_err();
        assert_eq!(err_code(&err), "NO_SHARES");
        assert!(ensure_withdrawable_shares(U256::from(1u64)).is_ok());
    }

    #[test]
    fn withdraw_calldata_is_bare_selector() {
        assert_eq!(withdrawCall {}.abi_encode(), withdrawCall::SELECTOR);
    }
}
