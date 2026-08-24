//! Off-chain EIP-712 bind certificate for npub ↔ roster EVM.

use alloy::primitives::{keccak256, Address, Signature, B256, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use alloy::sol_types::SolValue;
use serde::Serialize;
use tauri::{command, AppHandle, Runtime};

const DOMAIN_NAME: &[u8] = b"pacto-squad-roster";
const DOMAIN_VERSION: &[u8] = b"1";
const DOMAIN_TYPEHASH: &[u8] =
    b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const BIND_TYPEHASH: &[u8] =
    b"SquadRosterBind(string parentId,string memberNpub,address evmAddress,uint64 issuedAt)";
/// Max future skew for `issued_at` (anti-freeze on gossip ingest).
pub const MAX_ISSUED_AT_SKEW_SECS: u64 = 300;

pub fn roster_bind_signing_hash(
    parent_id: &str,
    member_npub: &str,
    evm_address: Address,
    issued_at: u64,
) -> B256 {
    let domain = keccak256(
        (
            keccak256(DOMAIN_TYPEHASH),
            keccak256(DOMAIN_NAME),
            keccak256(DOMAIN_VERSION),
            U256::ZERO,
            Address::ZERO,
        )
            .abi_encode(),
    );
    let struct_hash = keccak256(
        (
            keccak256(BIND_TYPEHASH),
            keccak256(parent_id.as_bytes()),
            keccak256(member_npub.as_bytes()),
            evm_address,
            U256::from(issued_at),
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

pub fn sign_roster_bind_cert(
    signer: &PrivateKeySigner,
    parent_id: &str,
    member_npub: &str,
    issued_at: u64,
) -> Result<String, String> {
    let hash = roster_bind_signing_hash(parent_id, member_npub, signer.address(), issued_at);
    let sig = signer
        .sign_hash_sync(&hash)
        .map_err(|e| format!("bind cert sign failed: {e}"))?;
    Ok(format!("0x{}", hex::encode(sig.as_bytes())))
}

pub fn parse_bind_signature(raw: &str) -> Result<Signature, String> {
    let t = raw.trim();
    let h = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .unwrap_or(t);
    if h.len() != 130 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid bind cert signature".to_string());
    }
    let mut bytes = [0u8; 65];
    for i in 0..65 {
        bytes[i] = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16)
            .map_err(|_| "invalid bind cert signature".to_string())?;
    }
    Signature::try_from(bytes.as_slice()).map_err(|e| format!("invalid bind cert signature: {e}"))
}

/// Recovered signer must equal `evm_address`.
pub fn verify_squad_roster_bind_cert(
    parent_id: &str,
    member_npub: &str,
    evm_address: &str,
    issued_at: u64,
    signature: &str,
) -> Result<Address, String> {
    let parent = parent_id.trim();
    let npub = member_npub.trim();
    if parent.is_empty() || npub.is_empty() {
        return Err("bind cert parent_id and member_npub required".to_string());
    }
    let addr = crate::evm::rpc::address::parse_address(evm_address)?;
    let hash = roster_bind_signing_hash(parent, npub, addr, issued_at);
    let sig = parse_bind_signature(signature)?;
    let recovered = sig
        .recover_address_from_prehash(&hash)
        .map_err(|e| format!("bind cert recover failed: {e}"))?;
    if recovered != addr {
        return Err("bind cert recovered address mismatch".to_string());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if issued_at > now.saturating_add(MAX_ISSUED_AT_SKEW_SECS) {
        return Err("bind cert issued_at too far in the future".to_string());
    }
    Ok(recovered)
}

pub(crate) fn require_verified_bind_cert_for_upsert(
    parent_id: &str,
    member_npub: &str,
    evm_address: &str,
    issued_at: Option<i64>,
    bind_signature: Option<String>,
) -> Result<(i64, String), String> {
    let issued = issued_at.ok_or_else(|| "bind cert required".to_string())?;
    if issued <= 0 {
        return Err("bind cert issued_at must be positive".to_string());
    }
    let sig = bind_signature.ok_or_else(|| "bind cert required".to_string())?;
    let sig_trim = sig.trim();
    if sig_trim.is_empty() {
        return Err("bind cert signature required".to_string());
    }
    verify_squad_roster_bind_cert(
        parent_id,
        member_npub,
        evm_address,
        issued as u64,
        sig_trim,
    )?;
    Ok((issued, sig_trim.to_string()))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadRosterBindCertDto {
    pub member_npub: String,
    pub evm_address: String,
    pub issued_at: u64,
    pub signature: String,
}

#[command]
pub async fn sign_squad_roster_bind_cert<R: Runtime>(
    app: AppHandle<R>,
    parent_id: String,
) -> Result<SquadRosterBindCertDto, String> {
    let parent = parent_id.trim().to_string();
    if parent.is_empty() {
        return Err("parent_id is empty".to_string());
    }
    let member_npub = crate::account_manager::get_current_account()?;
    let account_id = crate::db::get_squad_member_evm_account_id(&app, &parent, None)?
        .ok_or_else(|| "No squad EVM binding for this parent".to_string())?;
    let (signer, _) =
        crate::evm::rpc::signer::load_embedded_signer_for_account_id(app, &account_id).await?;
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let signature = sign_roster_bind_cert(&signer, &parent, member_npub.as_str(), issued_at)?;
    Ok(SquadRosterBindCertDto {
        member_npub,
        evm_address: format!("{:#x}", signer.address()),
        issued_at,
        signature,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Foundry/Anvil default key 0.
    const ANVIL_KEY: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const ANVIL_ADDR: &str = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
    const GOLDEN_HASH: &str = "0x591696e22a33216c94d4ae23cf87761f998d43e64de0efbc9da77c9b31d910c3";
    const GOLDEN_SIG: &str = "0x13973db85f6f94c3fd63a8ad1110ab7046577b2447fc258327de41554749d77148515c5be830e39fbdfaf9ed19779cb4d64e5c88809aaf26bdfbd4b2d1400b1b1b";

    fn anvil_signer() -> PrivateKeySigner {
        ANVIL_KEY.parse().expect("anvil key")
    }

    #[test]
    fn sign_and_verify_roundtrip() {
        let signer = anvil_signer();
        let parent = "ann-gid";
        let npub = "npub1alice";
        let issued_at = 1_710_000_000u64;
        let sig = sign_roster_bind_cert(&signer, parent, npub, issued_at).unwrap();
        assert_eq!(sig.len(), 132);
        verify_squad_roster_bind_cert(parent, npub, ANVIL_ADDR, issued_at, &sig).unwrap();
        assert!(sig.starts_with("0x"));
        assert_eq!(sig.len(), 132);
    }

    #[test]
    fn golden_digest_and_signature_are_stable() {
        let signer = anvil_signer();
        let hash =
            roster_bind_signing_hash("ann-gid", "npub1alice", signer.address(), 1_710_000_000);
        let sig = sign_roster_bind_cert(&signer, "ann-gid", "npub1alice", 1_710_000_000).unwrap();
        assert_eq!(format!("{hash:#x}"), GOLDEN_HASH);
        assert_eq!(sig, GOLDEN_SIG);
    }

    #[test]
    fn reject_wrong_parent_npub_address_and_truncated_sig() {
        let signer = anvil_signer();
        let sig = sign_roster_bind_cert(&signer, "ann-gid", "npub1alice", 1_710_000_000).unwrap();
        assert!(verify_squad_roster_bind_cert(
            "other",
            "npub1alice",
            ANVIL_ADDR,
            1_710_000_000,
            &sig
        )
        .is_err());
        assert!(verify_squad_roster_bind_cert(
            "ann-gid",
            "npub1bob",
            ANVIL_ADDR,
            1_710_000_000,
            &sig
        )
        .is_err());
        assert!(verify_squad_roster_bind_cert(
            "ann-gid",
            "npub1alice",
            "0x0000000000000000000000000000000000000001",
            1_710_000_000,
            &sig
        )
        .is_err());
        assert!(verify_squad_roster_bind_cert(
            "ann-gid",
            "npub1alice",
            ANVIL_ADDR,
            1_710_000_000,
            "0xab"
        )
        .is_err());
    }

    #[test]
    fn certified_upsert_skips_stale_issued_at() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        let signer = anvil_signer();
        let newer = sign_roster_bind_cert(&signer, "g1", "npub1alice", 200).unwrap();
        let older = sign_roster_bind_cert(&signer, "g1", "npub1alice", 100).unwrap();
        let newer_cert = crate::db::RosterBindCertIngest {
            parent_id: "g1".into(),
            member_npub: "npub1alice".into(),
            evm_address: format!("{:#x}", signer.address()),
            issued_at: 200,
            signature: newer,
        };
        let older_cert = crate::db::RosterBindCertIngest {
            parent_id: "g1".into(),
            member_npub: "npub1alice".into(),
            evm_address: format!("{:#x}", signer.address()),
            issued_at: 100,
            signature: older,
        };
        assert!(crate::db::apply_verified_roster_bind_cert(
            &conn,
            "g1",
            &newer_cert
        ));
        assert!(!crate::db::apply_verified_roster_bind_cert(
            &conn,
            "g1",
            &older_cert
        ));
        let stored: i64 = conn
            .query_row(
                "SELECT issued_at FROM squad_member_evm WHERE parent_id = 'g1' AND member_npub = 'npub1alice'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, 200);
    }

    #[test]
    fn unsigned_and_forged_certs_do_not_apply() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        let bad = crate::db::RosterBindCertIngest {
            parent_id: "g1".into(),
            member_npub: "npub1alice".into(),
            evm_address: ANVIL_ADDR.into(),
            issued_at: 1_710_000_000,
            signature: GOLDEN_SIG.to_string(),
        };
        // GOLDEN_SIG is for parent ann-gid, not g1.
        assert!(!crate::db::apply_verified_roster_bind_cert(
            &conn, "g1", &bad
        ));
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM squad_member_evm", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn share_ingest_rejects_unsigned_and_author_mismatch() {
        let signer = anvil_signer();
        let sig = sign_roster_bind_cert(&signer, "ann-gid", "npub1alice", 1_710_000_000).unwrap();
        let unsigned = r#"{"type":"squad_member_evm_share","payload":{"parent_id":"ann-gid","evm_address":"0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"}}"#;
        assert!(crate::db::parse_v2_squad_member_evm_share(unsigned, "npub1alice").is_none());
        let v2 = format!(
            r#"{{"version":2,"type":"squad_member_evm_share","payload":{{"parent_id":"ann-gid","member_npub":"npub1alice","evm_address":"{ANVIL_ADDR}","issued_at":1710000000,"signature":"{sig}"}}}}"#
        );
        assert!(crate::db::parse_v2_squad_member_evm_share(&v2, "npub1bob").is_none());
        let cert = crate::db::parse_v2_squad_member_evm_share(&v2, "npub1alice").unwrap();
        assert_eq!(cert.member_npub, "npub1alice");
    }

    #[test]
    fn snapshot_applies_alice_cert_when_forwarder_is_bob() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        let signer = anvil_signer();
        let sig = sign_roster_bind_cert(&signer, "g1", "npub1alice", 1_710_000_000).unwrap();
        let raw = format!(
            r#"{{"version":1,"type":"squad_evm_roster_snapshot","payload":{{"parent_id":"g1","members":[{{"member_npub":"npub1alice","evm_address":"{ANVIL_ADDR}","issued_at":1710000000,"signature":"{sig}"}}]}}}}"#
        );
        let (parent, members) = crate::db::parse_squad_evm_roster_snapshot_certs(&raw).unwrap();
        assert_eq!(parent, "g1");
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].member_npub, "npub1alice");
        assert!(crate::db::apply_verified_roster_bind_cert(
            &conn,
            "g1",
            &members[0]
        ));
        let stored: String = conn
            .query_row(
                "SELECT member_npub FROM squad_member_evm WHERE parent_id = 'g1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, "npub1alice");
    }

    #[test]
    fn require_verified_bind_cert_rejects_none_none() {
        let err = require_verified_bind_cert_for_upsert(
            "g1",
            "npub1alice",
            ANVIL_ADDR,
            None,
            None,
        )
        .expect_err("unsigned upsert must fail");
        assert!(err.contains("bind cert"));
    }

    #[test]
    fn reject_far_future_issued_at() {
        let signer = anvil_signer();
        let future = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
            .saturating_add(MAX_ISSUED_AT_SKEW_SECS + 60);
        let sig = sign_roster_bind_cert(&signer, "ann-gid", "npub1alice", future).unwrap();
        assert!(verify_squad_roster_bind_cert("ann-gid", "npub1alice", ANVIL_ADDR, future, &sig).is_err());
    }
}
