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
use super::contracts::pacto_username::ISponsorPolicyRegistry::isSelectorAllowedCall;
use super::global_paymaster::{encode_global_paymaster_and_data, required_global_pool_balance};
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config::{self, GlobalUsernameSponsorAddresses};
use super::rpc::call::eth_call_decode;
use super::rpc::signer::{load_embedded_signer, load_squad_roster_embedded_signer};
use super::rpc::{connect_read_provider, wallet_err_json};
use super::sponsor_preflight::{
    assert_global_factory_preflight, assert_global_gov_module_preflight,
};
use super::sponsor_userop::{
    bundler_rpc_url_with_stored, erc4337_account_implementation, factory_userop_too_large_error,
    is_bundler_gas_limit_error, load_stored_pimlico_key, roster_native_balance_wei,
    SponsoredUserOpSend,
};
use super::username_claim_preflight::preflight_bootstrap_claim_userop_path;
use super::userop::{
    estimate_sponsored_userop, paymaster_entry_point_deposit_preflight,
    resolve_eip7702_auth_for_sender, resolve_userop_send_fees, sign_and_send_sponsored_userop,
    userop_gas_ceilings, userop_gas_limit_sum, userop_placeholder_max_cost_wei, FinalGasLimits,
    IAccountExecute, IEntryPointV07, SponsoredUserOpBuild, SponsoredUserOpLane, UseropGasCeilings,
    UseropPlaceholderLane,
};
use super::wallet_chain_config;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsernameSponsorLane {
    Bootstrap,
    Member,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GlobalPreflightLane {
    Username(UsernameSponsorLane),
    GovModule,
    FactoryTarget,
}

/// claim() selector from pacto_actions / alloy — 0x9824550d
pub use super::userop::CLAIM_USERNAME_SELECTOR;

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

    let (max_priority, max_fee) = resolve_userop_send_fees(&bundler).await;

    let placeholders = username_placeholder_ceilings(&calldata, lane);
    let placeholder_max_cost =
        userop_placeholder_max_cost_wei(&calldata, username_placeholder_lane(lane), max_fee);

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

    let execute_calldata = IAccountExecute::executeCall {
        dest: to,
        value: U256::ZERO,
        data: Bytes::from(calldata.clone()),
    }
    .abi_encode();

    let code = read_provider.get_code_at(member).await.map_err(|e| {
        wallet_err_json(
            "RPC_CODE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;

    if lane == UsernameSponsorLane::Bootstrap {
        preflight_bootstrap_claim_userop_path(
            &read_provider,
            member,
            to,
            addrs.entry_point,
            account_impl,
            &calldata,
            &execute_calldata,
            code.as_ref(),
        )
        .await?;
    }

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
        preflight_lane: GlobalPreflightLane::Username(lane),
        npub_hash,
        member,
        inner_to: to,
        inner_selector: selector,
        inner_value: U256::ZERO,
        nonce,
        execute_calldata,
        max_fee,
        max_priority,
        eip7702_auth,
    };

    eprintln_global_userop_context(&ctx, code.len(), account_impl);

    let user_op_hash = run_global_userop(
        &read_provider,
        &signer,
        &bundler,
        &ctx,
        placeholders,
        SponsoredUserOpLane::Small,
        "global",
        |max_cost| {
            username_lane_preflight(
                &read_provider,
                &ctx.addrs,
                lane,
                ctx.member,
                ctx.inner_to,
                ctx.inner_selector,
                ctx.npub_hash,
                max_cost,
            )
        },
    )
    .await?;
    Ok(SponsoredUserOpSend {
        user_op_hash,
        bundler_url: bundler,
    })
}

/// Global-paymaster sponsored gov-module write (roster EOA + topHat policy).
pub async fn send_sponsored_global_gov_userop<R: Runtime>(
    app: AppHandle<R>,
    network: &str,
    parent_id: &str,
    to: Address,
    calldata: Vec<u8>,
    rpc_urls: Option<Vec<String>>,
) -> Result<SponsoredUserOpSend, String> {
    let net_key = network.to_lowercase();
    let selector = calldata_selector(&calldata)?;

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

    let (signer, _wallet) = load_squad_roster_embedded_signer(app.clone(), parent_id).await?;
    let member = signer.address();
    let read_provider = connect_read_provider(&urls).await?;

    let (max_priority, max_fee) = resolve_userop_send_fees(&bundler).await;

    let placeholders = userop_gas_ceilings(&calldata, UseropPlaceholderLane::GovModule);
    let placeholder_max_cost =
        userop_placeholder_max_cost_wei(&calldata, UseropPlaceholderLane::GovModule, max_fee);

    paymaster_entry_point_deposit_preflight(
        &read_provider,
        addrs.entry_point,
        addrs.pacto_global_paymaster,
        placeholder_max_cost,
    )
    .await?;
    let eligible = assert_global_gov_module_preflight(
        &read_provider,
        &addrs,
        member,
        to,
        placeholder_max_cost,
    )
    .await?;

    let execute_calldata = IAccountExecute::executeCall {
        dest: to,
        value: U256::ZERO,
        data: Bytes::from(calldata.clone()),
    }
    .abi_encode();

    let code = read_provider.get_code_at(member).await.map_err(|e| {
        wallet_err_json(
            "RPC_CODE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;

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
        preflight_lane: GlobalPreflightLane::GovModule,
        npub_hash: eligible.npub_hash,
        member,
        inner_to: to,
        inner_selector: selector,
        inner_value: U256::ZERO,
        nonce,
        execute_calldata,
        max_fee,
        max_priority,
        eip7702_auth,
    };

    eprintln_global_userop_context(&ctx, code.len(), account_impl);

    let provider = &read_provider;
    let gov_addrs = &ctx.addrs;
    let gov_member = ctx.member;
    let gov_to = ctx.inner_to;
    let user_op_hash = run_global_userop(
        provider,
        &signer,
        &bundler,
        &ctx,
        placeholders,
        SponsoredUserOpLane::Small,
        "global",
        move |max_cost| async move {
            assert_global_gov_module_preflight(provider, gov_addrs, gov_member, gov_to, max_cost)
                .await
                .map(|_| ())
        },
    )
    .await?;
    Ok(SponsoredUserOpSend {
        user_op_hash,
        bundler_url: bundler,
    })
}

/// Global-paymaster sponsored factory deploy (roster EOA + factory policy).
pub async fn send_sponsored_global_factory_userop<R: Runtime>(
    app: AppHandle<R>,
    network: &str,
    parent_id: &str,
    factory: Address,
    calldata: Vec<u8>,
    value_wei: U256,
    rpc_urls: Option<Vec<String>>,
) -> Result<SponsoredUserOpSend, String> {
    let net_key = network.to_lowercase();
    let selector = calldata_selector(&calldata)?;

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

    let (signer, _wallet) = load_squad_roster_embedded_signer(app.clone(), parent_id).await?;
    let member = signer.address();
    let read_provider = connect_read_provider(&urls).await?;

    if !value_wei.is_zero() {
        let balance =
            super::sponsor_userop::roster_native_balance_wei(&read_provider, member).await?;
        if balance < value_wei {
            return Err(wallet_err_json(
                "INSUFFICIENT_FUNDS",
                format!(
                    "roster key holds {balance} wei but this factory call needs {value_wei} wei msg.value (gas may still be sponsored)"
                ),
                None,
            ));
        }
    }

    let (max_priority, max_fee) = resolve_userop_send_fees(&bundler).await;

    let placeholders = userop_gas_ceilings(&calldata, UseropPlaceholderLane::FactoryTarget);
    let placeholder_max_cost =
        userop_placeholder_max_cost_wei(&calldata, UseropPlaceholderLane::FactoryTarget, max_fee);

    paymaster_entry_point_deposit_preflight(
        &read_provider,
        addrs.entry_point,
        addrs.pacto_global_paymaster,
        placeholder_max_cost,
    )
    .await?;
    let eligible = assert_global_factory_preflight(
        &read_provider,
        &addrs,
        member,
        factory,
        placeholder_max_cost,
    )
    .await?;

    let execute_calldata = IAccountExecute::executeCall {
        dest: factory,
        value: value_wei,
        data: Bytes::from(calldata.clone()),
    }
    .abi_encode();

    let code = read_provider.get_code_at(member).await.map_err(|e| {
        wallet_err_json(
            "RPC_CODE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;

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
        preflight_lane: GlobalPreflightLane::FactoryTarget,
        npub_hash: eligible.npub_hash,
        member,
        inner_to: factory,
        inner_selector: selector,
        inner_value: value_wei,
        nonce,
        execute_calldata,
        max_fee,
        max_priority,
        eip7702_auth,
    };

    eprintln_global_userop_context(&ctx, code.len(), account_impl);

    let provider = &read_provider;
    let factory_addrs = &ctx.addrs;
    let factory_member = ctx.member;
    let factory_to = ctx.inner_to;
    let factory_value = ctx.inner_value;
    match run_global_userop(
        provider,
        &signer,
        &bundler,
        &ctx,
        placeholders,
        SponsoredUserOpLane::Factory,
        "factory_target",
        move |max_cost| async move {
            assert_global_factory_preflight(
                provider,
                factory_addrs,
                factory_member,
                factory_to,
                max_cost,
            )
            .await?;
            if !factory_value.is_zero() {
                let balance = roster_native_balance_wei(provider, factory_member).await?;
                if balance < factory_value {
                    return Err(wallet_err_json(
                        "INSUFFICIENT_FUNDS",
                        format!(
                            "roster key holds {balance} wei but this factory call needs {factory_value} wei msg.value"
                        ),
                        None,
                    ));
                }
            }
            Ok(())
        },
    )
    .await
    {
        Ok(user_op_hash) => Ok(SponsoredUserOpSend {
            user_op_hash,
            bundler_url: bundler,
        }),
        Err(e) if is_bundler_gas_limit_error(&e) => Err(factory_userop_too_large_error()),
        Err(e) => Err(e),
    }
}

struct GlobalSponsoredSendParts {
    entry_point: Address,
    paymaster: Address,
    addrs: GlobalUsernameSponsorAddresses,
    preflight_lane: GlobalPreflightLane,
    npub_hash: B256,
    member: Address,
    inner_to: Address,
    inner_selector: [u8; 4],
    inner_value: U256,
    nonce: U256,
    execute_calldata: Vec<u8>,
    max_fee: u128,
    max_priority: u128,
    eip7702_auth: Option<Value>,
}

fn username_placeholder_lane(lane: UsernameSponsorLane) -> UseropPlaceholderLane {
    match lane {
        UsernameSponsorLane::Bootstrap => UseropPlaceholderLane::UsernameBootstrap,
        UsernameSponsorLane::Member => UseropPlaceholderLane::UsernameMember,
    }
}

fn username_placeholder_ceilings(calldata: &[u8], lane: UsernameSponsorLane) -> UseropGasCeilings {
    userop_gas_ceilings(calldata, username_placeholder_lane(lane))
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

async fn run_global_userop<P, S, F, Fut>(
    provider: &P,
    signer: &S,
    bundler_url: &str,
    ctx: &GlobalSponsoredSendParts,
    ceilings: UseropGasCeilings,
    lane: SponsoredUserOpLane,
    lane_label: &str,
    preflight: F,
) -> Result<String, String>
where
    P: Provider,
    S: Signer + Sync,
    F: FnOnce(U256) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let encode = |pm_v: u128, pm_post: u128| {
        encode_global_paymaster_and_data(
            ctx.paymaster,
            ctx.npub_hash,
            ctx.member,
            Address::ZERO,
            pm_v,
            pm_post,
        )
        .to_vec()
    };
    let build = SponsoredUserOpBuild {
        sender: ctx.member,
        nonce: ctx.nonce,
        call_data: &ctx.execute_calldata,
        entry_point: ctx.entry_point,
        paymaster: ctx.paymaster,
        max_fee: ctx.max_fee,
        max_priority: ctx.max_priority,
        eip7702_auth: ctx.eip7702_auth.clone(),
    };
    let limits =
        estimate_sponsored_userop(bundler_url, &build, ceilings, lane, lane_label, &encode).await?;
    if lane == SponsoredUserOpLane::Factory {
        eprintln_factory_userop_gas(&limits);
    }
    sign_and_send_sponsored_userop(
        provider,
        signer,
        bundler_url,
        &build,
        limits,
        &encode,
        preflight,
    )
    .await
}

fn preflight_lane_label(lane: GlobalPreflightLane) -> &'static str {
    match lane {
        GlobalPreflightLane::Username(UsernameSponsorLane::Bootstrap) => "bootstrap",
        GlobalPreflightLane::Username(UsernameSponsorLane::Member) => "member",
        GlobalPreflightLane::GovModule => "gov_module",
        GlobalPreflightLane::FactoryTarget => "factory_target",
    }
}

/// Operator stderr before bundler estimate (demo `make logs`).
fn eprintln_global_userop_context(
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
        "[pacto_wallet] global UserOp lane={} member={:#x} target={:#x} selector=0x{} code_len={} eip7702_auth={} account_impl={:#x} npub_hash_prefix={}",
        preflight_lane_label(ctx.preflight_lane),
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

fn eprintln_factory_userop_gas(limits: &FinalGasLimits) {
    let sum = userop_gas_limit_sum(
        limits.call_gas_limit,
        limits.verification_gas_limit,
        limits.pre_verification_gas,
        limits.paymaster_verification_gas_limit,
        limits.paymaster_post_op_gas_limit,
    );
    eprintln!(
        "[pacto_wallet] global UserOp lane=factory_target call={} verification={} pre_verification={} pm_verification={} pm_post={} sum={}",
        limits.call_gas_limit,
        limits.verification_gas_limit,
        limits.pre_verification_gas,
        limits.paymaster_verification_gas_limit,
        limits.paymaster_post_op_gas_limit,
        sum,
    );
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

#[cfg(test)]
mod tests {
    use super::{assert_lane_matches_selector, UsernameSponsorLane, CLAIM_USERNAME_SELECTOR};
    use crate::evm::username_claim_preflight::wallet_err_from_claim_eth_call_failure;

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
}
