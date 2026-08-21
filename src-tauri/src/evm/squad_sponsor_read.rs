//! Read-only squad sponsor pool state for Treasury (`eth_call` + native balance).

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::{
    paymasterCall, poolCall, spendablePoolWeiCall, squadIdCall, totalSharesCall,
};
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config;
use super::rpc::{call::eth_call_decode, connect_read_provider, wallet_err_json};
use super::squad_sponsor_common::{
    active_game_squad_id_for_parent, resolve_sponsor_record_for_parent, squad_variant_label,
};
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

/// Parent pool behind an eligibility clone (`sponsor.pool()`). Shares and deposits live here.
pub(crate) async fn read_clone_pool<P: Provider>(
    provider: &P,
    sponsor: Address,
) -> Result<Address, String> {
    let pool: Address = eth_call_decode(provider, sponsor, &poolCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    if pool.is_zero() {
        return Err(wallet_err_json(
            "SPONSOR_READ",
            "sponsor clone has no pool",
            None,
        ));
    }
    Ok(pool)
}

/// Clone `spendablePoolWei` (forwards to the pool) plus pool `totalShares`.
pub(crate) async fn read_sponsor_pool<P: Provider>(
    provider: &P,
    sponsor: Address,
) -> Result<(U256, U256, Address, B256), String> {
    let spendable: U256 = eth_call_decode(provider, sponsor, &spendablePoolWeiCall {}).await?;
    let pm: Address = eth_call_decode(provider, sponsor, &paymasterCall {}).await?;
    let sid: B256 = eth_call_decode(provider, sponsor, &squadIdCall {}).await?;
    let total_shares = match read_clone_pool(provider, sponsor).await {
        Ok(pool) => eth_call_decode(provider, pool, &totalSharesCall {})
            .await
            .unwrap_or(U256::ZERO),
        Err(_) => U256::ZERO,
    };
    Ok((spendable, total_shares, pm, sid))
}

#[tauri::command]
pub async fn get_squad_sponsor_summary<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    sponsor_address: Option<String>,
    rpc_urls: Option<Vec<String>>,
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

    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let provider = connect_read_provider(&urls).await?;
    let factory = addrs.squad_sponsor_factory;
    let game_squad_id = active_game_squad_id_for_parent(&app, pid);
    let resolved = resolve_sponsor_record_for_parent(
        &provider,
        factory,
        pid,
        sponsor_address.as_deref(),
        game_squad_id,
    )
    .await?;
    let sponsor = resolved.address;
    let squad_id = resolved.squad_id;

    let (pool_balance, total_shares, paymaster, on_chain_squad_id) =
        read_sponsor_pool(&provider, sponsor)
            .await
            .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;

    if on_chain_squad_id != squad_id {
        return Err(wallet_err_json(
            "SQUAD_ID_MISMATCH",
            "sponsor clone squad id does not match factory registry key",
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
        variant: squad_variant_label(resolved.variant).to_string(),
        top_hat_id: resolved.top_hat_id.to_string(),
        pool_balance_wei: pool_balance.to_string(),
        total_shares: total_shares.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::keccak256;

    fn selector(signature: &str) -> [u8; 4] {
        let hash = keccak256(signature.as_bytes());
        [hash[0], hash[1], hash[2], hash[3]]
    }

    #[test]
    fn pool_and_spendable_selectors_match_solidity() {
        assert_eq!(poolCall {}.abi_encode(), selector("pool()").to_vec());
        assert_eq!(
            spendablePoolWeiCall {}.abi_encode(),
            selector("spendablePoolWei()").to_vec()
        );
        assert_eq!(
            totalSharesCall {}.abi_encode(),
            selector("totalShares()").to_vec()
        );
    }
}
