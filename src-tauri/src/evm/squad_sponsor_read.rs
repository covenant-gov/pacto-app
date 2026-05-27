//! Read-only squad sponsor pool state for Treasury (`eth_call` + native balance).

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::{
    paymasterCall, squadIdCall, totalSharesCall,
};
use super::pacto_chain_config;
use super::rpc::{call::eth_call_decode, connect_read_provider, parse_address, wallet_err_json};
use super::squad_sponsor_common::{read_squad_record, squad_id_from_parent_id, squad_variant_label};
use super::wallet_chain_config;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorSummary {
    pub chain: String,
    pub chain_id: u64,
    pub parent_id: String,
    pub squad_id: String,
    pub sponsor_address: String,
    pub paymaster_address: String,
    pub variant: String,
    pub top_hat_id: String,
    pub pool_balance_wei: String,
    pub total_shares: String,
}

pub(crate) async fn read_sponsor_pool<P: Provider>(
    provider: &P,
    sponsor: Address,
) -> Result<(U256, U256, Address, B256), String> {
    let total_shares = eth_call_decode(provider, sponsor, &totalSharesCall {}).await?;
    let balance = provider
        .get_balance(sponsor)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_BALANCE", e.to_string(), None))?;
    let pm: Address = eth_call_decode(provider, sponsor, &paymasterCall {}).await?;
    let sid: B256 = eth_call_decode(provider, sponsor, &squadIdCall {}).await?;
    Ok((balance, total_shares, pm, sid))
}

#[tauri::command]
pub async fn get_squad_sponsor_summary<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    parent_id: String,
    sponsor_address: Option<String>,
) -> Result<SquadSponsorSummary, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
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

    let provider = connect_read_provider(&urls).await?;
    let factory = addrs.squad_sponsor_factory;
    let squad_id = squad_id_from_parent_id(pid);

    let (sponsor, variant, top_hat) =
        if let Some(raw) = sponsor_address.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let addr =
                parse_address(raw).map_err(|e| wallet_err_json("INVALID_SPONSOR", e, None))?;
            let (reg, v, hat) = read_squad_record(&provider, factory, squad_id)
                .await
                .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
            if reg != addr {
                return Err(wallet_err_json(
                    "SPONSOR_REGISTRY",
                    "sponsor address does not match factory registry for parent id",
                    None,
                ));
            }
            (addr, v, hat)
        } else {
            read_squad_record(&provider, factory, squad_id)
                .await
                .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?
        };

    let (pool_balance, total_shares, paymaster, on_chain_squad_id) =
        read_sponsor_pool(&provider, sponsor)
            .await
            .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;

    if on_chain_squad_id != squad_id {
        return Err(wallet_err_json(
            "SQUAD_ID_MISMATCH",
            "sponsor clone squad id does not match parent id derivation",
            None,
        ));
    }

    let paymaster_display = if paymaster.is_zero() {
        addrs.pacto_sponsor_paymaster
    } else {
        paymaster
    };

    Ok(SquadSponsorSummary {
        chain: net.key.clone(),
        chain_id: net.chain_id,
        parent_id: pid.to_string(),
        squad_id: format!("{:#x}", squad_id),
        sponsor_address: format!("{:#x}", sponsor),
        paymaster_address: format!("{:#x}", paymaster_display),
        variant: squad_variant_label(variant).to_string(),
        top_hat_id: top_hat.to_string(),
        pool_balance_wei: pool_balance.to_string(),
        total_shares: total_shares.to_string(),
    })
}
