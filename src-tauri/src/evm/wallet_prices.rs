//! USD display prices via Chainlink Data Feeds (on-chain oracles).
//!
//! Reads AggregatorV3 `latestRoundData` over JSON-RPC for the wallet network's
//! feed set (mainnet / Arbitrum / Sepolia). Anvil `local` aliases to Sepolia.
//! No static price fallbacks: if every RPC candidate fails, callers get an error.
//!
//! Reference: <https://docs.chain.link/data-feeds/using-data-feeds>
//! Feed addresses: <https://docs.chain.link/data-feeds/price-feeds/addresses>

use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::evm::wallet_security;

/// `latestRoundData()` selector
const SEL_LATEST_ROUND: &str = "0xfeaf968c";
/// `decimals()` selector
const SEL_DECIMALS: &str = "0x313ce567";

const CACHE_TTL: Duration = Duration::from_secs(90);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

struct FeedSet {
    eth: &'static str,
    usdc: &'static str,
    /// When equal to `usdc`, Sepolia reuses USDC/USD (no separate USDT feed).
    usdt: &'static str,
}

const FEEDS_MAINNET: FeedSet = FeedSet {
    eth: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    usdc: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
    usdt: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D",
};

const FEEDS_ARBITRUM: FeedSet = FeedSet {
    eth: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
    usdc: "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3",
    usdt: "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7",
};

/// Sepolia has no dedicated USDT/USD in the standard list; reuse USDC/USD.
const FEEDS_SEPOLIA: FeedSet = FeedSet {
    eth: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    usdc: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
    usdt: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
};

const PUBLIC_RPC_MAINNET: &[&str] = &["https://ethereum.publicnode.com", "https://1rpc.io/eth"];
const PUBLIC_RPC_ARBITRUM: &[&str] = &[
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum.publicnode.com",
];
const PUBLIC_RPC_SEPOLIA: &[&str] = &[
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://1rpc.io/sepolia",
    "https://rpc.sepolia.org",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletUsdSpotPrices {
    pub eth_usd: f64,
    pub usdc_usd: f64,
    pub usdt_usd: f64,
    /// Always `chainlink` on success.
    pub source: String,
    /// Resolved feed network: `ethereum-mainnet` | `arbitrum` | `sepolia`.
    pub feed_network: String,
    pub fetched_at_ms_epoch: i64,
}

struct CacheEntry {
    prices: WalletUsdSpotPrices,
    valid_at: Instant,
}

static PRICE_CACHE: Lazy<Mutex<HashMap<String, CacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn now_ms_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Map wallet network key → Chainlink feed network key (RPC + proxies).
pub fn resolve_feed_network(wallet_network_key: &str) -> Result<&'static str, String> {
    match wallet_network_key.trim().to_lowercase().as_str() {
        "mainnet" | "ethereum" | "eth" => Ok("mainnet"),
        "arbitrum" | "arb" | "arb1" => Ok("arbitrum"),
        "sepolia" => Ok("sepolia"),
        "local" | "anvil" | "hardhat" => Ok("sepolia"),
        other => Err(format!(
            "unsupported network for USD prices: {other} (use mainnet, arbitrum, sepolia, or local)"
        )),
    }
}

fn feed_network_label(feed_key: &str) -> &'static str {
    match feed_key {
        "mainnet" => "ethereum-mainnet",
        "arbitrum" => "arbitrum",
        "sepolia" => "sepolia",
        _ => "unknown",
    }
}

fn feed_set(feed_key: &str) -> Result<&'static FeedSet, String> {
    match feed_key {
        "mainnet" => Ok(&FEEDS_MAINNET),
        "arbitrum" => Ok(&FEEDS_ARBITRUM),
        "sepolia" => Ok(&FEEDS_SEPOLIA),
        other => Err(format!("no Chainlink feed set for {other}")),
    }
}

