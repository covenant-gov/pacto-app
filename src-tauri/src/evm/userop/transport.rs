//! ERC-4337 UserOp JSON, bundler RPC, and gas-limit math.

use std::time::Duration;

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, Bytes, B256, U256};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionRequest;
use serde_json::{json, Value};

use super::policy::policy;
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::{classify_gov_call_revert, wallet_err_json};
use crate::evm::sponsor_paymaster::{default_post_op_gas_limit, paymaster_data_offset};

alloy::sol! {
    #[sol(rpc)]
    interface IAccountExecute {
        function execute(address dest, uint256 value, bytes data) external;
    }

    #[sol(rpc)]
    interface IEntryPointV07 {
        function getNonce(address sender, uint192 key) external view returns (uint256 nonce);
        function getUserOpHash(PackedUserOperation userOp) external view returns (bytes32);
        function balanceOf(address account) external view returns (uint256);
    }

    #[derive(Debug)]
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }
}

/// Pimlico precheck: sum of the five ERC-4337 gas limits.
#[inline]
pub(crate) fn bundler_userop_gas_cap() -> u128 {
    policy().bundler_user_op_gas_cap
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FinalGasLimits {
    pub(crate) call_gas_limit: u128,
    pub(crate) verification_gas_limit: u128,
    pub(crate) pre_verification_gas: u128,
    pub(crate) paymaster_verification_gas_limit: u128,
    pub(crate) paymaster_post_op_gas_limit: u128,
}

pub(crate) fn userop_gas_limit_sum(
    call_gas_limit: u128,
    verification_gas_limit: u128,
    pre_verification_gas: u128,
    paymaster_verification_gas_limit: u128,
    paymaster_post_op_gas_limit: u128,
) -> u128 {
    call_gas_limit
        .saturating_add(verification_gas_limit)
        .saturating_add(pre_verification_gas)
        .saturating_add(paymaster_verification_gas_limit)
        .saturating_add(paymaster_post_op_gas_limit)
}

impl FinalGasLimits {
    fn sum(self) -> u128 {
        userop_gas_limit_sum(
            self.call_gas_limit,
            self.verification_gas_limit,
            self.pre_verification_gas,
            self.paymaster_verification_gas_limit,
            self.paymaster_post_op_gas_limit,
        )
    }
}

pub(crate) fn limits_from_estimated(estimated: &EstimatedUserOpGas) -> FinalGasLimits {
    FinalGasLimits {
        call_gas_limit: estimated.call_gas_limit,
        verification_gas_limit: estimated.verification_gas_limit,
        pre_verification_gas: estimated.pre_verification_gas,
        paymaster_verification_gas_limit: estimated.paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit: estimated.paymaster_post_op_gas_limit,
    }
}

/// Shrink five-limit sum to ≤ 16M. No pad. Prefer cutting `callGasLimit`.
pub(crate) fn clamp_userop_gas_limits_to_cap(limits: FinalGasLimits) -> FinalGasLimits {
    let sum = limits.sum();
    if sum <= bundler_userop_gas_cap() {
        return limits;
    }
    let overflow = sum - bundler_userop_gas_cap();
    if limits.call_gas_limit > overflow {
        let mut out = limits;
        out.call_gas_limit = limits.call_gas_limit - overflow;
        return out;
    }
    let scale = |v: u128| v.saturating_mul(bundler_userop_gas_cap()) / sum;
    let verification_gas_limit = scale(limits.verification_gas_limit);
    let pre_verification_gas = scale(limits.pre_verification_gas);
    let paymaster_verification_gas_limit = scale(limits.paymaster_verification_gas_limit);
    let paymaster_post_op_gas_limit = scale(limits.paymaster_post_op_gas_limit);
    let others = verification_gas_limit
        + pre_verification_gas
        + paymaster_verification_gas_limit
        + paymaster_post_op_gas_limit;
    FinalGasLimits {
        call_gas_limit: bundler_userop_gas_cap().saturating_sub(others),
        verification_gas_limit,
        pre_verification_gas,
        paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit,
    }
}

pub(crate) fn clamp_estimated_gas_to_bundler_cap(estimated: &EstimatedUserOpGas) -> FinalGasLimits {
    clamp_userop_gas_limits_to_cap(limits_from_estimated(estimated))
}

/// Pass-2 `eth_estimateUserOperationGas` re-pads. Skip it when that pad would exceed 16M.
pub(crate) fn should_skip_estimate_calibrate(first: &EstimatedUserOpGas) -> bool {
    limits_from_estimated(first).sum() > bundler_userop_gas_cap()
        || pad_userop_gas_limits(first).sum() > bundler_userop_gas_cap()
}

pub(crate) fn is_bundler_gas_limit_error(err: &str) -> bool {
    matches!(
        wallet_error_code(err).as_deref(),
        Some("BUNDLER_GAS_LIMIT" | "FACTORY_USEROP_TOO_LARGE")
    ) || err.to_lowercase().contains("max gas per userop")
}

pub(crate) fn factory_userop_too_large_error() -> String {
    wallet_err_json(
        "FACTORY_USEROP_TOO_LARGE",
        "This factory deploy needs more gas than the bundler allows in one sponsored UserOp. Fund the paying key with ETH and retry as a normal transaction.",
        None,
    )
}

/// When the bundler refuses to return an over-cap estimate, fill the 16M cap from placeholders.
pub(crate) fn bundler_cap_fallback_estimate(
    verification_gas_limit: u128,
    pre_verification_gas: u128,
    paymaster_verification_gas_limit: u128,
    paymaster_post_op_gas_limit: u128,
) -> EstimatedUserOpGas {
    let others = verification_gas_limit
        .saturating_add(pre_verification_gas)
        .saturating_add(paymaster_verification_gas_limit)
        .saturating_add(paymaster_post_op_gas_limit);
    EstimatedUserOpGas {
        call_gas_limit: bundler_userop_gas_cap().saturating_sub(others),
        verification_gas_limit,
        pre_verification_gas,
        paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit,
    }
}

fn pad_userop_gas_limits(estimated: &EstimatedUserOpGas) -> FinalGasLimits {
    FinalGasLimits {
        call_gas_limit: apply_userop_gas_margin(estimated.call_gas_limit),
        verification_gas_limit: apply_verification_gas_margin(estimated.verification_gas_limit),
        pre_verification_gas: apply_userop_gas_margin(estimated.pre_verification_gas),
        paymaster_verification_gas_limit: apply_verification_gas_margin(
            estimated.paymaster_verification_gas_limit,
        ),
        paymaster_post_op_gas_limit: apply_userop_gas_margin(estimated.paymaster_post_op_gas_limit),
    }
}

/// 1.2× pad when the estimate is under 16M; otherwise shrink only (bundler already padded).
pub(crate) fn finalize_userop_gas_limits(
    estimated: &EstimatedUserOpGas,
) -> Result<FinalGasLimits, String> {
    let raw = limits_from_estimated(estimated);
    let raw_sum = raw.sum();
    if raw_sum > bundler_userop_gas_cap() {
        return Ok(clamp_userop_gas_limits_to_cap(raw));
    }
    let padded = pad_userop_gas_limits(estimated);
    let padded_sum = padded.sum();
    if padded_sum <= bundler_userop_gas_cap() {
        return Ok(padded);
    }
    let surplus = padded_sum - raw_sum;
    if surplus == 0 {
        return Err(wallet_err_json(
            "BUNDLER_GAS_LIMIT",
            format!(
                "User operation gas limits exceeded the max gas per userOp: {padded_sum} > {}",
                bundler_userop_gas_cap()
            ),
            None,
        ));
    }
    let keep_surplus = bundler_userop_gas_cap() - raw_sum;
    let scale = |raw_f: u128, padded_f: u128| {
        let pad = padded_f.saturating_sub(raw_f);
        raw_f + pad * keep_surplus / surplus
    };
    let verification_gas_limit = scale(raw.verification_gas_limit, padded.verification_gas_limit);
    let pre_verification_gas = scale(raw.pre_verification_gas, padded.pre_verification_gas);
    let paymaster_verification_gas_limit = scale(
        raw.paymaster_verification_gas_limit,
        padded.paymaster_verification_gas_limit,
    );
    let paymaster_post_op_gas_limit = scale(
        raw.paymaster_post_op_gas_limit,
        padded.paymaster_post_op_gas_limit,
    );
    let others = verification_gas_limit
        + pre_verification_gas
        + paymaster_verification_gas_limit
        + paymaster_post_op_gas_limit;
    let limits = FinalGasLimits {
        call_gas_limit: bundler_userop_gas_cap().saturating_sub(others),
        verification_gas_limit,
        pre_verification_gas,
        paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit,
    };
    debug_assert!(limits.sum() <= bundler_userop_gas_cap());
    Ok(limits)
}

/// Factory deploys: no 1.2× pad. Shrink the five-limit sum to ≤ 16M, cutting call gas first.
pub(crate) fn finalize_factory_userop_gas_limits(estimated: &EstimatedUserOpGas) -> FinalGasLimits {
    let limits = clamp_userop_gas_limits_to_cap(limits_from_estimated(estimated));
    debug_assert!(limits.sum() <= bundler_userop_gas_cap());
    limits
}

pub(crate) fn is_userop_call_gas_error(err: &str) -> bool {
    serde_json::from_str::<Value>(err)
        .ok()
        .and_then(|v| v.get("code")?.as_str().map(|s| s == "USEROP_CALL_GAS"))
        .unwrap_or(false)
}

/// Dummy 65-byte ECDSA for `eth_estimateUserOperationGas` (content ignored; length must match).
pub(crate) fn dummy_userop_signature() -> Vec<u8> {
    let mut ecdsa = vec![0u8; 65];
    ecdsa[31] = 0x01;
    ecdsa[63] = 0x01;
    ecdsa[64] = 0x1c;
    ecdsa
}

/// Fields of the ERC-4337 v0.7 UserOperation JSON sent to the bundler.
pub(crate) struct UserOpParams<'a> {
    pub(crate) sender: Address,
    pub(crate) nonce: U256,
    pub(crate) call_data: &'a [u8],
    pub(crate) call_gas_limit: u128,
    pub(crate) verification_gas_limit: u128,
    pub(crate) pre_verification_gas: u128,
    pub(crate) max_fee_per_gas: u128,
    pub(crate) max_priority_fee_per_gas: u128,
    pub(crate) paymaster: Address,
    pub(crate) paymaster_verification_gas_limit: u128,
    pub(crate) paymaster_post_op_gas_limit: u128,
    pub(crate) paymaster_and_data: &'a [u8],
    pub(crate) signature: &'a [u8],
    pub(crate) eip7702_auth: Option<Value>,
}

