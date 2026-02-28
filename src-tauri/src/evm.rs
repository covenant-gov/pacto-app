//! EVM key derivation from Nostr secret key.
//!
//! Deterministic: one Nostr secret → one EVM key pair. Uses SHA256 with a domain
//! separator so the EVM key is distinct from the Nostr key.

use k256::ecdsa::SigningKey;
use k256::elliptic_curve::sec1::ToEncodedPoint;
use sha2::{Digest, Sha256};
use sha3::Keccak256;

const EVM_DERIVATION_CONTEXT: &[u8] = b"pacto-evm-derivation-v1";

/// Derive EVM private key (32 bytes) and Ethereum address from Nostr secret key bytes.
///
/// Formula: `evm_secret = SHA256(nostr_secret || EVM_DERIVATION_CONTEXT)`.
/// Address = last 20 bytes of `keccak256(uncompressed_public_key)`.
pub fn derive_evm_from_nostr_secret(nostr_secret: &[u8; 32]) -> Result<(Vec<u8>, String), String> {
    let mut hasher = Sha256::new();
    hasher.update(nostr_secret);
    hasher.update(EVM_DERIVATION_CONTEXT);
    let evm_secret_bytes: [u8; 32] = hasher.finalize().into();

    let signing_key =
        SigningKey::from_slice(&evm_secret_bytes).map_err(|e| format!("Invalid EVM key: {}", e))?;

    let verifying_key = signing_key.verifying_key();
    let uncompressed = verifying_key.to_encoded_point(false);
    let pub_bytes = uncompressed.as_bytes();
    let hash = Keccak256::digest(pub_bytes);
    let address_bytes: [u8; 20] = hash[12..32].try_into().map_err(|_| "address slice")?;
    let address_hex = format!("0x{}", hex::encode(address_bytes));

    Ok((evm_secret_bytes.to_vec(), address_hex))
}

/// Return `(evm_private_key_hex, evm_address)` e.g. for inclusion in LoginKeyPair.
pub fn derive_evm_hex_from_nostr_secret(nostr_secret: &[u8; 32]) -> Result<(String, String), String> {
    let (secret_bytes, address) = derive_evm_from_nostr_secret(nostr_secret)?;
    let evm_private_key_hex = format!("0x{}", hex::encode(secret_bytes));
    Ok((evm_private_key_hex, address))
}