fn price_rpc_candidates(feed_key: &str) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(url) = crate::evm::wallet_rpc_providers::provider_primary_rpc_url(feed_key) {
        urls.push(url);
    }
    let public: &[&str] = match feed_key {
        "mainnet" => PUBLIC_RPC_MAINNET,
        "arbitrum" => PUBLIC_RPC_ARBITRUM,
        "sepolia" => PUBLIC_RPC_SEPOLIA,
        _ => &[],
    };
    for u in public {
        if !urls.iter().any(|existing| existing == u) {
            urls.push((*u).to_string());
        }
    }
    urls
}

fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return Err("odd hex length".into());
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = hex_nibble(bytes[i]).ok_or_else(|| "bad hex".to_string())?;
        let lo = hex_nibble(bytes[i + 1]).ok_or_else(|| "bad hex".to_string())?;
        out.push(hi << 4 | lo);
        i += 2;
    }
    Ok(out)
}

fn parse_u256_word(word32: &[u8]) -> Result<u128, String> {
    if word32.len() != 32 {
        return Err("expected 32-byte word".into());
    }
    let mut v = 0u128;
    for b in word32.iter() {
        v = (v << 8) | (*b as u128);
    }
    Ok(v)
}

/// Parse `int256` answer from latestRoundData; Chainlink USD prices are positive and fit in lower 16 bytes.
fn parse_positive_price_answer(word32: &[u8]) -> Result<u128, String> {
    if word32.len() != 32 {
        return Err("expected 32-byte word".into());
    }
    for &b in word32.iter().take(16) {
        if b != 0 {
            return Err("oracle answer out of supported range".into());
        }
    }
    if word32[16] & 0x80 != 0 {
        return Err("unexpected negative oracle answer".into());
    }
    let mut v = 0u128;
    for &b in word32.iter().skip(16) {
        v = (v << 8) | b as u128;
    }
    Ok(v)
}

fn answer_to_f64(answer: u128, decimals: u8) -> Result<f64, String> {
    let a = answer as f64;
    let div = 10f64.powi(decimals as i32);
    if !div.is_finite() || div <= 0.0 {
        return Err("invalid decimals".into());
    }
    let p = a / div;
    if !p.is_finite() || p < 0.0 {
        return Err("invalid price".into());
    }
    Ok(p)
}

async fn eth_call(rpc_url: &str, to: &str, data: &str) -> Result<Vec<u8>, String> {
    let client = crate::net_transport::http_client_builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent("PactoWallet/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [
            { "to": to, "data": data },
            "latest"
        ]
    });

    let resp =
        client.post(rpc_url).json(&body).send().await.map_err(|e| {
            wallet_security::redact_urls_in_text(&format!("RPC request failed: {}", e))
        })?;

    let status = resp.status();
    let j: serde_json::Value = resp.json().await.map_err(|e| {
        wallet_security::redact_urls_in_text(&format!("RPC response not JSON: {}", e))
    })?;

    if let Some(err) = j.get("error") {
        let msg = format!("RPC error: {}", err.get("message").unwrap_or(err));
        return Err(wallet_security::redact_urls_in_text(&msg));
    }

    if !status.is_success() {
        return Err(wallet_security::redact_urls_in_text(&format!(
            "RPC HTTP {}",
            status
        )));
    }

    let result = j
        .get("result")
        .and_then(|r| r.as_str())
        .ok_or_else(|| "missing result field".to_string())?;

    hex_decode(result)
}

async fn read_feed_usd(rpc_url: &str, feed: &str) -> Result<f64, String> {
    let dec_bytes = eth_call(rpc_url, feed, SEL_DECIMALS).await?;
    if dec_bytes.len() < 32 {
        return Err("decimals() return too short".into());
    }
    let dec_u = parse_u256_word(&dec_bytes[dec_bytes.len() - 32..])?;
    let decimals = u8::try_from(dec_u).map_err(|_| "decimals out of range".to_string())?;

    let data_bytes = eth_call(rpc_url, feed, SEL_LATEST_ROUND).await?;
    // (uint80, int256, uint256, uint256, uint80) → 5 * 32 bytes
    if data_bytes.len() < 160 {
        return Err("latestRoundData return too short".into());
    }
    let answer_word = &data_bytes[32..64];
    let ans = parse_positive_price_answer(answer_word)?;
    answer_to_f64(ans, decimals)
}