/// Serializes the UserOperation for `eth_sendUserOperation` / `eth_estimateUserOperationGas` (v0.7).
pub(crate) fn user_op_json(p: UserOpParams) -> Result<Value, String> {
    Ok(json!({
        "sender": format!("{:#x}", p.sender),
        "nonce": format!("{:#x}", p.nonce),
        "factory": Value::Null,
        "factoryData": "0x",
        "callData": format!("0x{}", hex::encode(p.call_data)),
        "callGasLimit": format!("{:#x}", p.call_gas_limit),
        "verificationGasLimit": format!("{:#x}", p.verification_gas_limit),
        "preVerificationGas": format!("{:#x}", p.pre_verification_gas),
        "maxFeePerGas": format!("{:#x}", p.max_fee_per_gas),
        "maxPriorityFeePerGas": format!("{:#x}", p.max_priority_fee_per_gas),
        "paymaster": format!("{:#x}", p.paymaster),
        "paymasterVerificationGasLimit": format!("{:#x}", p.paymaster_verification_gas_limit),
        "paymasterPostOpGasLimit": format!("{:#x}", p.paymaster_post_op_gas_limit),
        "paymasterData": format!("0x{}", hex::encode(paymaster_data(p.paymaster_and_data)?)),
        "signature": format!("0x{}", hex::encode(p.signature)),
        "eip7702Auth": p.eip7702_auth,
    }))
}

/// `paymasterData` is `paymasterAndData` past its fixed header; short input is a bug, not a panic.
pub(crate) fn paymaster_data(paymaster_and_data: &[u8]) -> Result<&[u8], String> {
    paymaster_and_data
        .get(paymaster_data_offset()..)
        .ok_or_else(|| {
            wallet_err_json(
                "PAYMASTER_DATA",
                "paymasterAndData shorter than 52-byte header",
                None,
            )
        })
}

pub(crate) fn pack_u128s(hi: u128, lo: u128) -> B256 {
    let mut buf = [0u8; 32];
    buf[..16].copy_from_slice(&hi.to_be_bytes());
    buf[16..].copy_from_slice(&lo.to_be_bytes());
    B256::from(buf)
}

/// Fallback call gas when estimation is unavailable.
#[inline]
pub(crate) fn fallback_call_gas_limit() -> u128 {
    policy().fallback_call_gas_limit
}

/// Hats / Safe execute estimate ceiling (captain transfer + crew handoff).
#[inline]
pub(crate) fn heavy_call_gas_limit() -> u128 {
    policy().heavy_call_gas_limit
}

pub(crate) fn call_gas_with_margin(estimate: u128) -> u128 {
    estimate * policy().call_gas_margin_bps / 10_000
}

pub(crate) fn apply_userop_gas_margin(estimate: u128) -> u128 {
    call_gas_with_margin(estimate)
}

/// 1.2× headroom, never above 2.0× estimate (bundler verification efficiency floor).
pub(crate) fn apply_verification_gas_margin(estimate: u128) -> u128 {
    let padded = call_gas_with_margin(estimate);
    let cap = estimate.saturating_mul(policy().verification_gas_max_pad_bps) / 10_000;
    padded.min(cap).max(estimate)
}

/// Shared paymaster must hold EntryPoint deposit ≥ UserOp maxCost (bundler precheck).
pub(crate) async fn paymaster_entry_point_deposit_preflight<P: Provider>(
    provider: &P,
    entry_point: Address,
    paymaster: Address,
    required_wei: U256,
) -> Result<(), String> {
    let deposit: U256 = eth_call_decode(
        provider,
        entry_point,
        &IEntryPointV07::balanceOfCall { account: paymaster },
    )
    .await
    .map_err(|e| wallet_err_json("PAYMASTER_DEPOSIT_READ", e, None))?;
    if deposit < required_wei {
        return Err(wallet_err_json(
            "PAYMASTER_DEPOSIT_LOW",
            format!(
                "shared paymaster EntryPoint deposit ({deposit} wei) is below this UserOp's maxCost ({required_wei} wei). Operator: call paymaster.deposit() or EntryPoint.depositTo(paymaster) — not the squad sponsor pool."
            ),
            None,
        ));
    }
    Ok(())
}

/// `eth_estimateGas` for the governance call executed by the account. Estimates the inner
/// call (not `execute` itself) so it stays valid before the EIP-7702 delegation exists.
pub(crate) async fn estimate_call_gas<P: Provider>(
    provider: &P,
    member: Address,
    to: Address,
    calldata: &[u8],
) -> Option<u128> {
    let tx = TransactionRequest::default()
        .with_from(member)
        .with_to(to)
        .with_input(Bytes::copy_from_slice(calldata));
    provider.estimate_gas(tx).await.ok().map(|gas| gas as u128)
}

/// EntryPoint v0.7 maxCost bound: maxFeePerGas × every gas limit charged for the UserOp
/// (verification, call, preVerification, paymaster verification and postOp).
pub(crate) fn userop_max_cost_wei(
    call_gas_limit: u128,
    verification_gas_limit: u128,
    pre_verification_gas: u128,
    max_fee_per_gas: u128,
    paymaster_verification_gas_limit: u128,
    paymaster_post_op_gas_limit: u128,
) -> U256 {
    let total_gas = U256::from(call_gas_limit)
        + U256::from(verification_gas_limit)
        + U256::from(pre_verification_gas)
        + U256::from(paymaster_verification_gas_limit)
        + U256::from(paymaster_post_op_gas_limit);
    U256::from(max_fee_per_gas) * total_gas
}

pub(crate) async fn bundler_send_user_operation(
    bundler_url: &str,
    user_op: &Value,
    entry_point: Address,
) -> Result<String, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_sendUserOperation",
        "params": [user_op, format!("{entry_point:#x}")]
    });
    // Retry only transient transport failures; bundler validation rejects are final.
    let mut attempt = 0u32;
    let res = loop {
        attempt += 1;
        match bundler_rpc(bundler_url, &body).await {
            Err(e) if e.retriable && attempt < BUNDLER_MAX_ATTEMPTS => {
                tokio::time::sleep(bundler_retry_delay(attempt)).await;
            }
            result => break result,
        }
    };
    let res = res.map_err(|e| {
        wallet_err_json(
            "BUNDLER_RPC",
            format!(
                "bundler rpc failed after {attempt} attempt(s): {}",
                e.message
            ),
            None,
        )
    })?;
    parse_send_user_op_response(&res)
}

/// Gas limits returned by `eth_estimateUserOperationGas` (EntryPoint v0.7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EstimatedUserOpGas {
    pub(crate) call_gas_limit: u128,
    pub(crate) verification_gas_limit: u128,
    pub(crate) pre_verification_gas: u128,
    pub(crate) paymaster_verification_gas_limit: u128,
    pub(crate) paymaster_post_op_gas_limit: u128,
}

