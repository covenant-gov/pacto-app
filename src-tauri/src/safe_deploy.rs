//! Deploy a Safe 1.3.0 proxy via `GnosisSafeProxyFactory.createProxyWithNonce`, using addresses from
//! safe-global/safe-deployments (canonical vs eip155 ordering per chain).

use alloy::network::{EthereumWallet, TransactionBuilder};
use alloy::primitives::{keccak256, Address, B256, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::{TransactionReceipt, TransactionRequest};
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use alloy::sol_types::SolCall;
use serde::Serialize;
use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};

use crate::crypto;
use crate::db;
use crate::wallet_chain_config;
use crate::wallet_ops;
use crate::wallet_security;

sol! {
    interface GnosisSafeSetup {
        function setup(
            address[] _owners,
            uint256 _threshold,
            address to,
            bytes data,
            address fallbackHandler,
            address paymentToken,
            uint256 payment,
            address paymentReceiver
        ) external;
    }

    interface GnosisSafeProxyFactory {
        function createProxyWithNonce(
            address _singleton,
            bytes initializer,
            uint256 saltNonce
        ) external returns (address proxy);
    }
}

/// Same timeout policy as `wallet_ops::wallet_build_and_send_transaction`.
const RECEIPT_WAIT_TIMEOUT: Duration = Duration::from_secs(180);

/// Topic0 for `ProxyCreation(address,address)` (no indexed parameters in Safe 1.3.0 factory).
fn proxy_creation_topic0() -> B256 {
    B256::from_slice(keccak256("ProxyCreation(address,address)").as_slice())
}

/// GnosisSafe + factory + compatibility fallback handler for Safe **1.3.0** on supported chains.
/// Ordering matches safe-deployments `networkAddresses`: chain `1` uses `canonical` first; `10` and
/// `11155111` use `eip155` first.
#[derive(Clone, Copy, Debug)]
pub struct SafeFactoryAddresses {
    pub singleton: Address,
    pub proxy_factory: Address,
    pub fallback_handler: Address,
}

pub fn safe_factory_addresses_for_chain_id(chain_id: u64) -> Option<SafeFactoryAddresses> {
    use alloy::primitives::address;
    match chain_id {
        1 => Some(SafeFactoryAddresses {
            singleton: address!("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552"),
            proxy_factory: address!("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2"),
            fallback_handler: address!("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"),
        }),
        10 | 11_155_111 => Some(SafeFactoryAddresses {
            singleton: address!("0x69f4D1788e39c87893C980c06EdF4b7f686e2938"),
            proxy_factory: address!("0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC"),
            fallback_handler: address!("0x017062a1dE2FE6b99BE3d9d37841FeD19F573804"),
        }),
        _ => None,
    }
}

fn parse_salt_nonce(raw: Option<String>) -> Result<U256, String> {
    let Some(s) = raw.filter(|x| !x.trim().is_empty()) else {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "system time before UNIX epoch".to_string())?
            .as_nanos();
        return Ok(U256::from(nanos));
    };
    let t = s.trim();
    if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        let v = U256::from_str_radix(h, 16).map_err(|_| "invalid salt_nonce hex".to_string())?;
        return Ok(v);
    }
    let v = U256::from_str_radix(t, 10).map_err(|_| "invalid salt_nonce decimal".to_string())?;
    Ok(v)
}

/// Sort and dedupe owner addresses; Safe requires sorted unique owners.
fn normalize_owners(owners_hex: &[String]) -> Result<Vec<Address>, String> {
    let mut addrs: Vec<Address> = Vec::with_capacity(owners_hex.len());
    let mut seen: HashSet<String> = HashSet::new();
    for s in owners_hex {
        let a = wallet_ops::parse_address(s)?;
        let k = format!("{:x}", a);
        if !seen.insert(k) {
            return Err("duplicate owner address".into());
        }
        addrs.push(a);
    }
    addrs.sort_by_key(|a| *a);
    Ok(addrs)
}

