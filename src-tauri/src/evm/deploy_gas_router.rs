//! Factory deploy gas routing: global topHat sponsorship for eligible members, else EOA.

use alloy::network::EthereumWallet;
use alloy::network::TransactionBuilder;
use std::str::FromStr;

use alloy::primitives::{Address, TxHash, U256};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionReceipt;
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use super::global_sponsor_userop::send_sponsored_global_factory_userop;
use super::gov_read::rpc_urls_or_default;
use super::gov_sponsor_path::{select_gov_sponsor_path, GovSponsorPath};
use super::pacto_chain_config;
use super::rpc::signer::load_squad_roster_embedded_signer;
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, send_and_confirm,
    wait_for_transaction_receipt, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::sponsor_preflight::{global_factory_path_ok, read_eligible_member};
use super::sponsor_userop::{
    call_gas_ceiling_for_calldata, call_gas_with_margin, estimate_call_gas,
    roster_native_balance_wei, wait_for_user_operation_receipt, FALLBACK_MAX_FEE,
};
use super::wallet_chain_config::WalletNetworkConfig;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FactoryCallOutcome {
    pub receipt: TransactionReceipt,
    /// `self_funded` or `global_sponsored`.
    pub funded_by: String,
}

/// Parent-scoped roster id for global sponsorship probes; omit for non-squad deploys.
pub struct FactoryRouteContext<'a> {
    pub roster_parent_id: Option<&'a str>,
    pub eoa_pay_signer: Address,
    pub eoa_wallet: EthereumWallet,
}

pub async fn send_factory_call<R: Runtime>(
    app: AppHandle<R>,
    net: &WalletNetworkConfig,
    ctx: FactoryRouteContext<'_>,
    factory: Address,
    calldata: Vec<u8>,
    value_wei: U256,
    rpc_urls: Option<Vec<String>>,
    confirm_timeout: &str,
) -> Result<FactoryCallOutcome, String> {
    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let read_provider = connect_read_provider(&urls).await?;
    let gas_required =
        estimate_eoa_gas_cost_wei(&read_provider, ctx.eoa_pay_signer, factory, &calldata).await;
    let eoa_total = gas_required + value_wei;
    let pay_balance = roster_native_balance_wei(&read_provider, ctx.eoa_pay_signer).await?;
    let eoa_can_pay = pay_balance >= eoa_total;

    let (eligible_member, global_factory_ok) = match ctx.roster_parent_id {
        Some(pid) => {
            let (roster_signer, _) = load_squad_roster_embedded_signer(app.clone(), pid).await?;
            let roster = roster_signer.address();
            let global_addrs = pacto_chain_config::global_username_sponsor_addresses(&net.key);
            match global_addrs.as_ref() {
                Ok(addrs) => {
                    let eligible = read_eligible_member(
                        &read_provider,
                        addrs.pacto_username_nft,
                        roster,
                    )
                    .await?
                    .is_some();
                    let global_ok = if eligible {
                        global_factory_path_ok(
                            &read_provider,
                            addrs,
                            roster,
                            factory,
                            gas_required,
                        )
                        .await?
                    } else {
                        false
                    };
                    (eligible, global_ok)
                }
                Err(_) => (false, false),
            }
        }
        None => (false, false),
    };

    match select_gov_sponsor_path(eligible_member, false, global_factory_ok, eoa_can_pay) {
        GovSponsorPath::GlobalTopHat => {
            let pid = ctx.roster_parent_id.ok_or_else(|| {
                wallet_err_json(
                    "MISSING_PARENT",
                    "parentId is required for global sponsored factory deploy",
                    None,
                )
            })?;
            match send_sponsored_global_factory_userop(
                app.clone(),
                &net.key,
                pid,
                factory,
                calldata,
                value_wei,
                rpc_urls,
            )
            .await
            {
                Ok(send) => finish_sponsored_factory_call(&read_provider, &send, confirm_timeout)
                    .await
                    .map(|receipt| FactoryCallOutcome {
                        receipt,
                        funded_by: "global_sponsored".to_string(),
                    }),
                Err(e) if is_soft_sponsor_config_error(&e) => Err(wallet_err_json(
                    "SPONSOR_PATH_UNAVAILABLE",
                    format!(
                        "Global sponsored factory deploy is not fully configured ({e}). Fund the roster key or save a Pimlico API key on Status."
                    ),
                    None,
                )),
                Err(e) => Err(e),
            }
        }
        GovSponsorPath::Fail => {
            if eligible_member {
                Err(wallet_err_json(
                    "SPONSOR_PATH_UNAVAILABLE",
                    format!(
                        "eligible username member has no gas path for this factory call (global factory ok={global_factory_ok}, eoa can pay={eoa_can_pay}, value wei={value_wei})"
                    ),
                    None,
                ))
            } else {
                Err(wallet_err_json(
                    "INSUFFICIENT_FUNDS",
                    format!(
                        "signer holds {pay_balance} wei but this factory call needs ~{eoa_total} wei (gas + msg.value), and global sponsorship is unavailable"
                    ),
                    None,
                ))
            }
        }
        GovSponsorPath::Squad | GovSponsorPath::Eoa => {
            let provider = connect_signing_provider(&urls, ctx.eoa_wallet).await?;
            let tx = contract_call_request(factory, calldata).with_value(value_wei);
            let receipt = send_and_confirm(&provider, tx, confirm_timeout).await?;
            Ok(FactoryCallOutcome {
                receipt,
                funded_by: "self_funded".to_string(),
            })
        }
    }
}

