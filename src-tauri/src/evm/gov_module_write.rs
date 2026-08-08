//! Shared squad-key contract call helper for Pacto Gov module writes.

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, U256};
use alloy::providers::Provider;
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use super::access_control::{require_capability, with_gov_write_lock, GovCapability};
use super::gov_read::rpc_urls_or_default;
use super::rpc::signer::{
    load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, send_and_confirm,
    wallet_err_json,
};
use super::sponsor_userop::{
    bundler_rpc_url, call_gas_with_margin, estimate_call_gas, roster_native_balance_wei,
    send_sponsored_gov_userop, wait_for_user_operation_tx_hash, FALLBACK_CALL_GAS_LIMIT,
    FALLBACK_MAX_FEE,
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
    rpc_urls_override: Option<Vec<String>>,
) -> Result<(String, String, u64), String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let urls = rpc_urls_or_default(net, rpc_urls_override.clone());
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

    require_capability(&app, pid, capability, rpc_urls_override).await?;
    require_roster_treasury_signing_allowed(app.clone(), pid).await?;

    let _write_guard = with_gov_write_lock(pid).await;
    let (signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;

    // Route the write: EOA when the roster key can afford the gas, sponsored when it can't.
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
    let required = estimate_eoa_cost_wei(&read_provider, signer.address(), to, &calldata).await;
    match select_write_path(balance, required, has_sponsor_infra) {
        WritePath::Sponsored => {
            match send_sponsored_gov_userop(app.clone(), &net.key, pid, to, calldata.clone()).await
            {
                Ok(user_op_hash) => {
                    // The write guard must stay held through inclusion: returning now would let
                    // the next write reuse the same EntryPoint nonce. Callers expect a real L1
                    // transaction hash, not the bundler userOp hash.
                    let bundler = bundler_rpc_url(&net.key).ok_or_else(|| {
                        wallet_err_json(
                            "BUNDLER_CONFIG",
                            "Set BUNDLER_RPC_URL to an EntryPoint v0.7 bundler for sponsored governance writes when the roster key has no ETH.",
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
                                "Roster key can't cover this write's gas and the sponsored UserOp is not fully configured ({e}). Fund the roster key, or set BUNDLER_RPC_URL so the Rust backend can reach an EntryPoint v0.7 bundler (repo-root .env is loaded in debug builds)."
                            ),
                            None,
                        ));
                    }
                    return Err(e);
                }
            }
        }
        WritePath::InsufficientFunds => {
            return Err(wallet_err_json(
                "INSUFFICIENT_FUNDS",
                format!(
                    "roster key holds {balance} wei but this write needs ~{required} wei for gas, and no squad sponsor is deployed. Fund the roster key or deploy a squad sponsor first."
                ),
                None,
            ));
        }
        WritePath::Eoa => {}
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

/// Routing for a squad-key governance write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WritePath {
    Sponsored,
    Eoa,
    InsufficientFunds,
}

/// EOA when the roster key can afford the write, sponsored when it can't but sponsor infra
/// exists, otherwise a pre-send insufficient-funds error.
fn select_write_path(balance_wei: U256, required_wei: U256, has_sponsor_infra: bool) -> WritePath {
    if balance_wei >= required_wei {
        WritePath::Eoa
    } else if has_sponsor_infra {
        WritePath::Sponsored
    } else {
        WritePath::InsufficientFunds
    }
}

/// Conservative EOA cost bound: `eth_estimateGas` with 1.2x headroom times the current
/// EIP-1559 max fee, reusing the sponsored path's fallbacks when RPC estimation is down.
async fn estimate_eoa_cost_wei<P: Provider>(
    provider: &P,
    from: Address,
    to: Address,
    calldata: &[u8],
) -> U256 {
    let gas = estimate_call_gas(provider, from, to, calldata)
        .await
        .map(call_gas_with_margin)
        .unwrap_or(FALLBACK_CALL_GAS_LIMIT);
    let max_fee = provider
        .estimate_eip1559_fees()
        .await
        .map(|fees| fees.max_fee_per_gas)
        .unwrap_or(FALLBACK_MAX_FEE);
    U256::from(gas) * U256::from(max_fee)
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
        if let Some(from_infra) = db::parent_id_for_canonical_infra_ref(app, module_address.trim())?
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
    use super::{
        explicit_parent_id, is_soft_sponsor_config_error, select_write_path, wallet_error_code,
        WritePath,
    };
    use alloy::primitives::U256;

    #[test]
    fn explicit_parent_id_trims_and_rejects_empty() {
        assert_eq!(explicit_parent_id(" parent-1 "), Some("parent-1"));
        assert_eq!(explicit_parent_id(""), None);
        assert_eq!(explicit_parent_id("   "), None);
    }

    #[test]
    fn select_write_path_covers_balance_and_infra_matrix() {
        let required = U256::from(1_000_000u64);
        // Zero balance: sponsored with infra, clear error without.
        assert_eq!(
            select_write_path(U256::ZERO, required, true),
            WritePath::Sponsored
        );
        assert_eq!(
            select_write_path(U256::ZERO, required, false),
            WritePath::InsufficientFunds
        );
        // Dust below required routes the same as zero.
        let dust = required - U256::from(1u64);
        assert_eq!(
            select_write_path(dust, required, true),
            WritePath::Sponsored
        );
        assert_eq!(
            select_write_path(dust, required, false),
            WritePath::InsufficientFunds
        );
        // Sufficient balance always takes the EOA path.
        assert_eq!(select_write_path(required, required, true), WritePath::Eoa);
        assert_eq!(
            select_write_path(required + U256::from(1u64), required, false),
            WritePath::Eoa
        );
    }

    #[test]
    fn soft_sponsor_config_classification_uses_structured_code() {
        let soft = |code: &str| format!(r#"{{"code":"{code}","message":"configure it"}}"#);
        assert!(is_soft_sponsor_config_error(&soft("BUNDLER_CONFIG")));
        assert!(is_soft_sponsor_config_error(&soft(
            "ERC4337_ACCOUNT_CONFIG"
        )));
        assert!(!is_soft_sponsor_config_error(&soft("SPONSOR_POOL_LOW")));
        assert!(!is_soft_sponsor_config_error(&soft("PAYMASTER_REJECTED")));
        // Unparseable payloads and missing codes are hard errors.
        assert!(!is_soft_sponsor_config_error(
            "BUNDLER_CONFIG as plain text"
        ));
        assert!(!is_soft_sponsor_config_error(r#"{"message":"no code"}"#));
    }

    #[test]
    fn wallet_error_code_ignores_code_like_text_in_message() {
        // Substring dispatch would misread this as soft; the code field wins.
        let err = r#"{"code":"USEROP_RECEIPT_TIMEOUT","message":"not BUNDLER_CONFIG"}"#;
        assert_eq!(
            wallet_error_code(err),
            Some("USEROP_RECEIPT_TIMEOUT".to_string())
        );
        assert!(!is_soft_sponsor_config_error(err));
        assert_eq!(wallet_error_code("not json"), None);
        assert_eq!(wallet_error_code(r#"{"code":7}"#), None);
    }
}
