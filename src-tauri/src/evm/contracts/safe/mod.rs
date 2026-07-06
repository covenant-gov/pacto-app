//! Gnosis Safe proxy factory bindings and deploy helpers.
//! Default addresses follow safe-global/safe-deployments; override via `pacto_chain_config` env vars.

use alloy::primitives::{keccak256, Address, B256, Bytes, U256};
use alloy::rpc::types::TransactionReceipt;
use alloy::sol;
use alloy::sol_types::SolCall;

use crate::evm::rpc::parse_address;

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

/// Topic0 for `ProxyCreation(address,address)` (non-indexed params in Safe factory log).
pub fn proxy_creation_topic0() -> B256 {
    B256::from_slice(keccak256("ProxyCreation(address,address)").as_slice())
}

#[derive(Clone, Copy, Debug)]
pub struct SafeFactoryAddresses {
    pub singleton: Address,
    pub proxy_factory: Address,
    pub fallback_handler: Address,
}

/// Gnosis Safe **1.3.0** defaults from safe-deployments (canonical vs eip155 ordering per chain).
pub fn default_safe_factory_addresses_for_chain_id(chain_id: u64) -> Option<SafeFactoryAddresses> {
    use alloy::primitives::address;
    match chain_id {
        1 => Some(SafeFactoryAddresses {
            singleton: address!("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552"),
            proxy_factory: address!("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2"),
            fallback_handler: address!("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"),
        }),
        // Arbitrum One: canonical deployment; L2 singleton (GnosisSafeL2) for tx-service indexing.
        42_161 => Some(SafeFactoryAddresses {
            singleton: address!("0x3E5c63644E683549055b9Be8653de26E0B4CD36E"),
            proxy_factory: address!("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2"),
            fallback_handler: address!("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"),
        }),
        11_155_111 => Some(SafeFactoryAddresses {
            singleton: address!("0x69f4D1788e39c87893C980c06EdF4b7f686e2938"),
            proxy_factory: address!("0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC"),
            fallback_handler: address!("0x017062a1dE2FE6b99BE3d9d37841FeD19F573804"),
        }),
        _ => None,
    }
}

pub fn encode_setup_initializer(
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

pub fn encode_create_proxy_call(
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
pub fn proxy_address_from_factory_receipt(
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
        let proxy_word = &data[0..32];
        let proxy = Address::from_slice(&proxy_word[12..32]);
        return Ok(proxy);
    }
    Err("no ProxyCreation log from Safe factory in receipt".into())
}

/// Sort and dedupe owner addresses; Safe requires sorted unique owners.
pub fn normalize_owners(owners_hex: &[String]) -> Result<Vec<Address>, String> {
    use std::collections::HashSet;

    let mut addrs: Vec<Address> = Vec::with_capacity(owners_hex.len());
    let mut seen: HashSet<String> = HashSet::new();
    for s in owners_hex {
        let a = parse_address(s)?;
        let k = format!("{:x}", a);
        if !seen.insert(k) {
            return Err("duplicate owner address".into());
        }
        addrs.push(a);
    }
    addrs.sort_by_key(|a| *a);
    Ok(addrs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;

    #[test]
    fn factory_addresses_mainnet() {
        let a = default_safe_factory_addresses_for_chain_id(1).expect("mainnet");
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
    fn factory_addresses_arbitrum_canonical_l2() {
        let a = default_safe_factory_addresses_for_chain_id(42_161).expect("arbitrum");
        assert_eq!(
            a.singleton,
            address!("0x3E5c63644E683549055b9Be8653de26E0B4CD36E")
        );
        assert_eq!(
            a.proxy_factory,
            address!("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2")
        );
        assert_eq!(
            a.fallback_handler,
            address!("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4")
        );
    }

    #[test]
    fn factory_addresses_sepolia_eip155() {
        let s = default_safe_factory_addresses_for_chain_id(11_155_111).expect("sepolia");
        assert_eq!(
            s.singleton,
            address!("0x69f4D1788e39c87893C980c06EdF4b7f686e2938")
        );
        assert_eq!(
            s.proxy_factory,
            address!("0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC")
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
        assert_eq!(
            v[0],
            parse_address("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").unwrap()
        );
        assert_eq!(
            v[1],
            parse_address("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB").unwrap()
        );
    }

    #[test]
    fn proxy_creation_topic_matches_keccak() {
        let t = proxy_creation_topic0();
        let expected = B256::from_slice(keccak256("ProxyCreation(address,address)").as_slice());
        assert_eq!(t, expected);
    }
}
