//! Username NFT claim + address-rotation Tauri commands.

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, Bytes, B256, U256};
use alloy::providers::Provider;
use alloy::sol_types::SolCall;
use nostr_sdk::nips::nip06::FromMnemonic;
use nostr_sdk::prelude::Keys;
use rand::RngCore;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::claim_binding::sign_claim_binding;
use super::contracts::pacto_username::IBootstrapMintPool::spendablePoolWeiCall as bootstrapSpendableCall;
use super::contracts::pacto_username::IGlobalSponsorPool::spendablePoolWeiCall as globalSpendableCall;
use super::contracts::pacto_username::IPactoUsernameNFT::{
    cancelAddressTransferCall, canBootstrapClaimCall, claimAddressTransferCall, claimCall,
    eligibleMemberCall, initiateAddressTransferCall, isPendingTransferCall, mintFeeCall,
    nameAvailableCall, npubOfCall, recordOfCall, usedNonceCall,
};
use super::contracts::pacto_username::ISponsorPolicyRegistry::policyVersionCall;
use super::global_sponsor_userop::{send_sponsored_username_userop, UsernameSponsorLane};
use super::gov_read::rpc_urls_or_default;
use super::nostr_claim_link::{hash_nostr_claim, npub_hash_from_pubkey, sign_nostr_claim};
use super::pacto_chain_config::{self, GlobalUsernameSponsorAddresses};
use super::rpc::call::eth_call_decode;
use super::rpc::signer::{load_embedded_signer, require_treasury_signing_allowed};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, parse_address,
    send_and_confirm, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::sponsor_path::{select_username_sponsor_path, UsernameSponsorPath};
use super::sponsor_userop::{
    call_gas_ceiling_for_calldata, call_gas_with_margin, estimate_call_gas,
    roster_native_balance_wei, wait_for_user_operation_receipt, FALLBACK_MAX_FEE,
};
use super::username_nostr_link::publish_username_claim_link;
use super::wallet_chain_config::{self, WalletNetworkConfig};
use crate::db::{self, UsernameClaimRow, UsernameClaimUpsert};

/// Local catalog floor; must stay ≥ on-chain `SponsorPolicyRegistry.policyVersion()`.
const PACTO_ACTIONS_POLICY_VERSION: u64 = 3;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameRecordDto {
    pub name: String,
    pub evm_address: String,
    pub pending_address: String,
    pub token_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameEligibleMemberDto {
    pub npub_hash: String,
    pub token_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameClaimResult {
    pub network: String,
    pub chain_id: u64,
    pub path: String,
    pub username: String,
    pub npub_hash: String,
    pub token_id: String,
    pub link_event_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_op_hash: Option<String>,
    pub evm_address: String,
    pub policy_version: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameTransferResult {
    pub network: String,
    pub chain_id: u64,
    pub path: String,
    pub npub_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_op_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_address: Option<String>,
}

fn require_network(network: &str) -> Result<&'static WalletNetworkConfig, String> {
    wallet_chain_config::network_by_key(&network.to_lowercase()).ok_or_else(|| {
        wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {network}"),
            None,
        )
    })
}

fn username_addrs(net_key: &str) -> Result<GlobalUsernameSponsorAddresses, String> {
    pacto_chain_config::global_username_sponsor_addresses(net_key)
        .map_err(|e| wallet_err_json("USERNAME_CONFIG", e, None))
}

fn require_rpc_urls(
    net: &WalletNetworkConfig,
    rpc_urls: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let urls = rpc_urls_or_default(net, rpc_urls);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }
    Ok(urls)
}

fn validate_username(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.len() < 3 || n.len() > 32 {
        return Err(wallet_err_json(
            "INVALID_USERNAME",
            "username must be 3..=32 lowercase a-z characters",
            None,
        ));
    }
    if !n.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(wallet_err_json(
            "INVALID_USERNAME",
            "username must be lowercase a-z only",
            None,
        ));
    }
    Ok(n.to_string())
}