pub(crate) async fn bundler_get_user_operation_gas_price(
    bundler_url: &str,
) -> Result<(u128, u128), String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "pimlico_getUserOperationGasPrice",
        "params": []
    });
    let mut attempt = 0u32;
    let res = loop {
        attempt += 1;
        match bundler_rpc(bundler_url, &body).await {
            Err(e) if e.retriable && attempt < BUNDLER_MAX_ATTEMPTS => {
                tokio::time::sleep(bundler_retry_delay(attempt)).await;
            }
            result => break result,
        }
    };
    let res = res.map_err(|e| {
        wallet_err_json(
            "BUNDLER_FEE",
            format!(
                "pimlico_getUserOperationGasPrice failed after {attempt} attempt(s): {}",
                e.message
            ),
            None,
        )
    })?;
    parse_user_operation_gas_price_response(&res)
}

pub(crate) fn parse_user_operation_gas_price_response(res: &Value) -> Result<(u128, u128), String> {
    if let Some(err) = res.get("error") {
        let raw = crate::evm::wallet_security::redact_urls_in_text(&err.to_string());
        return Err(wallet_err_json(
            "BUNDLER_FEE",
            format!("pimlico_getUserOperationGasPrice failed: {raw}"),
            None,
        ));
    }
    let standard = res
        .get("result")
        .and_then(|r| r.get("standard"))
        .ok_or_else(|| {
            wallet_err_json(
                "BUNDLER_FEE",
                "pimlico_getUserOperationGasPrice returned no standard tier",
                None,
            )
        })?;
    let max_fee = parse_gas_price_field(standard, "maxFeePerGas")?;
    let priority = parse_gas_price_field(standard, "maxPriorityFeePerGas")?;
    if max_fee == 0 || priority == 0 {
        return Err(wallet_err_json(
            "BUNDLER_FEE",
            "pimlico_getUserOperationGasPrice standard tier has zero fees",
            None,
        ));
    }
    Ok((priority, max_fee.max(priority)))
}

fn parse_gas_price_field(obj: &Value, key: &str) -> Result<u128, String> {
    let Some(v) = obj.get(key) else {
        return Err(wallet_err_json(
            "BUNDLER_FEE",
            format!("pimlico_getUserOperationGasPrice missing {key}"),
            None,
        ));
    };
    if let Some(raw) = v.as_str() {
        return parse_hex_u128(raw).ok_or_else(|| {
            wallet_err_json(
                "BUNDLER_FEE",
                format!("pimlico_getUserOperationGasPrice invalid {key}: {raw}"),
                None,
            )
        });
    }
    v.as_u64().map(u128::from).ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_FEE",
            format!("pimlico_getUserOperationGasPrice invalid {key}"),
            None,
        )
    })
}

pub(crate) async fn bundler_estimate_user_operation_gas(
    bundler_url: &str,
    user_op: &Value,
    entry_point: Address,
) -> Result<EstimatedUserOpGas, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_estimateUserOperationGas",
        "params": [user_op, format!("{entry_point:#x}")]
    });
    let mut attempt = 0u32;
    let res = loop {
        attempt += 1;
        match bundler_rpc(bundler_url, &body).await {
            Err(e) if e.retriable && attempt < BUNDLER_MAX_ATTEMPTS => {
                tokio::time::sleep(bundler_retry_delay(attempt)).await;
            }
            result => break result,
        }
    };
    let res = res.map_err(|e| {
        wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!(
                "eth_estimateUserOperationGas failed after {attempt} attempt(s): {}",
                e.message
            ),
            None,
        )
    })?;
    parse_estimate_user_op_gas_response(&res)
}

/// Operator stderr for demo `make logs` / `tauri dev` (no env_logger). `redacted` must already
/// pass through [`crate::evm::wallet_security::redact_urls_in_text`].
fn eprintln_bundler_reject(op: &str, classified_code: &str, redacted: &str) {
    eprintln!("[pacto_wallet] bundler {op} rejected code={classified_code} detail={redacted}");
}

fn parse_estimate_user_op_gas_response(res: &Value) -> Result<EstimatedUserOpGas, String> {
    if let Some(err) = res.get("error") {
        let raw = crate::evm::wallet_security::redact_urls_in_text(&err.to_string());
        let (code, message) = classify_bundler_userop_reject(&raw);
        eprintln_bundler_reject("estimateUserOperationGas", code, &raw);
        return Err(wallet_err_json(code, message, None));
    }
    let result = res.get("result").ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_ESTIMATE",
            "eth_estimateUserOperationGas returned no result",
            None,
        )
    })?;
    Ok(EstimatedUserOpGas {
        call_gas_limit: parse_hex_u128_field(result, "callGasLimit")?,
        verification_gas_limit: parse_hex_u128_field(result, "verificationGasLimit")?,
        pre_verification_gas: parse_hex_u128_field(result, "preVerificationGas")?,
        // Sponsored path needs this; Alchemy may omit postOp when the paymaster has none.
        paymaster_verification_gas_limit: parse_hex_u128_field(
            result,
            "paymasterVerificationGasLimit",
        )?,
        paymaster_post_op_gas_limit: parse_hex_u128_field_or(
            result,
            "paymasterPostOpGasLimit",
            default_post_op_gas_limit(),
        )?,
    })
}

fn parse_hex_u128_field(obj: &Value, key: &str) -> Result<u128, String> {
    let Some(v) = obj.get(key) else {
        return Err(wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!("eth_estimateUserOperationGas missing {key}"),
            None,
        ));
    };
    if v.is_null() {
        return Err(wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!("eth_estimateUserOperationGas missing {key}"),
            None,
        ));
    }
    let raw = v.as_str().ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!("eth_estimateUserOperationGas invalid {key}"),
            None,
        )
    })?;
    if raw.is_empty() {
        return Err(wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!("eth_estimateUserOperationGas missing {key}"),
            None,
        ));
    }
    parse_hex_u128(raw).ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!("eth_estimateUserOperationGas invalid {key}: {raw}"),
            None,
        )
    })
}

/// Optional hex gas field; missing / null / empty → `default` (Alchemy omits unused paymaster postOp).
fn parse_hex_u128_field_or(obj: &Value, key: &str, default: u128) -> Result<u128, String> {
    let Some(v) = obj.get(key) else {
        return Ok(default);
    };
    if v.is_null() {
        return Ok(default);
    }
    let raw = v.as_str().ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!("eth_estimateUserOperationGas invalid {key}"),
            None,
        )
    })?;
    if raw.is_empty() {
        return Ok(default);
    }
    parse_hex_u128(raw).ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_ESTIMATE",
            format!("eth_estimateUserOperationGas invalid {key}: {raw}"),
            None,
        )
    })
}

fn parse_hex_u128(s: &str) -> Option<u128> {
    let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"))?;
    if hex.is_empty() {
        return Some(0);
    }
    u128::from_str_radix(hex, 16).ok()
}

/// Parses the `eth_sendUserOperation` response. A JSON-RPC error here is a bundler/
/// paymaster validation reject, which is final and must not be retried.
fn parse_send_user_op_response(res: &Value) -> Result<String, String> {
    if let Some(hash) = res.get("result").and_then(|v| v.as_str()) {
        return Ok(hash.to_string());
    }
    let raw = res
        .get("error")
        .map(|e| crate::evm::wallet_security::redact_urls_in_text(&e.to_string()))
        .unwrap_or_else(|| "eth_sendUserOperation failed".into());
    let (code, message) = classify_bundler_userop_reject(&raw);
    eprintln_bundler_reject("sendUserOperation", code, &raw);
    Err(wallet_err_json(code, message, None))
}

