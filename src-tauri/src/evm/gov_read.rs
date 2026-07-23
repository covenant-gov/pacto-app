//! Shared read-only governance context: network resolution + RPC provider.

use super::rpc::{connect_read_provider, wallet_err_json};
use super::wallet_chain_config;

pub struct GovReadNetwork {
    pub key: String,
    pub chain_id: u64,
    pub rpc_urls: Vec<String>,
}

pub(crate) fn sanitize_rpc_urls(raw: Option<Vec<String>>) -> Vec<String> {
    let Some(list) = raw else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for url in list {
        let trimmed = url.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(trimmed);
    }
    out
}

/// Prefer non-empty FE override list; otherwise curated/operator defaults for `net`.
pub fn rpc_urls_or_default(
    net: &wallet_chain_config::WalletNetworkConfig,
    rpc_urls_override: Option<Vec<String>>,
) -> Vec<String> {
    let override_urls = sanitize_rpc_urls(rpc_urls_override);
    if !override_urls.is_empty() {
        override_urls
    } else {
        wallet_chain_config::rpc_urls_for(net).to_vec()
    }
}

pub fn resolve_gov_read_network(
    network: &str,
    rpc_urls_override: Option<Vec<String>>,
) -> Result<GovReadNetwork, String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };
    let urls = rpc_urls_or_default(net, rpc_urls_override);
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
    rpc_urls_override: Option<Vec<String>>,
) -> Result<(impl alloy::providers::Provider + Clone, GovReadNetwork), String> {
    let ctx = resolve_gov_read_network(network, rpc_urls_override)?;
    let provider = connect_read_provider(&ctx.rpc_urls).await?;
    Ok((provider, ctx))
}

#[cfg(test)]
mod tests {
    use super::{resolve_gov_read_network, sanitize_rpc_urls};

    #[test]
    fn sanitize_dedupes_and_trims() {
        let urls = sanitize_rpc_urls(Some(vec![
            " https://a.example/rpc ".into(),
            "https://a.example/rpc".into(),
            "".into(),
            "https://b.example/rpc".into(),
        ]));
        assert_eq!(urls, vec!["https://a.example/rpc", "https://b.example/rpc"]);
    }

    #[test]
    fn override_urls_win_over_defaults() {
        let ctx = resolve_gov_read_network(
            "sepolia",
            Some(vec!["https://custom.example/rpc".into()]),
        )
        .expect("resolve");
        assert_eq!(ctx.rpc_urls, vec!["https://custom.example/rpc"]);
    }

    #[test]
    fn override_list_preserves_order() {
        let ctx = resolve_gov_read_network(
            "sepolia",
            Some(vec![
                "https://first.example/rpc".into(),
                "https://second.example/rpc".into(),
            ]),
        )
        .expect("resolve");
        assert_eq!(
            ctx.rpc_urls,
            vec!["https://first.example/rpc", "https://second.example/rpc"]
        );
    }
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
