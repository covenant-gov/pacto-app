//! Advanced-purpose opaque contract calls (Phase H). Squad keys use curated commands instead.

use alloy::network::{ReceiptResponse, TransactionBuilder};
use alloy::primitives::Bytes;
use alloy::rpc::types::TransactionRequest;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contract_call_params::{parse_data_hex, parse_value_wei};
use super::evm_accounts;
use super::rpc::{
    connect_signing_provider, parse_address, send_and_confirm, send_transaction_only,
    wallet_err_json,
};
use super::rpc::signer::load_advanced_embedded_signer;
use super::wallet_chain_config;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedContractCallResult {
    pub tx_hash: String,
    pub network: String,
    pub chain_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_number: Option<String>,
}

#[tauri::command]
pub async fn evm_send_advanced_contract_call<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    to: String,
    value_wei: String,
    data_hex: String,
    wait_for_confirmation: Option<bool>,
) -> Result<AdvancedContractCallResult, String> {
    let wait_for_confirmation = wait_for_confirmation.unwrap_or(false);
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let to_addr = parse_address(to.trim())
        .map_err(|e| wallet_err_json("INVALID_TO_ADDRESS", e, None))?;
    let value = parse_value_wei(&value_wei).map_err(|e| wallet_err_json("INVALID_VALUE", e, None))?;
    let data = parse_data_hex(&data_hex).map_err(|e| wallet_err_json("INVALID_DATA", e, None))?;

    evm_accounts::require_advanced_purpose_signer(app.clone())
        .await
        .map_err(|e| wallet_err_json("ADVANCED_SIGNER_REQUIRED", e, None))?;

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let (_signer, wallet) = load_advanced_embedded_signer(app.clone()).await?;
    let provider = connect_signing_provider(&urls, wallet).await?;

    let tx = TransactionRequest::default()
        .with_to(to_addr.into())
        .with_value(value)
        .with_input(Bytes::from(data));

    let receipt_timeout_message =
        "Timed out waiting for confirmation. The transaction may still complete; check a block explorer using the hash below.";

    if wait_for_confirmation {
        let receipt = send_and_confirm(&provider, tx, receipt_timeout_message).await?;
        return Ok(AdvancedContractCallResult {
            tx_hash: format!("0x{:x}", receipt.transaction_hash),
            network: net.key.clone(),
            chain_id: net.chain_id,
            block_number: receipt.block_number().map(|n| n.to_string()),
        });
    }

    let tx_hash = send_transaction_only(&provider, tx).await?;
    Ok(AdvancedContractCallResult {
        tx_hash,
        network: net.key.clone(),
        chain_id: net.chain_id,
        block_number: None,
    })
}
