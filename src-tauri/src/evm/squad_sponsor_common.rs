//! Shared squad sponsor helpers (squad id derivation, factory registry reads).

use std::str::FromStr;

use alloy::primitives::{keccak256, Address, B256, U256};
use tauri::{AppHandle, Runtime};

use super::rpc::{parse_address, wallet_err_json};
use alloy::providers::Provider;

use super::contracts::pacto_sponsor::ISquadSponsorFactory::squadsCall;
use super::contracts::pacto_sponsor::SquadVariant;
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

pub fn parse_signer_wallet(
    raw: Option<&str>,
    default: &'static str,
) -> Result<&'static str, String> {
    match raw
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
        .to_ascii_lowercase()
        .as_str()
    {
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

/// Factory registry row for a parent (live slot or, when allowed, wargame round).
pub struct ResolvedSponsor {
    pub address: Address,
    pub variant: SquadVariant,
    pub top_hat_id: U256,
    pub squad_id: B256,
}

/// Map a factory registry read failure to a retryable sponsor-lookup error.
fn sponsor_lookup_err(e: String) -> String {
    wallet_err_json("SPONSOR_LOOKUP", e, None)
}

/// Active war-game `gameSquadId` from a provider payload (no module-address requirement).
pub fn game_squad_id_from_wargame_payload(payload: &str) -> Option<B256> {
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let status = v
        .get("status")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    if !status.eq_ignore_ascii_case("active") {
        return None;
    }
    let id_raw = v.get("gameSquadId").and_then(|x| x.as_str())?;
    B256::from_str(id_raw.trim()).ok()
}

/// Stored active war-game round id for this parent, if any.
pub fn active_game_squad_id_for_parent<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Option<B256> {
    crate::db::pacto_gov_wargame_payload_for_parent(app, parent_id)
        .ok()
        .flatten()
        .as_deref()
        .and_then(game_squad_id_from_wargame_payload)
}

/// Factory `squads` key: parent keccak unless an explicit clone misses the parent slot
/// and an active war-game `gameSquadId` is available.
pub fn pick_registry_squad_id(
    parent_squad_id: B256,
    game_squad_id: Option<B256>,
    parent_sponsor: Option<Address>,
    explicit: Option<Address>,
) -> B256 {
    let Some(explicit) = explicit else {
        return parent_squad_id;
    };
    if parent_sponsor == Some(explicit) {
        return parent_squad_id;
    }
    game_squad_id.unwrap_or(parent_squad_id)
}

fn require_explicit_matches(
    registry: Address,
    explicit: Option<Address>,
) -> Result<Address, String> {
    if let Some(addr) = explicit {
        if registry != addr {
            return Err(wallet_err_json(
                "SPONSOR_REGISTRY",
                "sponsor address does not match factory registry for parent id",
                None,
            ));
        }
        return Ok(addr);
    }
    Ok(registry)
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
    match read_squad_record_opt(provider, factory, squad_id).await? {
        Some(record) => Ok(record),
        None => Err("no sponsor clone registered for this squad id".to_string()),
    }
}

/// Factory `squads` row, or `None` when no clone is registered.
pub async fn read_squad_record_opt<P: Provider>(
    provider: &P,
    factory: Address,
    squad_id: B256,
) -> Result<Option<(Address, SquadVariant, U256)>, String> {
    let call = squadsCall { squadId: squad_id };
    let decoded = eth_call_decode(provider, factory, &call).await?;
    if decoded.sponsor.is_zero() {
        return Ok(None);
    }
    Ok(Some((decoded.sponsor, decoded.variant, decoded.topHatId)))
}

/// Sponsor clone for a parent: live `squads(parentKeccak)` first; an explicit address that
/// misses that slot may resolve via active `gameSquadId`.
pub async fn resolve_sponsor_record_for_parent<P: Provider>(
    provider: &P,
    factory: Address,
    parent_id: &str,
    sponsor_address: Option<&str>,
    game_squad_id: Option<B256>,
) -> Result<ResolvedSponsor, String> {
    let parent_squad_id = squad_id_from_parent_id(parent_id);
    let parent_rec = read_squad_record_opt(provider, factory, parent_squad_id)
        .await
        .map_err(sponsor_lookup_err)?;
    let parent_sponsor = parent_rec.as_ref().map(|(addr, _, _)| *addr);

    let explicit = match sponsor_address.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => {
            Some(parse_address(raw).map_err(|e| wallet_err_json("INVALID_SPONSOR", e, None))?)
        }
        None => None,
    };

    let squad_id = pick_registry_squad_id(parent_squad_id, game_squad_id, parent_sponsor, explicit);

    let (reg, variant, top_hat) = if squad_id == parent_squad_id {
        parent_rec.ok_or_else(|| {
            sponsor_lookup_err("no sponsor clone registered for this squad id".to_string())
        })?
    } else {
        read_squad_record(provider, factory, squad_id)
            .await
            .map_err(sponsor_lookup_err)?
    };

    let address = require_explicit_matches(reg, explicit)?;
    Ok(ResolvedSponsor {
        address,
        variant,
        top_hat_id: top_hat,
        squad_id,
    })
}

