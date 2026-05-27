//! Squad allowlisted contract sends (Phase I). Requires squad-purpose signer and allowlisted `to`.

use alloy::network::{ReceiptResponse, TransactionBuilder};
use alloy::primitives::Bytes;
use alloy::rpc::types::TransactionRequest;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::db;
use super::contract_call_params::{parse_data_hex, parse_value_wei};
use super::rpc::{connect_signing_provider, parse_address, send_and_confirm, wallet_err_json};
use super::rpc::signer::load_squad_roster_embedded_signer;
use super::wallet_chain_config;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadAllowlistedCallResult {
    pub tx_hash: String,
    pub network: String,
    pub chain_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_number: Option<String>,
}

#[tauri::command]
pub async fn evm_send_squad_allowlisted_contract_call<R: Runtime>(
    app: AppHandle<R>,
    parent_id: String,
    network: String,
    to: String,
    value_wei: String,
    data_hex: String,
) -> Result<SquadAllowlistedCallResult, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "MISSING_PARENT",
            "parent_id is required.",
            None,
        ));
    }
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

    let allowed = db::is_allowlisted_contract_target(&app, pid, &net.key, &format!("{:#x}", to_addr))
        .map_err(|e| wallet_err_json("ALLOWLIST_CHECK", e, None))?;
    if !allowed {
        return Err(wallet_err_json(
            "TARGET_NOT_ALLOWLISTED",
            "Target contract is not on the squad implicit or explicit allowlist for this parent and chain. Use Settings → Smart contract security to add it, or use an Advanced account for arbitrary calls.",
            None,
        ));
    }

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let (_signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;
    let provider = connect_signing_provider(&urls, wallet).await?;

    let tx = TransactionRequest::default()
        .with_to(to_addr.into())
        .with_value(value)
        .with_input(Bytes::from(data));

    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for confirmation. The transaction may still complete; check a block explorer using the hash below.",
    )
    .await?;

    Ok(SquadAllowlistedCallResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        network: net.key.clone(),
        chain_id: net.chain_id,
        block_number: receipt.block_number().map(|n| n.to_string()),
    })
}
