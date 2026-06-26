//! Embedded wallet: balances (`get_wallet_summary`) and send (`wallet_build_and_send_transaction`).
//! Chain/asset table: `wallet_chain_config` (compile-time `wallet-assets.json` + chain IDs + default RPC).

use alloy::network::{ReceiptResponse, TransactionBuilder};
use alloy::primitives::{utils::parse_units, Address, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::TransactionRequest;
use alloy::sol_types::SolCall;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::{AppHandle, Runtime};

use crate::db;
use super::contracts::erc20::IERC20;
use super::evm_accounts;
use super::rpc::signer::load_embedded_signer;
use super::wallet_chain_config;
use super::wallet_prices;
use super::wallet_security;

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
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WalletSummary {
    pub networks: Vec<WalletSummaryNetwork>,
    pub total_usd_approx: f64,
    pub prices: wallet_prices::WalletUsdSpotPrices,
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

use super::rpc::{call::eth_call_u256, parse_address, wallet_err_json};
use super::rpc::{connect_signing_provider, send_and_confirm};

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

/// Tauri command: per-network native balance plus any watched ERC-20 rows; USD total uses Chainlink for ETH/USDC/USDT only.
#[tauri::command]
pub async fn get_wallet_summary<R: Runtime>(
    app: AppHandle<R>,
    watched_erc20s: Vec<WatchedErc20Input>,
) -> Result<WalletSummary, String> {
    let _ = evm_accounts::ensure_ready(app.clone()).await;
    let _ = db::repair_evm_address_if_needed(&app).await;
    let addr_str = db::read_stored_evm_address(app.clone())?
        .ok_or_else(|| "No EVM address for this account. Log in again or set your wallet address.".to_string())?;
    let owner = parse_address(&addr_str)?;

    let prices = wallet_prices::wallet_get_usd_spot_prices()
        .await
        .map_err(|e| {
            wallet_security::redact_urls_in_text(&format!("USD prices unavailable: {}", e))
        })?;

    let mut networks_out = Vec::new();
    let mut total_usd = 0.0_f64;

    for net in wallet_chain_config::wallet_networks() {
        let urls = wallet_chain_config::rpc_urls_for(net);
        if urls.is_empty() {
            return Err(format!("{}: no RPC URL configured", net.key));
        }

        let erc20_rows = watched_erc20_rows_for_network_key(&net.key, &watched_erc20s)?;

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

        let (eth_raw, erc20_balances) = snapshot.ok_or_else(|| {
            format!(
                "{}: all {} RPC endpoint(s) failed (last: {})",
                net.key,
                urls.len(),
                last_err
            )
        })?;

        let eth_dec = format_decimal(eth_raw, net.native_decimals);
        let eth_usd = (prices.eth_usd * eth_dec.parse::<f64>().unwrap_or(0.0)).max(0.0);
        total_usd += eth_usd;

        let mut assets: Vec<WalletSummaryAsset> = vec![WalletSummaryAsset {
            symbol: net.native_symbol.clone(),
            balance_raw: eth_raw.to_string(),
            balance_decimal: eth_dec,
            usd_value: Some(eth_usd),
        }];

        for (sym, raw, dec) in erc20_balances {
            let dec_str = format_decimal(raw, dec);
            let usd_val = match sym.as_str() {
                "USDC" => Some((prices.usdc_usd * dec_str.parse::<f64>().unwrap_or(0.0)).max(0.0)),
                "USDT" => Some((prices.usdt_usd * dec_str.parse::<f64>().unwrap_or(0.0)).max(0.0)),
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
        });
    }

    Ok(WalletSummary {
        networks: networks_out,
        total_usd_approx: total_usd,
        prices,
    })
}

fn resolve_peer_send_address<R: Runtime>(app: &AppHandle<R>, to_npub: &str) -> Result<Address, String> {
    if to_npub.trim().is_empty() {
        return Err(wallet_err_json(
            "MISSING_RECIPIENT",
            "Recipient npub or EVM address is required.",
            None,
        ));
    }
    let dm_peer = db::get_dm_peer_evm_stored(app, to_npub)
        .map_err(|e| wallet_err_json("DB_ERROR", e, Some(to_npub.to_string())))?;
    let profile_peer = db::get_profile_evm_address(app, to_npub)
        .map_err(|e| wallet_err_json("DB_ERROR", e, Some(to_npub.to_string())))?;
    let peer_addr_opt = dm_peer.or(profile_peer);

    let Some(peer_raw) = peer_addr_opt else {
        log::warn!(
            target: "pacto_wallet",
            "wallet_build_and_send_transaction: missing evm_address for npub prefix={}…",
            to_npub.chars().take(16).collect::<String>()
        );
        return Err(wallet_err_json(
            "MISSING_PEER_EVM_ADDRESS",
            "This contact has no EVM payout address saved for this DM. Use Request wallet information in the wallet sidebar so they can share their address privately.",
            Some(to_npub.to_string()),
        ));
    };

    parse_address(&peer_raw).map_err(|e| {
        wallet_err_json(
            "INVALID_PEER_EVM_ADDRESS",
            e,
            Some(to_npub.to_string()),
        )
    })
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
) -> Result<WalletSendResult, String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let asset_up = asset.to_uppercase();
    if erc20_transfer.is_none()
        && asset_up != "ETH"
        && asset_up != "USDC"
        && asset_up != "USDT"
    {
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
    evm_accounts::require_squad_purpose_signer(app.clone()).await.map_err(|e| {
        wallet_err_json("SQUAD_SIGNER_REQUIRED", e, None)
    })?;

    let (_signer, wallet) = load_embedded_signer(app.clone()).await?;
    let provider = connect_signing_provider(&urls, wallet).await?;

    let tx = if asset_up == "ETH" && erc20_transfer.is_none() {
        let v = parse_units(&amount, net.native_decimals).map_err(|e| {
            wallet_err_json("INVALID_AMOUNT", format!("{}", e), None)
        })?;
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
        let v = parse_units(&amount, dec).map_err(|e| {
            wallet_err_json("INVALID_AMOUNT", format!("{}", e), None)
        })?;
        let token: Address = parse_address(token_addr_s).map_err(|e| {
            wallet_err_json("INVALID_TOKEN_ADDRESS", e, None)
        })?;
        let call = IERC20::transferCall {
            to: to_addr,
            amount: v.into(),
        };
        let input = call.abi_encode();
        TransactionRequest::default()
            .with_to(token.into())
            .with_input(Bytes::from(input))
    };

    let receipt = send_and_confirm(
        &provider,
        tx,
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