fn encode_setup_initializer(
    owners: &[Address],
    threshold: u64,
    fallback_handler: Address,
) -> Result<Vec<u8>, String> {
    if owners.is_empty() {
        return Err("at least one owner required".into());
    }
    if threshold == 0 || threshold > owners.len() as u64 {
        return Err("threshold must be between 1 and number of owners".into());
    }
    let call = GnosisSafeSetup::setupCall {
        _owners: owners.to_vec(),
        _threshold: U256::from(threshold),
        to: Address::ZERO,
        data: Bytes::new(),
        fallbackHandler: fallback_handler,
        paymentToken: Address::ZERO,
        payment: U256::ZERO,
        paymentReceiver: Address::ZERO,
    };
    Ok(call.abi_encode())
}

fn encode_create_proxy_call(
    singleton: Address,
    initializer: Vec<u8>,
    salt_nonce: U256,
) -> Vec<u8> {
    GnosisSafeProxyFactory::createProxyWithNonceCall {
        _singleton: singleton,
        initializer: Bytes::from(initializer),
        saltNonce: salt_nonce,
    }
    .abi_encode()
}

/// Extract deployed proxy address from factory `ProxyCreation` log.
fn proxy_address_from_factory_receipt(
    receipt: &TransactionReceipt,
    factory: Address,
) -> Result<Address, String> {
    let topic0 = proxy_creation_topic0();
    for log in receipt.logs() {
        if log.address() != factory {
            continue;
        }
        let topics = log.topics();
        if topics.first() != Some(&topic0) {
            continue;
        }
        let data = log.data().data.as_ref();
        if data.len() < 64 {
            continue;
        }
        // ABI-encoded non-indexed `address` params: 32-byte words, address right-aligned.
        let proxy_word = &data[0..32];
        let proxy = Address::from_slice(&proxy_word[12..32]);
        return Ok(proxy);
    }
    Err("no ProxyCreation log from Safe factory in receipt".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeDeployProxyResult {
    pub tx_hash: String,
    pub safe_address: String,
    /// Wallet network key: `mainnet`, `optimism`, or `sepolia`.
    pub chain: String,
    pub chain_id: u64,
}

/// Deploy a new Safe proxy on **mainnet**, **optimism**, or **sepolia** using the embedded EVM key.
#[tauri::command]
pub async fn safe_deploy_proxy<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    owners: Vec<String>,
    threshold: u32,
    salt_nonce: Option<String>,
) -> Result<SafeDeployProxyResult, String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_ops::wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };
    let Some(addrs) = safe_factory_addresses_for_chain_id(net.chain_id) else {
        return Err(wallet_ops::wallet_err_json(
            "UNSUPPORTED_NETWORK",
            "Safe factory addresses not defined for this chain",
            None,
        ));
    };

    let owners_norm = normalize_owners(&owners).map_err(|e| {
        wallet_ops::wallet_err_json("INVALID_OWNERS", e, None)
    })?;
    let th = u64::from(threshold);
    let initializer = encode_setup_initializer(
        &owners_norm,
        th,
        addrs.fallback_handler,
    )
    .map_err(|e| wallet_ops::wallet_err_json("INVALID_SAFE_SETUP", e, None))?;

    let salt = parse_salt_nonce(salt_nonce).map_err(|e| {
        wallet_ops::wallet_err_json("INVALID_SALT_NONCE", e, None)
    })?;

    let calldata = encode_create_proxy_call(addrs.singleton, initializer, salt);

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_ops::wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    let enc = db::get_evm_pkey(app.clone())
        .map_err(|e| wallet_ops::wallet_err_json("DB_ERROR", e, None))?
        .ok_or_else(|| wallet_ops::wallet_err_json("NO_EVM_KEY", "EVM key not set for this account", None))?;

    let evm_private_key = crypto::internal_decrypt(enc, None)
        .await
        .map_err(|_| wallet_ops::wallet_err_json("DECRYPT_FAILED", "Could not decrypt EVM key", None))?;

    let signer: PrivateKeySigner = evm_private_key
        .parse()
        .map_err(|_| wallet_ops::wallet_err_json("INVALID_KEY", "Invalid EVM key format", None))?;

    let wallet = EthereumWallet::from(signer);
    let mut provider_opt = None;
    let mut connect_last = String::new();
    for url_s in &urls {
        if url_s.parse::<url::Url>().is_err() {
            connect_last = "invalid RPC URL".to_string();
            continue;
        }
        match ProviderBuilder::new()
            .wallet(wallet.clone())
            .connect(url_s.as_str())
            .await
        {
            Ok(p) => {
                provider_opt = Some(p);
                break;
            }
            Err(e) => {
                connect_last = wallet_security::redact_urls_in_text(&e.to_string());
            }
        }
    }
    let provider = match provider_opt {
        Some(p) => p,
        None => {
            return Err(wallet_ops::wallet_err_json(
                "RPC_CONNECT",
                format!(
                    "tried {} URL(s), last error: {}",
                    urls.len(),
                    connect_last
                ),
                None,
            ));
        }
    };

    let tx = TransactionRequest::default()
        .with_to(addrs.proxy_factory)
        .with_input(Bytes::from(calldata));

    let pending = provider
        .send_transaction(tx)
        .await
        .map_err(|e| {
            wallet_ops::wallet_err_json(
                "SEND_FAILED",
                wallet_security::redact_urls_in_text(&e.to_string()),
                None,
            )
        })?;

    let submitted_tx_hash = format!("0x{:x}", *pending.tx_hash());
    let receipt = pending
        .with_timeout(Some(RECEIPT_WAIT_TIMEOUT))
        .get_receipt()
        .await
        .map_err(|_| {
            wallet_ops::wallet_err_json_with_tx_hash(
                "RECEIPT_TIMEOUT",
                "Timed out waiting for confirmation. The transaction may still complete; check a block explorer using the hash below.",
                None,
                submitted_tx_hash.clone(),
            )
        })?;

    if !receipt.status() {
        return Err(wallet_ops::wallet_err_json(
            "TX_REVERTED",
            "Transaction was mined but reverted",
            None,
        ));
    }

    let proxy = proxy_address_from_factory_receipt(&receipt, addrs.proxy_factory).map_err(|e| {
        wallet_ops::wallet_err_json_with_tx_hash(
            "PARSE_RECEIPT",
            e,
            None,
            format!("0x{:x}", receipt.transaction_hash),
        )
    })?;

    Ok(SafeDeployProxyResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        safe_address: format!("{:#x}", proxy),
        chain: net.key.clone(),
        chain_id: net.chain_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;

    #[test]
    fn factory_addresses_mainnet() {
        let a = safe_factory_addresses_for_chain_id(1).expect("mainnet");
        assert_eq!(
            a.singleton,
            address!("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552")
        );
        assert_eq!(
            a.proxy_factory,
            address!("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2")
        );
    }

    #[test]
    fn factory_addresses_optimism_and_sepolia_eip155() {
        let o = safe_factory_addresses_for_chain_id(10).expect("optimism");
        let s = safe_factory_addresses_for_chain_id(11_155_111).expect("sepolia");
        assert_eq!(o.singleton, s.singleton);
        assert_eq!(o.proxy_factory, s.proxy_factory);
        assert_eq!(
            o.singleton,
            address!("0x69f4D1788e39c87893C980c06EdF4b7f686e2938")
        );
    }

    #[test]
    fn setup_and_factory_calldata_non_empty() {
        let owners = vec![address!("0x0000000000000000000000000000000000000001")];
        let fb = address!("0x0000000000000000000000000000000000000002");
        let init = encode_setup_initializer(&owners, 1, fb).unwrap();
        assert!(init.len() > 4);
        let factory_cd = encode_create_proxy_call(
            address!("0x0000000000000000000000000000000000000003"),
            init,
            U256::from(1u64),
        );
        assert!(factory_cd.len() > 4);
    }

    #[test]
    fn normalize_owners_sorts() {
        let a = vec![
            "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".to_string(),
            "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string(),
        ];
        let v = normalize_owners(&a).unwrap();
        assert_eq!(v[0], wallet_ops::parse_address("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").unwrap());
        assert_eq!(v[1], wallet_ops::parse_address("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB").unwrap());
    }

    #[test]
    fn proxy_creation_topic_matches_keccak() {
        let t = proxy_creation_topic0();
        let expected = B256::from_slice(keccak256("ProxyCreation(address,address)").as_slice());
        assert_eq!(t, expected);
    }
}
