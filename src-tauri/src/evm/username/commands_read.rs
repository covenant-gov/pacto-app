//! Read / cache Tauri commands for username NFT.

use alloy::primitives::{B256, U256};
use tauri::{AppHandle, Runtime};

use super::dto::{UsernameEligibleMemberDto, UsernameRecordDto};
use super::helpers::{
    parse_b256, record_to_dto, require_network, require_rpc_urls, username_addrs,
};
use crate::db::{self, UsernameClaimRow};
use crate::evm::contracts::pacto_username::IBootstrapMintPool::spendablePoolWeiCall as bootstrapSpendableCall;
use crate::evm::contracts::pacto_username::IGlobalSponsorPool::spendablePoolWeiCall as globalSpendableCall;
use crate::evm::contracts::pacto_username::IPactoUsernameNFT::{
    canBootstrapClaimCall, eligibleMemberCall, isPendingTransferCall, mintFeeCall,
    nameAvailableCall, npubOfCall, recordOfCall, usedNonceCall,
};
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::signer::load_embedded_signer;
use crate::evm::rpc::{connect_read_provider, parse_address, wallet_err_json};

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
