//! Shared squad sponsor helpers (squad id derivation, factory registry reads).

use alloy::primitives::{keccak256, Address, B256, U256};
use tauri::{AppHandle, Runtime};

use super::rpc::{parse_address, wallet_err_json};
use alloy::providers::Provider;

use super::contracts::pacto_sponsor::SquadVariant;
use super::contracts::pacto_sponsor::ISquadSponsorFactory::squadsCall;
use super::rpc::call::eth_call_decode;

/// Membership decision from the gathered signals (MLS group row, squad EVM binding, roster EVM address).
fn require_parent_member_decision(
    in_mls: bool,
    has_evm_binding: bool,
    has_roster_address: bool,
) -> Result<(), String> {
    if in_mls || has_evm_binding || has_roster_address {
        Ok(())
    } else {
        Err(wallet_err_json(
            "NOT_PARENT_MEMBER",
            "You must be a member of this squad to deploy or fund its on-chain infrastructure.",
            None,
        ))
    }
}

/// Preflight: reject when this parent has neither sponsor nor pacto_gov infra in SQLite.
pub fn require_sponsor_or_pacto_gov_infra_for_parent<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<(), String> {
    if crate::db::parent_has_sponsor_infra(app, parent_id)?
        || crate::db::parent_has_pacto_gov_infra_row(app, parent_id)?
    {
        Ok(())
    } else {
        Err(wallet_err_json(
            "SPONSOR_OR_PACTO_GOV_REQUIRED",
            "Deploy squad sponsor or Pacto Gov for this parent before other on-chain infra.",
            None,
        ))
    }
}

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

    let in_mls = crate::db::parent_exists_in_groups(app, pid).await?;
    let has_evm_binding = !in_mls
        && matches!(
            crate::db::get_squad_member_evm_account_id(app, pid, None),
            Ok(Some(_))
        );
    let has_roster_address = !in_mls
        && !has_evm_binding
        && (match crate::account_manager::get_current_account() {
            Ok(member) => matches!(
                crate::db::roster_evm_address_for_member(app, pid, member.as_str()),
                Ok(Some(_))
            ),
            Err(_) => false,
        });
    require_parent_member_decision(in_mls, has_evm_binding, has_roster_address)
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

/// Map a factory registry read failure to a retryable sponsor-lookup error.
fn sponsor_lookup_err(e: String) -> String {
    wallet_err_json("SPONSOR_LOOKUP", e, None)
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
            .map_err(sponsor_lookup_err)?;
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
        .map_err(sponsor_lookup_err)
        .map(|(addr, _, _)| addr)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err_code(err: &str) -> String {
        serde_json::from_str::<serde_json::Value>(err)
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(String::from))
            .unwrap_or_default()
    }

    #[test]
    fn parent_member_decision_accepts_any_membership_signal() {
        assert!(require_parent_member_decision(true, false, false).is_ok());
        assert!(require_parent_member_decision(false, true, false).is_ok());
        assert!(require_parent_member_decision(false, false, true).is_ok());
    }

    #[test]
    fn parent_member_decision_rejects_non_member() {
        let err = require_parent_member_decision(false, false, false).unwrap_err();
        assert_eq!(err_code(&err), "NOT_PARENT_MEMBER");
    }

    #[test]
    fn sponsor_lookup_err_maps_to_retryable_lookup_code() {
        let err = sponsor_lookup_err("rpc timeout".to_string());
        let v: serde_json::Value = serde_json::from_str(&err).expect("json");
        assert_eq!(v.get("code").and_then(|c| c.as_str()), Some("SPONSOR_LOOKUP"));
        assert_eq!(
            v.get("message").and_then(|m| m.as_str()),
            Some("rpc timeout")
        );
    }

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
