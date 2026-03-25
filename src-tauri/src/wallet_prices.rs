//! USD display prices via Chainlink Data Feeds (on-chain oracles).
//!
//! Reads AggregatorV3 `latestRoundData` over JSON-RPC. No static price fallbacks:
//! if RPC fails or data is invalid, the command returns an error so the UI can
//! explain that live oracle data is unavailable.
//!
//! Reference: <https://docs.chain.link/data-feeds/using-data-feeds>
//! Feed addresses (Ethereum mainnet, standard proxies): data.chain.link

use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::json;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::wallet_security;

/// Ethereum mainnet — ETH / USD (8 decimals typical; always read `decimals()`).
const FEED_ETH_USD: &str = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
/// Ethereum mainnet — USDC / USD
const FEED_USDC_USD: &str = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
/// Ethereum mainnet — USDT / USD
const FEED_USDT_USD: &str = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D";

/// `latestRoundData()` selector
const SEL_LATEST_ROUND: &str = "0xfeaf968c";
/// `decimals()` selector
const SEL_DECIMALS: &str = "0x313ce567";

const CACHE_TTL: Duration = Duration::from_secs(90);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Default read-only Ethereum RPC for Chainlink calls only (no API keys in repo).
/// Override with `PACTO_CHAINLINK_PRICE_RPC_URL` or `PACTO_WALLET_RPC_MAINNET`.
const DEFAULT_ETH_MAINNET_RPC: &str = "https://ethereum.publicnode.com";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletUsdSpotPrices {
    pub eth_usd: f64,
    pub usdc_usd: f64,
    pub usdt_usd: f64,
    /// Always `chainlink` on success.
    pub source: String,
    /// Where feeds were read (Ethereum mainnet aggregator contracts).
    pub feed_network: String,
    pub fetched_at_ms_epoch: i64,
}

struct CacheEntry {
    prices: WalletUsdSpotPrices,
    valid_at: Instant,
}

static PRICE_CACHE: Lazy<Mutex<Option<CacheEntry>>> = Lazy::new(|| Mutex::new(None));

fn now_ms_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn price_rpc_url() -> String {
    if let Ok(u) = std::env::var("PACTO_CHAINLINK_PRICE_RPC_URL") {
        let t = u.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    if let Ok(u) = std::env::var("PACTO_WALLET_RPC_MAINNET") {
        let first = u.split(',').map(|s| s.trim()).find(|s| !s.is_empty());
        if let Some(url) = first {
            return url.to_string();
        }
    }
    DEFAULT_ETH_MAINNET_RPC.to_string()
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
    let client = reqwest::Client::builder()
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

    let resp = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            wallet_security::redact_urls_in_text(&format!("RPC request failed: {}", e))
        })?;

    let status = resp.status();
    let j: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| {
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

/// Returns cached prices if fresh; otherwise reads Chainlink on Ethereum mainnet.
#[tauri::command]
pub async fn wallet_get_usd_spot_prices() -> Result<WalletUsdSpotPrices, String> {
    {
        let guard = PRICE_CACHE
            .lock()
            .map_err(|e| format!("price cache lock: {}", e))?;
        if let Some(ref entry) = *guard {
            if entry.valid_at.elapsed() < CACHE_TTL {
                return Ok(entry.prices.clone());
            }
        }
    }

    let rpc = price_rpc_url();
    let eth = read_feed_usd(&rpc, FEED_ETH_USD).await?;
    let usdc = read_feed_usd(&rpc, FEED_USDC_USD).await?;
    let usdt = read_feed_usd(&rpc, FEED_USDT_USD).await?;

    let prices = WalletUsdSpotPrices {
        eth_usd: eth,
        usdc_usd: usdc,
        usdt_usd: usdt,
        source: "chainlink".to_string(),
        feed_network: "ethereum-mainnet".to_string(),
        fetched_at_ms_epoch: now_ms_epoch(),
    };

    {
        let mut guard = PRICE_CACHE
            .lock()
            .map_err(|e| format!("price cache lock: {}", e))?;
        *guard = Some(CacheEntry {
            prices: prices.clone(),
            valid_at: Instant::now(),
        });
    }

    Ok(prices)
}
