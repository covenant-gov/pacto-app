//! Address-transfer Tauri commands for username NFT.

use alloy::primitives::U256;
use alloy::sol_types::SolCall;
use rand::RngCore;
use tauri::{AppHandle, Runtime};

use super::dto::UsernameTransferResult;
use super::helpers::{
    assert_policy_version_ok, finalize_member_write, load_nostr_keys, member_eligibility_ok,
    parse_b256, path_label, refresh_claim_cache_after_initiate, require_network, require_rpc_urls,
    username_addrs, InFlightGuard,
};
use crate::db::{self, UsernameClaimUpsert};
use crate::evm::contracts::pacto_username::IGlobalSponsorPool::spendablePoolWeiCall as globalSpendableCall;
use crate::evm::contracts::pacto_username::IPactoUsernameNFT::{
    cancelAddressTransferCall, claimAddressTransferCall, initiateAddressTransferCall, recordOfCall,
    usedNonceCall,
};
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::signer::{load_embedded_signer, require_treasury_signing_allowed};
use crate::evm::rpc::{connect_read_provider, parse_address, wallet_err_json};
use crate::evm::username_nostr_link::publish_username_claim_link;

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
    let _in_flight = InFlightGuard::acquire(hash)?;
    let new_addr = parse_address(new_address.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;

    let (signer, _) = load_embedded_signer(app.clone()).await?;
    let member = signer.address();
    let provider = connect_read_provider(&urls).await?;

    let (eligible, token_id) = member_eligibility_ok(&provider, nft, member, hash).await?;
    let global_pool: U256 = eth_call_decode(
        &provider,
        addrs.global_sponsor_pool,
        &globalSpendableCall {},
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    assert_policy_version_ok(&provider, addrs.sponsor_policy_registry).await?;

    let calldata = initiateAddressTransferCall {
        npubHash: hash,
        newAddress: new_addr,
    }
    .abi_encode();
    let global_member_ok = eligible && !global_pool.is_zero();

    let (path, tx_hash, user_op_hash) = finalize_member_write(
        app.clone(),
        net,
        &urls,
        rpc_urls,
        &provider,
        nft,
        calldata,
        hash,
        member,
        global_member_ok,
    )
    .await?;

    refresh_claim_cache_after_initiate(&app, &provider, nft, hash, addrs.policy_version, &net.key)
        .await;

    Ok(UsernameTransferResult {
        network: net.key.clone(),
        chain_id: net.chain_id,
        path: path_label(path),
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
    let _in_flight = InFlightGuard::acquire(hash)?;

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

    assert_policy_version_ok(&provider, addrs.sponsor_policy_registry).await?;

    let calldata = claimAddressTransferCall { npubHash: hash }.abi_encode();
    // Pending address is not yet eligibleMember; member UserOp is unavailable until after claim.
    let (path, tx_hash, user_op_hash) = finalize_member_write(
        app.clone(),
        net,
        &urls,
        rpc_urls,
        &provider,
        nft,
        calldata,
        hash,
        member,
        false,
    )
    .await?;
    let token_id = record.tokenId;

    let updated = eth_call_decode(&provider, nft, &recordOfCall { npubHash: hash })
        .await
        .ok();
    let rec = updated.as_ref().unwrap_or(&record);

    // Ownership moved to this signer — republish kind-31337 so the verified badge
    // is not left pointing at an attestation for the previous address.
    let mut link_event_id: Option<String> = None;
    match load_nostr_keys() {
        Ok(keys) => {
            let used: U256 = eth_call_decode(&provider, nft, &usedNonceCall { npubHash: hash })
                .await
                .unwrap_or(U256::ZERO);
            let nonce = used + U256::from(1u64);
            let issued_at = U256::from(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
            );
            let mut salt_bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut salt_bytes);
            let salt = alloy::primitives::B256::from(salt_bytes);
            match publish_username_claim_link(
                &keys, &rec.name, member, hash, nonce, issued_at, salt,
            )
            .await
            {
                Ok(id) => link_event_id = Some(id),
                Err(e) => {
                    log::warn!(
                        target: "pacto_wallet",
                        "username claim-transfer Nostr link republish failed: {e}"
                    );
                }
            }
        }
        Err(e) => {
            log::warn!(
                target: "pacto_wallet",
                "username claim-transfer Nostr keys unavailable for link republish: {e}"
            );
        }
    }

    if let Err(e) = db::upsert_username_claim(
        &app,
        &UsernameClaimUpsert {
            username: rec.name.clone(),
            npub_hash: format!("{hash:#x}"),
            token_id: rec.tokenId.to_string(),
            link_event_id: link_event_id.clone(),
            invalidate_link_event_id: link_event_id.is_none(),
            policy_version: addrs.policy_version as i64,
            network: net.key.clone(),
        },
    ) {
        log::warn!(
            target: "pacto_wallet",
            "username claim-transfer cache upsert failed after on-chain success: {e}"
        );
    }

    Ok(UsernameTransferResult {
        network: net.key.clone(),
        chain_id: net.chain_id,
        path: path_label(path),
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
    let _in_flight = InFlightGuard::acquire(hash)?;

    let (signer, _) = load_embedded_signer(app.clone()).await?;
    let member = signer.address();
    let provider = connect_read_provider(&urls).await?;

    let (eligible, token_id) = member_eligibility_ok(&provider, nft, member, hash).await?;
    let global_pool: U256 = eth_call_decode(
        &provider,
        addrs.global_sponsor_pool,
        &globalSpendableCall {},
    )
    .await
    .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    assert_policy_version_ok(&provider, addrs.sponsor_policy_registry).await?;

    let calldata = cancelAddressTransferCall { npubHash: hash }.abi_encode();
    let global_member_ok = eligible && !global_pool.is_zero();

    let (path, tx_hash, user_op_hash) = finalize_member_write(
        app.clone(),
        net,
        &urls,
        rpc_urls,
        &provider,
        nft,
        calldata,
        hash,
        member,
        global_member_ok,
    )
    .await?;

    Ok(UsernameTransferResult {
        network: net.key.clone(),
        chain_id: net.chain_id,
        path: path_label(path),
        npub_hash: format!("{hash:#x}"),
        tx_hash,
        user_op_hash,
        token_id: Some(token_id.to_string()),
        pending_address: None,
    })
}
