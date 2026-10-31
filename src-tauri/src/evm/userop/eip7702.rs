//! EIP-7702 authorization signing and sender resolution.

use alloy::primitives::Address;
use alloy::providers::Provider;
use alloy::signers::Signer;
use serde_json::{json, Value};

use crate::evm::rpc::wallet_err_json;

pub(crate) async fn sign_eip7702_authorization<S: Signer + Sync>(
    signer: &S,
    chain_id: u64,
    implementation: Address,
    nonce: u64,
) -> Result<Value, String> {
    // EIP-7702 authorization hash: keccak256(0x05 || rlp([chain_id, address, nonce]))
    let enc = encode_eip7702_authorization(chain_id, implementation, nonce);
    let mut msg = Vec::with_capacity(1 + enc.len());
    msg.push(0x05);
    msg.extend_from_slice(&enc);
    let hash = alloy::primitives::keccak256(&msg);
    let sig = signer
        .sign_hash(&hash)
        .await
        .map_err(|e| wallet_err_json("EIP7702_SIGN", e.to_string(), None))?;
    Ok(eip7702_auth_json(chain_id, implementation, nonce, &sig))
}

/// Bundler JSON for EIP-7702 auth. Uses `as_rsy()` so yParity is 0/1 — not Electrum `v` (27/28).
fn eip7702_auth_json(
    chain_id: u64,
    implementation: Address,
    nonce: u64,
    sig: &alloy::primitives::Signature,
) -> Value {
    let rsy = sig.as_rsy();
    json!({
        "chainId": format!("{chain_id:#x}"),
        "address": format!("{implementation:#x}"),
        "nonce": format!("{nonce:#x}"),
        "yParity": format!("{:#x}", rsy[64]),
        "r": format!("0x{}", hex::encode(&rsy[0..32])),
        "s": format!("0x{}", hex::encode(&rsy[32..64])),
    })
}

/// RLP encoding of the EIP-7702 authorization tuple `[chain_id, address, nonce]`;
/// integers use canonical minimal big-endian form, so any chain ID/nonce width is safe.
fn encode_eip7702_authorization(chain_id: u64, implementation: Address, nonce: u64) -> Vec<u8> {
    use alloy_rlp::{Encodable, Header};
    let addr = implementation.as_slice();
    let payload_length = chain_id.length() + addr.length() + nonce.length();
    let mut out = Vec::with_capacity(payload_length + 9);
    Header {
        list: true,
        payload_length,
    }
    .encode(&mut out);
    chain_id.encode(&mut out);
    addr.encode(&mut out);
    nonce.encode(&mut out);
    out
}

/// EIP-7702 designated-code: `0xef0100 || address` (23 bytes).
const EIP7702_CODE_LEN: usize = 23;
const EIP7702_PREFIX: [u8; 3] = [0xef, 0x01, 0x00];

/// Parse EIP-7702 delegation stub → implementation address.
pub(crate) fn eip7702_delegation_impl(code: &[u8]) -> Option<Address> {
    if code.len() != EIP7702_CODE_LEN || code[..3] != EIP7702_PREFIX {
        return None;
    }
    Some(Address::from_slice(&code[3..23]))
}

