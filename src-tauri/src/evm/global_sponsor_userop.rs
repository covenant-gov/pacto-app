//! ERC-4337 sponsored Username NFT writes via PactoGlobalPaymaster (bootstrap + member lanes).

use alloy::primitives::{Address, Bytes, FixedBytes, Uint, B256, U256};
use alloy::providers::Provider;
use alloy::signers::Signer;
use alloy::sol_types::SolCall;
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_username::IBootstrapMintPool::spendablePoolWeiCall as bootstrapSpendablePoolWeiCall;
use super::contracts::pacto_username::IGlobalSponsorPool::spendablePoolWeiCall as globalSpendablePoolWeiCall;
use super::contracts::pacto_username::IPactoGlobalPaymaster::ALLOWED_7702_IMPLEMENTATIONCall;
use super::contracts::pacto_username::IPactoUsernameNFT::{eligibleMemberCall, npubOfCall};
use super::contracts::pacto_username::ISponsorPolicyRegistry::{
    isSelectorAllowedCall, policyVersionCall,
};
use super::global_paymaster::{
    encode_global_paymaster_and_data, required_global_pool_balance,
    DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT, DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
};
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config::{self, GlobalUsernameSponsorAddresses};
use super::rpc::call::{eth_call_decode, eth_call_from};
use super::rpc::errors::extract_revert_selector;
use super::rpc::signer::load_embedded_signer;
use super::rpc::{connect_read_provider, wallet_err_json};
use super::sponsor_paymaster::DEFAULT_VERIFICATION_GAS_LIMIT;
use super::sponsor_userop::{
    apply_userop_gas_margin, apply_verification_gas_margin, bundler_estimate_user_operation_gas,
    bundler_rpc_url_with_stored, bundler_send_user_operation, clamp_userop_eip1559_fees,
    dummy_userop_signature, erc4337_account_implementation, load_stored_pimlico_key, pack_u128s,
    paymaster_data, paymaster_entry_point_deposit_preflight, sign_eip7702_authorization,
    user_op_json, userop_max_cost_wei, EstimatedUserOpGas, SponsoredUserOpSend, UserOpParams,
    FALLBACK_CALL_GAS_LIMIT, FALLBACK_MAX_FEE, FALLBACK_MAX_PRIORITY_FEE, HEAVY_CALL_GAS_LIMIT,
};
use super::wallet_chain_config;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsernameSponsorLane {
    Bootstrap,
    Member,
}

/// claim() selector from pacto_actions / alloy — 0x9824550d
pub const CLAIM_USERNAME_SELECTOR: [u8; 4] = [0x98, 0x24, 0x55, 0x0d];

