//! Shared squad sponsor helpers (squad id derivation, factory registry reads).

use alloy::primitives::{keccak256, Address, B256, U256};

use super::rpc::wallet_err_json;
use alloy::providers::Provider;

use super::contracts::pacto_sponsor::SquadVariant;
use super::contracts::pacto_sponsor::ISquadSponsorFactory::squadsCall;
use super::rpc::call::eth_call_decode;

/// Deterministic on-chain squad key for a Pacto parent id (squad or network root).
pub fn squad_id_from_parent_id(parent_id: &str) -> B256 {
    B256::from(keccak256(parent_id.trim().as_bytes()))
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

pub fn require_sponsor_infra_for_parent<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    parent_id: &str,
) -> Result<(), String> {
    if crate::db::parent_has_sponsor_infra(app, parent_id)? {
        Ok(())
    } else {
        Err(wallet_err_json(
            "SPONSOR_REQUIRED",
            "Deploy squad sponsor for this parent before other on-chain infra.",
            None,
        ))
    }
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
