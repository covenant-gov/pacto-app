//! Embedded wallet: balances (`get_wallet_summary`) and send (`wallet_build_and_send_transaction`).
//! Chain/asset table: `wallet_chain_config` (compile-time `wallet-assets.json` + chain IDs + default RPC).

use alloy::network::{ReceiptResponse, TransactionBuilder};
use alloy::primitives::{utils::parse_units, Address, Bytes, TxHash, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::TransactionRequest;
use alloy::sol_types::SolCall;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Runtime};

use super::contracts::erc20::IERC20;
use super::evm_accounts;
use super::rpc::signer::load_embedded_signer;
use super::wallet_chain_config;
use super::wallet_prices;
use super::wallet_security;
use crate::db;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WalletSummaryAsset {
    pub symbol: String,
    pub balance_raw: String,
    pub balance_decimal: String,
    pub usd_value: Option<f64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WalletSummaryNetwork {
    pub network: String,
    pub chain_id: u64,
    pub assets: Vec<WalletSummaryAsset>,
    /// Set when this network could not be read (RPC down / unreachable). Other
    /// networks still populate so one failure never breaks the whole summary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Completeness of Chainlink pricing across enabled feed networks.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WalletUsdPricingStatus {
    Complete,
    Partial,
    Unavailable,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WalletSummary {
    pub networks: Vec<WalletSummaryNetwork>,
    /// Sum of priced assets; `null` when no feed succeeded.
    pub total_usd_approx: Option<f64>,
    pub usd_pricing_status: WalletUsdPricingStatus,
    /// Sample metadata from first successful feed; omitted when none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prices: Option<wallet_prices::WalletUsdSpotPrices>,
}

fn usd_pricing_status_from_feeds(
    prices_by_feed: &HashMap<String, Option<wallet_prices::WalletUsdSpotPrices>>,
) -> WalletUsdPricingStatus {
    let required = prices_by_feed.len();
    if required == 0 {
        return WalletUsdPricingStatus::Unavailable;
    }
    let ok = prices_by_feed.values().filter(|p| p.is_some()).count();
    if ok == 0 {
        WalletUsdPricingStatus::Unavailable
    } else if ok == required {
        WalletUsdPricingStatus::Complete
    } else {
        WalletUsdPricingStatus::Partial
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletSendResult {
    pub tx_hash: String,
    pub network: String,
    pub chain_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_number: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedErc20Input {
    pub network: String,
    pub symbol: String,
    pub address: String,
    pub decimals: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20TransferSpec {
    pub address: String,
    pub decimals: u8,
}

use super::rpc::{
    call::{eth_call_decode, eth_call_u256},
    parse_address, wallet_err_json,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, send_and_confirm, send_transaction_only,
    wait_for_transaction_receipt,
};

fn format_decimal(raw: U256, decimals: u8) -> String {
    use alloy::primitives::utils::format_units;
    format_units(raw, decimals).unwrap_or_else(|_| raw.to_string())
}

async fn erc20_balance(
    provider: &impl Provider,
    token: Address,
    owner: Address,
) -> Result<U256, String> {
    let call = IERC20::balanceOfCall { account: owner };
    eth_call_u256(provider, token, call.abi_encode()).await
}

/// Public RPCs often return HTTP 522 / gateway errors or time out; caller should try the next URL.
fn is_retryable_wallet_rpc_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("522")
        || m.contains("523")
        || m.contains("524")
        || m.contains("timeout")
        || m.contains("timed out")
        || m.contains("connection refused")
        || m.contains("connection reset")
        || m.contains("429")
        || m.contains("502")
        || m.contains("503")
        || m.contains("504")
}

fn watched_erc20_rows_for_network_key(
    net_key: &str,
    watched: &[WatchedErc20Input],
) -> Result<Vec<(String, Address, u8)>, String> {
    let mut out: Vec<(String, Address, u8)> = Vec::new();
    let mut seen_addr: HashSet<String> = HashSet::new();
    for r in watched {
        if r.network.to_lowercase() != net_key {
            continue;
        }
        let sym = r.symbol.trim().to_uppercase();
        if sym.is_empty() {
            return Err("Each watched token needs a symbol.".to_string());
        }
        let addr = parse_address(&r.address)?;
        let k = format!("{:x}", addr);
        if seen_addr.insert(k) {
            out.push((sym, addr, r.decimals));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

/// Native + watched ERC-20 balances for one network, trying each RPC URL in order.
/// Any failure is returned as `Err(String)` so the caller can record a per-network
/// error without aborting the whole summary.
async fn fetch_network_snapshot(
    net: &wallet_chain_config::WalletNetworkConfig,
    owner: Address,
    watched_erc20s: &[WatchedErc20Input],
) -> Result<(U256, Vec<(String, U256, u8)>), String> {
    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(format!("{}: no RPC URL configured", net.key));
    }

    let erc20_rows = watched_erc20_rows_for_network_key(&net.key, watched_erc20s)?;

    let mut last_err = String::new();
    let mut snapshot: Option<(U256, Vec<(String, U256, u8)>)> = None;

    'next_url: for url_s in &urls {
        if url_s.parse::<url::Url>().is_err() {
            last_err = "invalid RPC URL".to_string();
            continue;
        }

        let provider = match ProviderBuilder::new().connect(url_s.as_str()).await {
            Ok(p) => p,
            Err(e) => {
                last_err = wallet_security::redact_urls_in_text(&format!("{}", e));
                if !is_retryable_wallet_rpc_error(&last_err) {
                    return Err(format!("{}: RPC connect: {}", net.key, last_err));
                }
                continue;
            }
        };

        let eth_raw = match provider.get_balance(owner).await {
            Ok(v) => v,
            Err(e) => {
                let msg = wallet_security::redact_urls_in_text(&format!("{}", e));
                if is_retryable_wallet_rpc_error(&msg) {
                    last_err = format!("{} getBalance: {}", net.key, msg);
                    continue 'next_url;
                }
                return Err(format!("{} getBalance: {}", net.key, msg));
            }
        };

        let mut erc20_balances: Vec<(String, U256, u8)> = Vec::with_capacity(erc20_rows.len());
        for (sym, token_addr, dec) in &erc20_rows {
            let raw = match erc20_balance(&provider, *token_addr, owner).await {
                Ok(v) => v,
                Err(e) => {
                    if is_retryable_wallet_rpc_error(&e) {
                        last_err = e;
                        continue 'next_url;
                    }
                    return Err(e);
                }
            };
            erc20_balances.push((sym.clone(), raw, *dec));
        }

        snapshot = Some((eth_raw, erc20_balances));
        break;
    }

    snapshot.ok_or_else(|| {
        format!(
            "{}: all {} RPC endpoint(s) failed (last: {})",
            net.key,
            urls.len(),
            last_err
        )
    })
}

/// Tauri command: per-network native balance plus any watched ERC-20 rows; USD total uses Chainlink for ETH/USDC/USDT only.
/// Only `enabled_chains` are queried; an unreachable network becomes a per-network `error` row instead of failing the summary.
#[tauri::command]
pub async fn get_wallet_summary<R: Runtime>(
    app: AppHandle<R>,
    watched_erc20s: Vec<WatchedErc20Input>,
    enabled_chains: Vec<String>,
) -> Result<WalletSummary, String> {
    let _ = evm_accounts::ensure_ready(app.clone()).await;
    let _ = db::repair_evm_address_if_needed(&app).await;
    let addr_str = db::read_stored_evm_address(app.clone())?.ok_or_else(|| {
        "No EVM address for this account. Log in again or set your wallet address.".to_string()
    })?;
    let owner = parse_address(&addr_str)?;

    let enabled: HashSet<String> = enabled_chains.iter().map(|c| c.to_lowercase()).collect();

    // Dedupe Chainlink fetches by feed network (local→sepolia shares Sepolia feeds).
    // Distinct feeds run concurrently; candidates within each feed stay sequential.
    let mut feed_jobs: Vec<(String, String)> = Vec::new();
    let mut seen_feeds: HashSet<String> = HashSet::new();
    for net in wallet_chain_config::wallet_networks() {
        if !enabled.contains(net.key.as_str()) {
            continue;
        }
        let Ok(feed_key) = wallet_prices::resolve_feed_network(&net.key) else {
            continue;
        };
        if !seen_feeds.insert(feed_key.to_string()) {
            continue;
        }
        feed_jobs.push((feed_key.to_string(), net.key.clone()));
    }

    let price_results =
        futures_util::future::join_all(feed_jobs.into_iter().map(|(feed_key, sample_net)| async move {
            let fetched = wallet_prices::get_usd_spot_prices_for_network(&sample_net)
                .await
                .ok();
            (feed_key, fetched)
        }))
        .await;

    let mut prices_by_feed: HashMap<String, Option<wallet_prices::WalletUsdSpotPrices>> =
        HashMap::new();
    for (feed_key, fetched) in price_results {
        prices_by_feed.insert(feed_key, fetched);
    }
    let usd_pricing_status = usd_pricing_status_from_feeds(&prices_by_feed);

    let mut networks_out = Vec::new();
    let mut total_usd = 0.0_f64;
    let mut summary_prices: Option<wallet_prices::WalletUsdSpotPrices> = None;

    for net in wallet_chain_config::wallet_networks() {
        if !enabled.contains(net.key.as_str()) {
            continue;
        }

        let (eth_raw, erc20_balances) =
            match fetch_network_snapshot(net, owner, &watched_erc20s).await {
                Ok(snapshot) => snapshot,
                Err(e) => {
                    networks_out.push(WalletSummaryNetwork {
                        network: net.key.clone(),
                        chain_id: net.chain_id,
                        assets: Vec::new(),
                        error: Some(e),
                    });
                    continue;
                }
            };

        let prices = wallet_prices::resolve_feed_network(&net.key)
            .ok()
            .and_then(|fk| prices_by_feed.get(fk).and_then(|p| p.clone()));
        if summary_prices.is_none() {
            if let Some(ref p) = prices {
                summary_prices = Some(p.clone());
            }
        }

        let eth_dec = format_decimal(eth_raw, net.native_decimals);
        let eth_usd = prices.as_ref().map(|p| {
            (p.eth_usd * eth_dec.parse::<f64>().unwrap_or(0.0)).max(0.0)
        });
        if let Some(u) = eth_usd {
            total_usd += u;
        }

        let mut assets: Vec<WalletSummaryAsset> = vec![WalletSummaryAsset {
            symbol: net.native_symbol.clone(),
            balance_raw: eth_raw.to_string(),
            balance_decimal: eth_dec,
            usd_value: eth_usd,
        }];

        for (sym, raw, dec) in erc20_balances {
            let dec_str = format_decimal(raw, dec);
            let usd_val = match (sym.as_str(), prices.as_ref()) {
                ("USDC", Some(p)) => {
                    Some((p.usdc_usd * dec_str.parse::<f64>().unwrap_or(0.0)).max(0.0))
                }
                ("USDT", Some(p)) => {
                    Some((p.usdt_usd * dec_str.parse::<f64>().unwrap_or(0.0)).max(0.0))
                }
                ("USDC" | "USDT", None) => None,
                _ => None,
            };
            if let Some(u) = usd_val {
                total_usd += u;
            }
            assets.push(WalletSummaryAsset {
                symbol: sym,
                balance_raw: raw.to_string(),
                balance_decimal: dec_str,
                usd_value: usd_val,
            });
        }

        networks_out.push(WalletSummaryNetwork {
            network: net.key.clone(),
            chain_id: net.chain_id,
            assets,
            error: None,
        });
    }

    let total_usd_approx = match usd_pricing_status {
        WalletUsdPricingStatus::Unavailable => None,
        WalletUsdPricingStatus::Complete | WalletUsdPricingStatus::Partial => Some(total_usd),
    };

    Ok(WalletSummary {
        networks: networks_out,
        total_usd_approx,
        usd_pricing_status,
        prices: summary_prices,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvmNativeBalance {
    pub balance_raw: String,
    pub balance_decimal: String,
    pub symbol: String,
}

/// Native ETH balance for an arbitrary `0x` address on one wallet network key.
#[tauri::command]
pub async fn get_evm_native_balance(
    network: String,
    address: String,
) -> Result<EvmNativeBalance, String> {
    let owner = parse_address(address.trim())?;
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(format!("Unknown network: {}", network));
    };

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(format!("{}: no RPC URL configured", net.key));
    }

    let mut last_err = String::new();
    let mut eth_raw: Option<U256> = None;

    'next_url: for url_s in &urls {
        if url_s.parse::<url::Url>().is_err() {
            last_err = "invalid RPC URL".to_string();
            continue;
        }

        let provider = match ProviderBuilder::new().connect(url_s.as_str()).await {
            Ok(p) => p,
            Err(e) => {
                last_err = wallet_security::redact_urls_in_text(&format!("{}", e));
                if !is_retryable_wallet_rpc_error(&last_err) {
                    return Err(format!("{}: RPC connect: {}", net.key, last_err));
                }
                continue;
            }
        };

        match provider.get_balance(owner).await {
            Ok(v) => {
                eth_raw = Some(v);
                break 'next_url;
            }
            Err(e) => {
                let msg = wallet_security::redact_urls_in_text(&format!("{}", e));
                if is_retryable_wallet_rpc_error(&msg) {
                    last_err = format!("{} getBalance: {}", net.key, msg);
                    continue 'next_url;
                }
                return Err(format!("{} getBalance: {}", net.key, msg));
            }
        }
    }

    let eth_raw = eth_raw.ok_or_else(|| {
        format!(
            "{}: all {} RPC endpoint(s) failed (last: {})",
            net.key,
            urls.len(),
            last_err
        )
    })?;

    Ok(EvmNativeBalance {
        balance_raw: eth_raw.to_string(),
        balance_decimal: format_decimal(eth_raw, net.native_decimals),
        symbol: net.native_symbol.clone(),
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvmErc20Balance {
    pub balance_raw: String,
    pub balance_decimal: String,
    pub symbol: String,
    pub decimals: u8,
}

/// ERC-20 `balanceOf` + `symbol`/`decimals` for an arbitrary owner on one wallet network key.
#[tauri::command]
pub async fn get_evm_erc20_balance(
    network: String,
    token_address: String,
    owner_address: String,
) -> Result<EvmErc20Balance, String> {
    let token = parse_address(token_address.trim())?;
    let owner = parse_address(owner_address.trim())?;
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(format!("Unknown network: {}", network));
    };

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(format!("{}: no RPC URL configured", net.key));
    }

    let mut last_err = String::new();
    let mut out: Option<EvmErc20Balance> = None;

    'next_url: for url_s in &urls {
        if url_s.parse::<url::Url>().is_err() {
            last_err = "invalid RPC URL".to_string();
            continue;
        }

        let provider = match ProviderBuilder::new().connect(url_s.as_str()).await {
            Ok(p) => p,
            Err(e) => {
                last_err = wallet_security::redact_urls_in_text(&format!("{}", e));
                if !is_retryable_wallet_rpc_error(&last_err) {
                    return Err(format!("{}: RPC connect: {}", net.key, last_err));
                }
                continue;
            }
        };

        let bal = match erc20_balance(&provider, token, owner).await {
            Ok(v) => v,
            Err(e) => {
                if is_retryable_wallet_rpc_error(&e) {
                    last_err = format!("{} balanceOf: {}", net.key, e);
                    continue 'next_url;
                }
                return Err(format!("{} balanceOf: {}", net.key, e));
            }
        };

        let decimals = match eth_call_decode(&provider, token, &IERC20::decimalsCall {}).await {
            Ok(d) => d,
            Err(e) => {
                if is_retryable_wallet_rpc_error(&e) {
                    last_err = format!("{} decimals: {}", net.key, e);
                    continue 'next_url;
                }
                return Err(format!("{} decimals: {}", net.key, e));
            }
        };

        let symbol = match eth_call_decode(&provider, token, &IERC20::symbolCall {}).await {
            Ok(s) => s,
            Err(e) => {
                if is_retryable_wallet_rpc_error(&e) {
                    last_err = format!("{} symbol: {}", net.key, e);
                    continue 'next_url;
                }
                // Non-standard (bytes32) symbols — still return balance with a fallback ticker.
                short_token_label(&token)
            }
        };

        out = Some(EvmErc20Balance {
            balance_raw: bal.to_string(),
            balance_decimal: format_decimal(bal, decimals),
            symbol,
            decimals,
        });
        break 'next_url;
    }

    out.ok_or_else(|| {
        format!(
            "{}: all {} RPC endpoint(s) failed (last: {})",
            net.key,
            urls.len(),
            last_err
        )
    })
}

fn short_token_label(token: &Address) -> String {
    let s = format!("{:#x}", token);
    if s.len() < 10 {
        return s;
    }
    format!("{}…{}", &s[..6], &s[s.len() - 4..])
}

fn map_dm_peer_send_address(to_npub: &str, dm_peer: Option<&str>) -> Result<Address, String> {
    if to_npub.trim().is_empty() {
        return Err(wallet_err_json(
            "MISSING_RECIPIENT",
            "Recipient npub or EVM address is required.",
            None,
        ));
    }
    let Some(peer_raw) = dm_peer.map(str::trim).filter(|s| !s.is_empty()) else {
        log::warn!(
            target: "pacto_wallet",
            "wallet_build_and_send_transaction: missing dm_peer_evm for npub prefix={}…",
            to_npub.chars().take(16).collect::<String>()
        );
        return Err(wallet_err_json(
            "MISSING_PEER_EVM_ADDRESS",
            "This contact has no EVM payout address saved for this DM. Use Request wallet information in the wallet sidebar so they can share their address privately.",
            Some(to_npub.to_string()),
        ));
    };

    parse_address(peer_raw)
        .map_err(|e| wallet_err_json("INVALID_PEER_EVM_ADDRESS", e, Some(to_npub.to_string())))
}

fn resolve_peer_send_address<R: Runtime>(
    app: &AppHandle<R>,
    to_npub: &str,
) -> Result<Address, String> {
    let dm_peer = db::get_dm_peer_evm_stored(app, to_npub)
        .map_err(|e| wallet_err_json("DB_ERROR", e, Some(to_npub.to_string())))?;
    map_dm_peer_send_address(to_npub, dm_peer.as_deref())
}

/// Tauri command: resolve peer EVM from `to_npub`, **or** use `to_address_evm` when set (raw `0x` recipient from Settings).
/// When `to_address_evm` is non-empty after trim, it is the recipient and `to_npub` is ignored for resolution.
#[tauri::command]
pub async fn wallet_build_and_send_transaction<R: Runtime>(
    app: AppHandle<R>,
    to_npub: String,
    network: String,
    asset: String,
    amount: String,
    erc20_transfer: Option<Erc20TransferSpec>,
    to_address_evm: Option<String>,
    wait_for_confirmation: Option<bool>,
) -> Result<WalletSendResult, String> {
    crate::session::heartbeat();
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let wait_for_confirmation = wait_for_confirmation.unwrap_or(false);
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let asset_up = asset.to_uppercase();
    if erc20_transfer.is_none() && asset_up != "ETH" && asset_up != "USDC" && asset_up != "USDT" {
        return Err(wallet_err_json(
            "UNSUPPORTED_ASSET",
            format!("Unknown asset: {}", asset),
            None,
        ));
    }

    let to_addr = if let Some(hex) = to_address_evm {
        let t = hex.trim();
        if !t.is_empty() {
            parse_address(t).map_err(|e| {
                wallet_err_json(
                    "INVALID_TO_ADDRESS",
                    format!("Invalid recipient address: {}", e),
                    None,
                )
            })?
        } else {
            resolve_peer_send_address(&app, &to_npub)?
        }
    } else {
        resolve_peer_send_address(&app, &to_npub)?
    };

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let _ = evm_accounts::ensure_ready(app.clone()).await;
    evm_accounts::require_squad_purpose_signer(app.clone())
        .await
        .map_err(|e| wallet_err_json("SQUAD_SIGNER_REQUIRED", e, None))?;

    let (_signer, wallet) = load_embedded_signer(app.clone()).await?;
    let provider = connect_signing_provider(&urls, wallet).await?;

    let tx = if asset_up == "ETH" && erc20_transfer.is_none() {
        let v = parse_units(&amount, net.native_decimals)
            .map_err(|e| wallet_err_json("INVALID_AMOUNT", format!("{}", e), None))?;
        TransactionRequest::default()
            .with_to(to_addr.into())
            .with_value(v.into())
    } else {
        let (token_addr_s, dec) = if let Some(spec) = &erc20_transfer {
            (&spec.address[..], spec.decimals)
        } else if asset_up == "USDC" {
            (&net.usdc_address[..], net.usdc_decimals)
        } else if asset_up == "USDT" {
            (&net.usdt_address[..], net.usdt_decimals)
        } else {
            return Err(wallet_err_json(
                "UNSUPPORTED_ASSET",
                "ERC-20 transfers require a token address or a supported symbol.",
                None,
            ));
        };
        let v = parse_units(&amount, dec)
            .map_err(|e| wallet_err_json("INVALID_AMOUNT", format!("{}", e), None))?;
        let token: Address = parse_address(token_addr_s)
            .map_err(|e| wallet_err_json("INVALID_TOKEN_ADDRESS", e, None))?;
        let call = IERC20::transferCall {
            to: to_addr,
            amount: v.into(),
        };
        let input = call.abi_encode();
        TransactionRequest::default()
            .with_to(token.into())
            .with_input(Bytes::from(input))
    };

    let receipt_timeout_message =
        "Timed out waiting for confirmation. The transaction may still complete; check a block explorer using the hash below.";

    if wait_for_confirmation {
        let receipt = send_and_confirm(&provider, tx, receipt_timeout_message).await?;
        return Ok(WalletSendResult {
            tx_hash: format!("0x{:x}", receipt.transaction_hash),
            network: net.key.clone(),
            chain_id: net.chain_id,
            block_number: receipt.block_number().map(|n| n.to_string()),
        });
    }

    let tx_hash = send_transaction_only(&provider, tx).await?;
    Ok(WalletSendResult {
        tx_hash,
        network: net.key.clone(),
        chain_id: net.chain_id,
        block_number: None,
    })
}

#[tauri::command]
pub async fn wallet_wait_for_transaction(
    network: String,
    tx_hash: String,
) -> Result<WalletSendResult, String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };
    let hash = tx_hash.trim();
    if !hash.starts_with("0x") || hash.len() != 66 {
        return Err(wallet_err_json(
            "INVALID_TX_HASH",
            "Transaction hash must be 0x-prefixed 32-byte hex.",
            None,
        ));
    }
    let tx_hash: TxHash = hash
        .parse()
        .map_err(|_| wallet_err_json("INVALID_TX_HASH", "Invalid transaction hash.", None))?;
    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }
    let provider = connect_read_provider(&urls).await?;
    let receipt = wait_for_transaction_receipt(
        &provider,
        tx_hash,
        "Timed out waiting for confirmation. The transaction may still complete; check a block explorer using the hash below.",
    )
    .await?;
    Ok(WalletSendResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        network: net.key.clone(),
        chain_id: net.chain_id,
        block_number: receipt.block_number().map(|n| n.to_string()),
    })
}

#[cfg(test)]
mod resolve_peer_send_address_tests {
    use super::*;

    fn err_code(err: &str) -> String {
        let v: serde_json::Value = serde_json::from_str(err).expect("wallet err json");
        v.get("code")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string()
    }

    #[test]
    fn empty_npub_is_missing_recipient() {
        let err = map_dm_peer_send_address("", Some("0x1111111111111111111111111111111111111111"))
            .unwrap_err();
        assert_eq!(err_code(&err), "MISSING_RECIPIENT");
    }

    #[test]
    fn missing_peer_row_is_missing_peer_evm() {
        let err = map_dm_peer_send_address("npub1peer", None).unwrap_err();
        assert_eq!(err_code(&err), "MISSING_PEER_EVM_ADDRESS");
    }

    #[test]
    fn empty_peer_address_is_missing_peer_evm() {
        let err = map_dm_peer_send_address("npub1peer", Some("   ")).unwrap_err();
        assert_eq!(err_code(&err), "MISSING_PEER_EVM_ADDRESS");
    }

    #[test]
    fn invalid_peer_hex_is_invalid_peer_evm() {
        let err = map_dm_peer_send_address("npub1peer", Some("0xbad")).unwrap_err();
        assert_eq!(err_code(&err), "INVALID_PEER_EVM_ADDRESS");
    }

    #[test]
    fn valid_peer_resolves_address() {
        let addr = map_dm_peer_send_address(
            "npub1peer",
            Some("0x1111111111111111111111111111111111111111"),
        )
        .unwrap();
        assert_eq!(
            addr,
            parse_address("0x1111111111111111111111111111111111111111").unwrap()
        );
    }
}

#[cfg(test)]
mod usd_pricing_status_tests {
    use super::*;

    fn sample_prices() -> wallet_prices::WalletUsdSpotPrices {
        wallet_prices::WalletUsdSpotPrices {
            eth_usd: 1.0,
            usdc_usd: 1.0,
            usdt_usd: 1.0,
            source: "chainlink".into(),
            feed_network: "sepolia".into(),
            fetched_at_ms_epoch: 0,
        }
    }

    #[test]
    fn empty_feed_map_is_unavailable() {
        let map = HashMap::new();
        assert_eq!(
            usd_pricing_status_from_feeds(&map),
            WalletUsdPricingStatus::Unavailable
        );
    }

    #[test]
    fn all_none_is_unavailable() {
        let mut map = HashMap::new();
        map.insert("sepolia".into(), None);
        map.insert("mainnet".into(), None);
        assert_eq!(
            usd_pricing_status_from_feeds(&map),
            WalletUsdPricingStatus::Unavailable
        );
    }

    #[test]
    fn all_some_is_complete() {
        let mut map = HashMap::new();
        map.insert("sepolia".into(), Some(sample_prices()));
        map.insert("mainnet".into(), Some(sample_prices()));
        assert_eq!(
            usd_pricing_status_from_feeds(&map),
            WalletUsdPricingStatus::Complete
        );
    }

    #[test]
    fn mixed_is_partial() {
        let mut map = HashMap::new();
        map.insert("sepolia".into(), Some(sample_prices()));
        map.insert("mainnet".into(), None);
        assert_eq!(
            usd_pricing_status_from_feeds(&map),
            WalletUsdPricingStatus::Partial
        );
    }
}
