//! Shared squad sponsor helpers (squad id derivation, factory registry reads).

use alloy::primitives::{keccak256, Address, B256, U256};
use tauri::{AppHandle, Runtime};

use super::rpc::{parse_address, wallet_err_json};
use alloy::providers::Provider;

use super::contracts::pacto_sponsor::SquadVariant;
use super::contracts::pacto_sponsor::ISquadSponsorFactory::squadsCall;
use super::rpc::call::eth_call_decode;

/// Current Nostr account must belong to the parent (MLS metadata or roster binding).
pub async fn require_parent_member<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }

    if crate::db::parent_exists_in_groups(app, pid).await? {
        return Ok(());
    }

    if matches!(
        crate::db::get_squad_member_evm_account_id(app, pid, None),
        Ok(Some(_))
    ) {
        return Ok(());
    }
    if let Ok(member) = crate::account_manager::get_current_account() {
        if matches!(
            crate::db::roster_evm_address_for_member(app, pid, member.as_str()),
            Ok(Some(_))
        ) {
            return Ok(());
        }
    }

    Err(wallet_err_json(
        "NOT_PARENT_MEMBER",
        "You must be a member of this squad to deploy or fund its on-chain infrastructure.",
        None,
    ))
}

/// Deterministic on-chain squad key for a Pacto parent id (squad or network root).
pub fn squad_id_from_parent_id(parent_id: &str) -> B256 {
    B256::from(keccak256(parent_id.trim().as_bytes()))
}

pub fn parse_signer_wallet(raw: Option<&str>, default: &'static str) -> Result<&'static str, String> {
    match raw.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(default).to_ascii_lowercase().as_str() {
        "squad" => Ok("squad"),
        "default" => Ok("default"),
        other => Err(wallet_err_json(
            "INVALID_SIGNER",
            format!("Unknown signer wallet: {other}"),
            None,
        )),
    }
}

pub fn parse_deposit_wei(raw: Option<&str>) -> Result<U256, String> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Err("amount must be non-empty".to_string());
    };
    if s.starts_with("0x") || s.starts_with("0X") {
        U256::from_str_radix(s.trim_start_matches("0x").trim_start_matches("0X"), 16)
            .map_err(|e| format!("invalid hex amount: {e}"))
    } else {
        U256::from_str_radix(s, 10).map_err(|e| format!("invalid decimal amount: {e}"))
    }
}

/// Preflight: reject when SQLite or the factory already has a sponsor for this parent.
pub async fn require_sponsor_not_already_deployed<R: Runtime, P: Provider>(
    app: &AppHandle<R>,
    provider: &P,
    factory: Address,
    parent_id: &str,
    squad_id: B256,
) -> Result<(), String> {
    if crate::db::parent_has_sponsor_infra(app, parent_id).unwrap_or(false) {
        return Err(wallet_err_json(
            "ALREADY_DEPLOYED",
            "This parent already has squad sponsor infrastructure.",
            None,
        ));
    }
    let call = squadsCall {
        squadId: squad_id,
    };
    // Transient RPC failure must not fall through to a doomed deploy tx.
    let decoded = eth_call_decode(provider, factory, &call)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
    if !decoded.sponsor.is_zero() {
        return Err(wallet_err_json(
            "ALREADY_DEPLOYED",
            "A sponsor clone is already registered for this squad id.",
            None,
        ));
    }
    Ok(())
}

pub fn squad_variant_label(v: SquadVariant) -> &'static str {
    match v {
        SquadVariant::NONE => "none",
        SquadVariant::SPONSOR => "sponsor",
        SquadVariant::EXT => "ext",
        SquadVariant::__Invalid => "unknown",
    }
}

pub async fn read_squad_record<P: Provider>(
    provider: &P,
    factory: Address,
    squad_id: B256,
) -> Result<(Address, SquadVariant, U256), String> {
    let call = squadsCall {
        squadId: squad_id,
    };
    let decoded = eth_call_decode(provider, factory, &call).await?;
    let sponsor = decoded.sponsor;
    if sponsor.is_zero() {
        return Err("no sponsor clone registered for this squad id".to_string());
    }
    Ok((sponsor, decoded.variant, decoded.topHatId))
}

/// Sponsor clone address for a parent: an explicit address is validated against the factory
/// registry; otherwise the registry-registered clone is returned.
pub async fn resolve_sponsor_for_parent<P: Provider>(
    provider: &P,
    factory: Address,
    parent_id: &str,
    sponsor_address: Option<&str>,
) -> Result<Address, String> {
    let squad_id = squad_id_from_parent_id(parent_id);
    if let Some(raw) = sponsor_address.map(str::trim).filter(|s| !s.is_empty()) {
        let addr = parse_address(raw).map_err(|e| wallet_err_json("INVALID_SPONSOR", e, None))?;
        let (reg, _, _) = read_squad_record(provider, factory, squad_id)
            .await
            .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
        if reg != addr {
            return Err(wallet_err_json(
                "SPONSOR_REGISTRY",
                "sponsor address does not match factory registry for parent id",
                None,
            ));
        }
        return Ok(addr);
    }
    read_squad_record(provider, factory, squad_id)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))
        .map(|(addr, _, _)| addr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn squad_id_from_parent_id_is_deterministic_and_trims() {
        let a = squad_id_from_parent_id("parent-id");
        let b = squad_id_from_parent_id("parent-id");
        let c = squad_id_from_parent_id("  parent-id  ");
        assert_eq!(a, b);
        assert_eq!(a, c);
    }

    #[test]
    fn parse_deposit_wei_decimal() {
        assert_eq!(parse_deposit_wei(Some("1000")).unwrap(), U256::from(1000u64));
        assert_eq!(parse_deposit_wei(Some("  1000  ")).unwrap(), U256::from(1000u64));
    }

    #[test]
    fn parse_deposit_wei_hex() {
        assert_eq!(parse_deposit_wei(Some("0xff")).unwrap(), U256::from(255u64));
        assert_eq!(parse_deposit_wei(Some("0XFF")).unwrap(), U256::from(255u64));
    }

    #[test]
    fn parse_deposit_wei_rejects_empty() {
        assert!(parse_deposit_wei(None).is_err());
        assert!(parse_deposit_wei(Some("")).is_err());
        assert!(parse_deposit_wei(Some("   ")).is_err());
    }

    #[test]
    fn parse_deposit_wei_rejects_invalid() {
        assert!(parse_deposit_wei(Some("not-a-number")).is_err());
        assert!(parse_deposit_wei(Some("0xzz")).is_err());
    }

    #[test]
    fn squad_variant_label_maps_variants() {
        assert_eq!(squad_variant_label(SquadVariant::NONE), "none");
        assert_eq!(squad_variant_label(SquadVariant::SPONSOR), "sponsor");
        assert_eq!(squad_variant_label(SquadVariant::EXT), "ext");
        assert_eq!(squad_variant_label(SquadVariant::__Invalid), "unknown");
    }

    #[test]
    fn parse_signer_wallet_defaults_and_rejects_unknown() {
        assert_eq!(parse_signer_wallet(None, "squad").unwrap(), "squad");
        assert_eq!(parse_signer_wallet(Some(""), "default").unwrap(), "default");
        assert_eq!(parse_signer_wallet(Some("DEFAULT"), "squad").unwrap(), "default");
        assert_eq!(parse_signer_wallet(Some("squad"), "default").unwrap(), "squad");
        assert!(parse_signer_wallet(Some("hardware"), "squad").is_err());
    }
}
