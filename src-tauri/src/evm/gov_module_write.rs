//! Shared squad-key contract call helper for Pacto Gov module writes.

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, U256};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use super::access_control::{require_capability, with_gov_write_lock, GovCapability};
use super::rpc::signer::{
    load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, send_and_confirm,
    wallet_err_json,
};
use super::sponsor_userop::{
    bundler_rpc_url, roster_native_balance_wei, send_sponsored_gov_userop,
    wait_for_user_operation_tx_hash,
};
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
    let has_sponsor_infra = db::parent_has_sponsor_infra(&app, pid).unwrap_or(false);
    // A failed balance lookup must not block writes: the sponsored path needs no roster
    // balance, but without sponsor infra there is no route for the write at all.
    let balance = match roster_native_balance_wei(&read_provider, signer.address()).await {
        Ok(balance) => balance,
        Err(e) if has_sponsor_infra => {
            log::warn!(target: "pacto_wallet", "roster balance lookup failed; trying sponsored path: {e}");
            U256::ZERO
        }
        Err(e) => {
            return Err(wallet_err_json(
                "BALANCE_LOOKUP",
                format!("roster balance check failed and no sponsor infra is configured, so the write can't be routed: {e}"),
                None,
            ));
        }
    };
    if balance.is_zero() && has_sponsor_infra {
        match send_sponsored_gov_userop(app.clone(), &net.key, pid, to, calldata.clone()).await {
            Ok(user_op_hash) => {
                // The write guard must stay held through inclusion: returning now would let
                // the next write reuse the same EntryPoint nonce. Callers expect a real L1
                // transaction hash, not the bundler userOp hash.
                let bundler = bundler_rpc_url().ok_or_else(|| {
                    wallet_err_json(
                        "BUNDLER_CONFIG",
                        "Set BUNDLER_RPC_URL for sponsored governance writes when the roster key has no ETH.",
                        None,
                    )
                })?;
                let tx_hash = wait_for_user_operation_tx_hash(&bundler, &user_op_hash).await?;
                return Ok((tx_hash, net.key.clone(), net.chain_id));
            }
            Err(e) => {
                // Soft config gaps: surface a clear path. Hard sponsor rejects stay hard.
                if is_soft_sponsor_config_error(&e) {
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

/// Stable `code` of a structured wallet error JSON; unparseable errors have no code and
/// are treated as hard failures by callers.
fn wallet_error_code(err: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(err).ok()?;
    parsed.get("code")?.as_str().map(str::to_string)
}

/// Soft sponsor-path config gaps the user can fix by funding the roster key or completing
/// bundler/account config.
fn is_soft_sponsor_config_error(err: &str) -> bool {
    matches!(
        wallet_error_code(err).as_deref(),
        Some("BUNDLER_CONFIG" | "ERC4337_ACCOUNT_CONFIG")
    )
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
