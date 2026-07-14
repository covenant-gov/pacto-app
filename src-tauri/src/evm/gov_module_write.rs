//! Shared squad-key contract call helper for Pacto Gov module writes.

use alloy::primitives::Address;
use tauri::{AppHandle, Runtime};

use super::rpc::{
    connect_signing_provider, contract_call_request, send_and_confirm, wallet_err_json,
};
use super::rpc::signer::{
    load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
};
use super::wallet_chain_config;
use crate::db;

pub async fn send_gov_module_call<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    to: Address,
    calldata: Vec<u8>,
) -> Result<(String, String, u64), String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let pid = parent_id.trim();
    if pid.is_empty() {
        // Fall back: resolve parent from any known infra canonical ref is caller's job.
        return Err(wallet_err_json(
            "MISSING_PARENT",
            "parentId is required for squad-key governance writes",
            None,
        ));
    }

    require_roster_treasury_signing_allowed(app.clone(), pid).await?;
    let (_signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;
    let provider = connect_signing_provider(&urls, wallet).await?;
    let tx = contract_call_request(to, calldata);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for governance transaction confirmation.",
    )
    .await?;

    Ok((
        format!("0x{:x}", receipt.transaction_hash),
        net.key.clone(),
        net.chain_id,
    ))
}

/// Prefer explicit parent_id; else look up from an infra address stored as canonical_ref.
pub fn resolve_parent_id_for_module<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    module_address: &str,
) -> Result<String, String> {
    let trimmed = parent_id.trim();
    if !trimmed.is_empty() {
        return Ok(trimmed.to_string());
    }
    db::parent_id_for_canonical_infra_ref(app, module_address.trim())?
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            wallet_err_json(
                "MISSING_PARENT",
                "could not resolve parent for governance write",
                None,
            )
        })
}