/// Attempt a global-paymaster sponsored UserOp; returns EntryPoint userOp hash + accepting bundler.
pub async fn send_sponsored_username_userop<R: Runtime>(
    app: AppHandle<R>,
    network: &str,
    to: Address,
    calldata: Vec<u8>,
    lane: UsernameSponsorLane,
    npub_hash: B256,
    rpc_urls: Option<Vec<String>>,
) -> Result<SponsoredUserOpSend, String> {
    let net_key = network.to_lowercase();
    let selector = calldata_selector(&calldata)?;
    assert_lane_matches_selector(lane, selector)?;

    let stored_key = load_stored_pimlico_key(&app);
    let bundler = bundler_rpc_url_with_stored(&net_key, stored_key.as_deref())?.ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_CONFIG",
            "Save a Pimlico API key on Status, or set PIMLICO_API_KEY (or BUNDLER_RPC_URL), for an EntryPoint v0.7 bundler.",
            None,
        )
    })?;

    let addrs = pacto_chain_config::global_username_sponsor_addresses(&net_key)
        .map_err(|e| wallet_err_json("USERNAME_SPONSOR_CONFIG", e, None))?;
    let account_impl = if !addrs.allowed_7702_implementation.is_zero() {
        addrs.allowed_7702_implementation
    } else {
        erc4337_account_implementation(network).ok_or_else(|| {
            wallet_err_json(
                "ERC4337_ACCOUNT_CONFIG",
                "Missing EIP-7702 account implementation for this network (globalUsernameSponsor.allowed7702Implementation, or erc4337.accountImplementation / PACTO_ERC4337_ACCOUNT_IMPL).",
                None,
            )
        })?
    };

    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {network}"),
            None,
        ));
    };
    let urls = rpc_urls_or_default(net, rpc_urls);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let (signer, _wallet) = load_embedded_signer(app.clone()).await?;
    let member = signer.address();
    let read_provider = connect_read_provider(&urls).await?;

    let (max_priority, max_fee) = match read_provider.estimate_eip1559_fees().await {
        Ok(fees) => clamp_userop_eip1559_fees(fees.max_priority_fee_per_gas, fees.max_fee_per_gas),
        Err(_) => {
            log::warn!(target: "pacto_wallet", "eip-1559 fee estimation failed; using fallback");
            (FALLBACK_MAX_PRIORITY_FEE, FALLBACK_MAX_FEE)
        }
    };

    let placeholders = placeholder_gas_ceilings(&calldata);
    let placeholder_max_cost = userop_max_cost_wei(
        placeholders.call,
        placeholders.verification,
        placeholders.pre_verification,
        max_fee,
        placeholders.pm_verification,
        placeholders.pm_post,
    );

    paymaster_entry_point_deposit_preflight(
        &read_provider,
        addrs.entry_point,
        addrs.pacto_global_paymaster,
        placeholder_max_cost,
    )
    .await?;
    username_lane_preflight(
        &read_provider,
        &addrs,
        lane,
        member,
        to,
        selector,
        npub_hash,
        placeholder_max_cost,
    )
    .await?;

    // Discriminate NFT claim revert (typed selector) from account/7702 UserOp sim failures.
    if lane == UsernameSponsorLane::Bootstrap {
        preflight_claim_eth_call(&read_provider, member, to, &calldata).await?;
    }

    let execute_calldata = IAccountExecute::executeCall {
        dest: to,
        value: U256::ZERO,
        data: Bytes::from(calldata.clone()),
    }
    .abi_encode();

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

    let code = read_provider.get_code_at(member).await.map_err(|e| {
        wallet_err_json(
            "RPC_CODE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    ensure_paymaster_7702_impl(&read_provider, addrs.pacto_global_paymaster, account_impl).await?;
    let eip7702_auth = resolve_eip7702_auth_for_sender(
        &read_provider,
        &signer,
        member,
        code.as_ref(),
        net.chain_id,
        account_impl,
    )
    .await?;

    let ctx = GlobalSponsoredSendParts {
        entry_point: addrs.entry_point,
        paymaster: addrs.pacto_global_paymaster,
        addrs,
        lane,
        npub_hash,
        member,
        inner_to: to,
        inner_selector: selector,
        nonce,
        execute_calldata,
        max_fee,
        max_priority,
        eip7702_auth,
    };

    eprintln_username_userop_context(&ctx, code.len(), account_impl);

    let estimated = estimate_global_sponsored_gas(&bundler, &ctx, placeholders).await?;
    let limits = FinalGasLimits {
        call_gas_limit: apply_userop_gas_margin(estimated.call_gas_limit),
        verification_gas_limit: apply_verification_gas_margin(estimated.verification_gas_limit),
        pre_verification_gas: apply_userop_gas_margin(estimated.pre_verification_gas),
        paymaster_verification_gas_limit: apply_verification_gas_margin(
            estimated.paymaster_verification_gas_limit,
        ),
        paymaster_post_op_gas_limit: apply_userop_gas_margin(estimated.paymaster_post_op_gas_limit),
    };
    let user_op_hash =
        sign_and_send_global_user_op(&read_provider, &signer, &bundler, &ctx, limits).await?;
    Ok(SponsoredUserOpSend {
        user_op_hash,
        bundler_url: bundler,
    })
}

struct GlobalSponsoredSendParts {
    entry_point: Address,
    paymaster: Address,
    addrs: GlobalUsernameSponsorAddresses,
    lane: UsernameSponsorLane,
    npub_hash: B256,
    member: Address,
    inner_to: Address,
    inner_selector: [u8; 4],
    nonce: U256,
    execute_calldata: Vec<u8>,
    max_fee: u128,
    max_priority: u128,
    eip7702_auth: Option<Value>,
}

#[derive(Clone, Copy, Debug)]
struct GasCeilings {
    call: u128,
    verification: u128,
    pre_verification: u128,
    pm_verification: u128,
    pm_post: u128,
}

#[derive(Clone, Copy, Debug)]
struct FinalGasLimits {
    call_gas_limit: u128,
    verification_gas_limit: u128,
    pre_verification_gas: u128,
    paymaster_verification_gas_limit: u128,
    paymaster_post_op_gas_limit: u128,
}

fn placeholder_gas_ceilings(calldata: &[u8]) -> GasCeilings {
    GasCeilings {
        call: username_call_gas_ceiling(calldata),
        verification: DEFAULT_VERIFICATION_GAS_LIMIT,
        pre_verification: 80_000,
        pm_verification: DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
        pm_post: DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
    }
}

fn username_call_gas_ceiling(calldata: &[u8]) -> u128 {
    if calldata.len() >= 4 && calldata[..4] == CLAIM_USERNAME_SELECTOR {
        HEAVY_CALL_GAS_LIMIT
    } else {
        FALLBACK_CALL_GAS_LIMIT
    }
}

fn calldata_selector(calldata: &[u8]) -> Result<[u8; 4], String> {
    if calldata.len() < 4 {
        return Err(wallet_err_json(
            "USERNAME_LANE",
            "calldata missing 4-byte selector",
            None,
        ));
    }
    Ok(calldata[..4].try_into().expect("len checked"))
}

/// Pure lane ↔ selector gate (also used by unit tests).
pub(crate) fn assert_lane_matches_selector(
    lane: UsernameSponsorLane,
    selector: [u8; 4],
) -> Result<(), String> {
    match lane {
        UsernameSponsorLane::Bootstrap => {
            if selector != CLAIM_USERNAME_SELECTOR {
                return Err(wallet_err_json(
                    "USERNAME_LANE",
                    "bootstrap lane requires claim() selector (0x9824550d)",
                    None,
                ));
            }
        }
        UsernameSponsorLane::Member => {
            if selector == CLAIM_USERNAME_SELECTOR {
                return Err(wallet_err_json(
                    "CLAIM_ON_MEMBER_PATH",
                    "claim() is not allowed on the member sponsor path",
                    None,
                ));
            }
        }
    }
    Ok(())
}

async fn username_lane_preflight<P: Provider>(
    provider: &P,
    addrs: &GlobalUsernameSponsorAddresses,
    lane: UsernameSponsorLane,
    member: Address,
    to: Address,
    selector: [u8; 4],
    npub_hash: B256,
    estimated_max_cost_wei: U256,
) -> Result<(), String> {
    match lane {
        UsernameSponsorLane::Bootstrap => {
            let existing: B256 = eth_call_decode(
                provider,
                addrs.pacto_username_nft,
                &npubOfCall { evmAddress: member },
            )
            .await
            .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
            if !existing.is_zero() {
                return Err(wallet_err_json(
                    "BOOTSTRAP_AFTER_MINT",
                    "username already minted for this EVM address; use the member sponsor path",
                    None,
                ));
            }
            pool_headroom_preflight(
                provider,
                addrs.bootstrap_mint_pool,
                estimated_max_cost_wei,
                true,
            )
            .await?;
        }
        UsernameSponsorLane::Member => {
            let eligible = eth_call_decode(
                provider,
                addrs.pacto_username_nft,
                &eligibleMemberCall { member },
            )
            .await
            .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
            let onchain_npub: B256 = eligible.npubHash;
            if onchain_npub.is_zero() {
                return Err(wallet_err_json(
                    "USERNAME_LANE",
                    "member is not an eligible username holder for global sponsorship",
                    None,
                ));
            }
            if !npub_hash.is_zero() && onchain_npub != npub_hash {
                return Err(wallet_err_json(
                    "USERNAME_LANE",
                    "npubHash does not match eligibleMember for this EVM address",
                    None,
                ));
            }
            let on_chain_version: U256 = eth_call_decode(
                provider,
                addrs.sponsor_policy_registry,
                &policyVersionCall {},
            )
            .await
            .map_err(|e| wallet_err_json("USERNAME_POLICY_READ", e, None))?;
            let catalog = U256::from(addrs.policy_version);
            if on_chain_version > catalog {
                return Err(wallet_err_json(
                    "USERNAME_POLICY_STALE",
                    format!(
                        "local catalog policyVersion {catalog} is behind on-chain {on_chain_version}"
                    ),
                    None,
                ));
            }
            let allowed: bool = eth_call_decode(
                provider,
                addrs.sponsor_policy_registry,
                &isSelectorAllowedCall {
                    target: to,
                    selector: FixedBytes::<4>::from(selector),
                },
            )
            .await
            .map_err(|e| wallet_err_json("USERNAME_POLICY_READ", e, None))?;
            if !allowed {
                return Err(wallet_err_json(
                    "USERNAME_SELECTOR",
                    format!(
                        "selector 0x{} is not allowed for target {to:#x}",
                        hex::encode(selector)
                    ),
                    None,
                ));
            }
            pool_headroom_preflight(
                provider,
                addrs.global_sponsor_pool,
                estimated_max_cost_wei,
                false,
            )
            .await?;
        }
    }
    Ok(())
}

async fn pool_headroom_preflight<P: Provider>(
    provider: &P,
    pool: Address,
    estimated_max_cost_wei: U256,
    bootstrap: bool,
) -> Result<(), String> {
    let spendable: U256 = if bootstrap {
        eth_call_decode(provider, pool, &bootstrapSpendablePoolWeiCall {})
            .await
            .map_err(|e| wallet_err_json("USERNAME_POOL_READ", e, None))?
    } else {
        eth_call_decode(provider, pool, &globalSpendablePoolWeiCall {})
            .await
            .map_err(|e| wallet_err_json("USERNAME_POOL_READ", e, None))?
    };
    let need = required_global_pool_balance(estimated_max_cost_wei);
    if spendable < need {
        return Err(wallet_err_json(
            "USERNAME_POOL_LOW",
            format!("sponsor spendablePoolWei {spendable} below required headroom {need}"),
            None,
        ));
    }
    Ok(())
}

async fn estimate_global_sponsored_gas(
    bundler_url: &str,
    ctx: &GlobalSponsoredSendParts,
    ceilings: GasCeilings,
) -> Result<EstimatedUserOpGas, String> {
    let dummy_sig = dummy_userop_signature();
    let mut paymaster_and_data = encode_global_paymaster_and_data(
        ctx.paymaster,
        ctx.npub_hash,
        ctx.member,
        Address::ZERO,
        ceilings.pm_verification,
        ceilings.pm_post,
    );
    // paymasterData is the bytes past the shared 52-byte ERC-4337 header.
    let _ = paymaster_data(paymaster_and_data.as_ref())?;
    let estimate_op = user_op_json(UserOpParams {
        sender: ctx.member,
        nonce: ctx.nonce,
        call_data: &ctx.execute_calldata,
        call_gas_limit: ceilings.call,
        verification_gas_limit: ceilings.verification,
        pre_verification_gas: ceilings.pre_verification,
        max_fee_per_gas: ctx.max_fee,
        max_priority_fee_per_gas: ctx.max_priority,
        paymaster: ctx.paymaster,
        paymaster_verification_gas_limit: ceilings.pm_verification,
        paymaster_post_op_gas_limit: ceilings.pm_post,
        paymaster_and_data: paymaster_and_data.as_ref(),
        signature: &dummy_sig,
        eip7702_auth: ctx.eip7702_auth.clone(),
    })?;
    let first =
        bundler_estimate_user_operation_gas(bundler_url, &estimate_op, ctx.entry_point).await?;
    paymaster_and_data = encode_global_paymaster_and_data(
        ctx.paymaster,
        ctx.npub_hash,
        ctx.member,
        Address::ZERO,
        first.paymaster_verification_gas_limit,
        first.paymaster_post_op_gas_limit,
    );
    let calibrate_op = user_op_json(UserOpParams {
        sender: ctx.member,
        nonce: ctx.nonce,
        call_data: &ctx.execute_calldata,
        call_gas_limit: first.call_gas_limit,
        verification_gas_limit: first.verification_gas_limit,
        pre_verification_gas: first.pre_verification_gas,
        max_fee_per_gas: ctx.max_fee,
        max_priority_fee_per_gas: ctx.max_priority,
        paymaster: ctx.paymaster,
        paymaster_verification_gas_limit: first.paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit: first.paymaster_post_op_gas_limit,
        paymaster_and_data: paymaster_and_data.as_ref(),
        signature: &dummy_sig,
        eip7702_auth: ctx.eip7702_auth.clone(),
    })?;
    bundler_estimate_user_operation_gas(bundler_url, &calibrate_op, ctx.entry_point).await
}

async fn sign_and_send_global_user_op<P: Provider, S: Signer + Sync>(
    provider: &P,
    signer: &S,
    bundler_url: &str,
    ctx: &GlobalSponsoredSendParts,
    limits: FinalGasLimits,
) -> Result<String, String> {
    let paymaster_and_data = encode_global_paymaster_and_data(
        ctx.paymaster,
        ctx.npub_hash,
        ctx.member,
        Address::ZERO,
        limits.paymaster_verification_gas_limit,
        limits.paymaster_post_op_gas_limit,
    );
    let final_max_cost = userop_max_cost_wei(
        limits.call_gas_limit,
        limits.verification_gas_limit,
        limits.pre_verification_gas,
        ctx.max_fee,
        limits.paymaster_verification_gas_limit,
        limits.paymaster_post_op_gas_limit,
    );
    paymaster_entry_point_deposit_preflight(
        provider,
        ctx.entry_point,
        ctx.paymaster,
        final_max_cost,
    )
    .await?;
    username_lane_preflight(
        provider,
        &ctx.addrs,
        ctx.lane,
        ctx.member,
        ctx.inner_to,
        ctx.inner_selector,
        ctx.npub_hash,
        final_max_cost,
    )
    .await?;

    let account_gas_limits = pack_u128s(limits.verification_gas_limit, limits.call_gas_limit);
    let gas_fees = pack_u128s(ctx.max_priority, ctx.max_fee);
    let packed = PackedUserOperation {
        sender: ctx.member,
        nonce: ctx.nonce,
        initCode: Bytes::new(),
        callData: Bytes::from(ctx.execute_calldata.clone()),
        accountGasLimits: account_gas_limits,
        preVerificationGas: U256::from(limits.pre_verification_gas),
        gasFees: gas_fees,
        paymasterAndData: paymaster_and_data.clone(),
        signature: Bytes::new(),
    };

    let user_op_hash: B256 = eth_call_decode(
        provider,
        ctx.entry_point,
        &IEntryPointV07::getUserOpHashCall { userOp: packed },
    )
    .await
    .map_err(|e| wallet_err_json("USEROP_HASH", e, None))?;

    let sig = signer
        .sign_hash(&user_op_hash)
        .await
        .map_err(|e| wallet_err_json("USEROP_SIGN", e.to_string(), None))?;
    let signature = sig.as_bytes().to_vec();

    let user_op = user_op_json(UserOpParams {
        sender: ctx.member,
        nonce: ctx.nonce,
        call_data: &ctx.execute_calldata,
        call_gas_limit: limits.call_gas_limit,
        verification_gas_limit: limits.verification_gas_limit,
        pre_verification_gas: limits.pre_verification_gas,
        max_fee_per_gas: ctx.max_fee,
        max_priority_fee_per_gas: ctx.max_priority,
        paymaster: ctx.paymaster,
        paymaster_verification_gas_limit: limits.paymaster_verification_gas_limit,
        paymaster_post_op_gas_limit: limits.paymaster_post_op_gas_limit,
        paymaster_and_data: paymaster_and_data.as_ref(),
        signature: &signature,
        eip7702_auth: ctx.eip7702_auth.clone(),
    })?;

    bundler_send_user_operation(bundler_url, &user_op, ctx.entry_point).await
}

fn lane_label(lane: UsernameSponsorLane) -> &'static str {
    match lane {
        UsernameSponsorLane::Bootstrap => "bootstrap",
        UsernameSponsorLane::Member => "member",
    }
}

/// Operator stderr before bundler estimate (demo `make logs`).
fn eprintln_username_userop_context(
    ctx: &GlobalSponsoredSendParts,
    code_len: usize,
    account_impl: Address,
) {
    let npub_prefix = format!("{:#x}", ctx.npub_hash);
    let npub_prefix = if npub_prefix.len() > 12 {
        &npub_prefix[..12]
    } else {
        npub_prefix.as_str()
    };
    eprintln!(
        "[pacto_wallet] username UserOp lane={} member={:#x} nft={:#x} selector=0x{} code_len={} eip7702_auth={} account_impl={:#x} npub_hash_prefix={}",
        lane_label(ctx.lane),
        ctx.member,
        ctx.inner_to,
        hex::encode(ctx.inner_selector),
        code_len,
        if ctx.eip7702_auth.is_some() {
            "some"
        } else {
            "none"
        },
        account_impl,
        npub_prefix,
    );
}

/// Direct NFT `claim` simulation as the roster EOA (no 7702). Surfaces typed revert selectors.
async fn preflight_claim_eth_call<P: Provider>(
    provider: &P,
    member: Address,
    nft: Address,
    claim_calldata: &[u8],
) -> Result<(), String> {
    // BIP-340 verify is gas-heavy; leave headroom so OOG is not mistaken for empty revert.
    const CLAIM_ETH_CALL_GAS: u64 = 8_000_000;
    match eth_call_from(
        provider,
        nft,
        Some(member),
        Some(CLAIM_ETH_CALL_GAS),
        claim_calldata.to_vec(),
    )
    .await
    {
        Ok(_) => Ok(()),
        Err(e) => Err(wallet_err_from_claim_eth_call_failure(&e)),
    }
}

/// Map a failed claim `eth_call` into a wallet error that keeps the revert selector when present.
pub(crate) fn wallet_err_from_claim_eth_call_failure(raw_err: &str) -> String {
    let redacted = crate::evm::wallet_security::redact_urls_in_text(raw_err);
    let selector = extract_revert_selector(&redacted);
    eprintln!(
        "[pacto_wallet] claim eth_call preflight failed selector={} detail={}",
        selector
            .as_deref()
            .map(|s| format!("0x{s}"))
            .unwrap_or_else(|| "none".into()),
        redacted
    );
    if let Some(sel) = selector.as_deref() {
        if let Some((code, msg)) = classify_username_claim_revert(sel) {
            return wallet_err_json(
                code,
                format!("{msg} (selector 0x{sel}). Detail: {redacted}"),
                None,
            );
        }
        return wallet_err_json(
            "USERNAME_CLAIM_REVERTED",
            format!(
                "claim() eth_call reverted with selector 0x{sel} (NFT-side; not EIP-7702/UserOp). Detail: {redacted}"
            ),
            None,
        );
    }
    wallet_err_json(
        "USERNAME_CLAIM_REVERTED",
        format!(
            "claim() eth_call reverted with empty or unknown data (unexpected for typed NFT errors). Detail: {redacted}"
        ),
        None,
    )
}

/// NFT custom-error selectors → structured wallet codes (Layer 1).
fn classify_username_claim_revert(sel: &str) -> Option<(&'static str, &'static str)> {
    match sel {
        "356848bf" => Some(("USERNAME_INVALID_NAME", "claim rejected: invalid name / empty pubkey")),
        "a08dc9f6" => Some(("USERNAME_TAKEN", "claim rejected: name unavailable")),
        "87e0b147" => Some(("USERNAME_NPUB_CLAIMED", "claim rejected: npub already claimed")),
        "057e4afc" => Some(("ALREADY_CLAIMED", "claim rejected: address already claimed")),
        "15a5e0fb" => Some(("USERNAME_MINT_FEE", "claim rejected: insufficient mint fee")),
        "b2613b41" => Some((
            "USERNAME_INVALID_EVM_SIG",
            "claim rejected: invalid EIP-712 ClaimBinding signature",
        )),
        "8bb09e51" => Some(("USERNAME_INVALID_NPUB_HASH", "claim rejected: npubHash ≠ sha256(0x02||pubkey)")),
        "bb8d46ae" => Some((
            "USERNAME_INVALID_NOSTR_SIG",
            "claim rejected: invalid BIP-340 Nostr claim signature",
        )),
        "97276890" => Some((
            "USERNAME_BINDING_EXPIRED",
            "claim rejected: issuedAt outside chain clock window (±5m / 7d)",
        )),
        "8dd24e09" => Some(("USERNAME_NONCE_USED", "claim rejected: nonce already used")),
        _ => None,
    }
}

async fn ensure_paymaster_7702_impl<P: Provider>(
    provider: &P,
    paymaster: Address,
    account_impl: Address,
) -> Result<(), String> {
    let on_chain: Address =
        eth_call_decode(provider, paymaster, &ALLOWED_7702_IMPLEMENTATIONCall {})
            .await
            .map_err(|e| wallet_err_json("USERNAME_7702_READ", e, None))?;
    if on_chain != account_impl {
        return Err(wallet_err_json(
            "USERNAME_7702_MISMATCH",
            format!(
                "paymaster ALLOWED_7702_IMPLEMENTATION {on_chain:#x} != client account_impl {account_impl:#x}; restart after address-book pin or fund ops cutover"
            ),
            None,
        ));
    }
    Ok(())
}

/// EIP-7702 designated-code: `0xef0100 || address` (23 bytes).
const EIP7702_CODE_LEN: usize = 23;
const EIP7702_PREFIX: [u8; 3] = [0xef, 0x01, 0x00];

/// Parse EIP-7702 delegation stub → implementation address.
pub(crate) fn eip7702_delegation_impl(code: &[u8]) -> Option<Address> {
    if code.len() != EIP7702_CODE_LEN || code[..3] != EIP7702_PREFIX {
        return None;
    }
    Some(Address::from_slice(&code[3..23]))
}

/// Empty code → sign 7702 auth; already-delegated to `account_impl` → no auth; else fail closed.
async fn resolve_eip7702_auth_for_sender<P: Provider, S: Signer + Sync>(
    provider: &P,
    signer: &S,
    member: Address,
    code: &[u8],
    chain_id: u64,
    account_impl: Address,
) -> Result<Option<Value>, String> {
    if code.is_empty() {
        let eoa_nonce = provider.get_transaction_count(member).await.map_err(|e| {
            wallet_err_json(
                "RPC_NONCE",
                crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
                None,
            )
        })?;
        let auth = sign_eip7702_authorization(signer, chain_id, account_impl, eoa_nonce).await?;
        return Ok(Some(auth));
    }
    match eip7702_delegation_impl(code) {
        Some(impl_addr) if impl_addr == account_impl => Ok(None),
        Some(impl_addr) => Err(wallet_err_json(
            "USERNAME_7702_SENDER",
            format!(
                "roster EOA already delegates via EIP-7702 to {impl_addr:#x}, expected {account_impl:#x}; clear unexpected code or use a fresh roster key"
            ),
            None,
        )),
        None => Err(wallet_err_json(
            "USERNAME_7702_SENDER",
            format!(
                "roster EOA {member:#x} has non-empty code (len {}) that is not an EIP-7702 stub; sponsored UserOp execute cannot run",
                code.len()
            ),
            None,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        assert_lane_matches_selector, eip7702_delegation_impl, wallet_err_from_claim_eth_call_failure,
        UsernameSponsorLane, CLAIM_USERNAME_SELECTOR,
    };
    use alloy::primitives::address;

    #[test]
    fn member_lane_rejects_claim_selector() {
        let err =
            assert_lane_matches_selector(UsernameSponsorLane::Member, CLAIM_USERNAME_SELECTOR)
                .unwrap_err();
        assert!(err.contains("CLAIM_ON_MEMBER_PATH"));
    }

    #[test]
    fn bootstrap_lane_rejects_non_claim_selector() {
        let transfer = [0xa4, 0xdf, 0x29, 0xb5];
        let err =
            assert_lane_matches_selector(UsernameSponsorLane::Bootstrap, transfer).unwrap_err();
        assert!(err.contains("USERNAME_LANE"));
        assert!(assert_lane_matches_selector(
            UsernameSponsorLane::Bootstrap,
            CLAIM_USERNAME_SELECTOR
        )
        .is_ok());
        assert!(assert_lane_matches_selector(UsernameSponsorLane::Member, transfer).is_ok());
    }

    #[test]
    fn claim_eth_call_failure_surfaces_selector() {
        let err = wallet_err_from_claim_eth_call_failure(
            "server returned an error response: error code 3: execution reverted, data: \"0xc4aedfdd\"",
        );
        assert!(err.contains("USERNAME_CLAIM_REVERTED"));
        assert!(err.contains("0xc4aedfdd"));
        assert!(err.contains("NFT-side"));
    }

    #[test]
    fn claim_eth_call_failure_maps_nft_selector() {
        let err = wallet_err_from_claim_eth_call_failure(
            "server returned an error response: error code 3: execution reverted, data: \"0xbb8d46ae\"",
        );
        assert!(err.contains("USERNAME_INVALID_NOSTR_SIG"));
        assert!(err.contains("0xbb8d46ae"));
    }

    #[test]
    fn claim_eth_call_failure_without_selector_stays_structured() {
        let err = wallet_err_from_claim_eth_call_failure(
            r#"{"code":-32000,"message":"execution reverted","data":"0x"}"#,
        );
        assert!(err.contains("USERNAME_CLAIM_REVERTED"));
        assert!(err.contains("empty or unknown"));
    }

    #[test]
    fn eip7702_delegation_impl_parses_designated_code() {
        let impl_addr = address!("0x33F920B5aF6c527f63BD6B24d58Dccd698b2DC60");
        let mut code = vec![0xef, 0x01, 0x00];
        code.extend_from_slice(impl_addr.as_slice());
        assert_eq!(eip7702_delegation_impl(&code), Some(impl_addr));
        assert_eq!(eip7702_delegation_impl(&[]), None);
        assert_eq!(eip7702_delegation_impl(&[0x00; 23]), None);
        assert_eq!(eip7702_delegation_impl(&code[..22]), None);
    }
}
