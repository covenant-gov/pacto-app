//! Send ETH to a squad sponsor clone via `ISquadSponsorBase.deposit()`.

use alloy::network::TransactionBuilder;
use alloy::primitives::U256;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::depositCall;
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config;
use super::rpc::signer::{
    load_active_squad_embedded_signer, load_squad_roster_embedded_signer,
    require_roster_treasury_signing_allowed, require_treasury_signing_allowed,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, send_and_confirm,
    wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::squad_sponsor_common::{
    active_game_squad_id_for_parent, parse_deposit_wei, parse_signer_wallet, require_parent_member,
    resolve_sponsor_for_parent,
};
use super::squad_sponsor_read::read_sponsor_pool;
use super::wallet_chain_config;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorDepositResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub sponsor_address: String,
    pub amount_wei: String,
    pub pool_balance_wei: String,
}

/// Trimmed parent id; rejects blank input before any state or chain access.
pub(super) fn require_non_empty_parent_id(parent_id: &str) -> Result<&str, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }
    Ok(pid)
}

/// Deposit amount in wei; rejects empty/invalid input and zero-value deposits.
fn parse_deposit_amount(raw: &str) -> Result<U256, String> {
    let amount =
        parse_deposit_wei(Some(raw)).map_err(|e| wallet_err_json("INVALID_AMOUNT", e, None))?;
    if amount.is_zero() {
        return Err(wallet_err_json(
            "INVALID_AMOUNT",
            "amount must be greater than zero",
            None,
        ));
    }
    Ok(amount)
}

/// Configured network for a command arg; rejects unknown keys.
pub(super) fn require_network_config(
    network: &str,
) -> Result<&'static wallet_chain_config::WalletNetworkConfig, String> {
    wallet_chain_config::network_by_key(&network.to_lowercase()).ok_or_else(|| {
        wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        )
    })
}

#[tauri::command]
pub async fn deposit_squad_sponsor<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    amount_wei: String,
    sponsor_address: Option<String>,
    signer_wallet: Option<String>,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadSponsorDepositResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let pid = require_non_empty_parent_id(&parent_id)?;
    require_parent_member(&app, pid).await?;

    let amount = parse_deposit_amount(&amount_wei)?;

    let net = require_network_config(&network)?;

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;

    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let read_provider = connect_read_provider(&urls).await?;
    let game_squad_id = active_game_squad_id_for_parent(&app, pid);
    let sponsor = resolve_sponsor_for_parent(
        &read_provider,
        addrs.squad_sponsor_factory,
        pid,
        sponsor_address.as_deref(),
        game_squad_id,
    )
    .await?;

    let signer_mode = parse_signer_wallet(signer_wallet.as_deref(), "default")?;
    let (_signer, wallet) = if signer_mode == "default" {
        require_treasury_signing_allowed(app.clone()).await?;
        load_active_squad_embedded_signer(app.clone()).await?
    } else {
        require_roster_treasury_signing_allowed(app.clone(), pid).await?;
        load_squad_roster_embedded_signer(app.clone(), pid).await?
    };
    let provider = connect_signing_provider(&urls, wallet).await?;

    let calldata = depositCall {}.abi_encode();
    let tx = contract_call_request(sponsor, calldata).with_value(amount);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for sponsor deposit confirmation.",
    )
    .await?;

    let read_provider = connect_read_provider(&urls).await?;
    let (pool_balance, _, _, _) =
        read_sponsor_pool(&read_provider, sponsor)
            .await
            .map_err(|e| {
                wallet_err_json_with_tx_hash(
                    "SPONSOR_READ",
                    e,
                    None,
                    format!("0x{:x}", receipt.transaction_hash),
                )
            })?;

    Ok(SquadSponsorDepositResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        sponsor_address: format!("{:#x}", sponsor),
        amount_wei: amount.to_string(),
        pool_balance_wei: pool_balance.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err_code(err: &str) -> String {
        serde_json::from_str::<serde_json::Value>(err)
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(String::from))
            .unwrap_or_default()
    }

    #[test]
    fn require_non_empty_parent_id_rejects_blank() {
        for blank in ["", "   ", "\t\n"] {
            let err = require_non_empty_parent_id(blank).unwrap_err();
            assert_eq!(err_code(&err), "INVALID_PARENT");
        }
        assert_eq!(
            require_non_empty_parent_id("  squad-1 ").unwrap(),
            "squad-1"
        );
    }

    #[test]
    fn parse_deposit_amount_rejects_empty_invalid_and_zero() {
        for bad in ["", "   ", "not-a-number", "0xzz", "0", "0x0"] {
            let err = parse_deposit_amount(bad).unwrap_err();
            assert_eq!(err_code(&err), "INVALID_AMOUNT", "input {bad:?}");
        }
    }

    #[test]
    fn parse_deposit_amount_accepts_decimal_and_hex() {
        assert_eq!(parse_deposit_amount("1000").unwrap(), U256::from(1000u64));
        assert_eq!(parse_deposit_amount(" 1000 ").unwrap(), U256::from(1000u64));
        assert_eq!(parse_deposit_amount("0xff").unwrap(), U256::from(255u64));
    }

    #[test]
    fn require_network_config_rejects_unknown_network() {
        let err = require_network_config("bogus-net").unwrap_err();
        assert_eq!(err_code(&err), "UNSUPPORTED_NETWORK");
        assert!(require_network_config("sepolia").is_ok());
        assert!(require_network_config("SEPOLIA").is_ok());
    }

    #[test]
    fn signer_wallet_selection_defaults_to_default() {
        assert_eq!(parse_signer_wallet(None, "default").unwrap(), "default");
        assert_eq!(parse_signer_wallet(Some(""), "default").unwrap(), "default");
        assert_eq!(
            parse_signer_wallet(Some(" squad "), "default").unwrap(),
            "squad"
        );
        assert_eq!(
            parse_signer_wallet(Some("SQUAD"), "default").unwrap(),
            "squad"
        );
        let err = parse_signer_wallet(Some("hardware"), "default").unwrap_err();
        assert_eq!(err_code(&err), "INVALID_SIGNER");
    }

    #[test]
    fn deposit_calldata_is_bare_selector() {
        assert_eq!(depositCall {}.abi_encode(), depositCall::SELECTOR);
    }
}
