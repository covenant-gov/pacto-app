//! ERC-4337 sponsored governance writes via PactoSponsorPaymaster.
//! See pacto-squad-sponsor `docs/DESKTOP_CLIENT_INTEGRATION.md`.

use alloy::primitives::{Address, B256, Bytes, U256, Uint};
use alloy::providers::Provider;
use alloy::signers::Signer;
use alloy::sol_types::SolCall;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::isEligibleCall;
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::load_squad_roster_embedded_signer;
use super::rpc::{connect_read_provider, wallet_err_json};
use super::sponsor_paymaster::{
    encode_paymaster_and_data, required_pool_balance, DEFAULT_POST_OP_GAS_LIMIT,
    DEFAULT_VERIFICATION_GAS_LIMIT,
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

    // Conservative maxCost for preflight (0.05 ETH); bundler will re-estimate.
    let estimated_max_cost = U256::from(50_000_000_000_000_000u64);
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

    let call_gas_limit: u128 = 500_000;
    let verification_gas_limit = DEFAULT_VERIFICATION_GAS_LIMIT;
    let pre_verification_gas: u128 = 80_000;
    let max_priority: u128 = 1_000_000_000;
    let max_fee: u128 = 30_000_000_000;

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
            sign_eip7702_authorization(&signer, net.chain_id, account_impl, eoa_nonce)
                .await
                .map_err(|e| wallet_err_json("EIP7702_SIGN", e, None))?,
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
        "paymasterData": format!("0x{}", hex::encode(&paymaster_and_data[52..])),
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

async fn sign_eip7702_authorization<S: Signer + Sync>(
    signer: &S,
    chain_id: u64,
    implementation: Address,
    nonce: u64,
) -> Result<Value, String> {
    // EIP-7702 authorization hash: keccak256(0x05 || rlp([chain_id, address, nonce]))
    let chain_bytes = trim_leading_zeros(&chain_id.to_be_bytes());
    let addr_bytes = implementation.as_slice();
    let nonce_bytes = if nonce == 0 {
        Vec::new()
    } else {
        trim_leading_zeros(&nonce.to_be_bytes())
    };

    let mut list: Vec<u8> = Vec::new();
    list.extend(rlp_bytes(&chain_bytes));
    list.extend(rlp_bytes(addr_bytes));
    list.extend(rlp_bytes(&nonce_bytes));
    let mut enc = if list.len() <= 55 {
        let mut o = vec![0xc0 + list.len() as u8];
        o.extend_from_slice(&list);
        o
    } else {
        return Err("rlp list too large".into());
    };
    let mut msg = vec![0x05u8];
    msg.append(&mut enc);
    let hash = alloy::primitives::keccak256(&msg);
    let sig = signer.sign_hash(&hash).await.map_err(|e| e.to_string())?;
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

fn trim_leading_zeros(bytes: &[u8]) -> Vec<u8> {
    let mut v = bytes.to_vec();
    while v.first() == Some(&0) && v.len() > 1 {
        v.remove(0);
    }
    v
}

fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    if b.is_empty() {
        return vec![0x80];
    }
    if b.len() <= 55 {
        let mut out = vec![0x80 + b.len() as u8];
        out.extend_from_slice(b);
        out
    } else {
        panic!("rlp item too large");
    }
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
    let res = bundler_rpc(bundler_url, body).await?;
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

async fn bundler_rpc(url: &str, body: Value) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client.post(url).json(&body).send().await.map_err(|e| {
        wallet_err_json(
            "BUNDLER_RPC",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    let status = res.status();
    let text = res.text().await.map_err(|e| {
        wallet_err_json(
            "BUNDLER_RPC",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    if !status.is_success() {
        return Err(wallet_err_json(
            "BUNDLER_RPC",
            crate::evm::wallet_security::redact_urls_in_text(&text),
            None,
        ));
    }
    serde_json::from_str(&text).map_err(|e| wallet_err_json("BUNDLER_RPC", e.to_string(), None))
}

#[cfg(test)]
mod tests {
    use super::{pack_u128s, rlp_bytes, trim_leading_zeros};
    use alloy::primitives::B256;

    #[test]
    fn pack_u128s_puts_hi_lo() {
        let packed = pack_u128s(100_000, 500_000);
        let mut expected = [0u8; 32];
        expected[..16].copy_from_slice(&100_000u128.to_be_bytes());
        expected[16..].copy_from_slice(&500_000u128.to_be_bytes());
        assert_eq!(packed, B256::from(expected));
    }

    #[test]
    fn rlp_empty_and_small() {
        assert_eq!(rlp_bytes(&[]), vec![0x80]);
        assert_eq!(rlp_bytes(&[0x7f]), vec![0x7f]);
        assert_eq!(trim_leading_zeros(&[0, 0, 1]), vec![1]);
    }
}
