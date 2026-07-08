//! Canonical embedded-wallet chain and asset table.
//!
//! Loads [`wallet-assets.json`](../../../src/lib/wallet/wallet-assets.json) at **compile time** so
//! token addresses, decimals, explorer URLs, and display names stay aligned with the Svelte/viem
//! layer. Numeric chain IDs and default RPC URL lists live here (JSON has no chain id field).
//!
//! Env: `ALCHEMY_RPC_KEY` builds `https://{host}.g.alchemy.com/v2/{key}` per network (see `wallet_rpc_providers.rs`).
//! Without a key, public defaults apply. See `docs/wallet/RPC_AND_VIEM_ARCHITECTURE.md`.

use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;

const EMBEDDED_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/lib/wallet/wallet-assets.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Root {
    #[allow(dead_code)]
    version: u32,
    networks: HashMap<String, NetworkJson>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkJson {
    #[allow(dead_code)]
    viem_chain_key: String,
    display_name: String,
    explorer_tx_path: String,
    native: NativeJson,
    tokens: HashMap<String, TokenJson>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeJson {
    #[allow(dead_code)]
    symbol: String,
    decimals: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenJson {
    address: String,
    decimals: u8,
}

/// Stable iteration order (must match product expectations and frontend `WALLET_ASSETS_CHAIN_IDS`).
/// `local` (Anvil) is a normal opt-in network in every build; the user must enable and
/// configure it in Settings → EVM, so nothing is auto-queried when Anvil is not running.
const NETWORK_KEYS: &[&str] = &["mainnet", "arbitrum", "sepolia", "local"];

fn chain_id_for_key(key: &str) -> Option<u64> {
    match key {
        "arbitrum" => Some(42_161),
        "local" => Some(31_337),
        "mainnet" => Some(1),
        "sepolia" => Some(11155111),
        _ => None,
    }
}

/// Defaults aligned with `src/lib/wallet/rpc-catalog.ts` `CURATED_RPC_URLS`.
fn default_rpc_urls_for_key(key: &str) -> Vec<&'static str> {
    match key {
        "arbitrum" => vec![
            "https://arb1.arbitrum.io/rpc",
            "https://arbitrum.publicnode.com",
        ],
        "local" => vec!["http://localhost:8545"],
        "mainnet" => vec![
            "https://ethereum.publicnode.com",
            "https://1rpc.io/eth",
        ],
        // `rpc.sepolia.org` often returns Cloudflare 522; prefer publicnode / 1rpc / drpc first.
        "sepolia" => vec![
            "https://ethereum-sepolia-rpc.publicnode.com",
            "https://1rpc.io/sepolia",
            "https://sepolia.drpc.org",
            "https://rpc2.sepolia.org",
            "https://rpc.sepolia.org",
        ],
        _ => vec![],
    }
}

/// One network row: chain id, RPC resolution, native + USDC/USDT from JSON.
#[derive(Clone, Debug)]
pub struct WalletNetworkConfig {
    pub key: String,
    pub chain_id: u64,
    /// Reserved for UI / explorer links.
    #[allow(dead_code)]
    pub display_name: String,
    /// Reserved for `explorer_url_for_tx` and in-app explorer actions.
    #[allow(dead_code)]
    pub explorer_tx_path: String,
    pub native_symbol: String,
    pub native_decimals: u8,
    pub usdc_address: String,
    pub usdt_address: String,
    pub usdc_decimals: u8,
    pub usdt_decimals: u8,
}

fn build_ordered_networks() -> Vec<WalletNetworkConfig> {
    let root: Root =
        serde_json::from_str(EMBEDDED_JSON).expect("parse src/lib/wallet/wallet-assets.json");
    let mut out = Vec::with_capacity(NETWORK_KEYS.len());
    for &k in NETWORK_KEYS {
        let net = root
            .networks
            .get(k)
            .unwrap_or_else(|| panic!("wallet-assets.json missing network {:?}", k));
        let usdc = net
            .tokens
            .get("USDC")
            .unwrap_or_else(|| panic!("wallet-assets.json {:?}: missing USDC", k));
        let usdt = net
            .tokens
            .get("USDT")
            .unwrap_or_else(|| panic!("wallet-assets.json {:?}: missing USDT", k));
        let chain_id = chain_id_for_key(k).unwrap_or_else(|| panic!("unknown chain id for {:?}", k));
        out.push(WalletNetworkConfig {
            key: k.to_string(),
            chain_id,
            display_name: net.display_name.clone(),
            explorer_tx_path: net.explorer_tx_path.clone(),
            native_symbol: net.native.symbol.clone(),
            native_decimals: net.native.decimals,
            usdc_address: usdc.address.clone(),
            usdt_address: usdt.address.clone(),
            usdc_decimals: usdc.decimals,
            usdt_decimals: usdt.decimals,
        });
    }
    out
}

static ORDERED_NETWORKS: Lazy<Vec<WalletNetworkConfig>> = Lazy::new(build_ordered_networks);

/// All configured networks in product order (includes `local` Anvil in every build).
pub fn wallet_networks() -> &'static [WalletNetworkConfig] {
    ORDERED_NETWORKS.as_slice()
}

/// Lookup by wallet network key (case-insensitive).
pub fn network_by_key(key: &str) -> Option<&'static WalletNetworkConfig> {
    let k = key.to_lowercase();
    wallet_networks().iter().find(|n| n.key == k)
}

