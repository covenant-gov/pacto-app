//! ERC-4337 sponsored governance writes via PactoSponsorPaymaster.
//! See pacto-squad-sponsor `docs/DESKTOP_CLIENT_INTEGRATION.md`.

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, B256, Bytes, U256, Uint};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionRequest;
use alloy::signers::Signer;
use alloy::sol_types::SolCall;
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::isEligibleCall;
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::load_squad_roster_embedded_signer;
use super::rpc::{connect_read_provider, wallet_err_json};
use super::sponsor_paymaster::{
    encode_paymaster_and_data, required_pool_balance, DEFAULT_POST_OP_GAS_LIMIT,
    DEFAULT_VERIFICATION_GAS_LIMIT, PAYMASTER_DATA_OFFSET,
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

pub fn bundler_rpc_url() -> Option<String> {
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
    parent_id: &str,
    member: Address,
    estimated_max_cost_wei: U256,
) -> Result<(Address, B256), String> {
    let squad_id = squad_id_from_parent_id(parent_id);
    let (sponsor, _variant, _hat) = read_squad_record(provider, factory, squad_id)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
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
    let pool = provider.get_balance(sponsor).await.map_err(|e| {
        wallet_err_json(
            "RPC_BALANCE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    let need = required_pool_balance(estimated_max_cost_wei);
    if pool < need {
        return Err(wallet_err_json(
            "SPONSOR_POOL_LOW",
            format!("sponsor pool {pool} below required headroom {need}"),
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
    let bundler = bundler_rpc_url().ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_CONFIG",
            "Set BUNDLER_RPC_URL for sponsored governance writes when the roster key has no ETH.",
            None,
        )
    })?;
    let account_impl = erc4337_account_implementation(network).ok_or_else(|| {
        wallet_err_json(
            "ERC4337_ACCOUNT_CONFIG",
            "Configure PACTO_ERC4337_ACCOUNT_IMPL (EIP-7702 account implementation) for sponsored writes.",
            None,
        )
    })?;

    let net_key = network.to_lowercase();
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

    let verification_gas_limit = DEFAULT_VERIFICATION_GAS_LIMIT;
    let pre_verification_gas: u128 = 80_000;

    // Estimate from the RPC; fall back to conservative constants when estimation is unavailable.
    let call_gas_limit = estimate_call_gas(&read_provider, member, to, &calldata)
        .await
        .map(call_gas_with_margin)
        .unwrap_or_else(|| {
            log::warn!(target: "pacto_wallet", "call gas estimation failed; using fallback");
            FALLBACK_CALL_GAS_LIMIT
        });
    let (max_priority, max_fee) = match read_provider.estimate_eip1559_fees().await {
        Ok(fees) => (
            fees.max_priority_fee_per_gas,
            fees.max_fee_per_gas,
        ),
        Err(_) => {
            log::warn!(target: "pacto_wallet", "eip-1559 fee estimation failed; using fallback");
            (FALLBACK_MAX_PRIORITY_FEE, FALLBACK_MAX_FEE)
        }
    };

    // Preflight against the EntryPoint maxCost of this UserOp, not a fixed guess.
    let estimated_max_cost = userop_max_cost_wei(
        call_gas_limit,
        verification_gas_limit,
        pre_verification_gas,
        max_fee,
    );
    let (sponsor, squad_id) = sponsor_eligibility_preflight(
        &read_provider,
        addrs.squad_sponsor_factory,
        parent_id,
        member,
        estimated_max_cost,
    )
    .await?;

    let execute_calldata = IAccountExecute::executeCall {
        dest: to,
        value: U256::ZERO,
        data: Bytes::from(calldata),
    }
    .abi_encode();

    let paymaster_and_data = encode_paymaster_and_data(
        addrs.pacto_sponsor_paymaster,
        squad_id,
        sponsor,
        member,
        DEFAULT_VERIFICATION_GAS_LIMIT,
        DEFAULT_POST_OP_GAS_LIMIT,
    );

    let nonce: U256 = eth_call_decode(
        &read_provider,
        addrs.entry_point,
        &IEntryPointV07::getNonceCall {
            sender: member,
            key: Uint::<192, 3>::ZERO,
        },
    )
    .await
    .map_err(|e| wallet_err_json("ENTRY_POINT_NONCE", e, None))?;

    let account_gas_limits = pack_u128s(verification_gas_limit, call_gas_limit);
    let gas_fees = pack_u128s(max_priority, max_fee);

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
        eip7702_auth = Some(
            sign_eip7702_authorization(&signer, net.chain_id, account_impl, eoa_nonce).await?,
        );
    }

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
        &IEntryPointV07::getUserOpHashCall {
            userOp: packed,
        },
    )
    .await
    .map_err(|e| wallet_err_json("USEROP_HASH", e, None))?;

    let sig = signer
        .sign_hash(&user_op_hash)
        .await
        .map_err(|e| wallet_err_json("USEROP_SIGN", e.to_string(), None))?;

    let user_op = json!({
        "sender": format!("{member:#x}"),
        "nonce": format!("{nonce:#x}"),
        "factory": Value::Null,
        "factoryData": "0x",
        "callData": format!("0x{}", hex::encode(&execute_calldata)),
        "callGasLimit": format!("{call_gas_limit:#x}"),
        "verificationGasLimit": format!("{verification_gas_limit:#x}"),
        "preVerificationGas": format!("{pre_verification_gas:#x}"),
        "maxFeePerGas": format!("{max_fee:#x}"),
        "maxPriorityFeePerGas": format!("{max_priority:#x}"),
        "paymaster": format!("{:#x}", addrs.pacto_sponsor_paymaster),
        "paymasterVerificationGasLimit": format!("{DEFAULT_VERIFICATION_GAS_LIMIT:#x}"),
        "paymasterPostOpGasLimit": format!("{DEFAULT_POST_OP_GAS_LIMIT:#x}"),
        "paymasterData": format!("0x{}", hex::encode(&paymaster_and_data[PAYMASTER_DATA_OFFSET..])),
        "signature": format!("0x{}", hex::encode(sig.as_bytes())),
        "eip7702Auth": eip7702_auth,
    });

    bundler_send_user_operation(&bundler, &user_op, addrs.entry_point).await
}

fn pack_u128s(hi: u128, lo: u128) -> B256 {
    let mut buf = [0u8; 32];
    buf[..16].copy_from_slice(&hi.to_be_bytes());
    buf[16..].copy_from_slice(&lo.to_be_bytes());
    B256::from(buf)
}

/// Fallback gas values when RPC estimation is unavailable.
const FALLBACK_CALL_GAS_LIMIT: u128 = 500_000;
const FALLBACK_MAX_PRIORITY_FEE: u128 = 1_000_000_000; // 1 gwei
const FALLBACK_MAX_FEE: u128 = 30_000_000_000; // 30 gwei
/// Headroom over `eth_estimateGas` to cover the account `execute` dispatch and state drift.
const CALL_GAS_MARGIN_BPS: u128 = 12_000;

fn call_gas_with_margin(estimate: u128) -> u128 {
    estimate * CALL_GAS_MARGIN_BPS / 10_000
}

/// `eth_estimateGas` for the governance call executed by the account. Estimates the inner
/// call (not `execute` itself) so it stays valid before the EIP-7702 delegation exists.
async fn estimate_call_gas<P: Provider>(
    provider: &P,
    member: Address,
    to: Address,
    calldata: &[u8],
) -> Option<u128> {
    let tx = TransactionRequest::default()
        .with_from(member)
        .with_to(to)
        .with_input(Bytes::copy_from_slice(calldata));
    provider
        .estimate_gas(tx)
        .await
        .ok()
        .map(|gas| gas as u128)
}

/// EntryPoint v0.7 maxCost bound: maxFeePerGas × every gas limit charged for the UserOp
/// (verification, call, preVerification, paymaster verification and postOp).
fn userop_max_cost_wei(
    call_gas_limit: u128,
    verification_gas_limit: u128,
    pre_verification_gas: u128,
    max_fee_per_gas: u128,
) -> U256 {
    let total_gas = U256::from(call_gas_limit)
        + U256::from(verification_gas_limit)
        + U256::from(pre_verification_gas)
        + U256::from(DEFAULT_VERIFICATION_GAS_LIMIT)
        + U256::from(DEFAULT_POST_OP_GAS_LIMIT);
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
    let sig_bytes = sig.as_bytes();
    Ok(json!({
        "chainId": format!("{chain_id:#x}"),
        "address": format!("{implementation:#x}"),
        "nonce": format!("{nonce:#x}"),
        "yParity": format!("{:#x}", sig_bytes[64] as u64 % 2),
        "r": format!("0x{}", hex::encode(&sig_bytes[0..32])),
        "s": format!("0x{}", hex::encode(&sig_bytes[32..64])),
    }))
}

/// RLP encoding of the EIP-7702 authorization tuple `[chain_id, address, nonce]`;
/// integers use canonical minimal big-endian form, so any chain ID/nonce width is safe.
fn encode_eip7702_authorization(chain_id: u64, implementation: Address, nonce: u64) -> Vec<u8> {
    use alloy_rlp::{Encodable, Header};
    let addr = implementation.as_slice();
    let payload_length = chain_id.length() + addr.length() + nonce.length();
    let mut out = Vec::with_capacity(payload_length + 9);
    Header { list: true, payload_length }.encode(&mut out);
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
            format!("bundler rpc failed after {attempt} attempt(s): {}", e.message),
            None,
        )
    })?;
    if let Some(hash) = res.get("result").and_then(|v| v.as_str()) {
        return Ok(hash.to_string());
    }
    Err(wallet_err_json(
        "PAYMASTER_REJECTED",
        res.get("error")
            .map(|e| crate::evm::wallet_security::redact_urls_in_text(&e.to_string()))
            .unwrap_or_else(|| "eth_sendUserOperation failed".into()),
        None,
    ))
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
        format!("bundler request timed out after {}s", BUNDLER_RPC_TIMEOUT.as_secs())
    } else {
        crate::evm::wallet_security::redact_urls_in_text(&e.to_string())
    }
}

async fn bundler_rpc(url: &str, body: &Value) -> Result<Value, BundlerRpcError> {
    let client = bundler_http_client()?;
    let res = client.post(url).json(body).send().await.map_err(|e| BundlerRpcError {
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
        call_gas_with_margin, encode_eip7702_authorization, pack_u128s, userop_max_cost_wei,
    };
    use alloy::primitives::{address, B256, U256};

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
        let cost = userop_max_cost_wei(500_000, 100_000, 80_000, 30_000_000_000);
        assert_eq!(
            cost,
            U256::from(30_000_000_000u128)
                * U256::from(500_000u128 + 100_000 + 80_000 + 100_000 + 50_000)
        );
    }

    #[test]
    fn call_gas_margin_adds_headroom() {
        assert_eq!(call_gas_with_margin(100_000), 120_000);
        assert_eq!(call_gas_with_margin(0), 0);
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
}
