//! Isolated Sepolia bootstrap username claim (Alchemy + Pimlico, no Tauri UI).
//! Feature `username-claim-harness` only — never CI. See docs/wallet/SPONSORED_USEROP_7702.md.

use alloy::eips::BlockNumberOrTag;
use alloy::primitives::{Address, Bytes, Uint, B256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;
use alloy::sol_types::SolCall;
use bip39::Mnemonic;
use nostr_sdk::nips::nip06::FromMnemonic;
use nostr_sdk::prelude::Keys;
use rand::RngCore;
use serde_json::Value;
use std::path::PathBuf;

use crate::evm::claim_binding::{claim_binding_signing_hash, sign_claim_binding};
use crate::evm::contracts::pacto_username::IBootstrapMintPool::spendablePoolWeiCall as bootstrapSpendableCall;
use crate::evm::contracts::pacto_username::IPactoGlobalPaymaster::ALLOWED_7702_IMPLEMENTATIONCall;
use crate::evm::contracts::pacto_username::IPactoProtocolRegistry::usernameNftCall;
use crate::evm::contracts::pacto_username::IPactoUsernameNFT::{
    canBootstrapClaimCall, claimCall, hashClaimBindingCall, nameAvailableCall,
    npubOfCall, recordOfCall, usedNonceCall,
};
use crate::evm::global_paymaster::{
    encode_global_paymaster_and_data, required_global_pool_balance,
    DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT, DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
};
use crate::evm::global_sponsor_userop::eip7702_delegation_impl;
use crate::evm::username_claim_preflight::preflight_bootstrap_claim_userop_path;
use crate::evm::nostr_claim_link::{
    hash_nostr_claim, npub_hash_from_pubkey, sign_nostr_claim, verify_nostr_claim,
};
use crate::evm::pacto_chain_config::{
    erc4337_account_implementation, global_username_sponsor_addresses,
};
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::sponsor_paymaster::DEFAULT_VERIFICATION_GAS_LIMIT;
use crate::evm::sponsor_userop::{
    apply_userop_gas_margin, apply_verification_gas_margin, bundler_estimate_user_operation_gas,
    bundler_send_user_operation, clamp_userop_eip1559_fees, dummy_userop_signature, pack_u128s,
    paymaster_data, paymaster_entry_point_deposit_preflight, sign_eip7702_authorization,
    user_op_json, userop_max_cost_wei, wait_for_user_operation_receipt, UserOpParams,
    FALLBACK_MAX_FEE, FALLBACK_MAX_PRIORITY_FEE, HEAVY_CALL_GAS_LIMIT,
};
use crate::evm::{derive_eth_bip44_v1_from_mnemonic_phrase, wallet_security};

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

const NETWORK: &str = "sepolia";
const CLAIM_NAME: &str = "test";
const CHAIN_ID: u64 = 11_155_111;

/// Run the harness. Optional `--mnemonic "twelve words…"`.
pub async fn run(args: impl IntoIterator<Item = String>) -> Result<(), String> {
    load_dotenv();
    let mnemonic = resolve_mnemonic(args)?;
    let alchemy_key = require_env("ALCHEMY_RPC_KEY")?;
    let pimlico_key = require_env("PIMLICO_API_KEY")?;

    let rpc_url = format!("https://eth-sepolia.g.alchemy.com/v2/{alchemy_key}");
    let bundler_url = format!("https://api.pimlico.io/v2/{CHAIN_ID}/rpc?apikey={pimlico_key}");
    eprintln!(
        "[username_claim_harness] stage=0 rpc_host=eth-sepolia.g.alchemy.com bundler_host=api.pimlico.io"
    );

    let keys = Keys::from_mnemonic(mnemonic.trim(), None)
        .map_err(|e| format!("nostr keys from mnemonic: {e}"))?;
    let pubkey = nostr_xonly_pubkey(&keys)?;
    let npub_hash = npub_hash_from_pubkey(pubkey);
    let (evm_key_hex, _addr_str) = derive_eth_bip44_v1_from_mnemonic_phrase(mnemonic.trim(), 0)?;
    let signer: PrivateKeySigner = evm_key_hex
        .parse()
        .map_err(|e| format!("parse PrivateKeySigner: {e}"))?;
    let member = signer.address();
    eprintln!(
        "[username_claim_harness] stage=0 member={member:#x} npub_hash_prefix={}",
        &format!("{npub_hash:#x}")[..14]
    );

    let provider = ProviderBuilder::new().connect_http(
        rpc_url
            .parse()
            .map_err(|e| format!("alchemy url parse: {e}"))?,
    );
    let addrs = global_username_sponsor_addresses(NETWORK)?;
    // Prefer book allowlist (same as send_sponsored_username_userop), then erc4337 pin.
    let account_impl = if !addrs.allowed_7702_implementation.is_zero() {
        addrs.allowed_7702_implementation
    } else {
        erc4337_account_implementation(NETWORK)
            .ok_or_else(|| "missing EIP-7702 account implementation".to_string())?
    };
    let nft = addrs.pacto_username_nft;

    // --- L0 ---
    eprintln!("[username_claim_harness] stage=1 L0 reads");
    let registry_nft: Address = eth_call_decode(
        &provider,
        addrs.protocol_registry,
        &usernameNftCall {},
    )
    .await
    .map_err(|e| format!("protocolRegistry.usernameNft: {e}"))?;
    if registry_nft != nft {
        return Err(format!(
            "L0 FAIL: book pactoUsernameNft {nft:#x} != REGISTRY.usernameNft() {registry_nft:#x}"
        ));
    }
    eprintln!("[username_claim_harness] L0 registry_nft_ok={nft:#x}");
    let available: bool = eth_call_decode(
        &provider,
        nft,
        &nameAvailableCall {
            name: CLAIM_NAME.into(),
        },
    )
    .await
    .map_err(|e| format!("nameAvailable: {e}"))?;
    if !available {
        return Err(format!(
            "L0 FAIL: name `{CLAIM_NAME}` unavailable (taken or reserved). Pick another or redeploy."
        ));
    }
    let can_bootstrap: bool = eth_call_decode(
        &provider,
        nft,
        &canBootstrapClaimCall {
            member,
            npubHash: npub_hash,
        },
    )
    .await
    .map_err(|e| format!("canBootstrapClaim: {e}"))?;
    let used: U256 = eth_call_decode(
        &provider,
        nft,
        &usedNonceCall {
            npubHash: npub_hash,
        },
    )
    .await
    .map_err(|e| format!("usedNonce: {e}"))?;
    let bootstrap_pool: U256 =
        eth_call_decode(&provider, addrs.bootstrap_mint_pool, &bootstrapSpendableCall {})
            .await
            .map_err(|e| format!("bootstrap spendable: {e}"))?;
    let pm_deposit: U256 = eth_call_decode(
        &provider,
        addrs.entry_point,
        &IEntryPointV07::balanceOfCall {
            account: addrs.pacto_global_paymaster,
        },
    )
    .await
    .map_err(|e| format!("EP balanceOf(paymaster): {e}"))?;
    let allowed_7702: Address = eth_call_decode(
        &provider,
        addrs.pacto_global_paymaster,
        &ALLOWED_7702_IMPLEMENTATIONCall {},
    )
    .await
    .map_err(|e| format!("ALLOWED_7702: {e}"))?;

    eprintln!(
        "[username_claim_harness] L0 name_ok={} can_bootstrap={} used_nonce={} bootstrap_pool={} pm_ep_deposit={} allowed_7702={allowed_7702:#x} account_impl={account_impl:#x}",
        available, can_bootstrap, used, bootstrap_pool, pm_deposit
    );
    if !can_bootstrap {
        return Err("L0 FAIL: canBootstrapClaim=false".into());
    }
    if bootstrap_pool.is_zero() {
        return Err("L0 FAIL: BootstrapMintPool spendable=0".into());
    }
    if pm_deposit.is_zero() {
        return Err("L0 FAIL: global paymaster EntryPoint deposit=0".into());
    }
    if allowed_7702 != account_impl {
        return Err(format!(
            "L0 FAIL: ALLOWED_7702 {allowed_7702:#x} != account_impl {account_impl:#x}"
        ));
    }

    // --- Build claim ---
    eprintln!("[username_claim_harness] stage=2 build claim({CLAIM_NAME})");
    let nonce = used + U256::from(1u64);
    let issued_at = claim_issued_at(&provider).await?;
    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = B256::from(salt_bytes);

    let on_chain_binding = eth_call_decode(
        &provider,
        nft,
        &hashClaimBindingCall {
            npubHash: npub_hash,
            evmAddress: member,
            name: CLAIM_NAME.into(),
            nonce,
            issuedAt: issued_at,
            salt,
        },
    )
    .await
    .map_err(|e| format!("hashClaimBinding: {e}"))?;
    let local_binding = claim_binding_signing_hash(
        CHAIN_ID,
        nft,
        npub_hash,
        member,
        CLAIM_NAME,
        nonce,
        issued_at,
        salt,
    );
    if on_chain_binding != local_binding {
        return Err(format!(
            "ClaimBinding mismatch local={local_binding:#x} on_chain={on_chain_binding:#x}"
        ));
    }

    let nostr_digest = hash_nostr_claim(pubkey, member, CLAIM_NAME, nonce, issued_at, salt);
    let secret = keys.secret_key().to_secret_bytes();
    let nostr_sig =
        sign_nostr_claim(&secret, nostr_digest).map_err(|e| format!("nostr sign: {e}"))?;
    if !verify_nostr_claim(pubkey, nostr_digest, &nostr_sig) {
        return Err("local BIP-340 verify failed".into());
    }
    let evm_sig = sign_claim_binding(
        &signer,
        CHAIN_ID,
        nft,
        npub_hash,
        CLAIM_NAME,
        nonce,
        issued_at,
        salt,
    )?;

    let claim_calldata = claimCall {
        name: CLAIM_NAME.into(),
        npubHash: npub_hash,
        pubkey,
        nonce,
        issuedAt: issued_at,
        salt,
        nostrSignature: Bytes::from(nostr_sig.to_vec()),
        evmSignature: Bytes::from(evm_sig),
    }
    .abi_encode();

    let execute_calldata = IAccountExecute::executeCall {
        dest: nft,
        value: U256::ZERO,
        data: Bytes::from(claim_calldata.clone()),
    }
    .abi_encode();

    let code = provider
        .get_code_at(member)
        .await
        .map_err(|e| format!("get_code: {e}"))?;

    eprintln!("[username_claim_harness] stage=3 L1+L1.5 preflight (shared with global_sponsor_userop)");
    preflight_bootstrap_claim_userop_path(
        &provider,
        member,
        nft,
        addrs.entry_point,
        account_impl,
        &claim_calldata,
        &execute_calldata,
        code.as_ref(),
    )
    .await?;

    // --- Sponsored UserOp ---
    eprintln!("[username_claim_harness] stage=4 sponsored UserOp (no EOA ETH)");
    let eip7702_auth = if code.is_empty() || eip7702_delegation_impl(code.as_ref())
        .is_some_and(|impl_addr| impl_addr != account_impl)
    {
        let eoa_nonce = provider
            .get_transaction_count(member)
            .await
            .map_err(|e| format!("tx count: {e}"))?;
        Some(sign_eip7702_authorization(&signer, CHAIN_ID, account_impl, eoa_nonce).await?)
    } else {
        eprintln!(
            "[username_claim_harness] roster has code_len={} — skipping 7702 auth (must already be correct stub)",
            code.len()
        );
        None
    };
    eprintln!(
        "[username_claim_harness] eip7702_auth={}",
        if eip7702_auth.is_some() {
            "some"
        } else {
            "none"
        }
    );

    let (max_priority, max_fee) = match provider.estimate_eip1559_fees().await {
        Ok(fees) => clamp_userop_eip1559_fees(fees.max_priority_fee_per_gas, fees.max_fee_per_gas),
        Err(_) => (FALLBACK_MAX_PRIORITY_FEE, FALLBACK_MAX_FEE),
    };
    let placeholder_max_cost = userop_max_cost_wei(
        HEAVY_CALL_GAS_LIMIT,
        DEFAULT_VERIFICATION_GAS_LIMIT,
        80_000,
        max_fee,
        DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
        DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
    );
    let pool_need = required_global_pool_balance(placeholder_max_cost);
    eprintln!(
        "[username_claim_harness] fees max_priority={max_priority} max_fee={max_fee} placeholder_max_cost={placeholder_max_cost} bootstrap_pool_need={pool_need} bootstrap_pool={bootstrap_pool}"
    );
    if bootstrap_pool < pool_need {
        return Err(format!(
            "L4 STOP USERNAME_POOL_LOW: bootstrap spendable {bootstrap_pool} < required headroom {pool_need} (max_fee={max_fee}). Lower fees or fund BootstrapMintPool — not a 7702 bug."
        ));
    }
    paymaster_entry_point_deposit_preflight(
        &provider,
        addrs.entry_point,
        addrs.pacto_global_paymaster,
        placeholder_max_cost,
    )
    .await
    .map_err(|e| format!("L4 STOP paymaster EP deposit: {e}"))?;

    let ep_nonce: U256 = eth_call_decode(
        &provider,
        addrs.entry_point,
        &IEntryPointV07::getNonceCall {
            sender: member,
            key: Uint::<192, 3>::from(0u64),
        },
    )
    .await
    .map_err(|e| format!("EP getNonce: {e}"))?;

    let dummy_sig = dummy_userop_signature();
    let mut paymaster_and_data = encode_global_paymaster_and_data(
        addrs.pacto_global_paymaster,
        npub_hash,
        member,
        Address::ZERO,
        DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
        DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
    );
    let _ = paymaster_data(paymaster_and_data.as_ref())?;

    let estimate_op = user_op_json(UserOpParams {
        sender: member,
        nonce: ep_nonce,
        call_data: &execute_calldata,
        call_gas_limit: HEAVY_CALL_GAS_LIMIT,
        verification_gas_limit: DEFAULT_VERIFICATION_GAS_LIMIT,
        pre_verification_gas: 80_000,
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: max_priority,
        paymaster: addrs.pacto_global_paymaster,
        paymaster_verification_gas_limit: DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
        paymaster_post_op_gas_limit: DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
        paymaster_and_data: paymaster_and_data.as_ref(),
        signature: &dummy_sig,
        eip7702_auth: eip7702_auth.clone(),
    })?;
    let first =
        bundler_estimate_user_operation_gas(&bundler_url, &estimate_op, addrs.entry_point)
            .await
            .map_err(|e| {
                dump_tenderly_simulator_recipe(
                    member,
                    account_impl,
                    &execute_calldata,
                    &estimate_op,
                    addrs.entry_point,
                    addrs.pacto_global_paymaster,
                );
                format!(
                    "L4 STOP after L1+L1.5 OK (estimate pass 1): {}. No txHash until send — use Simulator dump above (not Tenderly Explorer). Work-backward: field-diff UserOp vs squad (eip7702Auth, paymasterData policy=0, execute). App: global_sponsor_userop → username_claim → Commons.",
                    wallet_security::redact_urls_in_text(&e)
                )
            })?;
    paymaster_and_data = encode_global_paymaster_and_data(
        addrs.pacto_global_paymaster,
        npub_hash,
        member,
        Address::ZERO,
        first.paymaster_verification_gas_limit,
        first.paymaster_post_op_gas_limit,
    );
    let calibrate_op = user_op_json(UserOpParams {
        sender: member,
        nonce: ep_nonce,
        call_data: &execute_calldata,
        call_gas_limit: first.call_gas_limit,
        verification_gas_limit: first.verification_gas_limit,
        pre_verification_gas: first.pre_verification_gas,
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: max_priority,
        paymaster: addrs.pacto_global_paymaster,
        paymaster_verification_gas_limit: first.paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit: first.paymaster_post_op_gas_limit,
        paymaster_and_data: paymaster_and_data.as_ref(),
        signature: &dummy_sig,
        eip7702_auth: eip7702_auth.clone(),
    })?;
    let estimated =
        bundler_estimate_user_operation_gas(&bundler_url, &calibrate_op, addrs.entry_point)
            .await
            .map_err(|e| {
                dump_tenderly_simulator_recipe(
                    member,
                    account_impl,
                    &execute_calldata,
                    &calibrate_op,
                    addrs.entry_point,
                    addrs.pacto_global_paymaster,
                );
                format!(
                    "L4 STOP after L1+L1.5 OK (estimate pass 2): {}. No txHash — use Simulator dump above.",
                    wallet_security::redact_urls_in_text(&e)
                )
            })?;

    let call_gas_limit = apply_userop_gas_margin(estimated.call_gas_limit);
    let verification_gas_limit = apply_verification_gas_margin(estimated.verification_gas_limit);
    let pre_verification_gas = apply_userop_gas_margin(estimated.pre_verification_gas);
    let pm_verification = apply_verification_gas_margin(estimated.paymaster_verification_gas_limit);
    let pm_post = apply_userop_gas_margin(estimated.paymaster_post_op_gas_limit);

    let paymaster_and_data = encode_global_paymaster_and_data(
        addrs.pacto_global_paymaster,
        npub_hash,
        member,
        Address::ZERO,
        pm_verification,
        pm_post,
    );
    let final_max_cost = userop_max_cost_wei(
        call_gas_limit,
        verification_gas_limit,
        pre_verification_gas,
        max_fee,
        pm_verification,
        pm_post,
    );
    paymaster_entry_point_deposit_preflight(
        &provider,
        addrs.entry_point,
        addrs.pacto_global_paymaster,
        final_max_cost,
    )
    .await?;

    let packed = PackedUserOperation {
        sender: member,
        nonce: ep_nonce,
        initCode: Bytes::new(),
        callData: Bytes::from(execute_calldata.clone()),
        accountGasLimits: pack_u128s(verification_gas_limit, call_gas_limit),
        preVerificationGas: U256::from(pre_verification_gas),
        gasFees: pack_u128s(max_priority, max_fee),
        paymasterAndData: paymaster_and_data.clone(),
        signature: Bytes::new(),
    };
    let user_op_hash: B256 = eth_call_decode(
        &provider,
        addrs.entry_point,
        &IEntryPointV07::getUserOpHashCall { userOp: packed },
    )
    .await
    .map_err(|e| format!("getUserOpHash: {e}"))?;
    let sig = signer
        .sign_hash(&user_op_hash)
        .await
        .map_err(|e| format!("sign userOpHash: {e}"))?;
    let signature = sig.as_bytes().to_vec();

    let user_op = user_op_json(UserOpParams {
        sender: member,
        nonce: ep_nonce,
        call_data: &execute_calldata,
        call_gas_limit,
        verification_gas_limit,
        pre_verification_gas,
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: max_priority,
        paymaster: addrs.pacto_global_paymaster,
        paymaster_verification_gas_limit: pm_verification,
        paymaster_post_op_gas_limit: pm_post,
        paymaster_and_data: paymaster_and_data.as_ref(),
        signature: &signature,
        eip7702_auth,
    })?;

    let user_op_hash_hex =
        bundler_send_user_operation(&bundler_url, &user_op, addrs.entry_point).await?;
    eprintln!("[username_claim_harness] sent userOpHash={user_op_hash_hex}");
    let receipt = wait_for_user_operation_receipt(&bundler_url, &user_op_hash_hex).await?;
    if !receipt.success {
        return Err(format!(
            "UserOp reverted tx={} userOp={}",
            receipt.tx_hash, user_op_hash_hex
        ));
    }

    let on_npub: B256 = eth_call_decode(&provider, nft, &npubOfCall { evmAddress: member })
        .await
        .map_err(|e| format!("npubOf after mint: {e}"))?;
    let record = eth_call_decode(
        &provider,
        nft,
        &recordOfCall {
            npubHash: npub_hash,
        },
    )
    .await
    .map_err(|e| format!("recordOf: {e}"))?;

    eprintln!(
        "[username_claim_harness] SUCCESS name={} npubOf={on_npub:#x} token_id={} tx={} userOp={}",
        record.name, record.tokenId, receipt.tx_hash, user_op_hash_hex
    );
    eprintln!(
        "[username_claim_harness] work-backward next: compare global_sponsor_userop preflight → username_claim Tauri → Commons CTA"
    );
    Ok(())
}

/// Redacted UserOp + Tenderly Simulator paste recipe (no keys/mnemonics). Estimate failures have no txHash.
fn dump_tenderly_simulator_recipe(
    member: Address,
    account_impl: Address,
    execute_calldata: &[u8],
    user_op: &Value,
    entry_point: Address,
    paymaster: Address,
) {
    let stub = format!("0xef0100{}", hex::encode(account_impl));
    let call_data_hex = format!("0x{}", hex::encode(execute_calldata));
    let sender = user_op
        .get("sender")
        .and_then(|v| v.as_str())
        .unwrap_or("?");
    let nonce = user_op
        .get("nonce")
        .cloned()
        .unwrap_or(Value::Null);
    let call_gas = user_op.get("callGasLimit").cloned().unwrap_or(Value::Null);
    let ver_gas = user_op
        .get("verificationGasLimit")
        .cloned()
        .unwrap_or(Value::Null);
    let pre_gas = user_op
        .get("preVerificationGas")
        .cloned()
        .unwrap_or(Value::Null);
    let max_fee = user_op.get("maxFeePerGas").cloned().unwrap_or(Value::Null);
    let max_prio = user_op
        .get("maxPriorityFeePerGas")
        .cloned()
        .unwrap_or(Value::Null);
    let pm_data = user_op
        .get("paymasterData")
        .and_then(|v| v.as_str())
        .unwrap_or("0x");
    let pm_bytes = pm_data.trim_start_matches("0x");
    let pm_len = pm_bytes.len() / 2;
    let pm_head = if pm_bytes.len() >= 8 {
        &pm_bytes[..8]
    } else {
        pm_bytes
    };
    let pm_tail = if pm_bytes.len() >= 8 {
        &pm_bytes[pm_bytes.len() - 8..]
    } else {
        ""
    };
    let eip7702_present = user_op
        .get("eip7702Auth")
        .map(|v| !v.is_null())
        .unwrap_or(false);

    eprintln!("========== Tenderly Simulator dump (no L1 txHash — estimate/L1.5 only) ==========");
    eprintln!("chain=sepolia entryPoint={entry_point:#x} paymaster={paymaster:#x}");
    eprintln!("sender={sender} nonce={nonce} eip7702Auth={eip7702_present}");
    eprintln!(
        "gas call={call_gas} verification={ver_gas} preVerification={pre_gas} maxFee={max_fee} maxPriority={max_prio}"
    );
    eprintln!("callData={call_data_hex}");
    eprintln!("paymasterData len={pm_len} first4=0x{pm_head} last4=0x{pm_tail}");
    eprintln!(
        "RECIPE A: Simulate call to={member:#x} data=<callData above> from={entry_point:#x} with state override code={stub} on {member:#x} (Sepolia)."
    );
    eprintln!(
        "RECIPE B: Attribute EntryPoint validate/handle frames with this UserOp (dummy sig on estimate is normal) — account vs paymaster vs EP."
    );
    eprintln!("Do not use Tenderly Explorer — there is no transaction hash until bundler send.");
    eprintln!("============================================================================");
}

fn load_dotenv() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root_env = manifest.join("../.env");
    let _ = dotenvy::from_path(&root_env);
    let _ = dotenvy::dotenv();
}