/// Resolved RPC URL list: operator provider key + public fallbacks, or public defaults only.
pub fn rpc_urls_for(net: &WalletNetworkConfig) -> Vec<String> {
    if let Some(primary) = crate::evm::wallet_rpc_providers::provider_primary_rpc_url(&net.key) {
        let mut urls = vec![primary];
        for fallback in default_rpc_urls_for_key(&net.key) {
            if !urls.iter().any(|u| u == fallback) {
                urls.push(fallback.to_string());
            }
        }
        return urls;
    }
    default_rpc_urls_for_key(&net.key)
        .into_iter()
        .map(|s| s.to_string())
        .collect()
}

/// `explorer_tx_path` + `0x` hash (no double prefix). For “view on explorer” in the wallet UI.
#[allow(dead_code)]
pub fn explorer_url_for_tx(net: &WalletNetworkConfig, tx_hash_hex: &str) -> String {
    if net.explorer_tx_path.is_empty() {
        return String::new();
    }
    let h = tx_hash_hex.strip_prefix("0x").unwrap_or(tx_hash_hex);
    format!("{}0x{}", net.explorer_tx_path, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_network_is_in_wallet_networks() {
        let local = wallet_networks()
            .iter()
            .find(|n| n.key == "local")
            .expect("local network should be present");
        assert_eq!(local.chain_id, 31_337);
        assert_eq!(local.display_name, "Local Anvil");
        assert_eq!(local.native_symbol, "ETH");
        assert_eq!(local.native_decimals, 18);
        assert!(!local.usdc_address.is_empty(), "local USDC address is configured");
        assert!(!local.usdt_address.is_empty(), "local USDT address is configured");
        assert_eq!(local.usdc_decimals, 6);
        assert_eq!(local.usdt_decimals, 6);
    }

    #[test]
    fn network_by_key_is_case_insensitive_for_local() {
        for key in ["local", "LOCAL", "Local"] {
            let net = network_by_key(key).expect("local lookup should succeed");
            assert_eq!(net.key, "local", "key '{}' should resolve to local", key);
        }
    }

    #[test]
    fn network_by_key_rejects_anvil_alias() {
        assert!(network_by_key("anvil").is_none(), "only 'local' is canonical");
    }

    #[test]
    fn rpc_urls_for_local_ignores_alchemy_key() {
        let prev = std::env::var_os("ALCHEMY_RPC_KEY");
        std::env::set_var("ALCHEMY_RPC_KEY", "test-key");
        let _guard = EnvVarGuard("ALCHEMY_RPC_KEY", prev);
        let local = network_by_key("local").unwrap();
        assert_eq!(
            rpc_urls_for(local),
            vec!["http://localhost:8545".to_string()]
        );
    }

    struct EnvVarGuard(&'static str, Option<std::ffi::OsString>);
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.1 {
                Some(v) => std::env::set_var(self.0, v),
                None => std::env::remove_var(self.0),
            }
        }
    }

    #[test]
    fn explorer_url_for_tx_local_returns_empty() {
        let local = network_by_key("local").unwrap();
        assert_eq!(explorer_url_for_tx(local, "0xabc..."), "");
    }

    #[test]
    fn mainnet_network_is_in_wallet_networks() {
        let net = wallet_networks()
            .iter()
            .find(|n| n.key == "mainnet")
            .expect("mainnet should be present");
        assert_eq!(net.chain_id, 1);
    }

    #[test]
    fn network_by_key_unknown_returns_none() {
        assert!(network_by_key("unknown").is_none());
    }

    #[test]
    fn rpc_urls_for_network_includes_public_fallbacks() {
        let net = network_by_key("sepolia").unwrap();
        let urls = rpc_urls_for(net);
        assert!(!urls.is_empty());
        assert!(urls.iter().any(|u| u.contains("publicnode.com")));
    }

    #[test]
    fn explorer_url_for_tx_formats_hash_without_double_prefix() {
        let net = WalletNetworkConfig {
            key: "test".to_string(),
            chain_id: 1,
            display_name: "Test".to_string(),
            explorer_tx_path: "https://explorer.com/tx/".to_string(),
            native_symbol: "ETH".to_string(),
            native_decimals: 18,
            usdc_address: "".to_string(),
            usdt_address: "".to_string(),
            usdc_decimals: 6,
            usdt_decimals: 6,
        };
        assert_eq!(
            explorer_url_for_tx(&net, "0xdeadbeef"),
            "https://explorer.com/tx/0xdeadbeef"
        );
    }

    #[test]
    fn alchemy_key_injected_into_mainnet_urls() {
        let prev = std::env::var_os("ALCHEMY_RPC_KEY");
        std::env::set_var("ALCHEMY_RPC_KEY", "test-key");
        let _guard = EnvVarGuard("ALCHEMY_RPC_KEY", prev);
        let mainnet = network_by_key("mainnet").unwrap();
        let urls = rpc_urls_for(mainnet);
        assert!(urls.iter().any(|u| u.contains("g.alchemy.com")));
        assert!(urls.iter().any(|u| u.contains("publicnode.com")));
    }

}