/// Empty code or stale delegation → sign 7702 auth; correct impl → no auth.
pub(crate) async fn resolve_eip7702_auth_for_sender<P: Provider, S: Signer + Sync>(
    provider: &P,
    signer: &S,
    member: Address,
    code: &[u8],
    chain_id: u64,
    account_impl: Address,
) -> Result<Option<Value>, String> {
    let needs_auth = match eip7702_delegation_impl(code) {
        None if code.is_empty() => true,
        None => {
            return Err(wallet_err_json(
                "USERNAME_7702_SENDER",
                format!(
                    "roster EOA {member:#x} has non-empty code (len {}) that is not an EIP-7702 stub; sponsored UserOp execute cannot run",
                    code.len()
                ),
                None,
            ));
        }
        Some(impl_addr) if impl_addr == account_impl => false,
        Some(_stale) => {
            eprintln!(
                "[pacto_wallet] eip7702_auth=upgrade member={member:#x} stale_impl→{account_impl:#x}"
            );
            true
        }
    };
    if !needs_auth {
        return Ok(None);
    }
    let eoa_nonce = provider.get_transaction_count(member).await.map_err(|e| {
        wallet_err_json(
            "RPC_NONCE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    let auth = sign_eip7702_authorization(signer, chain_id, account_impl, eoa_nonce).await?;
    Ok(Some(auth))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;

    #[test]
    fn eip7702_authorization_encoding_matches_rlp_spec() {
        let implementation = address!("0x0000000000000000000000000000000000000001");
        let enc = encode_eip7702_authorization(1, implementation, 0);
        let mut expected = vec![0xd7, 0x01, 0x94];
        expected.extend_from_slice(implementation.as_slice());
        expected.push(0x80);
        assert_eq!(enc, expected);

        // Larger chain IDs and nonces encode as minimal big-endian strings.
        let enc = encode_eip7702_authorization(11_155_111, implementation, 0x0100);
        let mut payload = vec![0x83, 0xaa, 0x36, 0xa7, 0x94];
        payload.extend_from_slice(implementation.as_slice());
        payload.extend_from_slice(&[0x82, 0x01, 0x00]);
        let mut expected = vec![0xc0 + payload.len() as u8];
        expected.extend_from_slice(&payload);
        assert_eq!(enc, expected);
    }

    #[test]
    fn eip7702_auth_json_y_parity_recovers_signer_not_electrum_mod() {
        use alloy::primitives::{keccak256, Signature};
        use alloy::signers::local::PrivateKeySigner;
        use alloy::signers::SignerSync;

        // Anvil account #0
        let signer: PrivateKeySigner =
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
                .parse()
                .unwrap();
        let implementation = address!("0x2E9156deE65d7946305C334824e2648Ff9128f45");
        let chain_id = 11_155_111u64;
        let nonce = 0u64;

        let enc = encode_eip7702_authorization(chain_id, implementation, nonce);
        let mut msg = Vec::with_capacity(1 + enc.len());
        msg.push(0x05);
        msg.extend_from_slice(&enc);
        let hash = keccak256(&msg);
        let sig = signer.sign_hash_sync(&hash).expect("sign");

        let auth = eip7702_auth_json(chain_id, implementation, nonce, &sig);
        let y_parity = u64::from_str_radix(
            auth["yParity"].as_str().unwrap().trim_start_matches("0x"),
            16,
        )
        .unwrap();
        assert!(y_parity <= 1, "yParity must be 0 or 1, got {y_parity}");
        assert_eq!(y_parity as u8, sig.as_rsy()[64]);

        // Rebuild signature as the bundler would from auth JSON fields.
        let rsy = sig.as_rsy();
        let rebuilt = Signature::from_bytes_and_parity(&rsy[..64], rsy[64] != 0);
        let recovered = rebuilt
            .recover_address_from_prehash(&hash)
            .expect("recover");
        assert_eq!(recovered, signer.address());

        // Electrum v % 2 inverts yParity and recovers a different authority.
        let electrum = sig.as_bytes();
        let wrong_parity = (electrum[64] % 2) != 0;
        assert_ne!(
            wrong_parity,
            rsy[64] != 0,
            "bug demonstration: Electrum v%2 flips true y_parity"
        );
        let wrong = Signature::from_bytes_and_parity(&electrum[..64], wrong_parity);
        let wrong_addr = wrong
            .recover_address_from_prehash(&hash)
            .expect("recover wrong parity");
        assert_ne!(wrong_addr, signer.address());
    }

    #[test]
    fn eip7702_delegation_impl_parses_designated_code() {
        let impl_addr = address!("0x2E9156deE65d7946305C334824e2648Ff9128f45");
        let mut code = vec![0xef, 0x01, 0x00];
        code.extend_from_slice(impl_addr.as_slice());
        assert_eq!(eip7702_delegation_impl(&code), Some(impl_addr));
        assert_eq!(eip7702_delegation_impl(&[]), None);
        assert_eq!(eip7702_delegation_impl(&[0x00; 23]), None);
        assert_eq!(eip7702_delegation_impl(&code[..22]), None);
    }
}
