//! Nostr claim-link digests matching pacto-username-nft `NostrClaimLink.sol`.

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::sol_types::SolValue;
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};

const NOSTR_CLAIM_TYPE_STRING: &[u8] = b"PactoNostrClaim(bytes32 pubkey,address evmAddress,bytes32 nameHash,uint256 nonce,uint256 issuedAt,bytes32 salt)";

/// keccak256 of the PactoNostrClaim type string.
pub static NOSTR_CLAIM_TYPEHASH: Lazy<B256> = Lazy::new(|| keccak256(NOSTR_CLAIM_TYPE_STRING));

/// `sha256(0x02 || pubkey)` — matches bech32 npub decoded bytes.
pub fn npub_hash_from_pubkey(pubkey: B256) -> B256 {
    let mut hasher = Sha256::new();
    hasher.update([0x02u8]);
    hasher.update(pubkey.as_slice());
    B256::from_slice(&hasher.finalize())
}

/// Struct hash signed with BIP-340 for username mint.
pub fn hash_nostr_claim(
    pubkey: B256,
    evm_address: Address,
    name: &str,
    nonce: U256,
    issued_at: U256,
    salt: B256,
) -> B256 {
    let name_hash = keccak256(name.as_bytes());
    let encoded = (
        *NOSTR_CLAIM_TYPEHASH,
        pubkey,
        evm_address,
        name_hash,
        nonce,
        issued_at,
        salt,
    )
        .abi_encode();
    keccak256(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{address, b256};

    #[test]
    fn npub_hash_matches_claim_link_golden() {
        let pubkey =
            b256!("0x391823cee659f38512ccde6c2bb6f4e32e917478ee2e96d4f5e05656e7adb2ae");
        let expected =
            b256!("0x540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1");
        assert_eq!(npub_hash_from_pubkey(pubkey), expected);
    }

    #[test]
    fn hash_nostr_claim_matches_claim_link_golden() {
        let pubkey =
            b256!("0x391823cee659f38512ccde6c2bb6f4e32e917478ee2e96d4f5e05656e7adb2ae");
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let salt =
            b256!("0x1111111111111111111111111111111111111111111111111111111111111111");
        let digest = hash_nostr_claim(
            pubkey,
            evm,
            "daopunk",
            U256::from(1u64),
            U256::from(1_735_689_600u64),
            salt,
        );
        let expected =
            b256!("0x3bb29eb179f3f41047a8bd46613518f22b27436826c9d2f5b8e6f42f9162cf6e");
        assert_eq!(digest, expected);
    }

    #[test]
    fn typehash_matches_upstream() {
        assert_eq!(
            *NOSTR_CLAIM_TYPEHASH,
            b256!("0xe29cf6255f2ca32d485adabf2f756cf068edd7e00df2a290f1349a9a9c9ce4e2")
        );
    }
}
