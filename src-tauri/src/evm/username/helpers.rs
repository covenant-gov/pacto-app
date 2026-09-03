//! Shared validate / send / eligibility helpers for username commands.

use std::collections::HashSet;
use std::sync::Mutex;

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use nostr_sdk::nips::nip06::FromMnemonic;
use nostr_sdk::prelude::Keys;
use once_cell::sync::Lazy;
use tauri::{AppHandle, Runtime};

use super::dto::{UsernameRecordDto, PACTO_ACTIONS_POLICY_VERSION};
use crate::db::{self, UsernameClaimUpsert};
use crate::evm::contracts::pacto_username::IPactoUsernameNFT::{eligibleMemberCall, recordOfCall};
use crate::evm::contracts::pacto_username::ISponsorPolicyRegistry::policyVersionCall;
use crate::evm::global_sponsor_userop::{send_sponsored_username_userop, UsernameSponsorLane};
use crate::evm::gov_read::rpc_urls_or_default;
use crate::evm::pacto_chain_config::{self, GlobalUsernameSponsorAddresses};
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::signer::load_embedded_signer;
use crate::evm::rpc::{
    connect_signing_provider, contract_call_request, send_and_confirm, wallet_err_json,
    wallet_err_json_with_tx_hash,
};
use crate::evm::sponsor_path::{select_username_sponsor_path, UsernameSponsorPath};
use crate::evm::sponsor_userop::{
    call_gas_ceiling_for_calldata, call_gas_with_margin, estimate_call_gas,
    roster_native_balance_wei, wait_for_user_operation_receipt, FALLBACK_MAX_FEE,
};
use crate::evm::wallet_chain_config::{self, WalletNetworkConfig};

static IN_FLIGHT: Lazy<Mutex<HashSet<B256>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// Process-local guard: one in-flight write per `npub_hash` at a time.
pub struct InFlightGuard {
    hash: B256,
}

impl InFlightGuard {
    pub fn acquire(hash: B256) -> Result<Self, String> {
        let mut set = IN_FLIGHT
            .lock()
            .map_err(|_| wallet_err_json("USERNAME_IN_FLIGHT", "in-flight lock poisoned", None))?;
        if !set.insert(hash) {
            return Err(wallet_err_json(
                "USERNAME_IN_FLIGHT",
                format!("username write already in flight for npub_hash {hash:#x}"),
                None,
            ));
        }
        Ok(Self { hash })
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = IN_FLIGHT.lock() {
            set.remove(&self.hash);
        }
    }
}

pub fn require_network(network: &str) -> Result<&'static WalletNetworkConfig, String> {
    wallet_chain_config::network_by_key(&network.to_lowercase()).ok_or_else(|| {
        wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {network}"),
            None,
        )
    })
}

pub fn username_addrs(net_key: &str) -> Result<GlobalUsernameSponsorAddresses, String> {
    pacto_chain_config::global_username_sponsor_addresses(net_key)
        .map_err(|e| wallet_err_json("USERNAME_CONFIG", e, None))
}

pub fn require_rpc_urls(
    net: &WalletNetworkConfig,
    rpc_urls: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let urls = rpc_urls_or_default(net, rpc_urls);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }
    Ok(urls)
}