/// Map common bundler precheck strings to operator-facing codes/messages.
fn classify_bundler_userop_reject(raw: &str) -> (&'static str, String) {
    let lower = raw.to_lowercase();
    if lower.contains("paymaster deposit") {
        (
            "PAYMASTER_DEPOSIT_LOW",
            "Shared paymaster EntryPoint deposit is too low for this UserOp. Operator: fund via paymaster.deposit() or EntryPoint.depositTo(paymaster) — not the squad sponsor pool.".into(),
        )
    } else if lower.contains("stake too low") || lower.contains("paymaster stake") {
        (
            "PAYMASTER_STAKE_LOW",
            "Shared paymaster is not staked on EntryPoint. Operator: factory.addPaymasterStake (≥0.1 ETH, delay ≥1 day on Sepolia) — not the squad sponsor pool.".into(),
        )
    } else if lower.contains("ran out of gas for entity: paymaster")
        || lower.contains("out of gas for entity: paymaster")
    {
        (
            "PAYMASTER_VERIFICATION_GAS",
            "Bundler paymaster simulation ran out of gas. Client paymasterVerificationGasLimit may be too low for Hats/registry validation.".into(),
        )
    } else if lower.contains("ran out of gas for entity: account")
        || lower.contains("out of gas for entity: account")
    {
        (
            "USEROP_CALL_GAS",
            format!(
                "Bundler account call simulation ran out of gas. Hats/Safe execute may need the heavy call-gas ceiling. Detail: {raw}"
            ),
        )
    } else if lower.contains("verification gas limit efficiency")
        || lower.contains("gas limit efficiency too low")
    {
        (
            "PAYMASTER_GAS_EFFICIENCY",
            "Bundler rejected a verification gas limit as too high vs gas used (efficiency floor). Limits should come from eth_estimateUserOperationGas with a small margin.".into(),
        )
    } else if lower.contains("banned opcode")
        || (lower.contains("-32502") && !lower.contains("ran out of gas"))
    {
        (
            "PAYMASTER_VALIDATION",
            format!(
                "Bundler rejected paymaster validation (-32502 / banned opcode). Usually an old clone still wired to a pre-redeploy paymaster, or a stale Tauri binary after an address-book cutover. Recreate the squad sponsor under the current factory, restart tauri:dev, and confirm factory stake + EP deposit. Detail: {raw}"
            ),
        )
    } else if lower.contains("max gas per userop") || lower.contains("exceeded the max gas") {
        (
            "BUNDLER_GAS_LIMIT",
            format!(
                "Bundler rejected UserOp: gas limits exceed the max gas per userOp. Detail: {raw}"
            ),
        )
    } else if lower.contains("maxpriorityfeepergas") || lower.contains("maxfeepergas") {
        (
            "BUNDLER_FEE",
            "Bundler rejected UserOp gas fees (maxFeePerGas or priority fee below floor). Retry after updating the client.".into(),
        )
    } else if lower.contains("aa23")
        || lower.contains("validationfunctionmissing")
        || lower.contains("cf7b49f6")
    {
        (
            "ACCOUNT_VALIDATION",
            "Account validateUserOp reverted (AA23). For PactoSimple7702Account check nonce key 0 and bare ECDSA over userOpHash.".into(),
        )
    } else if lower.contains("-32507") || lower.contains("invalid account signature") {
        (
            "ACCOUNT_SIGNATURE",
            "Account signature invalid (-32507). PactoSimple7702Account expects bare ECDSA over the EntryPoint userOpHash (sign_hash), not personal_sign or MAv2 packing.".into(),
        )
    } else if lower.contains("aa33") {
        (
            "PAYMASTER_VALIDATION",
            format!("Paymaster validateUserOp reverted (AA33). Detail: {raw}"),
        )
    } else if lower.contains("useroperation reverted during simulation")
        || lower.contains("user operation reverted during simulation")
        || lower.contains("execution reverted")
        || lower.contains("aa40")
    {
        if let Some((code, msg)) = classify_gov_call_revert(raw) {
            (code, msg.to_string())
        } else {
            (
                "GOV_CALL_REVERTED",
                "Sponsored UserOp call reverted during simulation.".into(),
            )
        }
    } else {
        ("PAYMASTER_REJECTED", raw.to_string())
    }
}

/// Poll cadence and overall bound while waiting for UserOp inclusion on L1.
const USEROP_RECEIPT_POLL_INTERVAL: Duration = Duration::from_secs(2);
const USEROP_RECEIPT_WAIT_BOUND: Duration = Duration::from_secs(90);

/// `eth_getUserOperationReceipt`; `Ok(None)` while the bundler has no receipt yet.
async fn bundler_get_user_operation_receipt(
    bundler_url: &str,
    user_op_hash: &str,
) -> Result<Option<Value>, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getUserOperationReceipt",
        "params": [user_op_hash]
    });
    let mut attempt = 0u32;
    let res = loop {
        attempt += 1;
        match bundler_rpc(bundler_url, &body).await {
            Err(e) if e.retriable && attempt < BUNDLER_MAX_ATTEMPTS => {
                tokio::time::sleep(bundler_retry_delay(attempt)).await;
            }
            result => break result,
        }
    };
    let res = res.map_err(|e| {
        wallet_err_json(
            "BUNDLER_RPC",
            format!(
                "bundler rpc failed after {attempt} attempt(s): {}",
                e.message
            ),
            None,
        )
    })?;
    if let Some(error) = res.get("error") {
        return Err(wallet_err_json(
            "USEROP_RECEIPT",
            crate::evm::wallet_security::redact_urls_in_text(&error.to_string()),
            None,
        ));
    }
    match res.get("result") {
        None | Some(Value::Null) => Ok(None),
        Some(receipt) => Ok(Some(receipt.clone())),
    }
}

/// Parsed fields from a bundler `eth_getUserOperationReceipt` result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SponsoredUserOpReceipt {
    pub tx_hash: String,
    pub success: bool,
    /// Bundler `actualGasCost` as decimal wei when present.
    pub actual_gas_cost_wei: Option<String>,
}

/// Real L1 transaction hash from an `eth_getUserOperationReceipt` result.
fn receipt_transaction_hash(receipt: &Value) -> Option<String> {
    receipt
        .get("receipt")?
        .get("transactionHash")?
        .as_str()
        .map(str::to_string)
}

/// Prefer top-level UserOp `success`; fall back to nested L1 `receipt.status`.
fn receipt_success(receipt: &Value) -> Option<bool> {
    if let Some(v) = receipt.get("success") {
        return v.as_bool();
    }
    parse_l1_receipt_status(receipt.get("receipt")?.get("status")?)
}

fn parse_l1_receipt_status(raw: &Value) -> Option<bool> {
    match raw {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => n.as_u64().map(|v| v != 0),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return None;
            }
            let n = if t.starts_with("0x") || t.starts_with("0X") {
                u64::from_str_radix(t.trim_start_matches("0x").trim_start_matches("0X"), 16).ok()?
            } else {
                u64::from_str_radix(t, 10).ok()?
            };
            Some(n != 0)
        }
        _ => None,
    }
}

fn parse_actual_gas_cost_wei(raw: &Value) -> Option<String> {
    match raw {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return None;
            }
            let wei = if t.starts_with("0x") || t.starts_with("0X") {
                U256::from_str_radix(t.trim_start_matches("0x").trim_start_matches("0X"), 16)
                    .ok()?
            } else {
                U256::from_str_radix(t, 10).ok()?
            };
            Some(wei.to_string())
        }
        Value::Number(n) => n.as_u64().map(|v| U256::from(v).to_string()),
        _ => None,
    }
}

fn receipt_actual_gas_cost_wei(receipt: &Value) -> Option<String> {
    parse_actual_gas_cost_wei(receipt.get("actualGasCost")?)
}

/// Extract inclusion outcome from a bundler UserOp receipt object.
pub fn parse_sponsored_user_op_receipt(receipt: &Value) -> Result<SponsoredUserOpReceipt, String> {
    let tx_hash = receipt_transaction_hash(receipt).ok_or_else(|| {
        wallet_err_json(
            "USEROP_RECEIPT",
            "bundler receipt has no L1 transaction hash",
            None,
        )
    })?;
    let success = receipt_success(receipt).ok_or_else(|| {
        wallet_err_json(
            "USEROP_RECEIPT",
            "bundler receipt missing success / receipt.status",
            None,
        )
    })?;
    Ok(SponsoredUserOpReceipt {
        tx_hash,
        success,
        actual_gas_cost_wei: receipt_actual_gas_cost_wei(receipt),
    })
}

/// Polls until the UserOp is included; returns success, optional gas cost, and L1 tx hash.
pub async fn wait_for_user_operation_receipt(
    bundler_url: &str,
    user_op_hash: &str,
) -> Result<SponsoredUserOpReceipt, String> {
    let deadline = std::time::Instant::now() + USEROP_RECEIPT_WAIT_BOUND;
    loop {
        match bundler_get_user_operation_receipt(bundler_url, user_op_hash).await {
            Ok(Some(receipt)) => {
                return parse_sponsored_user_op_receipt(&receipt).map_err(|e| {
                    if e.contains("no L1 transaction hash") {
                        wallet_err_json(
                            "USEROP_RECEIPT",
                            format!(
                                "bundler receipt for {user_op_hash} has no L1 transaction hash"
                            ),
                            None,
                        )
                    } else {
                        e
                    }
                });
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!(target: "pacto_wallet", "userop receipt poll failed; retrying: {e}");
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err(wallet_err_json(
                "USEROP_RECEIPT_TIMEOUT",
                format!(
                    "UserOp {user_op_hash} was not included within {}s. It may still be mined — track it by userOpHash on the bundler or explorer before resubmitting.",
                    USEROP_RECEIPT_WAIT_BOUND.as_secs()
                ),
                None,
            ));
        }
        tokio::time::sleep(USEROP_RECEIPT_POLL_INTERVAL).await;
    }
}

/// Polls until included and returns the L1 transaction hash only.
#[allow(dead_code)]
pub async fn wait_for_user_operation_tx_hash(
    bundler_url: &str,
    user_op_hash: &str,
) -> Result<String, String> {
    Ok(wait_for_user_operation_receipt(bundler_url, user_op_hash)
        .await?
        .tx_hash)
}

/// Bundler JSON-RPC request timeout; a slow bundler must not hang the command.
const BUNDLER_RPC_TIMEOUT: Duration = Duration::from_secs(30);
const BUNDLER_MAX_ATTEMPTS: u32 = 3;
const BUNDLER_RETRY_BASE_DELAY: Duration = Duration::from_millis(250);
const BUNDLER_RETRY_MAX_DELAY: Duration = Duration::from_secs(2);

/// Builds the bundler JSON-RPC client. Built fresh per call (instead of a
/// cached static) so a Tor routing toggle takes effect on the next call
/// rather than requiring a restart -- see net_transport.rs.
fn bundler_http_client() -> Result<reqwest::Client, BundlerRpcError> {
    crate::net_transport::http_client_builder()
        .map_err(|e| BundlerRpcError {
            retriable: false,
            message: e,
        })?
        .timeout(BUNDLER_RPC_TIMEOUT)
        .build()
        .map_err(|e| BundlerRpcError {
            retriable: false,
            message: e.to_string(),
        })
}

/// Bundler call failure; `retriable` marks transient transport/HTTP conditions.
#[derive(Debug)]
struct BundlerRpcError {
    retriable: bool,
    message: String,
}

/// 429 and 5xx are transient; other non-success statuses are final.
fn retriable_bundler_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// Full-jitter exponential backoff, capped.
fn bundler_retry_delay(attempt: u32) -> Duration {
    let shift = attempt.saturating_sub(1).min(10);
    let cap = BUNDLER_RETRY_BASE_DELAY
        .as_millis()
        .saturating_mul(1u128 << shift)
        .min(BUNDLER_RETRY_MAX_DELAY.as_millis()) as u64;
    Duration::from_millis(rand::random::<u64>() % cap.saturating_add(1))
}

/// Redacts transport errors; timeouts name the bound so callers can tell slow bundlers from failures.
fn bundler_transport_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        format!(
            "bundler request timed out after {}s",
            BUNDLER_RPC_TIMEOUT.as_secs()
        )
    } else {
        crate::evm::wallet_security::redact_urls_in_text(&e.to_string())
    }
}

