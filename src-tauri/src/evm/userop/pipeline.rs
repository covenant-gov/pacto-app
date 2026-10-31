//! One estimate and one send for squad, global, and factory UserOps.

use std::future::Future;

use alloy::primitives::{Address, Bytes, B256, U256};
use alloy::providers::Provider;
use alloy::signers::Signer;

use super::placeholder::UseropGasCeilings;
use super::transport::{
    bundler_cap_fallback_estimate, bundler_estimate_user_operation_gas,
    bundler_send_user_operation, clamp_estimated_gas_to_bundler_cap, dummy_userop_signature,
    finalize_factory_userop_gas_limits, finalize_userop_gas_limits, heavy_call_gas_limit,
    is_bundler_gas_limit_error, is_userop_call_gas_error, pack_u128s, pass2_or_clamped_pass1,
    paymaster_data, paymaster_entry_point_deposit_preflight, should_skip_estimate_calibrate,
    user_op_json, userop_max_cost_wei, EstimatedUserOpGas, FinalGasLimits, IEntryPointV07,
    PackedUserOperation, UserOpParams,
};
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::wallet_err_json;

/// Fields shared by estimate and send. Paymaster bytes come from the encode callback.
pub(crate) struct SponsoredUserOpBuild<'a> {
    pub(crate) sender: Address,
    pub(crate) nonce: U256,
    pub(crate) call_data: &'a [u8],
    pub(crate) entry_point: Address,
    pub(crate) paymaster: Address,
    pub(crate) max_fee: u128,
    pub(crate) max_priority: u128,
    pub(crate) eip7702_auth: Option<serde_json::Value>,
}

/// Small lanes pad. Factory does not.
pub(crate) fn estimate_pads(factory_style: bool) -> bool {
    !factory_style
}

/// 500k → 1.5M retry. Factory never enters it, even if the call ceiling is under 1.5M.
pub(crate) fn heavy_call_retry_applies(factory_style: bool, call_ceiling: u128) -> bool {
    !factory_style && call_ceiling < heavy_call_gas_limit()
}

/// Factory gas-cap errors send the lane ceilings. Small lanes fill the 16M cap.
pub(crate) fn gas_cap_estimate_fallback(
    factory_style: bool,
    ceilings: &UseropGasCeilings,
) -> EstimatedUserOpGas {
    if factory_style {
        EstimatedUserOpGas {
            call_gas_limit: ceilings.call,
            verification_gas_limit: ceilings.verification,
            pre_verification_gas: ceilings.pre_verification,
            paymaster_verification_gas_limit: ceilings.pm_verification,
            paymaster_post_op_gas_limit: ceilings.pm_post,
        }
    } else {
        bundler_cap_fallback_estimate(
            ceilings.verification,
            ceilings.pre_verification,
            ceilings.pm_verification,
            ceilings.pm_post,
        )
    }
}

pub(crate) fn finalize_for_style(
    factory_style: bool,
    estimated: &EstimatedUserOpGas,
) -> Result<FinalGasLimits, String> {
    if estimate_pads(factory_style) {
        finalize_userop_gas_limits(estimated)
    } else {
        Ok(finalize_factory_userop_gas_limits(estimated))
    }
}

pub(crate) async fn estimate_sponsored_userop<E>(
    bundler_url: &str,
    op: &SponsoredUserOpBuild<'_>,
    ceilings: UseropGasCeilings,
    factory_style: bool,
    lane_label: &str,
    encode_paymaster: &E,
) -> Result<EstimatedUserOpGas, String>
where
    E: Fn(u128, u128) -> Vec<u8>,
{
    match estimate_with_ceilings(
        bundler_url,
        op,
        ceilings,
        factory_style,
        lane_label,
        encode_paymaster,
    )
    .await
    {
        Ok(estimated) => Ok(estimated),
        Err(e)
            if heavy_call_retry_applies(factory_style, ceilings.call)
                && is_userop_call_gas_error(&e) =>
        {
            log::warn!(
                target: "pacto_wallet",
                "{lane_label} estimate OOG at {} call gas; retrying at {}",
                ceilings.call,
                heavy_call_gas_limit()
            );
            let mut heavy = ceilings;
            heavy.call = heavy_call_gas_limit();
            estimate_with_ceilings(
                bundler_url,
                op,
                heavy,
                factory_style,
                lane_label,
                encode_paymaster,
            )
            .await
        }
        Err(e) => Err(e),
    }
}

