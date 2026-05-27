//! Shared read-only governance context: network resolution + RPC provider.

use super::rpc::{connect_read_provider, wallet_err_json};
use super::wallet_chain_config;

pub struct GovReadNetwork {
    pub key: String,
    pub chain_id: u64,
    pub rpc_urls: Vec<String>,
}

pub fn resolve_gov_read_network(network: &str) -> Result<GovReadNetwork, String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };
    let urls: Vec<String> = wallet_chain_config::rpc_urls_for(net).to_vec();
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }
    Ok(GovReadNetwork {
        key: net.key.clone(),
        chain_id: net.chain_id,
        rpc_urls: urls,
    })
}

pub async fn connect_gov_read_provider(
    network: &str,
) -> Result<(impl alloy::providers::Provider + Clone, GovReadNetwork), String> {
    let ctx = resolve_gov_read_network(network)?;
    let provider = connect_read_provider(&ctx.rpc_urls).await?;
    Ok((provider, ctx))
}

pub fn parse_top_hat_id(raw: &str) -> Result<alloy::primitives::U256, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("top_hat_id must be non-empty".to_string());
    }
    if s.starts_with("0x") || s.starts_with("0X") {
        alloy::primitives::U256::from_str_radix(s.trim_start_matches("0x").trim_start_matches("0X"), 16)
            .map_err(|e| format!("invalid hex top_hat_id: {e}"))
    } else {
        alloy::primitives::U256::from_str_radix(s, 10)
            .map_err(|e| format!("invalid decimal top_hat_id: {e}"))
    }
}
