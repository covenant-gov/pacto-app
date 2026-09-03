//! `username_claim` Tauri command.

use alloy::primitives::{Bytes, B256, U256};
use alloy::sol_types::SolCall;
use rand::RngCore;
use tauri::{AppHandle, Runtime};

use super::dto::{UsernameClaimResult, PACTO_ACTIONS_POLICY_VERSION};
use super::helpers::{
    estimate_eoa_cost_wei, load_nostr_keys, nostr_xonly_pubkey, record_to_dto, require_network,
    require_rpc_urls, send_eoa_call, username_addrs, validate_username, InFlightGuard,
};
use crate::db::{self, UsernameClaimUpsert};
use crate::evm::claim_binding::sign_claim_binding;
use crate::evm::contracts::pacto_username::IBootstrapMintPool::spendablePoolWeiCall as bootstrapSpendableCall;
use crate::evm::contracts::pacto_username::IPactoUsernameNFT::{
    canBootstrapClaimCall, claimCall, mintFeeCall, nameAvailableCall, npubOfCall, recordOfCall,
    usedNonceCall,
};
use crate::evm::contracts::pacto_username::ISponsorPolicyRegistry::policyVersionCall;
use crate::evm::global_sponsor_userop::{send_sponsored_username_userop, UsernameSponsorLane};
use crate::evm::nostr_claim_link::{hash_nostr_claim, npub_hash_from_pubkey, sign_nostr_claim};
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::signer::{load_embedded_signer, require_treasury_signing_allowed};
use crate::evm::rpc::{connect_read_provider, wallet_err_json, wallet_err_json_with_tx_hash};
use crate::evm::sponsor_path::{select_username_sponsor_path, UsernameSponsorPath};
use crate::evm::sponsor_userop::{roster_native_balance_wei, wait_for_user_operation_receipt};
use crate::evm::username_nostr_link::publish_username_claim_link;

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
    let _in_flight = InFlightGuard::acquire(npub_hash)?;
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
    let bootstrap_pool: U256 = eth_call_decode(
        &provider,
        addrs.bootstrap_mint_pool,
        &bootstrapSpendableCall {},
    )
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

    let link_event_id =
        publish_username_claim_link(&keys, &username, member, npub_hash, nonce, issued_at, salt)
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

    if let Err(e) = db::upsert_username_claim(
        &app,
        &UsernameClaimUpsert {
            username: dto.name.clone(),
            npub_hash: format!("{npub_hash:#x}"),
            token_id: dto.token_id.clone(),
            link_event_id: Some(link_event_id.clone()),
            invalidate_link_event_id: false,
            policy_version: policy_version as i64,
            network: net.key.clone(),
        },
    ) {
        log::warn!(
            target: "pacto_wallet",
            "username claim cache upsert failed after on-chain success: {e}"
        );
    }

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