async fn estimate_with_ceilings<E>(
    bundler_url: &str,
    op: &SponsoredUserOpBuild<'_>,
    ceilings: UseropGasCeilings,
    factory_style: bool,
    lane_label: &str,
    encode_paymaster: &E,
) -> Result<EstimatedUserOpGas, String>
where
    E: Fn(u128, u128) -> Vec<u8>,
{
    let dummy_sig = dummy_userop_signature();
    let mut paymaster_and_data = encode_paymaster(ceilings.pm_verification, ceilings.pm_post);
    let _ = paymaster_data(&paymaster_and_data)?;
    let estimate_op = user_op_for(
        op,
        &ceilings_as_limits(&ceilings),
        &paymaster_and_data,
        &dummy_sig,
    )?;
    let first = match bundler_estimate_user_operation_gas(bundler_url, &estimate_op, op.entry_point)
        .await
    {
        Ok(gas) => gas,
        Err(e) if is_bundler_gas_limit_error(&e) => {
            if factory_style {
                log::warn!(
                    target: "pacto_wallet",
                    "factory estimate hit bundler gas cap; sending at factory ceilings"
                );
            } else {
                log::warn!(
                    target: "pacto_wallet",
                    "{lane_label} estimate pass 1 hit bundler 16M cap; using fallback limits"
                );
            }
            return Ok(gas_cap_estimate_fallback(factory_style, &ceilings));
        }
        Err(e) => return Err(e),
    };
    if factory_style || should_skip_estimate_calibrate(&first) {
        if !factory_style {
            log::warn!(
                target: "pacto_wallet",
                "skip {lane_label} estimate calibrate; pass-1 sum would exceed 16M after bundler pad"
            );
        }
        return Ok(first);
    }
    let calibrate = clamp_estimated_gas_to_bundler_cap(&first);
    paymaster_and_data = encode_paymaster(
        calibrate.paymaster_verification_gas_limit,
        calibrate.paymaster_post_op_gas_limit,
    );
    let _ = paymaster_data(&paymaster_and_data)?;
    let calibrate_op = user_op_for(op, &calibrate, &paymaster_and_data, &dummy_sig)?;
    pass2_or_clamped_pass1(
        lane_label,
        bundler_estimate_user_operation_gas(bundler_url, &calibrate_op, op.entry_point).await,
        &first,
    )
}

fn ceilings_as_limits(ceilings: &UseropGasCeilings) -> FinalGasLimits {
    FinalGasLimits {
        call_gas_limit: ceilings.call,
        verification_gas_limit: ceilings.verification,
        pre_verification_gas: ceilings.pre_verification,
        paymaster_verification_gas_limit: ceilings.pm_verification,
        paymaster_post_op_gas_limit: ceilings.pm_post,
    }
}

fn user_op_for(
    op: &SponsoredUserOpBuild<'_>,
    limits: &FinalGasLimits,
    paymaster_and_data: &[u8],
    signature: &[u8],
) -> Result<serde_json::Value, String> {
    user_op_json(UserOpParams {
        sender: op.sender,
        nonce: op.nonce,
        call_data: op.call_data,
        call_gas_limit: limits.call_gas_limit,
        verification_gas_limit: limits.verification_gas_limit,
        pre_verification_gas: limits.pre_verification_gas,
        max_fee_per_gas: op.max_fee,
        max_priority_fee_per_gas: op.max_priority,
        paymaster: op.paymaster,
        paymaster_verification_gas_limit: limits.paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit: limits.paymaster_post_op_gas_limit,
        paymaster_and_data,
        signature,
        eip7702_auth: op.eip7702_auth.clone(),
    })
}

