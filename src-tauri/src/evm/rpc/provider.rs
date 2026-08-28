use std::time::{Duration, Instant};

use alloy::network::{EthereumWallet, TransactionBuilder};
use alloy::primitives::{Address, Bytes, TxHash};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::{TransactionReceipt, TransactionRequest};

use super::config::RECEIPT_WAIT_TIMEOUT;
use super::errors::{wallet_err_from_send_failure, wallet_err_json, wallet_err_json_with_tx_hash};
use crate::evm::wallet_security;

/// Builds the client backing every alloy JSON-RPC provider this module
/// constructs, gated through the shared Tor transport switch. Alloy pins a
/// different major `reqwest` version (0.13) than the rest of this crate
/// (0.12, see `Cargo.toml`'s `reqwest013` comment), so this can't reuse
/// `net_transport::http_client_builder` -- it configures the same local
/// SOCKS address directly on alloy's own `reqwest` instance instead.
/// Without this, alloy's `.connect(url)` builds an unproxied client
/// internally, and wallet RPC calls (balance/gas reads, tx broadcasts,
/// receipt polling) would leak the caller's real IP alongside their EVM
/// address even with Tor routing enabled.
pub(crate) fn tor_aware_http_client() -> Result<reqwest013::Client, String> {
    let builder = reqwest013::Client::builder();
    match crate::net_transport::active_socks_addr() {
        Some(addr) => reqwest013::Proxy::all(format!("socks5h://{addr}"))
            .map(|proxy| builder.proxy(proxy))
            .map_err(|e| {
                format!(
                    "Tor routing is enabled but the local proxy could not be configured for the wallet RPC client: {e}"
                )
            }),
        None => Ok(builder),
    }
    .and_then(|b| b.build().map_err(|e| e.to_string()))
}

pub async fn connect_read_provider(urls: &[String]) -> Result<impl Provider + Clone, String> {
    let mut last_err = String::new();
    for url_s in urls {
        let parsed_url = match url_s.parse::<url::Url>() {
            Ok(u) => u,
            Err(_) => {
                last_err = "invalid RPC URL".to_string();
                continue;
            }
        };
        match tor_aware_http_client() {
            Ok(client) => return Ok(ProviderBuilder::new().connect_reqwest(client, parsed_url)),
            Err(e) => {
                last_err = wallet_security::redact_urls_in_text(&e);
                continue;
            }
        }
    }
    Err(wallet_err_json(
        "RPC_CONNECT",
        format!("tried {} URL(s), last error: {}", urls.len(), last_err),
        None,
    ))
}

/// Signing provider: gas + blob-gas + **pending** nonce (not cached) + chain id.
pub async fn connect_signing_provider(
    urls: &[String],
    wallet: EthereumWallet,
) -> Result<impl Provider + Clone, String> {
    let mut last_err = String::new();
    for url_s in urls {
        let parsed_url = match url_s.parse::<url::Url>() {
            Ok(u) => u,
            Err(_) => {
                last_err = "invalid RPC URL".to_string();
                continue;
            }
        };
        match tor_aware_http_client() {
            Ok(client) => {
                return Ok(ProviderBuilder::new()
                    .disable_recommended_fillers()
                    .with_gas_estimation()
                    .with_blob_gas_estimation()
                    .with_simple_nonce_management()
                    .fetch_chain_id()
                    .wallet(wallet.clone())
                    .connect_reqwest(client, parsed_url));
            }
            Err(e) => {
                last_err = wallet_security::redact_urls_in_text(&e);
                continue;
            }
        }
    }
    Err(wallet_err_json(
        "RPC_CONNECT",
        format!("tried {} URL(s), last error: {}", urls.len(), last_err),
        None,
    ))
}

fn is_nonce_too_low(err: &str) -> bool {
    err.to_ascii_lowercase().contains("nonce too low")
}

pub async fn send_transaction_only<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
) -> Result<String, String> {
    let pending = provider.send_transaction(tx).await.map_err(|e| {
        wallet_err_from_send_failure(&wallet_security::redact_urls_in_text(&e.to_string()))
    })?;
    Ok(format!("0x{:x}", *pending.tx_hash()))
}

async fn send_and_confirm_once<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    let pending = provider.send_transaction(tx).await.map_err(|e| {
        wallet_err_from_send_failure(&wallet_security::redact_urls_in_text(&e.to_string()))
    })?;

    let submitted_tx_hash = format!("0x{:x}", *pending.tx_hash());
    let receipt = pending
        .with_timeout(Some(RECEIPT_WAIT_TIMEOUT))
        .get_receipt()
        .await
        .map_err(|_| {
            wallet_err_json_with_tx_hash(
                "RECEIPT_TIMEOUT",
                format!(
                    "{receipt_timeout_message} Do not resubmit the same calldata; look up tx {submitted_tx_hash} on the explorer."
                ),
                None,
                submitted_tx_hash,
            )
        })?;

    if !receipt.status() {
        return Err(wallet_err_json_with_tx_hash(
            "TX_REVERTED",
            "Transaction was mined but reverted",
            None,
            format!("0x{:x}", receipt.transaction_hash),
        ));
    }

    Ok(receipt)
}

pub async fn send_and_confirm<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    match send_and_confirm_once(provider, tx.clone(), receipt_timeout_message).await {
        Ok(receipt) => Ok(receipt),
        Err(e) if is_nonce_too_low(&e) => {
            send_and_confirm_once(provider, tx, receipt_timeout_message).await
        }
        Err(e) => Err(e),
    }
}

pub async fn wait_for_transaction_receipt<P: Provider>(
    provider: &P,
    tx_hash: TxHash,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    let submitted = format!("0x{:x}", tx_hash);
    let deadline = Instant::now() + RECEIPT_WAIT_TIMEOUT;
    loop {
        let receipt = provider
            .get_transaction_receipt(tx_hash)
            .await
            .map_err(|e| {
                wallet_err_json(
                    "RECEIPT_POLL_FAILED",
                    wallet_security::redact_urls_in_text(&e.to_string()),
                    None,
                )
            })?;
        if let Some(receipt) = receipt {
            if !receipt.status() {
                return Err(wallet_err_json_with_tx_hash(
                    "TX_REVERTED",
                    "Transaction was mined but reverted",
                    None,
                    submitted,
                ));
            }
            return Ok(receipt);
        }
        if Instant::now() >= deadline {
            return Err(wallet_err_json_with_tx_hash(
                "RECEIPT_TIMEOUT",
                receipt_timeout_message,
                None,
                submitted,
            ));
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

pub fn contract_call_request(to: Address, calldata: Vec<u8>) -> TransactionRequest {
    TransactionRequest::default()
        .with_to(to)
        .with_input(Bytes::from(calldata))
}

#[cfg(test)]
mod tests {
    use super::is_nonce_too_low;

    #[test]
    fn nonce_too_low_matches_geth_and_wrapped_json() {
        assert!(is_nonce_too_low(
            "server returned an error response: error code -32000: nonce too low: next nonce 117, tx nonce 114"
        ));
        assert!(is_nonce_too_low(
            r#"{"code":"SEND_FAILED","message":"Nonce too low"}"#
        ));
        assert!(!is_nonce_too_low("insufficient funds"));
        assert!(!is_nonce_too_low("replacement transaction underpriced"));
    }
}
