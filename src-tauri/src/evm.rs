//! EVM key derivation from Nostr secret key.
//!
//! Deterministic: one Nostr secret → one EVM key pair. Uses SHA256 with a domain
//! separator so the EVM key is distinct from the Nostr key.

use k256::ecdsa::SigningKey;
use sha2::{Digest, Sha256};
use sha3::Keccak256;

const EVM_DERIVATION_CONTEXT: &[u8] = b"pacto-evm-derivation-v1";

/// Ethereum / Yellow Paper: `keccak256(x || y)` where x,y are 32-byte big-endian coordinates.
/// The SEC1 uncompressed encoding is `0x04 || x || y`; that leading byte must **not** be hashed.
pub fn address_from_evm_secret_32(evm_secret_bytes: &[u8; 32]) -> Result<String, String> {
    let signing_key =
        SigningKey::from_slice(evm_secret_bytes).map_err(|e| format!("Invalid EVM key: {}", e))?;
    let verifying_key = signing_key.verifying_key();
    let uncompressed = verifying_key.to_encoded_point(false);
    let pub_bytes = uncompressed.as_bytes();
    let pub_for_hash: &[u8] = match pub_bytes.first() {
        Some(0x04) if pub_bytes.len() == 65 => &pub_bytes[1..],
        _ => pub_bytes,
    };
    let hash = Keccak256::digest(pub_for_hash);
    let address_bytes: [u8; 20] = hash[12..32].try_into().map_err(|_| "address slice")?;
    Ok(format!("0x{}", hex::encode(address_bytes)))
}

/// Derive EVM private key (32 bytes) and Ethereum address from Nostr secret key bytes.
///
/// Formula: `evm_secret = SHA256(nostr_secret || EVM_DERIVATION_CONTEXT)`.
/// Address = last 20 bytes of `keccak256(x || y)` (standard Ethereum, excluding SEC1 `0x04` prefix).
pub fn derive_evm_from_nostr_secret(nostr_secret: &[u8; 32]) -> Result<(Vec<u8>, String), String> {
    let mut hasher = Sha256::new();
    hasher.update(nostr_secret);
    hasher.update(EVM_DERIVATION_CONTEXT);
    let evm_secret_bytes: [u8; 32] = hasher.finalize().into();

    let address_hex = address_from_evm_secret_32(&evm_secret_bytes)?;
    Ok((evm_secret_bytes.to_vec(), address_hex))
}

/// Return `(evm_private_key_hex, evm_address)` e.g. for inclusion in LoginKeyPair.
pub fn derive_evm_hex_from_nostr_secret(nostr_secret: &[u8; 32]) -> Result<(String, String), String> {
    let (secret_bytes, address) = derive_evm_from_nostr_secret(nostr_secret)?;
    let evm_private_key_hex = format!("0x{}", hex::encode(secret_bytes));
    Ok((evm_private_key_hex, address))
}

/// Normalize user-supplied `0x` + 40 hex to lowercase checksummed form is not required for RPC; keep stable `0x` + lower hex.
pub fn normalize_hex_address(s: &str) -> Option<String> {
    let t = s.trim();
    let h = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t);
    if h.len() != 40 {
        return None;
    }
    if !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("0x{}", h.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Well-known Anvil/Hardhat default account #0 — MetaMask-compatible derivation.
    #[test]
    fn evm_address_matches_standard_keccak_of_xy() {
        let hex = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        let key_bytes = hex::decode(hex).expect("hex");
        let mut sk = [0u8; 32];
        sk.copy_from_slice(&key_bytes);
        let addr = address_from_evm_secret_32(&sk).expect("addr");
        assert_eq!(
            addr.to_lowercase(),
            "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
        );
    }
}
