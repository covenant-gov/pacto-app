//! EVM addresses and key derivation.
//!
//! - **Phrase-derived v1:** BIP-39 phrase → `m/44'/60'/0'/0/{i}` (primary product path; see `docs/wallet/HD_DERIVATION_V1.md`).
//! - **Legacy nostr-linked preview:** `SHA256(nostr_secret || domain)` — used only for a few login/preview call sites in `lib.rs`, not for phrase-derived signing.

use bip32::XPrv;
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
fn derive_evm_from_nostr_secret(nostr_secret: &[u8; 32]) -> Result<(Vec<u8>, String), String> {
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

/// Pacto EVM v1 from recovery phrase: BIP-39 passphrase → BIP-32 path `m/44'/60'/0'/0/{address_index}` (Ethereum standard).
pub fn derive_eth_bip44_v1_from_mnemonic_phrase(
    phrase: &str,
    address_index: u32,
) -> Result<(String, String), String> {
    let mnemonic = bip39::Mnemonic::parse_normalized(phrase.trim())
        .map_err(|_| "Invalid recovery phrase".to_string())?;
    let seed = mnemonic.to_seed("");
    derive_eth_bip44_v1_from_seed(&seed, address_index)
}

/// Same as [`derive_eth_bip44_v1_from_mnemonic_phrase`] but takes the BIP-39 seed bytes (empty passphrase).
fn derive_eth_bip44_v1_from_seed(seed: &[u8], address_index: u32) -> Result<(String, String), String> {
    let path = format!("m/44'/60'/0'/0/{}", address_index);
    let path: bip32::DerivationPath = path
        .parse()
        .map_err(|e: bip32::Error| format!("Derivation path: {}", e))?;
    let xprv = XPrv::derive_from_path(seed, &path).map_err(|e| format!("Key derivation: {}", e))?;
    let signing_key = xprv.private_key();
    let arr: [u8; 32] = signing_key
        .to_bytes()
        .as_slice()
        .try_into()
        .map_err(|_| "invalid derived key length")?;
    let address_hex = address_from_evm_secret_32(&arr)?;
    let hex_key = format!("0x{}", hex::encode(arr));
    Ok((hex_key, address_hex))
}

/// Normalize user-supplied `0x` + 40 hex to lowercase; checksumming not required for RPC.
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

    /// Golden vector: abandon mnemonic, path m/44'/60'/0'/0/0 (matches Foundry cast).
    #[test]
    fn bip44_abandon_mnemonic_index_0_matches_cast() {
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let (_k, addr) =
            derive_eth_bip44_v1_from_mnemonic_phrase(phrase, 0).expect("derive");
        assert_eq!(
            addr.to_lowercase(),
            "0x9858effd232b4033e47d90003d41ec34ecaeda94"
        );
    }

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
