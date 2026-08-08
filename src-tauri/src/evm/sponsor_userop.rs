//! ERC-4337 sponsored governance writes via PactoSponsorPaymaster.
//! See pacto-squad-sponsor `docs/DESKTOP_CLIENT_INTEGRATION.md`.

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, Bytes, Uint, B256, U256};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionRequest;
use alloy::signers::Signer;
use alloy::sol_types::SolCall;
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::{
    isEligibleCall, paymasterCall, spendablePoolWeiCall,
};
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::load_squad_roster_embedded_signer;
use super::rpc::{connect_read_provider, wallet_err_json};
use super::sponsor_paymaster::{
    encode_paymaster_and_data, required_pool_balance, DEFAULT_PAYMASTER_VERIFICATION_GAS_LIMIT,
    DEFAULT_POST_OP_GAS_LIMIT, DEFAULT_VERIFICATION_GAS_LIMIT, PAYMASTER_DATA_OFFSET,
};
use super::squad_sponsor_common::{read_squad_record, squad_id_from_parent_id};
use super::wallet_chain_config;
use crate::db;

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

/// Optional ERC-4337 account implementation for EIP-7702 delegation.
pub fn erc4337_account_implementation(network_key: &str) -> Option<Address> {
    pacto_chain_config::erc4337_account_implementation(network_key)
}

/// Explicit EntryPoint v0.7 bundler (`BUNDLER_RPC_URL`). Not derived from chain RPC keys.
pub fn bundler_rpc_url(_network_key: &str) -> Option<String> {
    explicit_bundler_rpc_url()
}

