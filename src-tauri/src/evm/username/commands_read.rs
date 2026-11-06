//! Read / cache Tauri commands for username NFT.

use alloy::primitives::{B256, U256};
use tauri::{AppHandle, Runtime};

use super::dto::{UsernameAccountStateDto, UsernameEligibleMemberDto, UsernameRecordDto};
use super::helpers::{
    clear_link_restore_failure, link_restore_last_failure, load_nostr_keys, nostr_xonly_pubkey,
    parse_b256, read_registry_policy_version, record_link_restore_failure, record_to_dto,
    require_network, require_rpc_urls, should_attempt_username_link_restore, unix_now_secs,
    username_addrs, username_claim_cache_needs_upsert, username_holder_claim_upsert,
};
use crate::db::{self, UsernameClaimRow};
use crate::evm::contracts::pacto_username::IBootstrapMintPool::spendablePoolWeiCall as bootstrapSpendableCall;
use crate::evm::contracts::pacto_username::IGlobalSponsorPool::spendablePoolWeiCall as globalSpendableCall;
use crate::evm::contracts::pacto_username::IPactoUsernameNFT::{
    canBootstrapClaimCall, eligibleMemberCall, isPendingTransferCall, nameAvailableCall,
    npubOfCall, recordOfCall, usedNonceCall,
};
use crate::evm::nostr_claim_link::npub_hash_from_pubkey;
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::signer::load_embedded_signer;
use crate::evm::rpc::{connect_read_provider, parse_address, wallet_err_json};
use crate::evm::username_nostr_link::fetch_username_claim_link_id;

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
    let addr = parse_address(evm_address.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
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
    let wei: U256 = eth_call_decode(
        &provider,
        addrs.global_sponsor_pool,
        &globalSpendableCall {},
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(wei.to_string())
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

fn chain_unread(cached: Option<UsernameClaimRow>, chain_error: String) -> UsernameAccountStateDto {
    UsernameAccountStateDto {
        cached,
        record: None,
        pending_transfer: false,
        chain_error: Some(chain_error),
    }
}

/// Local claim row plus this account's username NFT record on one provider session.
/// A chain failure is `Ok` with `record: None` so the caller can keep the last record.
#[tauri::command]
pub async fn username_sync_account_state<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    rpc_urls: Option<Vec<String>>,
    force_link_restore: Option<bool>,
) -> Result<UsernameAccountStateDto, String> {
    let start_npub = crate::account_manager::get_current_account()
        .map_err(|e| wallet_err_json("DB_ERROR", e, None))?;
    let mut cached =
        db::get_username_claim(&app).map_err(|e| wallet_err_json("DB_ERROR", e, None))?;
    let net = require_network(&network)?;
    let urls = require_rpc_urls(net, rpc_urls)?;
    let addrs = username_addrs(&net.key)?;
    let keys = load_nostr_keys()?;
    let pubkey = nostr_xonly_pubkey(&keys)?;
    let npub_hash = npub_hash_from_pubkey(pubkey);
    let provider = match connect_read_provider(&urls).await {
        Ok(provider) => provider,
        Err(e) => return Ok(chain_unread(cached, e)),
    };
    let record = match eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &recordOfCall {
            npubHash: npub_hash,
        },
    )
    .await
    {
        Ok(record) => record,
        Err(e) => {
            return Ok(chain_unread(
                cached,
                wallet_err_json("USERNAME_READ", e, None),
            ))
        }
    };
    let pending = match eth_call_decode(
        &provider,
        addrs.pacto_username_nft,
        &isPendingTransferCall {
            npubHash: npub_hash,
        },
    )
    .await
    {
        Ok(pending) => pending,
        Err(e) => {
            return Ok(chain_unread(
                cached,
                wallet_err_json("USERNAME_READ", e, None),
            ))
        }
    };
    if let Some(preview) =
        username_holder_claim_upsert(&record.name, record.tokenId, npub_hash, 0, &net.key)
    {
        if username_claim_cache_needs_upsert(
            cached.as_ref(),
            &preview.username,
            &preview.token_id,
            &net.key,
        ) {
            let policy_version =
                read_registry_policy_version(&provider, addrs.sponsor_policy_registry).await;
            if let Some(upsert) = username_holder_claim_upsert(
                &record.name,
                record.tokenId,
                npub_hash,
                policy_version as i64,
                &net.key,
            ) {
                db::upsert_username_claim(&app, &upsert)
                    .map_err(|e| wallet_err_json("DB_ERROR", e, None))?;
                cached = db::get_username_claim(&app)
                    .map_err(|e| wallet_err_json("DB_ERROR", e, None))?;
            }
        }
    }
    let restore_meta = cached.as_ref().and_then(|row| {
        let missing = row
            .link_event_id
            .as_deref()
            .map(|id| id.trim().is_empty())
            .unwrap_or(true);
        if missing && !record.name.trim().is_empty() && !record.tokenId.is_zero() {
            Some((row.updated_at_ms, row.npub_hash.clone()))
        } else {
            None
        }
    });
    if let Some((expected_updated_at, expected_hash)) = restore_meta {
        let force = force_link_restore.unwrap_or(false);
        if !should_attempt_username_link_restore(
            unix_now_secs(),
            link_restore_last_failure(npub_hash),
            force,
        ) {
            log::debug!(
                target: "pacto_wallet",
                "username claim link restore skipped: failure backoff"
            );
        } else {
            let id = fetch_username_claim_link_id(
                &keys,
                npub_hash,
                record.name.trim(),
                record.evmAddress,
            )
            .await;
            let id = id.as_deref().map(str::trim).filter(|s| !s.is_empty());
            match id {
                None => record_link_restore_failure(npub_hash, unix_now_secs()),
                Some(id) => {
                    let live = db::try_restore_username_claim_link(
                        &app,
                        &start_npub,
                        &expected_hash,
                        expected_updated_at,
                        id,
                    )
                    .map_err(|e| wallet_err_json("DB_ERROR", e, None))?;
                    let still_here = crate::account_manager::get_current_account()
                        .ok()
                        .is_some_and(|npub| npub == start_npub);
                    match (still_here, live) {
                        (true, Some(row)) => {
                            let has_link = row
                                .link_event_id
                                .as_deref()
                                .map(|s| !s.trim().is_empty())
                                .unwrap_or(false);
                            cached = Some(row);
                            if has_link {
                                clear_link_restore_failure(npub_hash);
                            }
                        }
                        _ => {
                            log::debug!(
                                target: "pacto_wallet",
                                "username claim link restore skipped: row changed or session moved"
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(UsernameAccountStateDto {
        cached,
        record: Some(record_to_dto(record)),
        pending_transfer: pending,
        chain_error: None,
    })
}
