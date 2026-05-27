//! Send ETH to a squad sponsor clone via `ISquadSponsorBase.deposit()`.

use alloy::network::TransactionBuilder;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::depositCall;
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, parse_address,
    send_and_confirm, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::rpc::signer::{load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed};
use super::squad_sponsor_common::{parse_deposit_wei, read_squad_record, squad_id_from_parent_id};
use super::squad_sponsor_read::read_sponsor_pool;
use super::wallet_chain_config;
use super::pacto_chain_config;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorDepositResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub sponsor_address: String,
    pub amount_wei: String,
    pub pool_balance_wei: String,
}

#[tauri::command]
pub async fn deposit_squad_sponsor<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    amount_wei: String,
    sponsor_address: Option<String>,
) -> Result<SquadSponsorDepositResult, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }

    let amount = parse_deposit_wei(Some(amount_wei.as_str()))
        .map_err(|e| wallet_err_json("INVALID_AMOUNT", e, None))?;
    if amount.is_zero() {
        return Err(wallet_err_json(
            "INVALID_AMOUNT",
            "amount must be greater than zero",
            None,
        ));
    }

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
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    let read_provider = connect_read_provider(&urls).await?;
    let factory = addrs.squad_sponsor_factory;
    let squad_id = squad_id_from_parent_id(pid);

    let sponsor = if let Some(raw) = sponsor_address.as_deref().map(str::trim).filter(|s| !s.is_empty())
    {
        let addr =
            parse_address(raw).map_err(|e| wallet_err_json("INVALID_SPONSOR", e, None))?;
        let (reg, _, _) = read_squad_record(&read_provider, factory, squad_id)
            .await
            .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
        if reg != addr {
            return Err(wallet_err_json(
                "SPONSOR_REGISTRY",
                "sponsor address does not match factory registry for parent id",
                None,
            ));
        }
        addr
    } else {
        read_squad_record(&read_provider, factory, squad_id)
            .await
            .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?
            .0
    };

    require_roster_treasury_signing_allowed(app.clone(), pid).await?;
    let (_signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;
    let provider = connect_signing_provider(&urls, wallet).await?;

    let calldata = depositCall {}.abi_encode();
    let tx = contract_call_request(sponsor, calldata).with_value(amount);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for sponsor deposit confirmation.",
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

    Ok(SquadSponsorDepositResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        sponsor_address: format!("{:#x}", sponsor),
        amount_wei: amount.to_string(),
        pool_balance_wei: pool_balance.to_string(),
    })
}