fn parse_b256(raw: &str) -> Result<B256, String> {
    let t = raw.trim();
    let h = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .unwrap_or(t);
    if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(wallet_err_json(
            "INVALID_NPUB_HASH",
            "expected 32-byte hex",
            None,
        ));
    }
    let bytes = hex::decode(h).map_err(|e| {
        wallet_err_json("INVALID_NPUB_HASH", format!("invalid hex: {e}"), None)
    })?;
    Ok(B256::from_slice(&bytes))
}

fn load_nostr_keys() -> Result<Keys, String> {
    let phrase = crate::mnemonic_seed_get().ok_or_else(|| {
        wallet_err_json(
            "NO_MNEMONIC",
            "recovery phrase is not loaded in this session",
            None,
        )
    })?;
    Keys::from_mnemonic(phrase, None).map_err(|e| {
        wallet_err_json(
            "NOSTR_KEYS",
            format!("could not derive Nostr keys: {e}"),
            None,
        )
    })
}

fn nostr_xonly_pubkey(keys: &Keys) -> Result<B256, String> {
    let hex_pk = keys.public_key().to_hex();
    let bytes = hex::decode(&hex_pk).map_err(|e| {
        wallet_err_json(
            "NOSTR_PUBKEY",
            format!("invalid pubkey hex: {e}"),
            None,
        )
    })?;
    if bytes.len() != 32 {
        return Err(wallet_err_json(
            "NOSTR_PUBKEY",
            "expected 32-byte x-only pubkey",
            None,
        ));
    }
    Ok(B256::from_slice(&bytes))
}

fn record_to_dto(record: super::contracts::pacto_username::UsernameRecord) -> UsernameRecordDto {
    UsernameRecordDto {
        name: record.name,
        evm_address: format!("{:#x}", record.evmAddress),
        pending_address: format!("{:#x}", record.pendingAddress),
        token_id: record.tokenId.to_string(),
    }
}

async fn estimate_eoa_cost_wei<P: Provider>(
    provider: &P,
    from: Address,
    to: Address,
    calldata: &[u8],
    value: U256,
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
    value + U256::from(gas) * U256::from(max_fee)
}

async fn send_eoa_call<R: Runtime>(
    app: AppHandle<R>,
    net: &WalletNetworkConfig,
    urls: &[String],
    to: Address,
    calldata: Vec<u8>,
    value: U256,
) -> Result<String, String> {
    let (_signer, wallet) = load_embedded_signer(app).await?;
    let provider = connect_signing_provider(urls, wallet).await?;
    let tx = contract_call_request(to, calldata)
        .with_chain_id(net.chain_id)
        .with_value(value);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for username transaction confirmation. Check an explorer with the returned hash before resubmitting.",
    )
    .await?;
    Ok(format!("0x{:x}", receipt.transaction_hash))
}

async fn send_member_or_eoa_write<R: Runtime>(
    app: AppHandle<R>,
    net: &WalletNetworkConfig,
    urls: &[String],
    rpc_urls: Option<Vec<String>>,
    nft: Address,
    calldata: Vec<u8>,
    npub_hash: B256,
    member: Address,
    eoa_can_pay: bool,
    global_member_ok: bool,
) -> Result<(UsernameSponsorPath, Option<String>, Option<String>), String> {
    let path = select_username_sponsor_path(false, false, eoa_can_pay, global_member_ok);
    match path {
        UsernameSponsorPath::Eoa => {
            let tx = send_eoa_call(app, net, urls, nft, calldata, U256::ZERO).await?;
            Ok((path, Some(tx), None))
        }
        UsernameSponsorPath::GlobalMember => {
            let send = send_sponsored_username_userop(
                app,
                &net.key,
                nft,
                calldata,
                UsernameSponsorLane::Member,
                npub_hash,
                rpc_urls,
            )
            .await?;
            let receipt =
                wait_for_user_operation_receipt(&send.bundler_url, &send.user_op_hash).await?;
            if !receipt.success {
                return Err(wallet_err_json_with_tx_hash(
                    "USEROP_FAILED",
                    format!(
                        "sponsored UserOp {} was included but reverted (tx {})",
                        send.user_op_hash, receipt.tx_hash
                    ),
                    None,
                    receipt.tx_hash.clone(),
                ));
            }
            Ok((path, Some(receipt.tx_hash), Some(send.user_op_hash)))
        }
        UsernameSponsorPath::Bootstrap => Err(wallet_err_json(
            "USERNAME_PATH",
            "bootstrap path is not valid for address transfer writes",
            None,
        )),
        UsernameSponsorPath::Fail => Err(wallet_err_json(
            "USERNAME_PATH_UNAVAILABLE",
            format!(
                "no gas path for username write (member {member:#x}): fund the EOA or ensure eligibleMember + global pool"
            ),
            None,
        )),
    }
}

