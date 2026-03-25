//! Canonical embedded-wallet chain and asset table.
//!
//! Loads [`wallet-assets.json`](../../../src/lib/wallet/wallet-assets.json) at **compile time** so
//! token addresses, decimals, explorer URLs, and display names stay aligned with the Svelte/viem
//! layer. Numeric chain IDs and default RPC URL lists live here (JSON has no chain id field).
//!
//! Env: `PACTO_WALLET_RPC_MAINNET`, `PACTO_WALLET_RPC_OPTIMISM`, `PACTO_WALLET_RPC_SEPOLIA`
//! (comma-separated fallbacks). See `docs/wallet/RPC_AND_VIEM_ARCHITECTURE.md`.

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
const NETWORK_KEYS: &[&str] = &["mainnet", "optimism", "sepolia"];

fn chain_id_for_key(key: &str) -> Option<u64> {
    match key {
        "mainnet" => Some(1),
        "optimism" => Some(10),
        "sepolia" => Some(11155111),
        _ => None,
    }
}

fn rpc_env_var_for_key(key: &str) -> Option<&'static str> {
    match key {
        "mainnet" => Some("PACTO_WALLET_RPC_MAINNET"),
        "optimism" => Some("PACTO_WALLET_RPC_OPTIMISM"),
        "sepolia" => Some("PACTO_WALLET_RPC_SEPOLIA"),
        _ => None,
    }
}

/// Defaults aligned with `src/lib/wallet/chains.ts` `DEFAULT_RPC_URLS`.
fn default_rpc_urls_for_key(key: &str) -> Vec<&'static str> {
    match key {
        "mainnet" => vec![
            "https://ethereum.publicnode.com",
            "https://1rpc.io/eth",
        ],
        "optimism" => vec![
            "https://mainnet.optimism.io",
            "https://optimism.publicnode.com",
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

/// All configured networks in product order (mainnet, optimism, sepolia).
pub fn wallet_networks() -> &'static [WalletNetworkConfig] {
    ORDERED_NETWORKS.as_slice()
}

/// Lookup by `mainnet` / `optimism` / `sepolia` (case-insensitive).
pub fn network_by_key(key: &str) -> Option<&'static WalletNetworkConfig> {
    let k = key.to_lowercase();
    wallet_networks().iter().find(|n| n.key == k)
}

/// Resolved RPC URL list: env override or defaults from this module.
pub fn rpc_urls_for(net: &WalletNetworkConfig) -> Vec<String> {
    if let Some(env_name) = rpc_env_var_for_key(&net.key) {
        if let Ok(u) = std::env::var(env_name) {
            let parts: Vec<String> = u
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !parts.is_empty() {
                return parts;
            }
        }
    }
    default_rpc_urls_for_key(&net.key)
        .into_iter()
        .map(|s| s.to_string())
        .collect()
}

/// `explorer_tx_path` + `0x` hash (no double prefix). For “view on explorer” in the wallet UI.
#[allow(dead_code)]
pub fn explorer_url_for_tx(net: &WalletNetworkConfig, tx_hash_hex: &str) -> String {
    let h = tx_hash_hex.strip_prefix("0x").unwrap_or(tx_hash_hex);
    format!("{}0x{}", net.explorer_tx_path, h)
}
