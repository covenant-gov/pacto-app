//! Nostr claim-link digests + BIP-340 matching pacto-username-nft `NostrClaimLink.sol`.

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::sol_types::SolValue;
use k256::ecdsa::signature::hazmat::{PrehashSigner, PrehashVerifier};
use k256::schnorr::{Signature as SchnorrSignature, SigningKey, VerifyingKey};
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};

/// Relay-layer Nostr kind for username claim link events.
pub const PACTO_USERNAME_CLAIM_KIND: u16 = 31_337;

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

/// BIP-340 Schnorr sign over the Nostr claim digest → 64 raw bytes (R || S).
pub fn sign_nostr_claim(secret_key: &[u8; 32], digest: B256) -> Result<[u8; 64], String> {
    let signing_key =
        SigningKey::from_bytes(secret_key).map_err(|e| format!("invalid nostr secret: {e}"))?;
    let sig = signing_key
        .sign_prehash(digest.as_slice())
        .map_err(|e| format!("bip340 sign failed: {e}"))?;
    Ok(sig.to_bytes().into())
}

/// BIP-340 verify over the Nostr claim digest (64-byte R||S).
pub fn verify_nostr_claim(pubkey: B256, digest: B256, signature: &[u8]) -> bool {
    if signature.len() != 64 {
        return false;
    }
    let Ok(vk) = VerifyingKey::from_bytes(pubkey.as_slice()) else {
        return false;
    };
    let Ok(sig) = SchnorrSignature::try_from(signature) else {
        return false;
    };
    vk.verify_prehash(digest.as_slice(), &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{address, b256};
    use k256::schnorr::SigningKey;

    #[test]
    fn npub_hash_matches_claim_link_golden() {
        let pubkey = b256!("0x391823cee659f38512ccde6c2bb6f4e32e917478ee2e96d4f5e05656e7adb2ae");
        let expected = b256!("0x540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1");
        assert_eq!(npub_hash_from_pubkey(pubkey), expected);
    }

    #[test]
    fn hash_nostr_claim_matches_claim_link_golden() {
        let pubkey = b256!("0x391823cee659f38512ccde6c2bb6f4e32e917478ee2e96d4f5e05656e7adb2ae");
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let salt = b256!("0x1111111111111111111111111111111111111111111111111111111111111111");
        let digest = hash_nostr_claim(
            pubkey,
            evm,
            "daopunk",
            U256::from(1u64),
            U256::from(1_735_689_600u64),
            salt,
        );
        let expected = b256!("0x3bb29eb179f3f41047a8bd46613518f22b27436826c9d2f5b8e6f42f9162cf6e");
        assert_eq!(digest, expected);
    }

    #[test]
    fn golden_nostr_signature_verifies() {
        let pubkey = b256!("0x391823cee659f38512ccde6c2bb6f4e32e917478ee2e96d4f5e05656e7adb2ae");
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let salt = b256!("0x1111111111111111111111111111111111111111111111111111111111111111");
        let digest = hash_nostr_claim(
            pubkey,
            evm,
            "daopunk",
            U256::from(1u64),
            U256::from(1_735_689_600u64),
            salt,
        );
        let sig_hex = "715358459e600817a7e0fb4371b594a9e36f8c4f0272a41e4248fc3b1021accf6cdf2d2718424a5491d94ae1935fbb1b569c3e92b23269143e71e3635be3efb2";
        let sig = hex::decode(sig_hex).expect("hex");
        assert!(verify_nostr_claim(pubkey, digest, &sig));
    }

    #[test]
    fn sign_nostr_claim_round_trip() {
        let secret = [0x42u8; 32];
        let signing_key = SigningKey::from_bytes(&secret).expect("sk");
        let pubkey = B256::from_slice(signing_key.verifying_key().to_bytes().as_slice());
        let digest = b256!("0x3bb29eb179f3f41047a8bd46613518f22b27436826c9d2f5b8e6f42f9162cf6e");
        let sig = sign_nostr_claim(&secret, digest).expect("sign");
        assert!(verify_nostr_claim(pubkey, digest, &sig));
    }

    #[test]
    fn verify_nostr_claim_rejects_wrong_key_mutated_digest_and_truncated_sig() {
        let secret = [0x42u8; 32];
        let signing_key = SigningKey::from_bytes(&secret).expect("sk");
        let pubkey = B256::from_slice(signing_key.verifying_key().to_bytes().as_slice());
        let digest = b256!("0x3bb29eb179f3f41047a8bd46613518f22b27436826c9d2f5b8e6f42f9162cf6e");
        let sig = sign_nostr_claim(&secret, digest).expect("sign");

        let other_secret = [0x43u8; 32];
        let other_pk = B256::from_slice(
            SigningKey::from_bytes(&other_secret)
                .expect("sk")
                .verifying_key()
                .to_bytes()
                .as_slice(),
        );
        assert!(!verify_nostr_claim(other_pk, digest, &sig));

        let mut mutated = digest;
        mutated.0[0] ^= 0xff;
        assert!(!verify_nostr_claim(pubkey, mutated, &sig));

        assert!(!verify_nostr_claim(pubkey, digest, &sig[..32]));
        assert!(!verify_nostr_claim(pubkey, digest, &[]));
    }

    #[test]
    fn typehash_matches_upstream() {
        assert_eq!(
            *NOSTR_CLAIM_TYPEHASH,
            b256!("0xe29cf6255f2ca32d485adabf2f756cf068edd7e00df2a290f1349a9a9c9ce4e2")
        );
    }
}