/// Sponsor clone address for a parent (see [`resolve_sponsor_record_for_parent`]).
pub async fn resolve_sponsor_for_parent<P: Provider>(
    provider: &P,
    factory: Address,
    parent_id: &str,
    sponsor_address: Option<&str>,
    game_squad_id: Option<B256>,
) -> Result<Address, String> {
    resolve_sponsor_record_for_parent(provider, factory, parent_id, sponsor_address, game_squad_id)
        .await
        .map(|r| r.address)
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
        assert_eq!(
            v.get("code").and_then(|c| c.as_str()),
            Some("SPONSOR_LOOKUP")
        );
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
        assert_eq!(
            parse_deposit_wei(Some("1000")).unwrap(),
            U256::from(1000u64)
        );
        assert_eq!(
            parse_deposit_wei(Some("  1000  ")).unwrap(),
            U256::from(1000u64)
        );
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
        assert_eq!(
            parse_signer_wallet(Some("DEFAULT"), "squad").unwrap(),
            "default"
        );
        assert_eq!(
            parse_signer_wallet(Some("squad"), "default").unwrap(),
            "squad"
        );
        assert!(parse_signer_wallet(Some("hardware"), "squad").is_err());
    }

    fn addr(n: u8) -> Address {
        Address::repeat_byte(n)
    }

    fn id(n: u8) -> B256 {
        B256::repeat_byte(n)
    }

    #[test]
    fn pick_registry_squad_id_parent_hit_uses_parent_key() {
        let parent = id(0x11);
        let game = id(0x22);
        let sponsor = addr(0xaa);
        assert_eq!(
            pick_registry_squad_id(parent, Some(game), Some(sponsor), Some(sponsor)),
            parent
        );
    }

    #[test]
    fn pick_registry_squad_id_no_explicit_ignores_game_id() {
        let parent = id(0x11);
        let game = id(0x22);
        assert_eq!(
            pick_registry_squad_id(parent, Some(game), None, None),
            parent
        );
        assert_eq!(
            pick_registry_squad_id(parent, Some(game), Some(addr(0xaa)), None),
            parent
        );
    }

    #[test]
    fn pick_registry_squad_id_parent_empty_explicit_uses_game_id() {
        let parent = id(0x11);
        let game = id(0x22);
        assert_eq!(
            pick_registry_squad_id(parent, Some(game), None, Some(addr(0xbb))),
            game
        );
    }

    #[test]
    fn pick_registry_squad_id_explicit_mismatch_uses_game_id() {
        let parent = id(0x11);
        let game = id(0x22);
        assert_eq!(
            pick_registry_squad_id(parent, Some(game), Some(addr(0xaa)), Some(addr(0xbb)),),
            game
        );
    }

    #[test]
    fn pick_registry_squad_id_explicit_mismatch_without_game_stays_parent() {
        let parent = id(0x11);
        assert_eq!(
            pick_registry_squad_id(parent, None, None, Some(addr(0xbb))),
            parent
        );
        assert_eq!(
            pick_registry_squad_id(parent, None, Some(addr(0xaa)), Some(addr(0xbb))),
            parent
        );
    }

    #[test]
    fn require_explicit_matches_accepts_none_and_equal() {
        let reg = addr(0xaa);
        assert_eq!(require_explicit_matches(reg, None).unwrap(), reg);
        assert_eq!(require_explicit_matches(reg, Some(reg)).unwrap(), reg);
    }

    #[test]
    fn require_explicit_matches_rejects_mismatch() {
        let err = require_explicit_matches(addr(0xaa), Some(addr(0xbb))).unwrap_err();
        assert_eq!(err_code(&err), "SPONSOR_REGISTRY");
    }

    #[test]
    fn game_squad_id_from_wargame_payload_requires_active_and_id() {
        let game = id(0xab);
        let hex = format!("{game:#x}");
        assert_eq!(
            game_squad_id_from_wargame_payload(&format!(
                r#"{{"status":"active","gameSquadId":"{hex}"}}"#
            )),
            Some(game)
        );
        assert_eq!(
            game_squad_id_from_wargame_payload(&format!(
                r#"{{"status":"ACTIVE","gameSquadId":"{hex}"}}"#
            )),
            Some(game)
        );
        assert!(game_squad_id_from_wargame_payload(&format!(
            r#"{{"status":"retired","gameSquadId":"{hex}"}}"#
        ))
        .is_none());
        assert!(game_squad_id_from_wargame_payload(r#"{"status":"active"}"#).is_none());
        assert!(game_squad_id_from_wargame_payload("{").is_none());
    }
}
