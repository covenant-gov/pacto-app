//! EIP-712 ClaimBinding v2 digests for PactoUsernameNFT.

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use alloy::sol_types::SolValue;
use once_cell::sync::Lazy;

const DOMAIN_TYPE_STRING: &[u8] =
    b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const DOMAIN_NAME: &[u8] = b"PactoUsername";
const DOMAIN_VERSION: &[u8] = b"2";
const CLAIM_BINDING_TYPE_STRING: &[u8] =
    b"ClaimBinding(bytes32 npubHash,address evmAddress,string name,uint256 nonce,uint256 issuedAt,bytes32 salt)";

static DOMAIN_TYPEHASH: Lazy<B256> = Lazy::new(|| keccak256(DOMAIN_TYPE_STRING));
static CLAIM_BINDING_TYPEHASH: Lazy<B256> = Lazy::new(|| keccak256(CLAIM_BINDING_TYPE_STRING));

/// EIP-712 typed-data hash for ClaimBinding (domain version `2`).
pub fn claim_binding_signing_hash(
    chain_id: u64,
    verifying_contract: Address,
    npub_hash: B256,
    evm_address: Address,
    name: &str,
    nonce: U256,
    issued_at: U256,
    salt: B256,
) -> B256 {
    let domain = keccak256(
        (
            *DOMAIN_TYPEHASH,
            keccak256(DOMAIN_NAME),
            keccak256(DOMAIN_VERSION),
            U256::from(chain_id),
            verifying_contract,
        )
            .abi_encode(),
    );
    let struct_hash = keccak256(
        (
            *CLAIM_BINDING_TYPEHASH,
            npub_hash,
            evm_address,
            keccak256(name.as_bytes()),
            nonce,
            issued_at,
            salt,
        )
            .abi_encode(),
    );
    let mut prefixed = [0u8; 66];
    prefixed[0] = 0x19;
    prefixed[1] = 0x01;
    prefixed[2..34].copy_from_slice(domain.as_slice());
    prefixed[34..66].copy_from_slice(struct_hash.as_slice());
    keccak256(prefixed)
}

/// Sign ClaimBinding with the claimer EVM key → 65-byte hex signature.
pub fn sign_claim_binding(
    signer: &PrivateKeySigner,
    chain_id: u64,
    verifying_contract: Address,
    npub_hash: B256,
    name: &str,
    nonce: U256,
    issued_at: U256,
    salt: B256,
) -> Result<Vec<u8>, String> {
    let hash = claim_binding_signing_hash(
        chain_id,
        verifying_contract,
        npub_hash,
        signer.address(),
        name,
        nonce,
        issued_at,
        salt,
    );
    let sig = signer
        .sign_hash_sync(&hash)
        .map_err(|e| format!("claim binding sign failed: {e}"))?;
    Ok(sig.as_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{address, b256};
    use alloy::signers::local::PrivateKeySigner;

    #[test]
    fn claim_binding_typehash_matches_upstream() {
        assert_eq!(
            *CLAIM_BINDING_TYPEHASH,
            keccak256(CLAIM_BINDING_TYPE_STRING)
        );
    }

    #[test]
    fn sign_claim_binding_recovers_signer() {
        let pk = "0x00000000000000000000000000000000000000000000000000000000000a11ce";
        let signer: PrivateKeySigner = pk.parse().expect("pk");
        let nft = address!("0x1111111111111111111111111111111111111111");
        let npub_hash =
            b256!("0x540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1");
        let salt =
            b256!("0x1111111111111111111111111111111111111111111111111111111111111111");
        let nonce = U256::from(1u64);
        let issued_at = U256::from(1_735_689_600u64);
        let sig = sign_claim_binding(
            &signer,
            11_155_111,
            nft,
            npub_hash,
            "daopunk",
            nonce,
            issued_at,
            salt,
        )
        .expect("sign");
        assert_eq!(sig.len(), 65);

        let hash = claim_binding_signing_hash(
            11_155_111,
            nft,
            npub_hash,
            signer.address(),
            "daopunk",
            nonce,
            issued_at,
            salt,
        );
        let recovered = alloy::primitives::Signature::try_from(sig.as_slice())
            .expect("sig")
            .recover_address_from_prehash(&hash)
            .expect("recover");
        assert_eq!(recovered, signer.address());
    }
}
