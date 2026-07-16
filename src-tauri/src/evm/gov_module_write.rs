//! Shared squad-key contract call helper for Pacto Gov module writes.

use alloy::network::TransactionBuilder;
use alloy::primitives::Address;
use tauri::{AppHandle, Runtime};

use super::access_control::{require_capability, with_gov_write_lock, GovCapability};
use super::rpc::signer::{
    load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, send_and_confirm,
    wallet_err_json,
};
use super::sponsor_userop::{roster_native_balance_wei, send_sponsored_gov_userop};
use super::wallet_chain_config;
use crate::db;

pub async fn send_gov_module_call<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    to: Address,
    calldata: Vec<u8>,
    capability: GovCapability,
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
        return Err(wallet_err_json(
            "MISSING_PARENT",
            "parentId is required for squad-key governance writes",
            None,
        ));
    }

    require_capability(&app, pid, capability).await?;
    require_roster_treasury_signing_allowed(app.clone(), pid).await?;

    let _write_guard = with_gov_write_lock(pid).await;
    let (signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;

    // Prefer sponsored UserOp when roster has no ETH and sponsor infra exists.
    let read_provider = connect_read_provider(&urls).await?;
    let balance = roster_native_balance_wei(&read_provider, signer.address()).await?;
    if balance.is_zero() && db::parent_has_sponsor_infra(&app, pid).unwrap_or(false) {
        match send_sponsored_gov_userop(app.clone(), &net.key, pid, to, calldata.clone()).await {
            Ok(user_op_hash) => {
                return Ok((user_op_hash, net.key.clone(), net.chain_id));
            }
            Err(e) => {
                // Soft config gaps: surface a clear path. Hard sponsor rejects stay hard.
                if e.contains("BUNDLER_CONFIG") || e.contains("ERC4337_ACCOUNT_CONFIG") {
                    return Err(wallet_err_json(
                        "SPONSOR_PATH_UNAVAILABLE",
                        format!(
                            "Roster key has 0 ETH and sponsored UserOp is not fully configured ({e}). Fund the roster key or set BUNDLER_RPC_URL and PACTO_ERC4337_ACCOUNT_IMPL."
                        ),
                        None,
                    ));
                }
                return Err(e);
            }
        }
    }

    let provider = connect_signing_provider(&urls, wallet).await?;
    let tx = contract_call_request(to, calldata).with_chain_id(net.chain_id);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for governance confirmation. The transaction may still confirm — do not resubmit the same calldata; check the explorer with the returned tx hash.",
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
    if let Some(trimmed) = explicit_parent_id(parent_id) {
        if let Some(from_infra) =
            db::parent_id_for_canonical_infra_ref(app, module_address.trim())?
                .filter(|s| !s.trim().is_empty())
        {
            if from_infra.trim() != trimmed {
                return Err(wallet_err_json(
                    "PARENT_MISMATCH",
                    "client parentId does not match infra for this module",
                    None,
                ));
            }
        }
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

/// Non-empty trimmed parent id, if the caller supplied one.
pub fn explicit_parent_id(parent_id: &str) -> Option<&str> {
    let trimmed = parent_id.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::explicit_parent_id;

    #[test]
    fn explicit_parent_id_trims_and_rejects_empty() {
        assert_eq!(explicit_parent_id(" parent-1 "), Some("parent-1"));
        assert_eq!(explicit_parent_id(""), None);
        assert_eq!(explicit_parent_id("   "), None);
    }
}