async fn read_all_feeds_usd(rpc_url: &str, feeds: &FeedSet) -> Result<(f64, f64, f64), String> {
    let eth = read_feed_usd(rpc_url, feeds.eth).await?;
    let usdc = read_feed_usd(rpc_url, feeds.usdc).await?;
    let usdt = if feeds.usdt.eq_ignore_ascii_case(feeds.usdc) {
        usdc
    } else {
        read_feed_usd(rpc_url, feeds.usdt).await?
    };
    Ok((eth, usdc, usdt))
}

/// Fetch (or return cached) Chainlink USD spots for a wallet network key.
pub async fn get_usd_spot_prices_for_network(
    wallet_network_key: &str,
) -> Result<WalletUsdSpotPrices, String> {
    let feed_key = resolve_feed_network(wallet_network_key)?;
    let feeds = feed_set(feed_key)?;
    let label = feed_network_label(feed_key).to_string();

    {
        let guard = PRICE_CACHE
            .lock()
            .map_err(|e| format!("price cache lock: {}", e))?;
        if let Some(entry) = guard.get(feed_key) {
            if entry.valid_at.elapsed() < CACHE_TTL {
                return Ok(entry.prices.clone());
            }
        }
    }

    let candidates = price_rpc_candidates(feed_key);
    if candidates.is_empty() {
        return Err(format!("no RPC candidates for feed network {feed_key}"));
    }

    let mut last_err = None;
    let mut triple = None;
    for rpc in &candidates {
        match read_all_feeds_usd(rpc, feeds).await {
            Ok(prices) => {
                triple = Some(prices);
                break;
            }
            Err(e) => last_err = Some(e),
        }
    }
    let (eth, usdc, usdt) = triple.ok_or_else(|| {
        last_err.unwrap_or_else(|| format!("USD prices unavailable on {feed_key}"))
    })?;

    let prices = WalletUsdSpotPrices {
        eth_usd: eth,
        usdc_usd: usdc,
        usdt_usd: usdt,
        source: "chainlink".to_string(),
        feed_network: label,
        fetched_at_ms_epoch: now_ms_epoch(),
    };

    {
        let mut guard = PRICE_CACHE
            .lock()
            .map_err(|e| format!("price cache lock: {}", e))?;
        guard.insert(
            feed_key.to_string(),
            CacheEntry {
                prices: prices.clone(),
                valid_at: Instant::now(),
            },
        );
    }

    Ok(prices)
}

/// Returns cached prices if fresh; otherwise reads Chainlink for `network_key`.
#[tauri::command]
pub async fn wallet_get_usd_spot_prices(
    network_key: String,
) -> Result<WalletUsdSpotPrices, String> {
    get_usd_spot_prices_for_network(&network_key).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_local_aliases_to_sepolia() {
        assert_eq!(resolve_feed_network("local").unwrap(), "sepolia");
        assert_eq!(resolve_feed_network("anvil").unwrap(), "sepolia");
        assert_eq!(resolve_feed_network("LOCAL").unwrap(), "sepolia");
    }

    #[test]
    fn resolve_known_networks() {
        assert_eq!(resolve_feed_network("mainnet").unwrap(), "mainnet");
        assert_eq!(resolve_feed_network("arbitrum").unwrap(), "arbitrum");
        assert_eq!(resolve_feed_network("sepolia").unwrap(), "sepolia");
    }

    #[test]
    fn resolve_unknown_errors() {
        assert!(resolve_feed_network("polygon").is_err());
    }

    #[test]
    fn sepolia_rpc_candidates_include_public_fallback() {
        let urls = price_rpc_candidates("sepolia");
        assert!(urls.iter().any(|u| u.contains("sepolia")));
    }

    #[test]
    fn sepolia_reuses_usdc_feed_for_usdt() {
        let set = feed_set("sepolia").unwrap();
        assert!(set.usdt.eq_ignore_ascii_case(set.usdc));
    }
}