fn require_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("missing {name} (load pacto-app/.env)"))
}

fn resolve_mnemonic(args: impl IntoIterator<Item = String>) -> Result<String, String> {
    let mut args = args.into_iter().skip(1);
    let mut cli: Option<String> = None;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--mnemonic" => {
                cli = Some(args.next().ok_or("--mnemonic requires a phrase")?);
            }
            "--help" | "-h" => {
                eprintln!(
                    "Usage: username_claim_harness [--mnemonic \"twelve words…\"]\n\
                     Requires ALCHEMY_RPC_KEY + PIMLICO_API_KEY in pacto-app/.env.\n\
                     Claims username `test` via bootstrap sponsored UserOp (no roster ETH)."
                );
                std::process::exit(0);
            }
            other => return Err(format!("unrecognized argument: {other}")),
        }
    }
    if let Some(m) = cli {
        return Ok(m);
    }
    let mnemonic = Mnemonic::generate(12).map_err(|e| format!("generate mnemonic: {e}"))?;
    Ok(mnemonic.to_string())
}

fn nostr_xonly_pubkey(keys: &Keys) -> Result<B256, String> {
    let hex_pk = keys.public_key().to_hex();
    let bytes = hex::decode(&hex_pk).map_err(|e| format!("pubkey hex: {e}"))?;
    if bytes.len() != 32 {
        return Err("expected 32-byte x-only pubkey".into());
    }
    Ok(B256::from_slice(&bytes))
}

async fn claim_issued_at<P: Provider>(provider: &P) -> Result<U256, String> {
    let block = provider
        .get_block_by_number(BlockNumberOrTag::Latest)
        .await
        .map_err(|e| format!("latest block: {e}"))?
        .ok_or_else(|| "latest block missing".to_string())?;
    Ok(U256::from(block.header.timestamp))
}