pub(crate) async fn sign_and_send_sponsored_userop<P, S, E, F, Fut>(
    provider: &P,
    signer: &S,
    bundler_url: &str,
    op: &SponsoredUserOpBuild<'_>,
    limits: FinalGasLimits,
    encode_paymaster: &E,
    preflight: F,
) -> Result<String, String>
where
    P: Provider,
    S: Signer + Sync,
    E: Fn(u128, u128) -> Vec<u8>,
    F: FnOnce(U256) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let paymaster_and_data = encode_paymaster(
        limits.paymaster_verification_gas_limit,
        limits.paymaster_post_op_gas_limit,
    );
    let final_max_cost = userop_max_cost_wei(
        limits.call_gas_limit,
        limits.verification_gas_limit,
        limits.pre_verification_gas,
        op.max_fee,
        limits.paymaster_verification_gas_limit,
        limits.paymaster_post_op_gas_limit,
    );
    paymaster_entry_point_deposit_preflight(provider, op.entry_point, op.paymaster, final_max_cost)
        .await?;
    preflight(final_max_cost).await?;

    let packed = PackedUserOperation {
        sender: op.sender,
        nonce: op.nonce,
        initCode: Bytes::new(),
        callData: Bytes::from(op.call_data.to_vec()),
        accountGasLimits: pack_u128s(limits.verification_gas_limit, limits.call_gas_limit),
        preVerificationGas: U256::from(limits.pre_verification_gas),
        gasFees: pack_u128s(op.max_priority, op.max_fee),
        paymasterAndData: Bytes::from(paymaster_and_data.clone()),
        signature: Bytes::new(),
    };
    let user_op_hash: B256 = eth_call_decode(
        provider,
        op.entry_point,
        &IEntryPointV07::getUserOpHashCall { userOp: packed },
    )
    .await
    .map_err(|e| wallet_err_json("USEROP_HASH", e, None))?;
    let sig = signer
        .sign_hash(&user_op_hash)
        .await
        .map_err(|e| wallet_err_json("USEROP_SIGN", e.to_string(), None))?;
    let signature = sig.as_bytes().to_vec();
    let user_op = user_op_for(op, &limits, &paymaster_and_data, &signature)?;
    bundler_send_user_operation(bundler_url, &user_op, op.entry_point).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evm::userop::transport::bundler_userop_gas_cap;

    #[test]
    fn factory_style_skips_pad_and_heavy_retry() {
        assert!(!estimate_pads(true));
        assert!(estimate_pads(false));
        assert!(!heavy_call_retry_applies(true, 500_000));
        assert!(!heavy_call_retry_applies(true, 14_000_000));
        assert!(heavy_call_retry_applies(false, 500_000));
        assert!(!heavy_call_retry_applies(false, heavy_call_gas_limit()));

        let ceilings = UseropGasCeilings {
            call: 14_000_000,
            verification: 1_000_000,
            pre_verification: 200_000,
            pm_verification: 500_000,
            pm_post: 100_000,
        };
        let factory = gas_cap_estimate_fallback(true, &ceilings);
        assert_eq!(factory.call_gas_limit, 14_000_000);
        let small = gas_cap_estimate_fallback(false, &ceilings);
        assert_eq!(
            small.call_gas_limit
                + small.verification_gas_limit
                + small.pre_verification_gas
                + small.paymaster_verification_gas_limit
                + small.paymaster_post_op_gas_limit,
            bundler_userop_gas_cap()
        );

        let raw = EstimatedUserOpGas {
            call_gas_limit: 100_000,
            verification_gas_limit: 100_000,
            pre_verification_gas: 80_000,
            paymaster_verification_gas_limit: 100_000,
            paymaster_post_op_gas_limit: 50_000,
        };
        let padded = finalize_for_style(false, &raw).expect("small finalize");
        let factory_limits = finalize_for_style(true, &raw).expect("factory finalize");
        assert!(padded.call_gas_limit > raw.call_gas_limit);
        assert_eq!(factory_limits.call_gas_limit, raw.call_gas_limit);
        assert_eq!(
            factory_limits.verification_gas_limit,
            raw.verification_gas_limit
        );
    }
}