async fn bundler_rpc(url: &str, body: &Value) -> Result<Value, BundlerRpcError> {
    let client = bundler_http_client()?;
    let res = client
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|e| BundlerRpcError {
            retriable: e.is_timeout() || e.is_connect(),
            message: bundler_transport_error(&e),
        })?;
    let status = res.status();
    let text = res.text().await.map_err(|e| BundlerRpcError {
        retriable: e.is_timeout() || e.is_connect(),
        message: bundler_transport_error(&e),
    })?;
    if !status.is_success() {
        return Err(BundlerRpcError {
            retriable: retriable_bundler_status(status),
            message: crate::evm::wallet_security::redact_urls_in_text(&text),
        });
    }
    serde_json::from_str(&text).map_err(|e| BundlerRpcError {
        retriable: false,
        message: e.to_string(),
    })
}

/// Structured `wallet_err_json` code when present.
pub(crate) fn wallet_error_code(err: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(err).ok()?;
    parsed.get("code")?.as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evm::sponsor_paymaster::{
        default_post_op_gas_limit, encode_paymaster_and_data, paymaster_data_offset,
    };
    use alloy::primitives::{address, b256, U256};
    use reqwest::StatusCode;
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn pack_u128s_puts_hi_lo() {
        let packed = pack_u128s(100_000, 500_000);
        let mut expected = [0u8; 32];
        expected[..16].copy_from_slice(&100_000u128.to_be_bytes());
        expected[16..].copy_from_slice(&500_000u128.to_be_bytes());
        assert_eq!(packed, B256::from(expected));
    }

    #[test]
    fn userop_max_cost_covers_all_gas_limits() {
        let cost = userop_max_cost_wei(500_000, 100_000, 80_000, 30_000_000_000, 250_000, 50_000);
        assert_eq!(
            cost,
            U256::from(30_000_000_000u128)
                * U256::from(500_000u128 + 100_000 + 80_000 + 250_000 + 50_000)
        );
    }

    #[test]
    fn call_gas_margin_adds_headroom() {
        assert_eq!(call_gas_with_margin(100_000), 120_000);
        assert_eq!(call_gas_with_margin(0), 0);
        assert_eq!(apply_userop_gas_margin(113_392), 136_070);
    }

    #[test]
    fn verification_gas_margin_uses_1_2x_under_efficiency_cap() {
        // 1.2× is below 2.0×, so pad equals call-gas margin.
        assert_eq!(apply_verification_gas_margin(100_000), 120_000);
        assert_eq!(apply_verification_gas_margin(113_393), 136_071);
        assert_eq!(apply_verification_gas_margin(0), 0);
    }

    #[test]
    fn verification_gas_margin_never_exceeds_2x_estimate() {
        // Efficiency floor 0.4 ⇒ used/limit ≥ 0.4 ⇒ limit ≤ used/0.4 ≈ 2.5×; we cap at 2.0×.
        let estimate = 113_393u128;
        assert!(apply_verification_gas_margin(estimate) <= estimate * 2);
        assert!(apply_verification_gas_margin(estimate) >= estimate);
        // If 1.2× somehow exceeded 2× (impossible with current BPS), still clamp — exercise cap path
        // by checking max pad ratio for a large estimate equals 1.2× here, and that 2× is the hard ceiling.
        assert_eq!(
            apply_verification_gas_margin(estimate).min(estimate * 2),
            apply_verification_gas_margin(estimate)
        );
    }

    #[test]
    fn finalize_small_userop_keeps_full_margin() {
        let estimated = EstimatedUserOpGas {
            call_gas_limit: 100_000,
            verification_gas_limit: 100_000,
            pre_verification_gas: 80_000,
            paymaster_verification_gas_limit: 100_000,
            paymaster_post_op_gas_limit: 50_000,
        };
        let limits = finalize_userop_gas_limits(&estimated).expect("small op");
        assert_eq!(limits.call_gas_limit, apply_userop_gas_margin(100_000));
        assert_eq!(
            limits.verification_gas_limit,
            apply_verification_gas_margin(100_000)
        );
        assert_eq!(limits.pre_verification_gas, apply_userop_gas_margin(80_000));
        assert_eq!(
            limits.paymaster_verification_gas_limit,
            apply_verification_gas_margin(100_000)
        );
        assert_eq!(
            limits.paymaster_post_op_gas_limit,
            apply_userop_gas_margin(50_000)
        );
        assert!(limits.sum() <= bundler_userop_gas_cap());
    }

    #[test]
    fn finalize_factory_userop_clamps_pad_to_bundler_cap() {
        let estimated = EstimatedUserOpGas {
            call_gas_limit: 13_000_000,
            verification_gas_limit: 400_000,
            pre_verification_gas: 200_000,
            paymaster_verification_gas_limit: 400_000,
            paymaster_post_op_gas_limit: 100_000,
        };
        let raw_sum = 14_100_000u128;
        assert_eq!(
            estimated.call_gas_limit
                + estimated.verification_gas_limit
                + estimated.pre_verification_gas
                + estimated.paymaster_verification_gas_limit
                + estimated.paymaster_post_op_gas_limit,
            raw_sum
        );
        let padded_sum = apply_userop_gas_margin(13_000_000)
            + apply_verification_gas_margin(400_000)
            + apply_userop_gas_margin(200_000)
            + apply_verification_gas_margin(400_000)
            + apply_userop_gas_margin(100_000);
        assert!(padded_sum > bundler_userop_gas_cap());
        let limits = finalize_factory_userop_gas_limits(&estimated);
        assert!(limits.sum() <= bundler_userop_gas_cap());
        assert_eq!(limits.call_gas_limit, estimated.call_gas_limit);
        assert_eq!(
            limits.verification_gas_limit,
            estimated.verification_gas_limit
        );
        assert_eq!(limits.pre_verification_gas, estimated.pre_verification_gas);
        assert_eq!(
            limits.paymaster_verification_gas_limit,
            estimated.paymaster_verification_gas_limit
        );
        assert_eq!(
            limits.paymaster_post_op_gas_limit,
            estimated.paymaster_post_op_gas_limit
        );
        assert_ne!(
            limits.call_gas_limit,
            apply_userop_gas_margin(estimated.call_gas_limit)
        );
    }

    #[test]
    fn finalize_factory_sixteen_million_fixture_cuts_call() {
        let estimated = EstimatedUserOpGas {
            call_gas_limit: 14_500_000,
            verification_gas_limit: 800_000,
            pre_verification_gas: 400_000,
            paymaster_verification_gas_limit: 800_000,
            paymaster_post_op_gas_limit: 294_139,
        };
        assert_eq!(
            estimated.call_gas_limit
                + estimated.verification_gas_limit
                + estimated.pre_verification_gas
                + estimated.paymaster_verification_gas_limit
                + estimated.paymaster_post_op_gas_limit,
            16_794_139
        );
        let limits = finalize_factory_userop_gas_limits(&estimated);
        assert_eq!(limits.sum(), bundler_userop_gas_cap());
        assert_eq!(limits.verification_gas_limit, 800_000);
        assert_eq!(limits.pre_verification_gas, 400_000);
        assert_eq!(limits.paymaster_verification_gas_limit, 800_000);
        assert_eq!(limits.paymaster_post_op_gas_limit, 294_139);
        assert_eq!(limits.call_gas_limit, 13_705_861);
    }

    #[test]
    fn finalize_shared_sixteen_million_fixture_stays_at_cap() {
        let estimated = EstimatedUserOpGas {
            call_gas_limit: 14_500_000,
            verification_gas_limit: 800_000,
            pre_verification_gas: 400_000,
            paymaster_verification_gas_limit: 800_000,
            paymaster_post_op_gas_limit: 294_139,
        };
        let limits = finalize_userop_gas_limits(&estimated).expect("clamp over-cap raw");
        assert!(limits.sum() <= bundler_userop_gas_cap());
        assert_eq!(limits.sum(), bundler_userop_gas_cap());
    }

    #[test]
    fn clamp_estimate_pass_echo_stays_at_cap() {
        let estimated = EstimatedUserOpGas {
            call_gas_limit: 14_500_000,
            verification_gas_limit: 800_000,
            pre_verification_gas: 400_000,
            paymaster_verification_gas_limit: 800_000,
            paymaster_post_op_gas_limit: 294_139,
        };
        assert_eq!(
            estimated.call_gas_limit
                + estimated.verification_gas_limit
                + estimated.pre_verification_gas
                + estimated.paymaster_verification_gas_limit
                + estimated.paymaster_post_op_gas_limit,
            16_794_139
        );
        let limits = clamp_estimated_gas_to_bundler_cap(&estimated);
        assert_eq!(limits.sum(), bundler_userop_gas_cap());
        assert_eq!(limits.verification_gas_limit, 800_000);
        assert_eq!(limits.pre_verification_gas, 400_000);
        assert_eq!(limits.paymaster_verification_gas_limit, 800_000);
        assert_eq!(limits.paymaster_post_op_gas_limit, 294_139);
        assert_eq!(limits.call_gas_limit, 13_705_861);
    }

    #[test]
    fn clamp_under_cap_is_identity() {
        let estimated = EstimatedUserOpGas {
            call_gas_limit: 100_000,
            verification_gas_limit: 100_000,
            pre_verification_gas: 80_000,
            paymaster_verification_gas_limit: 100_000,
            paymaster_post_op_gas_limit: 50_000,
        };
        let limits = clamp_estimated_gas_to_bundler_cap(&estimated);
        assert_eq!(limits.call_gas_limit, 100_000);
        assert_eq!(limits.verification_gas_limit, 100_000);
        assert_eq!(limits.pre_verification_gas, 80_000);
        assert_eq!(limits.paymaster_verification_gas_limit, 100_000);
        assert_eq!(limits.paymaster_post_op_gas_limit, 50_000);
    }

    #[test]
    fn skip_calibrate_when_pad_would_exceed_cap() {
        let factory = EstimatedUserOpGas {
            call_gas_limit: 13_000_000,
            verification_gas_limit: 400_000,
            pre_verification_gas: 200_000,
            paymaster_verification_gas_limit: 400_000,
            paymaster_post_op_gas_limit: 100_000,
        };
        assert!(should_skip_estimate_calibrate(&factory));
        let small = EstimatedUserOpGas {
            call_gas_limit: 100_000,
            verification_gas_limit: 100_000,
            pre_verification_gas: 80_000,
            paymaster_verification_gas_limit: 100_000,
            paymaster_post_op_gas_limit: 50_000,
        };
        assert!(!should_skip_estimate_calibrate(&small));
        let already_over = EstimatedUserOpGas {
            call_gas_limit: 14_500_000,
            verification_gas_limit: 800_000,
            pre_verification_gas: 400_000,
            paymaster_verification_gas_limit: 800_000,
            paymaster_post_op_gas_limit: 294_139,
        };
        assert!(should_skip_estimate_calibrate(&already_over));
    }

    #[test]
    fn small_op_calibrate_request_stays_under_cap() {
        let small = EstimatedUserOpGas {
            call_gas_limit: 100_000,
            verification_gas_limit: 100_000,
            pre_verification_gas: 80_000,
            paymaster_verification_gas_limit: 100_000,
            paymaster_post_op_gas_limit: 50_000,
        };
        assert!(!should_skip_estimate_calibrate(&small));
        let request = clamp_estimated_gas_to_bundler_cap(&small);
        assert!(request.sum() <= bundler_userop_gas_cap());
    }

    #[test]
    fn bundler_cap_fallback_fills_sixteen_million() {
        let estimated = bundler_cap_fallback_estimate(100_000, 80_000, 500_000, 50_000);
        assert_eq!(
            estimated.call_gas_limit
                + estimated.verification_gas_limit
                + estimated.pre_verification_gas
                + estimated.paymaster_verification_gas_limit
                + estimated.paymaster_post_op_gas_limit,
            bundler_userop_gas_cap()
        );
        assert_eq!(estimated.call_gas_limit, 15_270_000);
    }

    #[test]
    fn bundler_gas_limit_error_matches_pimlico_json() {
        assert!(is_bundler_gas_limit_error(
            r#"{"code":"BUNDLER_GAS_LIMIT","message":"User operation gas limits exceeded the max gas per userOp: 16794127 > 16000000"}"#
        ));
        assert!(is_bundler_gas_limit_error(
            "User operation gas limits exceeded the max gas per userOp: 16949303 > 16000000"
        ));
        assert!(!is_bundler_gas_limit_error(
            r#"{"code":"BUNDLER_FEE","message":"x"}"#
        ));
        assert!(is_bundler_gas_limit_error(&factory_userop_too_large_error()));
    }

    #[test]
    fn finalize_clamps_when_bundler_return_exceeds_cap() {
        let estimated = EstimatedUserOpGas {
            call_gas_limit: 15_000_000,
            verification_gas_limit: 500_000,
            pre_verification_gas: 200_000,
            paymaster_verification_gas_limit: 300_000,
            paymaster_post_op_gas_limit: 100_001,
        };
        let limits = finalize_userop_gas_limits(&estimated).expect("clamp over-cap return");
        assert_eq!(limits.sum(), bundler_userop_gas_cap());
        assert_eq!(limits.verification_gas_limit, 500_000);
        assert!(limits.call_gas_limit < estimated.call_gas_limit);
    }

    #[test]
    fn user_op_json_serializes_erc4337_fields() {
        let member = address!("0x3333333333333333333333333333333333333333");
        let paymaster = address!("0x78197483Ac3180361cDb1F59Dd702Ea8ca34AC3A");
        let squad_id = b256!("0x1111111111111111111111111111111111111111111111111111111111111111");
        let sponsor = address!("0x2222222222222222222222222222222222222222");
        let paymaster_and_data =
            encode_paymaster_and_data(paymaster, squad_id, sponsor, member, 136_070, 60_000);
        let op = user_op_json(UserOpParams {
            sender: member,
            nonce: U256::from(7),
            call_data: &[0xde, 0xad],
            call_gas_limit: 210_000,
            verification_gas_limit: 100_000,
            pre_verification_gas: 80_000,
            max_fee_per_gas: 30_000_000_000,
            max_priority_fee_per_gas: 1_000_000_000,
            paymaster,
            paymaster_verification_gas_limit: 136_070,
            paymaster_post_op_gas_limit: 60_000,
            paymaster_and_data: &paymaster_and_data,
            signature: &[0xaa; 65],
            eip7702_auth: None,
        })
        .unwrap();
        assert_eq!(op["sender"], json!(format!("{member:#x}")));
        assert_eq!(op["nonce"], json!("0x7"));
        assert!(op["factory"].is_null());
        assert_eq!(op["factoryData"], json!("0x"));
        assert_eq!(op["callData"], json!("0xdead"));
        assert_eq!(op["callGasLimit"], json!("0x33450"));
        assert_eq!(op["verificationGasLimit"], json!("0x186a0"));
        assert_eq!(op["preVerificationGas"], json!("0x13880"));
        assert_eq!(op["maxFeePerGas"], json!("0x6fc23ac00"));
        assert_eq!(op["maxPriorityFeePerGas"], json!("0x3b9aca00"));
        assert_eq!(op["paymaster"], json!(format!("{paymaster:#x}")));
        assert_eq!(op["paymasterVerificationGasLimit"], json!("0x21386"));
        assert_eq!(op["paymasterPostOpGasLimit"], json!("0xea60"));
        let expected_pmd = hex::encode(&paymaster_and_data[paymaster_data_offset()..]);
        assert_eq!(op["paymasterData"], json!(format!("0x{expected_pmd}")));
        assert_eq!(op["signature"], json!(format!("0x{}", "aa".repeat(65))));
        assert!(op["eip7702Auth"].is_null());
    }

    #[test]
    fn user_op_json_shared_keys_stable_for_username_and_squad() {
        // Both send_sponsored_* paths must serialize the same ERC-4337 / 7702 key set
        // via user_op_json (Layer 2 field-diff baseline).
        const REQUIRED: &[&str] = &[
            "sender",
            "nonce",
            "factory",
            "factoryData",
            "callData",
            "callGasLimit",
            "verificationGasLimit",
            "preVerificationGas",
            "maxFeePerGas",
            "maxPriorityFeePerGas",
            "paymaster",
            "paymasterVerificationGasLimit",
            "paymasterPostOpGasLimit",
            "paymasterData",
            "signature",
            "eip7702Auth",
        ];
        let member = address!("0x3333333333333333333333333333333333333333");
        let paymaster = address!("0x1C2eb4Ac1cD57aF67ad8B20838A28FB23d39d5b8");
        let paymaster_and_data = {
            let mut v = vec![0u8; paymaster_data_offset()];
            v.extend_from_slice(&[0x01, 0x02, 0x03, 0x04]);
            v
        };
        let auth = json!({
            "chainId": "0xaa36a7",
            "address": "0x2E9156deE65d7946305C334824e2648Ff9128f45",
            "nonce": "0x0",
            "yParity": "0x0",
            "r": format!("0x{}", "11".repeat(32)),
            "s": format!("0x{}", "22".repeat(32)),
        });
        let op = user_op_json(UserOpParams {
            sender: member,
            nonce: U256::ZERO,
            call_data: &[0xb6, 0x1d, 0x27, 0xf6],
            call_gas_limit: 1_500_000,
            verification_gas_limit: 100_000,
            pre_verification_gas: 80_000,
            max_fee_per_gas: 30_000_000_000,
            max_priority_fee_per_gas: 1_000_000_000,
            paymaster,
            paymaster_verification_gas_limit: 200_000,
            paymaster_post_op_gas_limit: 60_000,
            paymaster_and_data: &paymaster_and_data,
            signature: &[0xbb; 65],
            eip7702_auth: Some(auth.clone()),
        })
        .unwrap();
        let obj = op.as_object().expect("object");
        for key in REQUIRED {
            assert!(obj.contains_key(*key), "missing UserOp key {key}");
        }
        assert_eq!(
            obj.len(),
            REQUIRED.len(),
            "unexpected extra UserOp keys: {obj:?}"
        );
        assert_eq!(op["eip7702Auth"], auth);
        assert!(op["factory"].is_null());
        assert_eq!(op["signature"].as_str().unwrap().len(), 2 + 65 * 2);
    }

    #[test]
    fn parse_estimate_user_op_gas_response_reads_v07_fields() {
        let res = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "preVerificationGas": "0x13880",
                "verificationGasLimit": "0x186a0",
                "callGasLimit": "0x33450",
                "paymasterVerificationGasLimit": "0x1bb00",
                "paymasterPostOpGasLimit": "0xc350"
            }
        });
        let g = parse_estimate_user_op_gas_response(&res).unwrap();
        assert_eq!(g.pre_verification_gas, 80_000);
        assert_eq!(g.verification_gas_limit, 100_000);
        assert_eq!(g.call_gas_limit, 210_000);
        assert_eq!(g.paymaster_verification_gas_limit, 113_408);
        assert_eq!(g.paymaster_post_op_gas_limit, 50_000);
        assert_eq!(
            apply_verification_gas_margin(g.paymaster_verification_gas_limit),
            136_089
        );
    }

    #[test]
    fn parse_estimate_user_op_gas_response_maps_bundler_errors() {
        let res = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -32602, "message": "Verification gas limit efficiency too low. Required: 0.4, Actual: 0.226785"}
        });
        let err = parse_estimate_user_op_gas_response(&res).unwrap_err();
        assert!(err.contains("PAYMASTER_GAS_EFFICIENCY"));

        let sim = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {
                "code": -32521,
                "message": "UserOperation reverted during simulation with reason: 0xdeadbeef"
            }
        });
        let err = parse_estimate_user_op_gas_response(&sim).unwrap_err();
        assert!(err.contains("GOV_CALL_REVERTED"));
        assert!(err.contains("Sponsored UserOp call reverted during simulation."));
    }

    #[test]
    fn parse_estimate_defaults_omitted_paymaster_post_op() {
        let res = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "preVerificationGas": "0x13880",
                "verificationGasLimit": "0x186a0",
                "callGasLimit": "0x33450",
                "paymasterVerificationGasLimit": "0x1bb00"
            }
        });
        let g = parse_estimate_user_op_gas_response(&res).unwrap();
        assert_eq!(g.paymaster_verification_gas_limit, 113_408);
        assert_eq!(g.paymaster_post_op_gas_limit, default_post_op_gas_limit());

        let null_post = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "preVerificationGas": "0x13880",
                "verificationGasLimit": "0x186a0",
                "callGasLimit": "0x33450",
                "paymasterVerificationGasLimit": "0x1bb00",
                "paymasterPostOpGasLimit": null
            }
        });
        let g = parse_estimate_user_op_gas_response(&null_post).unwrap();
        assert_eq!(g.paymaster_post_op_gas_limit, default_post_op_gas_limit());
    }

    #[test]
    fn parse_estimate_requires_paymaster_verification_gas() {
        let res = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "preVerificationGas": "0x13880",
                "verificationGasLimit": "0x186a0",
                "callGasLimit": "0x33450"
            }
        });
        let err = parse_estimate_user_op_gas_response(&res).unwrap_err();
        assert!(err.contains("BUNDLER_ESTIMATE"));
        assert!(err.contains("paymasterVerificationGasLimit"));
    }

    #[test]
    fn parse_hex_u128_accepts_hex_strings() {
        assert_eq!(parse_hex_u128("0x0"), Some(0));
        assert_eq!(parse_hex_u128("0x7a120"), Some(500_000));
        assert_eq!(parse_hex_u128("not-hex"), None);
    }

    #[test]
    fn dummy_userop_signature_is_bare_ecdsa_length() {
        let dummy = dummy_userop_signature();
        assert_eq!(dummy.len(), 65);
        assert_eq!(dummy[64], 0x1c);
    }

    #[test]
    fn paymaster_data_slices_past_header_and_rejects_short_input() {
        let pmd = paymaster_data(&[0u8; 180]).unwrap();
        assert_eq!(pmd.len(), 180 - paymaster_data_offset());
        assert_eq!(paymaster_data(&[0u8; 52]).unwrap(), &[] as &[u8]);
        let err = paymaster_data(&[0u8; 51]).unwrap_err();
        assert!(err.contains("PAYMASTER_DATA"));
    }

    #[test]
    fn parse_send_user_op_response_returns_hash_on_success() {
        let ok = json!({"jsonrpc": "2.0", "id": 1, "result": "0xabc"});
        assert_eq!(parse_send_user_op_response(&ok).unwrap(), "0xabc");
    }

    #[test]
    fn parse_send_user_op_response_codes_bundler_rejects() {
        let rejected = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -32500, "message": "paymaster stake too low"}
        });
        let err = parse_send_user_op_response(&rejected).unwrap_err();
        assert!(err.contains("PAYMASTER_STAKE_LOW"));
        assert!(err.contains("addPaymasterStake"));

        let missing = json!({"jsonrpc": "2.0", "id": 1});
        let err = parse_send_user_op_response(&missing).unwrap_err();
        assert!(err.contains("PAYMASTER_REJECTED"));
        assert!(err.contains("eth_sendUserOperation failed"));

        let sim = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {
                "code": -32521,
                "message": "UserOperation reverted during simulation",
                "data": "https://api.pimlico.io/v2/11155111/rpc?apikey=secret-key"
            }
        });
        let err = parse_send_user_op_response(&sim).unwrap_err();
        assert!(err.contains("GOV_CALL_REVERTED"));
        assert!(err.contains("Sponsored UserOp call reverted during simulation."));
        // Classified toast must not echo bundler URL secrets (detail only on stderr).
        assert!(!err.contains("secret-key"));
        assert!(!err.contains("apikey="));
    }

    #[test]
    fn classify_bundler_rejects_maps_deposit_stake_and_fee() {
        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32000,"message":"precheck failed: paymaster deposit is 0"}"#,
        );
        assert_eq!(code, "PAYMASTER_DEPOSIT_LOW");
        assert!(msg.contains("paymaster.deposit()"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32000,"message":"maxPriorityFeePerGas is 1500000 but must be at least 1000000000"}"#,
        );
        assert_eq!(code, "BUNDLER_FEE");
        assert!(msg.contains("priority fee"));

        let (code, msg) = classify_bundler_userop_reject(
            "maxFeePerGas must be at least 11000000002 (current maxFeePerGas: 1000000000) - use pimlico_getUserOperationGasPrice to get the current gas price",
        );
        assert_eq!(code, "BUNDLER_FEE");
        assert!(msg.contains("maxFeePerGas") || msg.contains("priority fee"));

        let (code, msg) = classify_bundler_userop_reject(
            "User operation gas limits exceeded the max gas per userOp: 16949303 > 16000000",
        );
        assert_eq!(code, "BUNDLER_GAS_LIMIT");
        assert!(msg.contains("16949303"));
        assert!(msg.contains("16000000"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32500,"data":{"reason":"AA23 reverted","revertData":"0xcf7b49f6b61d27f6"},"message":"validation reverted"}"#,
        );
        assert_eq!(code, "ACCOUNT_VALIDATION");
        assert!(msg.contains("AA23"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32507,"message":"Invalid account signature"}"#,
        );
        assert_eq!(code, "ACCOUNT_SIGNATURE");
        assert!(msg.contains("bare ECDSA") || msg.contains("userOpHash"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32502,"message":"Simulation ran out of gas for entity: paymaster:\"0x78197483Ac3180361cDb1F59Dd702Ea8ca34AC3A\""}"#,
        );
        assert_eq!(code, "PAYMASTER_VERIFICATION_GAS");
        assert!(msg.contains("paymasterVerificationGasLimit") || msg.contains("out of gas"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32602,"message":"Verification gas limit efficiency too low. Required: 0.4, Actual: 0.226785"}"#,
        );
        assert_eq!(code, "PAYMASTER_GAS_EFFICIENCY");
        assert!(msg.contains("efficiency") || msg.contains("estimateUserOperationGas"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32502,"message":"paymaster uses banned opcode: BALANCE"}"#,
        );
        assert_eq!(code, "PAYMASTER_VALIDATION");
        assert!(msg.contains("banned opcode"));
        assert!(msg.contains("BALANCE") || msg.contains("recreate"));

        let (code, msg) = classify_bundler_userop_reject("something else");
        assert_eq!(code, "PAYMASTER_REJECTED");
        assert_eq!(msg, "something else");

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32502,"message":"Simulation ran out of gas for entity: account"}"#,
        );
        assert_eq!(code, "USEROP_CALL_GAS");
        assert!(msg.contains("entity: account"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32500,"data":{"reason":"AA33 reverted"},"message":"paymaster validation"}"#,
        );
        assert_eq!(code, "PAYMASTER_VALIDATION");
        assert!(msg.contains("AA33"));

        let (code, msg) = classify_bundler_userop_reject(
            r#"{"code":-32521,"message":"UserOperation reverted during simulation with reason: MutinyModule_Expired"}"#,
        );
        assert_eq!(code, "MUTINY_EXPIRED");
        assert!(msg.contains("deadline") || msg.contains("expired"));

        let (code, _) = classify_bundler_userop_reject(
            "server returned an error response: error code 3: execution reverted, data: '0xc4aedfdd'",
        );
        assert_eq!(code, "MUTINY_NOT_ACTIVE");
    }

    #[test]
    fn userop_call_gas_error_reads_structured_code() {
        assert!(is_userop_call_gas_error(
            r#"{"code":"USEROP_CALL_GAS","message":"ran out of gas for entity: account"}"#
        ));
        assert!(!is_userop_call_gas_error(
            r#"{"code":"PAYMASTER_REJECTED","message":"ran out of gas for entity: account"}"#
        ));
        assert!(!is_userop_call_gas_error("USEROP_CALL_GAS as plain text"));
    }

    #[test]
    fn pacto_simple_7702_userop_sig_is_bare_ecdsa_over_hash() {
        use alloy::primitives::keccak256;
        use alloy::signers::local::PrivateKeySigner;
        use alloy::signers::SignerSync;

        let signer: PrivateKeySigner =
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
                .parse()
                .unwrap();
        let user_op_hash = keccak256(b"fake-userop-hash-for-test");

        let sig = signer.sign_hash_sync(&user_op_hash).unwrap();
        let recovered = sig.recover_address_from_prehash(&user_op_hash).unwrap();
        assert_eq!(recovered, signer.address());
        assert_eq!(sig.as_bytes().len(), 65);

        // personal_sign digests would not recover against the raw userOpHash.
        let eip191 = alloy::primitives::eip191_hash_message(user_op_hash.as_slice());
        let personal = signer.sign_message_sync(user_op_hash.as_slice()).unwrap();
        let wrong = personal.recover_address_from_prehash(&user_op_hash);
        assert!(wrong.is_err() || wrong.unwrap() != signer.address());
        let _ = eip191;
    }

    #[test]
    fn parse_pimlico_standard_userop_gas_price() {
        let res = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "slow": {
                    "maxFeePerGas": "0x2540be400",
                    "maxPriorityFeePerGas": "0x3b9aca00"
                },
                "standard": {
                    "maxFeePerGas": "0x28fa6ae00",
                    "maxPriorityFeePerGas": "0x3b9aca00"
                },
                "fast": {
                    "maxFeePerGas": "0x2cb417800",
                    "maxPriorityFeePerGas": "0x77359400"
                }
            }
        });
        let (priority, max_fee) = parse_user_operation_gas_price_response(&res).expect("parse");
        assert_eq!(priority, 1_000_000_000);
        assert_eq!(max_fee, 11_000_000_000);
        assert!(max_fee >= 11_000_000_000);
    }

    #[test]
    fn receipt_transaction_hash_extracts_nested_l1_hash() {
        let receipt = json!({
            "userOpHash": "0xaaa",
            "success": true,
            "receipt": {"transactionHash": "0xbbb", "blockNumber": "0x1"}
        });
        assert_eq!(
            receipt_transaction_hash(&receipt),
            Some("0xbbb".to_string())
        );

        let pending_shape = json!({"userOpHash": "0xaaa"});
        assert_eq!(receipt_transaction_hash(&pending_shape), None);
        let wrong_type = json!({"receipt": {"transactionHash": 7}});
        assert_eq!(receipt_transaction_hash(&wrong_type), None);
    }

    #[test]
    fn parse_sponsored_receipt_reads_success_and_actual_gas_cost() {
        let receipt = json!({
            "userOpHash": "0xaaa",
            "success": true,
            "actualGasCost": "0x18cba6a00",
            "receipt": {"transactionHash": "0xbbb"}
        });
        assert_eq!(
            parse_sponsored_user_op_receipt(&receipt).unwrap(),
            SponsoredUserOpReceipt {
                tx_hash: "0xbbb".to_string(),
                success: true,
                actual_gas_cost_wei: Some(U256::from(0x18cba6a00u64).to_string()),
            }
        );

        let decimal_cost = json!({
            "success": true,
            "actualGasCost": "7000000000000000",
            "receipt": {"transactionHash": "0xccc"}
        });
        assert_eq!(
            parse_sponsored_user_op_receipt(&decimal_cost)
                .unwrap()
                .actual_gas_cost_wei
                .as_deref(),
            Some("7000000000000000")
        );

        let failed = json!({
            "success": false,
            "actualGasCost": "0x1",
            "receipt": {"transactionHash": "0xddd"}
        });
        let parsed = parse_sponsored_user_op_receipt(&failed).unwrap();
        assert!(!parsed.success);

        let missing_cost = json!({
            "success": true,
            "receipt": {"transactionHash": "0xeee"}
        });
        assert!(parse_sponsored_user_op_receipt(&missing_cost)
            .unwrap()
            .actual_gas_cost_wei
            .is_none());
    }

    #[test]
    fn parse_sponsored_receipt_falls_back_to_nested_status() {
        let via_status = json!({
            "actualGasCost": "0x1",
            "receipt": {"transactionHash": "0xbbb", "status": "0x1"}
        });
        let parsed = parse_sponsored_user_op_receipt(&via_status).unwrap();
        assert!(parsed.success);
        assert_eq!(parsed.tx_hash, "0xbbb");

        let failed_status = json!({
            "receipt": {"transactionHash": "0xccc", "status": "0x0"}
        });
        assert!(
            !parse_sponsored_user_op_receipt(&failed_status)
                .unwrap()
                .success
        );

        // Top-level UserOp success wins over nested L1 status.
        let prefer_top = json!({
            "success": true,
            "receipt": {"transactionHash": "0xddd", "status": "0x0"}
        });
        assert!(
            parse_sponsored_user_op_receipt(&prefer_top)
                .unwrap()
                .success
        );

        let missing_both = json!({
            "receipt": {"transactionHash": "0xeee"}
        });
        let err = parse_sponsored_user_op_receipt(&missing_both).unwrap_err();
        assert!(err.contains("success / receipt.status"));
    }

    #[test]
    fn retry_classification_covers_only_transient_statuses() {
        assert!(retriable_bundler_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(retriable_bundler_status(StatusCode::INTERNAL_SERVER_ERROR));
        assert!(retriable_bundler_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(!retriable_bundler_status(StatusCode::BAD_REQUEST));
        assert!(!retriable_bundler_status(StatusCode::UNAUTHORIZED));
        assert!(!retriable_bundler_status(StatusCode::OK));
    }

    #[test]
    fn retry_delay_stays_within_backoff_caps() {
        for _ in 0..64 {
            assert!(bundler_retry_delay(1) <= Duration::from_millis(250));
            assert!(bundler_retry_delay(2) <= Duration::from_millis(500));
            assert!(bundler_retry_delay(3) <= Duration::from_millis(1_000));
            assert!(bundler_retry_delay(30) <= Duration::from_secs(2));
        }
    }
}
