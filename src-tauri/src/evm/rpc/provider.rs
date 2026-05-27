use alloy::network::{EthereumWallet, ReceiptResponse, TransactionBuilder};
use alloy::primitives::{Address, Bytes};
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
        return Err(wallet_err_json(
            "TX_REVERTED",
            "Transaction was mined but reverted",
            None,
        ));
    }

    Ok(receipt)
}

pub fn contract_call_request(to: Address, calldata: Vec<u8>) -> TransactionRequest {
    TransactionRequest::default()
        .with_to(to)
        .with_input(Bytes::from(calldata))
}