pub fn validate_username(name: &str) -> Result<String, String> {
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

pub fn parse_b256(raw: &str) -> Result<B256, String> {
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
    let bytes = hex::decode(h)
        .map_err(|e| wallet_err_json("INVALID_NPUB_HASH", format!("invalid hex: {e}"), None))?;
    Ok(B256::from_slice(&bytes))
}

pub fn load_nostr_keys() -> Result<Keys, String> {
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

pub fn nostr_xonly_pubkey(keys: &Keys) -> Result<B256, String> {
    let hex_pk = keys.public_key().to_hex();
    let bytes = hex::decode(&hex_pk)
        .map_err(|e| wallet_err_json("NOSTR_PUBKEY", format!("invalid pubkey hex: {e}"), None))?;
    if bytes.len() != 32 {
        return Err(wallet_err_json(
            "NOSTR_PUBKEY",
            "expected 32-byte x-only pubkey",
            None,
        ));
    }
    Ok(B256::from_slice(&bytes))
}

pub fn record_to_dto(
    record: crate::evm::contracts::pacto_username::UsernameRecord,
) -> UsernameRecordDto {
    UsernameRecordDto {
        name: record.name,
        evm_address: format!("{:#x}", record.evmAddress),
        pending_address: format!("{:#x}", record.pendingAddress),
        token_id: record.tokenId.to_string(),
    }
}

pub fn member_npub_matches(onchain: B256, expected: B256) -> bool {
    onchain == expected && !onchain.is_zero()
}

pub fn path_label(path: UsernameSponsorPath) -> String {
    match path {
        UsernameSponsorPath::Eoa => "eoa".into(),
        UsernameSponsorPath::GlobalMember => "global_member".into(),
        other => format!("{other:?}").to_lowercase(),
    }
}

pub async fn estimate_eoa_cost_wei<P: Provider>(
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

pub async fn send_eoa_call<R: Runtime>(
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

pub async fn send_member_or_eoa_write<R: Runtime>(
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

pub async fn member_eligibility_ok<P: Provider>(
    provider: &P,
    nft: Address,
    member: Address,
    expected_npub: B256,
) -> Result<(bool, U256), String> {
    let ret = eth_call_decode(provider, nft, &eligibleMemberCall { member })
        .await
        .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok((
        member_npub_matches(ret.npubHash, expected_npub),
        ret.tokenId,
    ))
}

pub async fn assert_policy_version_ok<P: Provider>(
    provider: &P,
    registry: Address,
) -> Result<(), String> {
    let on_chain_policy: U256 = eth_call_decode(provider, registry, &policyVersionCall {})
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
    Ok(())
}

/// Balance + EOA cost estimate + member/EOA send for transfer writes.
pub async fn finalize_member_write<R: Runtime, P: Provider>(
    app: AppHandle<R>,
    net: &WalletNetworkConfig,
    urls: &[String],
    rpc_urls: Option<Vec<String>>,
    provider: &P,
    nft: Address,
    calldata: Vec<u8>,
    npub_hash: B256,
    member: Address,
    global_member_ok: bool,
) -> Result<(UsernameSponsorPath, Option<String>, Option<String>), String> {
    let balance = roster_native_balance_wei(provider, member)
        .await
        .map_err(|e| wallet_err_json("BALANCE_LOOKUP", e, None))?;
    let eoa_cost = estimate_eoa_cost_wei(provider, member, nft, &calldata, U256::ZERO).await;
    let eoa_can_pay = balance >= eoa_cost;
    send_member_or_eoa_write(
        app,
        net,
        urls,
        rpc_urls,
        nft,
        calldata,
        npub_hash,
        member,
        eoa_can_pay,
        global_member_ok,
    )
    .await
}

/// Best-effort cache refresh after initiate (preserves existing link_event_id).
pub async fn refresh_claim_cache_after_initiate<R: Runtime, P: Provider>(
    app: &AppHandle<R>,
    provider: &P,
    nft: Address,
    hash: B256,
    policy_version: u64,
    network: &str,
) {
    let record = eth_call_decode(provider, nft, &recordOfCall { npubHash: hash })
        .await
        .ok();
    if let Some(rec) = record.as_ref() {
        let _ = db::upsert_username_claim(
            app,
            &UsernameClaimUpsert {
                username: rec.name.clone(),
                npub_hash: format!("{hash:#x}"),
                token_id: rec.tokenId.to_string(),
                link_event_id: None,
                invalidate_link_event_id: false,
                policy_version: policy_version as i64,
                network: network.to_string(),
            },
        );
    }
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

    #[test]
    fn member_npub_matches_table() {
        let a = B256::repeat_byte(0x11);
        let b = B256::repeat_byte(0x22);
        assert!(member_npub_matches(a, a));
        assert!(!member_npub_matches(a, b));
        assert!(!member_npub_matches(B256::ZERO, B256::ZERO));
        assert!(!member_npub_matches(B256::ZERO, a));
    }

    #[test]
    fn in_flight_guard_refuses_second_acquire() {
        let hash = B256::repeat_byte(0xab);
        let first = InFlightGuard::acquire(hash).expect("first acquire");
        let second = InFlightGuard::acquire(hash);
        assert!(second.is_err());
        drop(first);
        let third = InFlightGuard::acquire(hash).expect("acquire after drop");
        drop(third);
    }
}
