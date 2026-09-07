//! On-chain owner reads for Ext-first infra completion gates.

use alloy::primitives::Address;
use alloy::providers::Provider;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::ISquadAdminExt::ownerCall;
use super::contracts::pacto_sponsor::ISquadSponsorExt::addressOwnerCall;
use super::contracts::pacto_sponsor::ISquadSponsorFactory::squadsCall;
use super::contracts::pacto_sponsor::SquadVariant;
use super::rpc::call::eth_call_decode;
use super::squad_sponsor_common::squad_id_from_parent_id;
use super::rpc::{parse_address, wallet_err_json};

/// Resolved Ext owners for a parent (on-chain reads).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExtInfraOwners {
    pub sponsor_address_owner: Option<Address>,
    pub admin_ext_owner: Option<Address>,
}

pub async fn read_sponsor_address_owner<P: Provider>(
    provider: &P,
    sponsor: Address,
) -> Result<Address, String> {
    eth_call_decode(provider, sponsor, &addressOwnerCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))
}

pub async fn read_admin_ext_owner<P: Provider>(
    provider: &P,
    admin_proxy: Address,
) -> Result<Address, String> {
    eth_call_decode(provider, admin_proxy, &ownerCall {})
        .await
        .map_err(|e| wallet_err_json("ADMIN_READ", e, None))
}

/// Parse owner from persisted JSON when RPC is unavailable (fail-closed for gates).
pub fn owner_from_payload_field(raw: Option<&str>) -> Option<Address> {
    raw.and_then(|s| parse_address(s.trim()).ok())
}

/// Caller roster must match every ext owner that exists before gov deploy.
pub fn require_roster_matches_owners_for_gov_deploy(
    roster: Address,
    owners: &ExtInfraOwners,
) -> Result<(), String> {
    let mut required: Vec<Address> = Vec::new();
    if let Some(o) = owners.sponsor_address_owner {
        if o != roster {
            required.push(o);
        }
    }
    if let Some(o) = owners.admin_ext_owner {
        if o != roster {
            required.push(o);
        }
    }
    if required.is_empty() {
        return Ok(());
    }
    let addrs = required
        .iter()
        .map(|a| format!("{:#x}", a))
        .collect::<Vec<_>>()
        .join(", ");
    Err(wallet_err_json(
        "NOT_INFRA_OWNER",
        format!(
            "only the infra owner can deploy Pacto Gov when Ext components exist (required: {})",
            addrs
        ),
        None,
    ))
}

pub fn require_roster_is_sponsor_owner(roster: Address, owner: Address) -> Result<(), String> {
    if roster != owner {
        return Err(wallet_err_json(
            "NOT_SPONSOR_OWNER",
            "only the squad sponsor address owner can wire the Ext sponsor",
            None,
        ));
    }
    Ok(())
}

/// Live on-chain Ext owners for gov-deploy preflight.
pub async fn resolve_ext_infra_owners_on_chain<R: Runtime, P: Provider>(
    app: &AppHandle<R>,
    parent_id: &str,
    provider: &P,
    sponsor_factory: Address,
) -> Result<ExtInfraOwners, String> {
    let pid = parent_id.trim();
    let mut owners = ExtInfraOwners::default();
    let squad_id = squad_id_from_parent_id(pid);
    if let Ok(record) =
        eth_call_decode(provider, sponsor_factory, &squadsCall { squadId: squad_id }).await
    {
        if !record.sponsor.is_zero() && matches!(record.variant, SquadVariant::EXT) {
            owners.sponsor_address_owner =
                read_sponsor_address_owner(provider, record.sponsor).await.ok();
        }
    }
    let rows = crate::db::list_squad_infra(app.clone(), pid.to_string())?;
    if let Some(row) = rows.iter().find(|r| r.infra_type == "squad_admin") {
        if let Ok(addr) = parse_address(row.canonical_ref.trim()) {
            owners.admin_ext_owner = read_admin_ext_owner(provider, addr)
                .await
                .ok()
                .or_else(|| {
                    row.provider_payload.as_deref().and_then(|p| {
                        let v: serde_json::Value = serde_json::from_str(p).ok()?;
                        let owner_str = v
                            .get("owner")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string())?;
                        owner_from_payload_field(Some(owner_str.as_str()))
                    })
                });
        }
    }
    Ok(owners)
}

/// Load roster EVM for the current account on this parent (binding source of truth).
pub async fn roster_evm_for_parent<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<Option<Address>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(None);
    }
    let member = crate::account_manager::get_current_account()?;
    let raw = crate::db::roster_evm_address_for_member(app, pid, member.as_str())?;
    Ok(raw.and_then(|s| parse_address(s.trim()).ok()))
}