async fn member_eligibility_ok<P: Provider>(
    provider: &P,
    nft: Address,
    member: Address,
    expected_npub: B256,
) -> Result<(bool, U256), String> {
    let ret = eth_call_decode(provider, nft, &eligibleMemberCall { member })
        .await
        .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok((
        ret.npubHash == expected_npub && !ret.npubHash.is_zero(),
        ret.tokenId,
    ))
}

#[tauri::command]
pub async fn username_name_available(
    network: String,
    name: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<bool, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let provider = connect_read_provider(&urls).await?;
    let available: bool = eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &nameAvailableCall {
            name: name.trim().to_string(),
        },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(available)
}

#[tauri::command]
pub async fn username_can_bootstrap_claim<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    member: Option<String>,
    npub_hash: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<bool, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let hash = parse_b256(&npub_hash)?;
    let member_addr = if let Some(raw) = member.as_deref() {
        parse_address(raw.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?
    } else {
        let (signer, _) = load_embedded_signer(app).await?;
        signer.address()
    };
    let provider = connect_read_provider(&urls).await?;
    let can: bool = eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &canBootstrapClaimCall {
            member: member_addr,
            npubHash: hash,
        },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(can)
}

#[tauri::command]
pub async fn username_npub_of(
    network: String,
    evm_address: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let addr =
        parse_address(evm_address.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let provider = connect_read_provider(&urls).await?;
    let hash: B256 = eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &npubOfCall { evmAddress: addr },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(format!("{hash:#x}"))
}

#[tauri::command]
pub async fn username_record_of(
    network: String,
    npub_hash: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<UsernameRecordDto, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let hash = parse_b256(&npub_hash)?;
    let provider = connect_read_provider(&urls).await?;
    let record = eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &recordOfCall { npubHash: hash },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(record_to_dto(record))
}

#[tauri::command]
pub async fn username_eligible_member(
    network: String,
    member: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<UsernameEligibleMemberDto, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let addr =
        parse_address(member.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let provider = connect_read_provider(&urls).await?;
    let ret = eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &eligibleMemberCall { member: addr },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(UsernameEligibleMemberDto {
        npub_hash: format!("{:#x}", ret.npubHash),
        token_id: ret.tokenId.to_string(),
    })
}

#[tauri::command]
pub async fn username_is_pending_transfer(
    network: String,
    npub_hash: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<bool, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let hash = parse_b256(&npub_hash)?;
    let provider = connect_read_provider(&urls).await?;
    let pending: bool = eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &isPendingTransferCall { npubHash: hash },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(pending)
}

#[tauri::command]
pub async fn username_bootstrap_spendable_pool_wei(
    network: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let provider = connect_read_provider(&urls).await?;
    let wei: U256 = eth_call_decode(
        &provider,
        addrs.bootstrap_mint_pool,
        &bootstrapSpendableCall {},
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(wei.to_string())
}

#[tauri::command]
pub async fn username_global_spendable_pool_wei(
    network: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let provider = connect_read_provider(&urls).await?;
    let wei: U256 =
        eth_call_decode(&provider, addrs.global_sponsor_pool, &globalSpendableCall {})
            .await
            .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(wei.to_string())
}

#[tauri::command]
pub async fn username_mint_fee(
    network: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let provider = connect_read_provider(&urls).await?;
    let fee: U256 = eth_call_decode(&provider, addrs.pacto_username_nft, &mintFeeCall {})
        .await
        .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(fee.to_string())
}

#[tauri::command]
pub async fn username_used_nonce(
    network: String,
    npub_hash: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let hash = parse_b256(&npub_hash)?;
    let provider = connect_read_provider(&urls).await?;
    let nonce: U256 = eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &usedNonceCall { npubHash: hash },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(nonce.to_string())
}

#[tauri::command]
pub async fn username_get_cached_claim<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<UsernameClaimRow>, String> {
    db::get_username_claim(&app).map_err(|e| wallet_err_json("DB_ERROR", e, None))
}

#[tauri::command]
pub async fn username_claim<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    name: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<UsernameClaimResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    require_treasury_signing_allowed(app.clone()).await?;

    let username = validate_username(&name)?;
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls.clone())?;
    let addrs = username_addrs(&net.key)?;
    let nft = addrs.pacto_username_nft;

    let keys = load_nostr_keys()?;
    let pubkey = nostr_xonly_pubkey(&keys)?;
    let npub_hash = npub_hash_from_pubkey(pubkey);
    let (signer, _wallet) = load_embedded_signer(app.clone()).await?;
    let member = signer.address();

    let provider = connect_read_provider(&urls).await?;

    let available: bool = eth_call_decode(
        &provider,
        nft,
        &nameAvailableCall {
            name: username.clone(),
        },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    if !available {
        return Err(wallet_err_json(
            "USERNAME_TAKEN",
            format!("username `{username}` is not available"),
            None,
        ));
    }

    let existing: B256 = eth_call_decode(&provider, nft, &npubOfCall { evmAddress: member })
        .await
        .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    if !existing.is_zero() {
        return Err(wallet_err_json(
            "ALREADY_CLAIMED",
            format!("evm address {member:#x} already has npubOf={existing:#x}"),
            None,
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
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;

    let mint_fee: U256 = eth_call_decode(&provider, nft, &mintFeeCall {})
        .await
        .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    let used: U256 = eth_call_decode(
        &provider,
        nft,
        &usedNonceCall {
            npubHash: npub_hash,
        },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    let bootstrap_pool: U256 =
        eth_call_decode(&provider, addrs.bootstrap_mint_pool, &bootstrapSpendableCall {})
            .await
            .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    let balance = roster_native_balance_wei(&provider, member)
        .await
        .map_err(|e| wallet_err_json("BALANCE_LOOKUP", e, None))?;

    // Placeholder calldata length for gas estimate (actual claim built after signing).
    let rough_calldata = claimCall {
        name: username.clone(),
        npubHash: npub_hash,
        pubkey,
        nonce: used + U256::from(1u64),
        issuedAt: U256::from(1u64),
        salt: B256::ZERO,
        nostrSignature: Bytes::from(vec![0u8; 64]),
        evmSignature: Bytes::from(vec![0u8; 65]),
    }
    .abi_encode();
    let eoa_cost = estimate_eoa_cost_wei(&provider, member, nft, &rough_calldata, mint_fee).await;
    let bootstrap_pool_ok = can_bootstrap && !bootstrap_pool.is_zero();
    let eoa_can_pay = balance >= eoa_cost;
    let path = select_username_sponsor_path(true, bootstrap_pool_ok, eoa_can_pay, false);
    if path == UsernameSponsorPath::Fail {
        return Err(wallet_err_json(
            "USERNAME_PATH_UNAVAILABLE",
            format!(
                "no gas path for first claim: bootstrap_pool_ok={bootstrap_pool_ok}, eoa_balance={balance}, need~{eoa_cost}"
            ),
            None,
        ));
    }

    let nonce = used + U256::from(1u64);
    let issued_at = U256::from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    );
    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = B256::from(salt_bytes);

    let link_event_id = publish_username_claim_link(
        &keys,
        &username,
        member,
        npub_hash,
        nonce,
        issued_at,
        salt,
    )
    .await
    .map_err(|e| wallet_err_json("NOSTR_PUBLISH", e, None))?;

    let nostr_digest = hash_nostr_claim(pubkey, member, &username, nonce, issued_at, salt);
    let secret = keys.secret_key().to_secret_bytes();
    let nostr_sig = sign_nostr_claim(&secret, nostr_digest)
        .map_err(|e| wallet_err_json("NOSTR_SIGN", e, None))?;
    let evm_sig = sign_claim_binding(
        &signer,
        net.chain_id,
        nft,
        npub_hash,
        &username,
        nonce,
        issued_at,
        salt,
    )
    .map_err(|e| wallet_err_json("EVM_SIGN", e, None))?;

    let calldata = claimCall {
        name: username.clone(),
        npubHash: npub_hash,
        pubkey,
        nonce,
        issuedAt: issued_at,
        salt,
        nostrSignature: Bytes::from(nostr_sig.to_vec()),
        evmSignature: Bytes::from(evm_sig),
    }
    .abi_encode();

    let (path_label, tx_hash, user_op_hash) = match path {
        UsernameSponsorPath::Bootstrap => {
            let send = send_sponsored_username_userop(
                app.clone(),
                &net.key,
                nft,
                calldata,
                UsernameSponsorLane::Bootstrap,
                npub_hash,
                rpc_urls.clone(),
            )
            .await?;
            let receipt =
                wait_for_user_operation_receipt(&send.bundler_url, &send.user_op_hash).await?;
            if !receipt.success {
                return Err(wallet_err_json_with_tx_hash(
                    "USEROP_FAILED",
                    format!(
                        "bootstrap claim UserOp {} reverted (tx {})",
                        send.user_op_hash, receipt.tx_hash
                    ),
                    None,
                    receipt.tx_hash.clone(),
                ));
            }
            (
                "bootstrap".to_string(),
                Some(receipt.tx_hash),
                Some(send.user_op_hash),
            )
        }
        UsernameSponsorPath::Eoa => {
            let tx = send_eoa_call(app.clone(), net, &urls, nft, calldata, mint_fee).await?;
            ("eoa".to_string(), Some(tx), None)
        }
        UsernameSponsorPath::GlobalMember | UsernameSponsorPath::Fail => {
            return Err(wallet_err_json(
                "USERNAME_PATH",
                "unexpected path for first claim",
                None,
            ));
        }
    };

    let record = eth_call_decode(
        &provider,
        nft,
        &recordOfCall {
            npubHash: npub_hash,
        },
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    let dto = record_to_dto(record);

    let on_chain_policy: U256 = eth_call_decode(
        &provider,
        addrs.sponsor_policy_registry,
        &policyVersionCall {},
    )
    .await
    .unwrap_or(U256::from(addrs.policy_version));
    let policy_version = on_chain_policy
        .try_into()
        .unwrap_or(addrs.policy_version)
        .max(PACTO_ACTIONS_POLICY_VERSION.min(addrs.policy_version));

    db::upsert_username_claim(
        &app,
        &UsernameClaimUpsert {
            username: dto.name.clone(),
            npub_hash: format!("{npub_hash:#x}"),
            token_id: dto.token_id.clone(),
            link_event_id: Some(link_event_id.clone()),
            policy_version: policy_version as i64,
            network: net.key.clone(),
        },
    )
    .map_err(|e| wallet_err_json("DB_ERROR", e, None))?;

    Ok(UsernameClaimResult {
        network: net.key.clone(),
        chain_id: net.chain_id,
        path: path_label,
        username: dto.name,
        npub_hash: format!("{npub_hash:#x}"),
        token_id: dto.token_id,
        link_event_id,
        tx_hash,
        user_op_hash,
        evm_address: format!("{member:#x}"),
        policy_version,
    })
}

#[tauri::command]
pub async fn username_initiate_address_transfer<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    npub_hash: String,
    new_address: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<UsernameTransferResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    require_treasury_signing_allowed(app.clone()).await?;

    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls.clone())?;
    let addrs = username_addrs(&net.key)?;
    let nft = addrs.pacto_username_nft;
    let hash = parse_b256(&npub_hash)?;
    let new_addr = parse_address(new_address.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;

    let (signer, _) = load_embedded_signer(app.clone()).await?;
    let member = signer.address();
    let provider = connect_read_provider(&urls).await?;

    let (eligible, token_id) = member_eligibility_ok(&provider, nft, member, hash).await?;
    let global_pool: U256 =
        eth_call_decode(&provider, addrs.global_sponsor_pool, &globalSpendableCall {})
            .await
            .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    let on_chain_policy: U256 = eth_call_decode(
        &provider,
        addrs.sponsor_policy_registry,
        &policyVersionCall {},
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    if on_chain_policy > U256::from(PACTO_ACTIONS_POLICY_VERSION) {
        return Err(wallet_err_json(
            "POLICY_VERSION",
            format!(
                "local catalog policyVersion {PACTO_ACTIONS_POLICY_VERSION} is behind on-chain {on_chain_policy}"
            ),
            None,
        ));
    }

    let calldata = initiateAddressTransferCall {
        npubHash: hash,
        newAddress: new_addr,
    }
    .abi_encode();
    let balance = roster_native_balance_wei(&provider, member)
        .await
        .map_err(|e| wallet_err_json("BALANCE_LOOKUP", e, None))?;
    let eoa_cost = estimate_eoa_cost_wei(&provider, member, nft, &calldata, U256::ZERO).await;
    let eoa_can_pay = balance >= eoa_cost;
    let global_member_ok = eligible && !global_pool.is_zero();

    let (path, tx_hash, user_op_hash) = send_member_or_eoa_write(
        app.clone(),
        net,
        &urls,
        rpc_urls,
        nft,
        calldata,
        hash,
        member,
        eoa_can_pay,
        global_member_ok,
    )
    .await?;

    let record = eth_call_decode(&provider, nft, &recordOfCall { npubHash: hash })
        .await
        .ok();
    if let Some(rec) = record.as_ref() {
        let _ = db::upsert_username_claim(
            &app,
            &UsernameClaimUpsert {
                username: rec.name.clone(),
                npub_hash: format!("{hash:#x}"),
                token_id: rec.tokenId.to_string(),
                link_event_id: None,
                policy_version: addrs.policy_version as i64,
                network: net.key.clone(),
            },
        );
    }

    Ok(UsernameTransferResult {
        network: net.key.clone(),
        chain_id: net.chain_id,
        path: match path {
            UsernameSponsorPath::Eoa => "eoa".into(),
            UsernameSponsorPath::GlobalMember => "global_member".into(),
            other => format!("{other:?}").to_lowercase(),
        },
        npub_hash: format!("{hash:#x}"),
        tx_hash,
        user_op_hash,
        token_id: Some(token_id.to_string()),
        pending_address: Some(format!("{new_addr:#x}")),
    })
}

#[tauri::command]
pub async fn username_claim_address_transfer<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    npub_hash: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<UsernameTransferResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    require_treasury_signing_allowed(app.clone()).await?;

    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls.clone())?;
    let addrs = username_addrs(&net.key)?;
    let nft = addrs.pacto_username_nft;
    let hash = parse_b256(&npub_hash)?;

    let (signer, _) = load_embedded_signer(app.clone()).await?;
    let member = signer.address();
    let provider = connect_read_provider(&urls).await?;

    // New address claims the pending transfer; eligibility is checked for the *current*
    // on-chain member for member-sponsor path. Prefer EOA when funded.
    let record = eth_call_decode(&provider, nft, &recordOfCall { npubHash: hash })
        .await
        .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    if record.pendingAddress != member {
        return Err(wallet_err_json(
            "NOT_PENDING_ADDRESS",
            format!(
                "active signer {member:#x} is not pendingAddress {:#x}",
                record.pendingAddress
            ),
            None,
        ));
    }

    let on_chain_policy: U256 = eth_call_decode(
        &provider,
        addrs.sponsor_policy_registry,
        &policyVersionCall {},
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    if on_chain_policy > U256::from(PACTO_ACTIONS_POLICY_VERSION) {
        return Err(wallet_err_json(
            "POLICY_VERSION",
            format!(
                "local catalog policyVersion {PACTO_ACTIONS_POLICY_VERSION} is behind on-chain {on_chain_policy}"
            ),
            None,
        ));
    }

    let calldata = claimAddressTransferCall { npubHash: hash }.abi_encode();
    let balance = roster_native_balance_wei(&provider, member)
        .await
        .map_err(|e| wallet_err_json("BALANCE_LOOKUP", e, None))?;
    let eoa_cost = estimate_eoa_cost_wei(&provider, member, nft, &calldata, U256::ZERO).await;
    let eoa_can_pay = balance >= eoa_cost;
    // Pending address is not yet eligibleMember; member UserOp is unavailable until after claim.
    let (path, tx_hash, user_op_hash) = send_member_or_eoa_write(
        app.clone(),
        net,
        &urls,
        rpc_urls,
        nft,
        calldata,
        hash,
        member,
        eoa_can_pay,
        false,
    )
    .await?;
    let token_id = record.tokenId;

    let updated = eth_call_decode(&provider, nft, &recordOfCall { npubHash: hash })
        .await
        .ok();
    if let Some(rec) = updated.as_ref() {
        let _ = db::upsert_username_claim(
            &app,
            &UsernameClaimUpsert {
                username: rec.name.clone(),
                npub_hash: format!("{hash:#x}"),
                token_id: rec.tokenId.to_string(),
                link_event_id: None,
                policy_version: addrs.policy_version as i64,
                network: net.key.clone(),
            },
        );
    }

    Ok(UsernameTransferResult {
        network: net.key.clone(),
        chain_id: net.chain_id,
        path: match path {
            UsernameSponsorPath::Eoa => "eoa".into(),
            UsernameSponsorPath::GlobalMember => "global_member".into(),
            other => format!("{other:?}").to_lowercase(),
        },
        npub_hash: format!("{hash:#x}"),
        tx_hash,
        user_op_hash,
        token_id: Some(token_id.to_string()),
        pending_address: None,
    })
}

#[tauri::command]
pub async fn username_cancel_address_transfer<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    npub_hash: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<UsernameTransferResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    require_treasury_signing_allowed(app.clone()).await?;

    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls.clone())?;
    let addrs = username_addrs(&net.key)?;
    let nft = addrs.pacto_username_nft;
    let hash = parse_b256(&npub_hash)?;

    let (signer, _) = load_embedded_signer(app.clone()).await?;
    let member = signer.address();
    let provider = connect_read_provider(&urls).await?;

    let (eligible, token_id) = member_eligibility_ok(&provider, nft, member, hash).await?;
    let global_pool: U256 =
        eth_call_decode(&provider, addrs.global_sponsor_pool, &globalSpendableCall {})
            .await
            .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    let on_chain_policy: U256 = eth_call_decode(
        &provider,
        addrs.sponsor_policy_registry,
        &policyVersionCall {},
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    if on_chain_policy > U256::from(PACTO_ACTIONS_POLICY_VERSION) {
        return Err(wallet_err_json(
            "POLICY_VERSION",
            format!(
                "local catalog policyVersion {PACTO_ACTIONS_POLICY_VERSION} is behind on-chain {on_chain_policy}"
            ),
            None,
        ));
    }

    let calldata = cancelAddressTransferCall { npubHash: hash }.abi_encode();
    let balance = roster_native_balance_wei(&provider, member)
        .await
        .map_err(|e| wallet_err_json("BALANCE_LOOKUP", e, None))?;
    let eoa_cost = estimate_eoa_cost_wei(&provider, member, nft, &calldata, U256::ZERO).await;
    let eoa_can_pay = balance >= eoa_cost;
    let global_member_ok = eligible && !global_pool.is_zero();

    let (path, tx_hash, user_op_hash) = send_member_or_eoa_write(
        app.clone(),
        net,
        &urls,
        rpc_urls,
        nft,
        calldata,
        hash,
        member,
        eoa_can_pay,
        global_member_ok,
    )
    .await?;

    Ok(UsernameTransferResult {
        network: net.key.clone(),
        chain_id: net.chain_id,
        path: match path {
            UsernameSponsorPath::Eoa => "eoa".into(),
            UsernameSponsorPath::GlobalMember => "global_member".into(),
            other => format!("{other:?}").to_lowercase(),
        },
        npub_hash: format!("{hash:#x}"),
        tx_hash,
        user_op_hash,
        token_id: Some(token_id.to_string()),
        pending_address: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_username_accepts_lowercase() {
        assert_eq!(validate_username("dao").unwrap(), "dao");
        assert_eq!(validate_username("  daopunk  ").unwrap(), "daopunk");
    }

    #[test]
    fn validate_username_rejects_bad() {
        assert!(validate_username("ab").is_err());
        assert!(validate_username("Dao").is_err());
        assert!(validate_username("dao1").is_err());
        assert!(validate_username(&"a".repeat(33)).is_err());
    }

    #[test]
    fn parse_b256_round_trip() {
        let h = "0x540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1";
        let b = parse_b256(h).unwrap();
        assert_eq!(format!("{b:#x}"), h);
    }
}
