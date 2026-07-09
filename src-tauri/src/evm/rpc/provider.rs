use std::time::{Duration, Instant};

use alloy::network::{EthereumWallet, TransactionBuilder};
use alloy::primitives::{Address, Bytes, TxHash};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::{TransactionReceipt, TransactionRequest};

use crate::evm::wallet_security;
use super::config::RECEIPT_WAIT_TIMEOUT;
use super::errors::{wallet_err_json, wallet_err_json_with_tx_hash};

pub async fn connect_read_provider(
    urls: &[String],
) -> Result<impl Provider + Clone, String> {
    let mut last_err = String::new();
    for url_s in urls {
        if url_s.parse::<url::Url>().is_err() {
            last_err = "invalid RPC URL".to_string();
            continue;
        }
        match ProviderBuilder::new().connect(url_s.as_str()).await {
            Ok(p) => return Ok(p),
            Err(e) => last_err = wallet_security::redact_urls_in_text(&e.to_string()),
        }
    }
    Err(wallet_err_json(
        "RPC_CONNECT",
        format!("tried {} URL(s), last error: {}", urls.len(), last_err),
        None,
    ))
}

pub async fn connect_signing_provider(
    urls: &[String],
    wallet: EthereumWallet,
) -> Result<impl Provider + Clone, String> {
    let mut last_err = String::new();
    for url_s in urls {
        if url_s.parse::<url::Url>().is_err() {
            last_err = "invalid RPC URL".to_string();
            continue;
        }
        match ProviderBuilder::new()
            .wallet(wallet.clone())
            .connect(url_s.as_str())
            .await
        {
            Ok(p) => return Ok(p),
            Err(e) => last_err = wallet_security::redact_urls_in_text(&e.to_string()),
        }
    }
    Err(wallet_err_json(
        "RPC_CONNECT",
        format!("tried {} URL(s), last error: {}", urls.len(), last_err),
        None,
    ))
}

pub async fn send_transaction_only<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
) -> Result<String, String> {
    let pending = provider
        .send_transaction(tx)
        .await
        .map_err(|e| {
            wallet_err_json(
                "SEND_FAILED",
                wallet_security::redact_urls_in_text(&e.to_string()),
                None,
            )
        })?;
    Ok(format!("0x{:x}", *pending.tx_hash()))
}

pub async fn send_and_confirm<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    let pending = provider
        .send_transaction(tx)
        .await
        .map_err(|e| {
            wallet_err_json(
                "SEND_FAILED",
                wallet_security::redact_urls_in_text(&e.to_string()),
                None,
            )
        })?;

    let submitted_tx_hash = format!("0x{:x}", *pending.tx_hash());
    let receipt = pending
        .with_timeout(Some(RECEIPT_WAIT_TIMEOUT))
        .get_receipt()
        .await
        .map_err(|_| {
            wallet_err_json_with_tx_hash(
                "RECEIPT_TIMEOUT",
                receipt_timeout_message,
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

pub async fn wait_for_transaction_receipt<P: Provider>(
    provider: &P,
    tx_hash: TxHash,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    let submitted = format!("0x{:x}", tx_hash);
    let deadline = Instant::now() + RECEIPT_WAIT_TIMEOUT;
    loop {
        let receipt = provider.get_transaction_receipt(tx_hash).await.map_err(|e| {
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
