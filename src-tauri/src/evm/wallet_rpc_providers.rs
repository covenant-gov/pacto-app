//! Operator RPC providers: one API key → per-chain URLs.
//! Keep host map aligned with `src/lib/wallet/rpc-providers.ts`.

const ALCHEMY_KEY_ENV: &str = "ALCHEMY_RPC_KEY";

fn alchemy_host_for_network_key(network_key: &str) -> Option<&'static str> {
    match network_key {
        "mainnet" => Some("eth-mainnet"),
        "sepolia" => Some("eth-sepolia"),
        "arbitrum" => Some("arb-mainnet"),
        _ => None,
    }
}

fn alchemy_url(network_key: &str, api_key: &str) -> Option<String> {
    let key = api_key.trim();
    if key.is_empty() {
        return None;
    }
    let host = alchemy_host_for_network_key(network_key)?;
    Some(format!("https://{host}.g.alchemy.com/v2/{key}"))
}

/// Primary RPC URL from `ALCHEMY_RPC_KEY` (and future provider keys), if configured.
pub fn provider_primary_rpc_url(network_key: &str) -> Option<String> {
    let api_key = std::env::var(ALCHEMY_KEY_ENV).ok()?;
    alchemy_url(network_key, &api_key)
}

/// Ethereum mainnet URL for Chainlink price feed reads.
pub fn mainnet_provider_rpc_url() -> Option<String> {
    provider_primary_rpc_url("mainnet")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alchemy_url_uses_host_map() {
        std::env::set_var(ALCHEMY_KEY_ENV, "test-key");
        let url = provider_primary_rpc_url("sepolia").unwrap();
        assert_eq!(
            url,
            "https://eth-sepolia.g.alchemy.com/v2/test-key"
        );
        std::env::remove_var(ALCHEMY_KEY_ENV);
    }

    #[test]
    fn missing_key_returns_none() {
        std::env::remove_var(ALCHEMY_KEY_ENV);
        assert!(provider_primary_rpc_url("mainnet").is_none());
    }
}