fn explicit_bundler_rpc_url() -> Option<String> {
    std::env::var("BUNDLER_RPC_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub async fn roster_native_balance_wei<P: Provider>(
    provider: &P,
    roster: Address,
) -> Result<U256, String> {
    provider.get_balance(roster).await.map_err(|e| {
        wallet_err_json(
            "RPC_BALANCE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })
}

pub async fn sponsor_eligibility_preflight<P: Provider>(
    provider: &P,
    factory: Address,
    expected_paymaster: Address,
    parent_id: &str,
    member: Address,
    estimated_max_cost_wei: U256,
) -> Result<(Address, B256), String> {
    let squad_id = squad_id_from_parent_id(parent_id);
    let (sponsor, _variant, _hat) = read_squad_record(provider, factory, squad_id)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
    let clone_paymaster: Address = eth_call_decode(provider, sponsor, &paymasterCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    if clone_paymaster != expected_paymaster {
        return Err(wallet_err_json(
            "SPONSOR_PAYMASTER_MISMATCH",
            format!(
                "squad sponsor clone paymaster ({clone_paymaster:#x}) does not match the address book ({expected_paymaster:#x}). After a factory redeploy, recreate the squad sponsor (old clones are not migratable)."
            ),
            None,
        ));
    }
    let eligible: bool = eth_call_decode(provider, sponsor, &isEligibleCall { member })
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    if !eligible {
        return Err(wallet_err_json(
            "SPONSOR_INELIGIBLE",
            "roster address is not eligible for gas sponsorship (hat or Ext permit)",
            None,
        ));
    }
    let pool: U256 = eth_call_decode(provider, sponsor, &spendablePoolWeiCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    let need = required_pool_balance(estimated_max_cost_wei);
    if pool < need {
        return Err(wallet_err_json(
            "SPONSOR_POOL_LOW",
            format!("sponsor spendablePoolWei {pool} below required headroom {need}"),
            None,
        ));
    }
    Ok((sponsor, squad_id))
}

/// Attempt a sponsored UserOp; returns EntryPoint userOp hash on success.
pub async fn send_sponsored_gov_userop<R: Runtime>(
    app: AppHandle<R>,
    network: &str,
    parent_id: &str,
    to: Address,
    calldata: Vec<u8>,
) -> Result<String, String> {
    let net_key = network.to_lowercase();
    let bundler = bundler_rpc_url(&net_key).ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_CONFIG",
            "Set BUNDLER_RPC_URL to an EntryPoint v0.7 bundler for sponsored governance writes when the roster key has no ETH.",
            None,
        )
    })?;
    let account_impl = erc4337_account_implementation(network).ok_or_else(|| {
        wallet_err_json(
            "ERC4337_ACCOUNT_CONFIG",
            "Missing EIP-7702 account implementation for this network (address book erc4337.accountImplementation, or PACTO_ERC4337_ACCOUNT_IMPL).",
            None,
        )
    })?;

    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {network}"),
            None,
        ));
    };
    if !db::parent_has_sponsor_infra(&app, parent_id).unwrap_or(false) {
        return Err(wallet_err_json(
            "SPONSOR_REQUIRED",
            "Deploy squad sponsor before sponsored governance writes.",
            None,
        ));
    }

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let (signer, _wallet) = load_squad_roster_embedded_signer(app.clone(), parent_id).await?;
    let member = signer.address();
    let read_provider = connect_read_provider(&urls).await?;

    let (max_priority, max_fee) = match read_provider.estimate_eip1559_fees().await {
        Ok(fees) => clamp_userop_eip1559_fees(fees.max_priority_fee_per_gas, fees.max_fee_per_gas),
        Err(_) => {
            log::warn!(target: "pacto_wallet", "eip-1559 fee estimation failed; using fallback");
            (FALLBACK_MAX_PRIORITY_FEE, FALLBACK_MAX_FEE)
        }
    };

    // Placeholder ceilings so deposit/pool preflight and bundler estimate do not OOG.
    let placeholder_call = FALLBACK_CALL_GAS_LIMIT;
    let placeholder_verification = DEFAULT_VERIFICATION_GAS_LIMIT;
    let placeholder_pre_verification: u128 = 80_000;
    let placeholder_pm_verification = DEFAULT_PAYMASTER_VERIFICATION_GAS_LIMIT;
    let placeholder_pm_post = DEFAULT_POST_OP_GAS_LIMIT;
    let placeholder_max_cost = userop_max_cost_wei(
        placeholder_call,
        placeholder_verification,
        placeholder_pre_verification,
        max_fee,
        placeholder_pm_verification,
        placeholder_pm_post,
    );
    paymaster_entry_point_deposit_preflight(
        &read_provider,
        addrs.entry_point,
        addrs.pacto_sponsor_paymaster,
        placeholder_max_cost,
    )
    .await?;
    let (sponsor, squad_id) = sponsor_eligibility_preflight(
        &read_provider,
        addrs.squad_sponsor_factory,
        addrs.pacto_sponsor_paymaster,
        parent_id,
        member,
        placeholder_max_cost,
    )
    .await?;

    let execute_calldata = IAccountExecute::executeCall {
        dest: to,
        value: U256::ZERO,
        data: Bytes::from(calldata),
    }
    .abi_encode();

    let mut paymaster_and_data = encode_paymaster_and_data(
        addrs.pacto_sponsor_paymaster,
        squad_id,
        sponsor,
        member,
        placeholder_pm_verification,
        placeholder_pm_post,
    );

    let nonce: U256 = eth_call_decode(
        &read_provider,
        addrs.entry_point,
        &IEntryPointV07::getNonceCall {
            sender: member,
            key: Uint::<192, 3>::from(0u64),
        },
    )
    .await
    .map_err(|e| wallet_err_json("ENTRY_POINT_NONCE", e, None))?;

    // EIP-7702: authorization for empty-code EOAs (bundler/EntryPoint attach set-code).
    let code = read_provider.get_code_at(member).await.map_err(|e| {
        wallet_err_json(
            "RPC_CODE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    let mut eip7702_auth: Option<Value> = None;
    if code.is_empty() {
        let eoa_nonce = read_provider
            .get_transaction_count(member)
            .await
            .map_err(|e| {
                wallet_err_json(
                    "RPC_NONCE",
                    crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
                    None,
                )
            })?;
        eip7702_auth =
            Some(sign_eip7702_authorization(&signer, net.chain_id, account_impl, eoa_nonce).await?);
    }

    let dummy_sig = dummy_userop_signature();
    let estimate_op = user_op_json(UserOpParams {
        sender: member,
        nonce,
        call_data: &execute_calldata,
        call_gas_limit: placeholder_call,
        verification_gas_limit: placeholder_verification,
        pre_verification_gas: placeholder_pre_verification,
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: max_priority,
        paymaster: addrs.pacto_sponsor_paymaster,
        paymaster_verification_gas_limit: placeholder_pm_verification,
        paymaster_post_op_gas_limit: placeholder_pm_post,
        paymaster_and_data: &paymaster_and_data,
        signature: &dummy_sig,
        eip7702_auth: eip7702_auth.clone(),
    })?;
    let estimated =
        bundler_estimate_user_operation_gas(&bundler, &estimate_op, addrs.entry_point).await?;
    let call_gas_limit = apply_userop_gas_margin(estimated.call_gas_limit);
    let verification_gas_limit = apply_userop_gas_margin(estimated.verification_gas_limit);
    let pre_verification_gas = apply_userop_gas_margin(estimated.pre_verification_gas);
    let paymaster_verification_gas_limit =
        apply_userop_gas_margin(estimated.paymaster_verification_gas_limit);
    let paymaster_post_op_gas_limit =
        apply_userop_gas_margin(estimated.paymaster_post_op_gas_limit);

    paymaster_and_data = encode_paymaster_and_data(
        addrs.pacto_sponsor_paymaster,
        squad_id,
        sponsor,
        member,
        paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit,
    );

    let final_max_cost = userop_max_cost_wei(
        call_gas_limit,
        verification_gas_limit,
        pre_verification_gas,
        max_fee,
        paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit,
    );
    paymaster_entry_point_deposit_preflight(
        &read_provider,
        addrs.entry_point,
        addrs.pacto_sponsor_paymaster,
        final_max_cost,
    )
    .await?;
    sponsor_eligibility_preflight(
        &read_provider,
        addrs.squad_sponsor_factory,
        addrs.pacto_sponsor_paymaster,
        parent_id,
        member,
        final_max_cost,
    )
    .await?;

    let account_gas_limits = pack_u128s(verification_gas_limit, call_gas_limit);
    let gas_fees = pack_u128s(max_priority, max_fee);
    let packed = PackedUserOperation {
        sender: member,
        nonce,
        initCode: Bytes::new(),
        callData: Bytes::from(execute_calldata.clone()),
        accountGasLimits: account_gas_limits,
        preVerificationGas: U256::from(pre_verification_gas),
        gasFees: gas_fees,
        paymasterAndData: paymaster_and_data.clone(),
        signature: Bytes::new(),
    };

    let user_op_hash: B256 = eth_call_decode(
        &read_provider,
        addrs.entry_point,
        &IEntryPointV07::getUserOpHashCall { userOp: packed },
    )
    .await
    .map_err(|e| wallet_err_json("USEROP_HASH", e, None))?;

    // PactoSimple7702Account: ECDSA.recover(userOpHash, sig) == address(this).
    let sig = signer
        .sign_hash(&user_op_hash)
        .await
        .map_err(|e| wallet_err_json("USEROP_SIGN", e.to_string(), None))?;
    let signature = sig.as_bytes().to_vec();

    let user_op = user_op_json(UserOpParams {
        sender: member,
        nonce,
        call_data: &execute_calldata,
        call_gas_limit,
        verification_gas_limit,
        pre_verification_gas,
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: max_priority,
        paymaster: addrs.pacto_sponsor_paymaster,
        paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit,
        paymaster_and_data: &paymaster_and_data,
        signature: &signature,
        eip7702_auth,
    })?;

    bundler_send_user_operation(&bundler, &user_op, addrs.entry_point).await
}

/// Dummy 65-byte ECDSA for `eth_estimateUserOperationGas` (content ignored; length must match).
fn dummy_userop_signature() -> Vec<u8> {
    let mut ecdsa = vec![0u8; 65];
    ecdsa[31] = 0x01;
    ecdsa[63] = 0x01;
    ecdsa[64] = 0x1c;
    ecdsa
}

/// Fields of the ERC-4337 v0.7 UserOperation JSON sent to the bundler.
struct UserOpParams<'a> {
    sender: Address,
    nonce: U256,
    call_data: &'a [u8],
    call_gas_limit: u128,
    verification_gas_limit: u128,
    pre_verification_gas: u128,
    max_fee_per_gas: u128,
    max_priority_fee_per_gas: u128,
    paymaster: Address,
    paymaster_verification_gas_limit: u128,
    paymaster_post_op_gas_limit: u128,
    paymaster_and_data: &'a [u8],
    signature: &'a [u8],
    eip7702_auth: Option<Value>,
}

/// Serializes the UserOperation for `eth_sendUserOperation` / `eth_estimateUserOperationGas` (v0.7).
fn user_op_json(p: UserOpParams) -> Result<Value, String> {
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
fn paymaster_data(paymaster_and_data: &[u8]) -> Result<&[u8], String> {
    paymaster_and_data
        .get(PAYMASTER_DATA_OFFSET..)
        .ok_or_else(|| {
            wallet_err_json(
                "PAYMASTER_DATA",
                "paymasterAndData shorter than 52-byte header",
                None,
            )
        })
}

fn pack_u128s(hi: u128, lo: u128) -> B256 {
    let mut buf = [0u8; 32];
    buf[..16].copy_from_slice(&hi.to_be_bytes());
    buf[16..].copy_from_slice(&lo.to_be_bytes());
    B256::from(buf)
}

/// Fallback gas values when RPC estimation is unavailable.
pub(crate) const FALLBACK_CALL_GAS_LIMIT: u128 = 500_000;
/// Floor tip so common bundler prechecks do not reject near-zero RPC estimates.
pub(crate) const FALLBACK_MAX_PRIORITY_FEE: u128 = 1_000_000_000; // 1 gwei
pub(crate) const FALLBACK_MAX_FEE: u128 = 30_000_000_000; // 30 gwei
/// Headroom over bundler / `eth_estimateGas` estimates (1.2x).
const CALL_GAS_MARGIN_BPS: u128 = 12_000;

pub(crate) fn call_gas_with_margin(estimate: u128) -> u128 {
    estimate * CALL_GAS_MARGIN_BPS / 10_000
}

fn apply_userop_gas_margin(estimate: u128) -> u128 {
    call_gas_with_margin(estimate)
}

/// Raise RPC tip/max-fee to bundler floors; ensure maxFee ≥ maxPriorityFee.
fn clamp_userop_eip1559_fees(priority: u128, max_fee: u128) -> (u128, u128) {
    let priority = priority.max(FALLBACK_MAX_PRIORITY_FEE);
    let max_fee = max_fee.max(priority);
    (priority, max_fee)
}

/// Shared paymaster must hold EntryPoint deposit ≥ UserOp maxCost (bundler precheck).
async fn paymaster_entry_point_deposit_preflight<P: Provider>(
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
fn userop_max_cost_wei(
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

async fn sign_eip7702_authorization<S: Signer + Sync>(
    signer: &S,
    chain_id: u64,
    implementation: Address,
    nonce: u64,
) -> Result<Value, String> {
    // EIP-7702 authorization hash: keccak256(0x05 || rlp([chain_id, address, nonce]))
    let enc = encode_eip7702_authorization(chain_id, implementation, nonce);
    let mut msg = Vec::with_capacity(1 + enc.len());
    msg.push(0x05);
    msg.extend_from_slice(&enc);
    let hash = alloy::primitives::keccak256(&msg);
    let sig = signer
        .sign_hash(&hash)
        .await
        .map_err(|e| wallet_err_json("EIP7702_SIGN", e.to_string(), None))?;
    Ok(eip7702_auth_json(chain_id, implementation, nonce, &sig))
}

/// Bundler JSON for EIP-7702 auth. Uses `as_rsy()` so yParity is 0/1 — not Electrum `v` (27/28).
fn eip7702_auth_json(
    chain_id: u64,
    implementation: Address,
    nonce: u64,
    sig: &alloy::primitives::Signature,
) -> Value {
    let rsy = sig.as_rsy();
    json!({
        "chainId": format!("{chain_id:#x}"),
        "address": format!("{implementation:#x}"),
        "nonce": format!("{nonce:#x}"),
        "yParity": format!("{:#x}", rsy[64]),
        "r": format!("0x{}", hex::encode(&rsy[0..32])),
        "s": format!("0x{}", hex::encode(&rsy[32..64])),
    })
}

/// RLP encoding of the EIP-7702 authorization tuple `[chain_id, address, nonce]`;
/// integers use canonical minimal big-endian form, so any chain ID/nonce width is safe.
fn encode_eip7702_authorization(chain_id: u64, implementation: Address, nonce: u64) -> Vec<u8> {
    use alloy_rlp::{Encodable, Header};
    let addr = implementation.as_slice();
    let payload_length = chain_id.length() + addr.length() + nonce.length();
    let mut out = Vec::with_capacity(payload_length + 9);
    Header {
        list: true,
        payload_length,
    }
    .encode(&mut out);
    chain_id.encode(&mut out);
    addr.encode(&mut out);
    nonce.encode(&mut out);
    out
}

async fn bundler_send_user_operation(
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
struct EstimatedUserOpGas {
    call_gas_limit: u128,
    verification_gas_limit: u128,
    pre_verification_gas: u128,
    paymaster_verification_gas_limit: u128,
    paymaster_post_op_gas_limit: u128,
}

async fn bundler_estimate_user_operation_gas(
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

fn parse_estimate_user_op_gas_response(res: &Value) -> Result<EstimatedUserOpGas, String> {
    if let Some(err) = res.get("error") {
        let raw = crate::evm::wallet_security::redact_urls_in_text(&err.to_string());
        let (code, message) = classify_bundler_userop_reject(&raw);
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
            DEFAULT_POST_OP_GAS_LIMIT,
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
    } else if lower.contains("maxpriorityfeepergas") {
        (
            "BUNDLER_FEE",
            "Bundler rejected UserOp gas fees (priority fee below floor). Retry after updating the client.".into(),
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

/// Real L1 transaction hash from an `eth_getUserOperationReceipt` result.
fn receipt_transaction_hash(receipt: &Value) -> Option<String> {
    receipt
        .get("receipt")?
        .get("transactionHash")?
        .as_str()
        .map(str::to_string)
}

/// Polls `eth_getUserOperationReceipt` until the UserOp is included and returns the real L1
/// transaction hash. Transient poll failures are logged and retried until the bound; on
/// timeout the error carries the userOpHash so inclusion can be tracked manually.
pub async fn wait_for_user_operation_tx_hash(
    bundler_url: &str,
    user_op_hash: &str,
) -> Result<String, String> {
    let deadline = std::time::Instant::now() + USEROP_RECEIPT_WAIT_BOUND;
    loop {
        match bundler_get_user_operation_receipt(bundler_url, user_op_hash).await {
            Ok(Some(receipt)) => {
                return receipt_transaction_hash(&receipt).ok_or_else(|| {
                    wallet_err_json(
                        "USEROP_RECEIPT",
                        format!("bundler receipt for {user_op_hash} has no L1 transaction hash"),
                        None,
                    )
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

/// Bundler JSON-RPC request timeout; a slow bundler must not hang the command.
const BUNDLER_RPC_TIMEOUT: Duration = Duration::from_secs(30);
const BUNDLER_MAX_ATTEMPTS: u32 = 3;
const BUNDLER_RETRY_BASE_DELAY: Duration = Duration::from_millis(250);
const BUNDLER_RETRY_MAX_DELAY: Duration = Duration::from_secs(2);

/// Bundler JSON-RPC client; connection pool is reused across calls.
static BUNDLER_HTTP_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(BUNDLER_RPC_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
});

fn bundler_http_client() -> Result<&'static reqwest::Client, BundlerRpcError> {
    BUNDLER_HTTP_CLIENT.as_ref().map_err(|e| BundlerRpcError {
        retriable: false,
        message: e.clone(),
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

#[cfg(test)]
mod tests {
    use super::{
        apply_userop_gas_margin, bundler_retry_delay, bundler_rpc_url, call_gas_with_margin,
        clamp_userop_eip1559_fees, classify_bundler_userop_reject, dummy_userop_signature,
        eip7702_auth_json, encode_eip7702_authorization, explicit_bundler_rpc_url, pack_u128s,
        parse_estimate_user_op_gas_response, parse_hex_u128, parse_send_user_op_response,
        paymaster_data, receipt_transaction_hash, retriable_bundler_status, user_op_json,
        userop_max_cost_wei, UserOpParams, FALLBACK_MAX_PRIORITY_FEE,
    };
    use crate::evm::sponsor_paymaster::PAYMASTER_DATA_OFFSET;
    use crate::evm::sponsor_paymaster::{encode_paymaster_and_data, DEFAULT_POST_OP_GAS_LIMIT};
    use alloy::primitives::{address, b256, B256, U256};
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
    fn user_op_json_serializes_erc4337_fields() {
        let member = address!("0x3333333333333333333333333333333333333333");
        let paymaster = address!("0x1deDa9E84374ED7cf032b063F287823c449e98b5");
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
        let expected_pmd = hex::encode(&paymaster_and_data[PAYMASTER_DATA_OFFSET..]);
        assert_eq!(op["paymasterData"], json!(format!("0x{expected_pmd}")));
        assert_eq!(op["signature"], json!(format!("0x{}", "aa".repeat(65))));
        assert!(op["eip7702Auth"].is_null());
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
            apply_userop_gas_margin(g.paymaster_verification_gas_limit),
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
        assert_eq!(g.paymaster_post_op_gas_limit, DEFAULT_POST_OP_GAS_LIMIT);

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
        assert_eq!(g.paymaster_post_op_gas_limit, DEFAULT_POST_OP_GAS_LIMIT);
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
        assert_eq!(pmd.len(), 180 - PAYMASTER_DATA_OFFSET);
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
            r#"{"code":-32502,"message":"Simulation ran out of gas for entity: paymaster:\"0x1deDa9E84374ED7cf032b063F287823c449e98b5\""}"#,
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
    fn clamp_userop_fees_raises_tip_floor_and_keeps_max_fee_above_tip() {
        let (p, f) = clamp_userop_eip1559_fees(1_500_000, 20_000_000_000);
        assert_eq!(p, FALLBACK_MAX_PRIORITY_FEE);
        assert_eq!(f, 20_000_000_000);

        let (p, f) = clamp_userop_eip1559_fees(1_500_000, 500_000);
        assert_eq!(p, FALLBACK_MAX_PRIORITY_FEE);
        assert_eq!(f, FALLBACK_MAX_PRIORITY_FEE);

        let (p, f) = clamp_userop_eip1559_fees(2_000_000_000, 40_000_000_000);
        assert_eq!(p, 2_000_000_000);
        assert_eq!(f, 40_000_000_000);
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

    #[test]
    fn eip7702_authorization_encoding_matches_rlp_spec() {
        let implementation = address!("0x0000000000000000000000000000000000000001");
        let enc = encode_eip7702_authorization(1, implementation, 0);
        let mut expected = vec![0xd7, 0x01, 0x94];
        expected.extend_from_slice(implementation.as_slice());
        expected.push(0x80);
        assert_eq!(enc, expected);

        // Larger chain IDs and nonces encode as minimal big-endian strings.
        let enc = encode_eip7702_authorization(11_155_111, implementation, 0x0100);
        let mut payload = vec![0x83, 0xaa, 0x36, 0xa7, 0x94];
        payload.extend_from_slice(implementation.as_slice());
        payload.extend_from_slice(&[0x82, 0x01, 0x00]);
        let mut expected = vec![0xc0 + payload.len() as u8];
        expected.extend_from_slice(&payload);
        assert_eq!(enc, expected);
    }

    #[test]
    fn eip7702_auth_json_y_parity_recovers_signer_not_electrum_mod() {
        use alloy::primitives::{keccak256, Signature};
        use alloy::signers::local::PrivateKeySigner;
        use alloy::signers::SignerSync;

        // Anvil account #0
        let signer: PrivateKeySigner =
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
                .parse()
                .unwrap();
        let implementation = address!("0x33F920B5aF6c527f63BD6B24d58Dccd698b2DC60");
        let chain_id = 11_155_111u64;
        let nonce = 0u64;

        let enc = encode_eip7702_authorization(chain_id, implementation, nonce);
        let mut msg = Vec::with_capacity(1 + enc.len());
        msg.push(0x05);
        msg.extend_from_slice(&enc);
        let hash = keccak256(&msg);
        let sig = signer.sign_hash_sync(&hash).expect("sign");

        let auth = eip7702_auth_json(chain_id, implementation, nonce, &sig);
        let y_parity = u64::from_str_radix(
            auth["yParity"].as_str().unwrap().trim_start_matches("0x"),
            16,
        )
        .unwrap();
        assert!(y_parity <= 1, "yParity must be 0 or 1, got {y_parity}");
        assert_eq!(y_parity as u8, sig.as_rsy()[64]);

        // Rebuild signature as the bundler would from auth JSON fields.
        let rsy = sig.as_rsy();
        let rebuilt = Signature::from_bytes_and_parity(&rsy[..64], rsy[64] != 0);
        let recovered = rebuilt
            .recover_address_from_prehash(&hash)
            .expect("recover");
        assert_eq!(recovered, signer.address());

        // Electrum v % 2 inverts yParity and recovers a different authority.
        let electrum = sig.as_bytes();
        let wrong_parity = (electrum[64] % 2) != 0;
        assert_ne!(
            wrong_parity,
            rsy[64] != 0,
            "bug demonstration: Electrum v%2 flips true y_parity"
        );
        let wrong = Signature::from_bytes_and_parity(&electrum[..64], wrong_parity);
        let wrong_addr = wrong
            .recover_address_from_prehash(&hash)
            .expect("recover wrong parity");
        assert_ne!(wrong_addr, signer.address());
    }

    struct EnvVarGuard(&'static str, Option<std::ffi::OsString>);
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.1 {
                Some(v) => std::env::set_var(self.0, v),
                None => std::env::remove_var(self.0),
            }
        }
    }

    #[test]
    fn bundler_rpc_url_requires_explicit_env() {
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_a = std::env::var_os("ALCHEMY_RPC_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _ga = EnvVarGuard("ALCHEMY_RPC_KEY", prev_a);
        std::env::set_var("BUNDLER_RPC_URL", "https://bundler.example/v2/explicit");
        std::env::set_var("ALCHEMY_RPC_KEY", "alchemy-key");
        assert_eq!(
            bundler_rpc_url("sepolia").as_deref(),
            Some("https://bundler.example/v2/explicit")
        );
        assert_eq!(
            explicit_bundler_rpc_url().as_deref(),
            Some("https://bundler.example/v2/explicit")
        );
    }

    #[test]
    fn bundler_rpc_url_ignores_alchemy_when_bundler_unset() {
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_a = std::env::var_os("ALCHEMY_RPC_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _ga = EnvVarGuard("ALCHEMY_RPC_KEY", prev_a);
        std::env::remove_var("BUNDLER_RPC_URL");
        std::env::set_var("ALCHEMY_RPC_KEY", "alchemy-key");
        assert!(bundler_rpc_url("sepolia").is_none());
    }

    #[test]
    fn bundler_rpc_url_none_without_bundler() {
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_a = std::env::var_os("ALCHEMY_RPC_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _ga = EnvVarGuard("ALCHEMY_RPC_KEY", prev_a);
        std::env::remove_var("BUNDLER_RPC_URL");
        std::env::remove_var("ALCHEMY_RPC_KEY");
        assert!(bundler_rpc_url("sepolia").is_none());
    }
}