async fn finish_sponsored_factory_call<P: Provider>(
    provider: &P,
    send: &super::sponsor_userop::SponsoredUserOpSend,
    confirm_timeout: &str,
) -> Result<TransactionReceipt, String> {
    let userop_receipt =
        wait_for_user_operation_receipt(&send.bundler_url, &send.user_op_hash).await?;
    if !userop_receipt.success {
        return Err(wallet_err_json_with_tx_hash(
            "USEROP_FAILED",
            format!(
                "sponsored factory UserOp {} was included but reverted (tx {})",
                send.user_op_hash,
                userop_receipt.tx_hash
            ),
            None,
            userop_receipt.tx_hash.clone(),
        ));
    }
    let hash = TxHash::from_str(userop_receipt.tx_hash.as_str()).map_err(|_| {
            wallet_err_json(
                "USEROP_RECEIPT",
                "invalid L1 transaction hash from bundler receipt",
                None,
            )
        })?;
    wait_for_transaction_receipt(provider, hash, confirm_timeout).await
}

async fn estimate_eoa_gas_cost_wei<P: Provider>(
    provider: &P,
    from: Address,
    to: Address,
    calldata: &[u8],
) -> U256 {
    let gas = estimate_call_gas(provider, from, to, calldata)
        .await
        .map(call_gas_with_margin)
        .unwrap_or_else(|| call_gas_ceiling_for_calldata(calldata));
    let max_fee = provider
        .estimate_eip1559_fees()
        .await
        .map(|fees| fees.max_fee_per_gas)
        .unwrap_or(FALLBACK_MAX_FEE);
    U256::from(gas) * U256::from(max_fee)
}

fn wallet_error_code(err: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(err).ok()?;
    parsed.get("code")?.as_str().map(str::to_string)
}

fn is_soft_sponsor_config_error(err: &str) -> bool {
    matches!(
        wallet_error_code(err).as_deref(),
        Some("BUNDLER_CONFIG" | "ERC4337_ACCOUNT_CONFIG")
    )
}

#[cfg(test)]
mod tests {
    use crate::evm::gov_sponsor_path::{select_gov_sponsor_path, GovSponsorPath};
    use super::*;

    #[test]
    fn soft_sponsor_config_classification() {
        let soft = |code: &str| format!(r#"{{"code":"{code}","message":"x"}}"#);
        assert!(is_soft_sponsor_config_error(&soft("BUNDLER_CONFIG")));
        assert!(!is_soft_sponsor_config_error(&soft("INSUFFICIENT_FUNDS")));
    }

    #[test]
    fn factory_router_skips_squad_arm() {
        assert_eq!(
            select_gov_sponsor_path(true, false, true, true),
            GovSponsorPath::GlobalTopHat
        );
        assert_eq!(
            select_gov_sponsor_path(true, false, false, true),
            GovSponsorPath::Eoa
        );
        assert_eq!(
            select_gov_sponsor_path(false, false, false, true),
            GovSponsorPath::Eoa
        );
        assert_eq!(
            select_gov_sponsor_path(false, false, true, false),
            GovSponsorPath::Fail
        );
    }
}
