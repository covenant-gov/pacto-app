//! Launchpad deploy option state: infra status, owner gates, and action enablement.

use std::collections::HashMap;

use alloy::primitives::Address;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorExt::hatsWiredCall;
use super::contracts::pacto_sponsor::ISquadSponsorFactory::squadsCall;
use super::contracts::pacto_sponsor::SquadVariant;
use super::gov_read::rpc_urls_or_default;
use super::infra_owner::{
    owner_from_payload_field, read_admin_ext_owner, read_sponsor_address_owner, roster_evm_for_parent,
    ExtInfraOwners,
};
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::connect_read_provider;
use super::squad_sponsor_common::{squad_id_from_parent_id, squad_variant_label};
use super::wallet_chain_config;
use crate::db::{list_squad_infra, SquadInfraRow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchpadComponentStatus {
    pub deployed: bool,
    pub deployed_address: Option<String>,
    pub variant: Option<String>,
    pub address_owner: Option<String>,
    pub owner: Option<String>,
    pub hats_wired: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchpadDeployOption {
    pub id: String,
    pub deployed: bool,
    pub enabled: bool,
    pub disabled_reason_key: Option<String>,
    pub disabled_reason_values: Option<HashMap<String, String>>,
    pub deployed_address: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadDeployLaunchpadState {
    pub my_roster_evm: Option<String>,
    pub pacto_gov: LaunchpadComponentStatus,
    pub sponsor: LaunchpadComponentStatus,
    pub admin: LaunchpadComponentStatus,
    pub options: Vec<LaunchpadDeployOption>,
}

fn parse_payload_field(payload: &str, key: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn infra_row<'a>(rows: &'a [SquadInfraRow], infra_type: &str) -> Option<&'a SquadInfraRow> {
    rows.iter().find(|r| r.infra_type == infra_type)
}

fn addresses_match(a: Option<Address>, b: Option<Address>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

fn disabled_reason(key: &str) -> (Option<String>, Option<HashMap<String, String>>) {
    (Some(key.to_string()), None)
}

fn disabled_reason_with_addresses(
    key: &str,
    addrs: &[Address],
) -> (Option<String>, Option<HashMap<String, String>>) {
    let addresses = addrs
        .iter()
        .map(|a| format!("{:#x}", a))
        .collect::<Vec<_>>()
        .join(", ");
    let mut values = HashMap::new();
    values.insert("addresses".to_string(), addresses);
    (Some(key.to_string()), Some(values))
}

fn launchpad_option(
    id: &str,
    deployed: bool,
    enabled: bool,
    disabled_key: Option<String>,
    disabled_values: Option<HashMap<String, String>>,
    deployed_address: Option<String>,
) -> LaunchpadDeployOption {
    LaunchpadDeployOption {
        id: id.to_string(),
        deployed,
        enabled,
        disabled_reason_key: disabled_key,
        disabled_reason_values: disabled_values,
        deployed_address,
    }
}

#[tauri::command]
pub async fn get_squad_deploy_launchpad_state<R: Runtime>(
    app: AppHandle<R>,
    parent_id: String,
    network: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadDeployLaunchpadState, String> {
    let pid = parent_id.trim();
    let rows = list_squad_infra(app.clone(), pid.to_string())?;
    let my_roster = roster_evm_for_parent(&app, pid).await?;

    let gov_row = infra_row(&rows, "pacto_gov");
    let sponsor_row = infra_row(&rows, "sponsor");
    let admin_row = infra_row(&rows, "squad_admin");

    let has_pacto_gov = gov_row.is_some();
    let gov_payload = gov_row.and_then(|r| r.provider_payload.as_deref());
    let gov_admin_proxy = gov_payload
        .and_then(|p| parse_payload_field(p, "squadAdminProxy"));
    let pacto_gov_address = gov_row.map(|r| r.canonical_ref.clone());

    let mut sponsor_status = LaunchpadComponentStatus {
        deployed: false,
        deployed_address: None,
        variant: None,
        address_owner: None,
        owner: None,
        hats_wired: None,
    };

    let mut admin_status = LaunchpadComponentStatus {
        deployed: false,
        deployed_address: None,
        variant: None,
        address_owner: None,
        owner: None,
        hats_wired: None,
    };

    let mut ext_owners = ExtInfraOwners::default();

    let net_key = network.to_lowercase();
    let net = wallet_chain_config::network_by_key(&net_key);
    let urls = net.as_ref().map(|n| rpc_urls_or_default(n, rpc_urls.clone()));
    let provider = if let (Some(n), Some(urls)) = (net.as_ref(), urls.as_ref()) {
        if !urls.is_empty() {
            connect_read_provider(urls).await.ok()
        } else {
            None
        }
    } else {
        None
    };

    // Sponsor slot: local row and/or factory registry.
    if let Some(row) = sponsor_row {
        sponsor_status.deployed = true;
        sponsor_status.deployed_address = Some(row.canonical_ref.clone());
        if let Some(p) = row.provider_payload.as_deref() {
            sponsor_status.variant = parse_payload_field(p, "variant");
            sponsor_status.hats_wired = parse_payload_field(p, "hatsWired")
                .map(|s| s == "true" || s == "1");
            sponsor_status.address_owner = parse_payload_field(p, "addressOwner");
        }
    }

    if let (Some(p), Some(n)) = (provider.as_ref(), net.as_ref()) {
        if let Ok(addrs) = pacto_chain_config::squad_sponsor_deploy_addresses(&n.key) {
            let squad_id = squad_id_from_parent_id(pid);
            if let Ok(record) = eth_call_decode(p, addrs.squad_sponsor_factory, &squadsCall {
                squadId: squad_id,
            })
            .await
            {
                if !record.sponsor.is_zero() {
                    sponsor_status.deployed = true;
                    sponsor_status.deployed_address =
                        Some(format!("{:#x}", record.sponsor));
                    sponsor_status.variant =
                        Some(squad_variant_label(record.variant).to_string());
                    if matches!(record.variant, SquadVariant::EXT) {
                        if let Ok(owner) = read_sponsor_address_owner(p, record.sponsor).await {
                            ext_owners.sponsor_address_owner = Some(owner);
                            sponsor_status.address_owner = Some(format!("{:#x}", owner));
                        }
                        if let Ok(wired) =
                            eth_call_decode(p, record.sponsor, &hatsWiredCall {}).await
                        {
                            sponsor_status.hats_wired = Some(wired);
                        }
                    } else if matches!(record.variant, SquadVariant::SPONSOR) {
                        sponsor_status.hats_wired = Some(true);
                    }
                }
            }
        }
    }

    if ext_owners.sponsor_address_owner.is_none() {
        ext_owners.sponsor_address_owner = sponsor_status
            .address_owner
            .as_deref()
            .and_then(|s| owner_from_payload_field(Some(s)));
    }

    // Admin: dedicated row or embedded in pacto_gov payload.
    if let Some(row) = admin_row {
        admin_status.deployed = true;
        admin_status.deployed_address = Some(row.canonical_ref.clone());
        if let Some(p) = row.provider_payload.as_deref() {
            admin_status.variant = parse_payload_field(p, "variant");
            admin_status.owner = parse_payload_field(p, "owner");
        }
    } else if let Some(proxy) = gov_admin_proxy.as_ref() {
        admin_status.deployed = true;
        admin_status.deployed_address = Some(proxy.clone());
        admin_status.variant = Some("gov".to_string());
    }

    if let (Some(p), Some(proxy)) = (provider.as_ref(), admin_status.deployed_address.as_ref()) {
        if admin_row.is_some() {
            if let Ok(addr) = super::rpc::parse_address(proxy) {
                if let Ok(owner) = read_admin_ext_owner(p, addr).await {
                    ext_owners.admin_ext_owner = Some(owner);
                    admin_status.owner = Some(format!("{:#x}", owner));
                }
            }
        }
    }
    if ext_owners.admin_ext_owner.is_none() {
        ext_owners.admin_ext_owner = admin_status
            .owner
            .as_deref()
            .and_then(|s| owner_from_payload_field(Some(s)));
    }

    let pacto_gov_status = LaunchpadComponentStatus {
        deployed: has_pacto_gov,
        deployed_address: pacto_gov_address,
        variant: if has_pacto_gov { Some("pacto_gov".to_string()) } else { None },
        address_owner: None,
        owner: None,
        hats_wired: None,
    };

    let has_sponsor = sponsor_status.deployed;
    let has_admin = admin_status.deployed;
    let hats_wired = sponsor_status.hats_wired.unwrap_or(false);
    let sponsor_is_ext = sponsor_status.variant.as_deref() == Some("ext");
    let unwired_ext = has_sponsor && sponsor_is_ext && !hats_wired;

    let gov_owner_ok = ext_owners.sponsor_address_owner.is_none()
        && ext_owners.admin_ext_owner.is_none()
        || {
            let mut ok = true;
            if let Some(o) = ext_owners.sponsor_address_owner {
                ok &= addresses_match(my_roster, Some(o));
            }
            if let Some(o) = ext_owners.admin_ext_owner {
                ok &= addresses_match(my_roster, Some(o));
            }
            ok
        };

    let sponsor_owner_ok = ext_owners
        .sponsor_address_owner
        .map(|o| addresses_match(my_roster, Some(o)))
        .unwrap_or(true);

    let mut options: Vec<LaunchpadDeployOption> = Vec::new();

    // Full governance
    let full_enabled = !has_pacto_gov && !has_sponsor && !has_admin;
    let (full_disabled_key, full_disabled_values) = if full_enabled {
        (None, None)
    } else {
        disabled_reason("governance.launchpad.reason.fullGovBlocked")
    };
    options.push(launchpad_option(
        "full-gov",
        false,
        full_enabled,
        full_disabled_key,
        full_disabled_values,
        None,
    ));

    // Pacto Gov
    let (pacto_gov_disabled_key, pacto_gov_disabled_values) = if has_pacto_gov {
        disabled_reason("governance.launchpad.reason.pactoGovAlreadyDeployed")
    } else if !gov_owner_ok {
        let mut req = Vec::new();
        if let Some(o) = ext_owners.sponsor_address_owner {
            req.push(o);
        }
        if let Some(o) = ext_owners.admin_ext_owner {
            req.push(o);
        }
        disabled_reason_with_addresses("governance.launchpad.reason.notInfraOwner", &req)
    } else {
        (None, None)
    };
    options.push(launchpad_option(
        "pacto-gov",
        has_pacto_gov,
        pacto_gov_disabled_key.is_none(),
        pacto_gov_disabled_key,
        pacto_gov_disabled_values,
        pacto_gov_status.deployed_address.clone(),
    ));

    // Squad Sponsor Ext create
    let (ext_sponsor_disabled_key, ext_sponsor_disabled_values) = if has_pacto_gov {
        disabled_reason("governance.launchpad.reason.extSponsorBeforeGovOnly")
    } else if has_sponsor {
        disabled_reason("governance.launchpad.reason.sponsorAlreadyDeployed")
    } else {
        (None, None)
    };
    options.push(launchpad_option(
        "sponsor-ext",
        has_sponsor,
        ext_sponsor_disabled_key.is_none(),
        ext_sponsor_disabled_key,
        ext_sponsor_disabled_values,
        sponsor_status.deployed_address.clone(),
    ));

    // Hats sponsor create (gov first, no unwired ext)
    let (hats_disabled_key, hats_disabled_values) = if !has_pacto_gov {
        disabled_reason("governance.launchpad.reason.deployGovBeforeHatsSponsor")
    } else if has_sponsor && hats_wired {
        disabled_reason("governance.launchpad.reason.sponsorAlreadyDeployed")
    } else if unwired_ext {
        disabled_reason("governance.launchpad.reason.wireExtSponsorInstead")
    } else {
        (None, None)
    };
    options.push(launchpad_option(
        "sponsor-hats",
        has_sponsor && hats_wired,
        hats_disabled_key.is_none(),
        hats_disabled_key,
        hats_disabled_values,
        if has_sponsor && hats_wired {
            sponsor_status.deployed_address.clone()
        } else {
            None
        },
    ));

    // Wire unwired Ext sponsor
    let (wire_disabled_key, wire_disabled_values) = if !has_pacto_gov {
        disabled_reason("governance.launchpad.reason.deployGovBeforeWire")
    } else if !unwired_ext {
        disabled_reason("governance.launchpad.reason.noUnwiredExtSponsor")
    } else if !sponsor_owner_ok {
        let o = ext_owners.sponsor_address_owner.unwrap_or(Address::ZERO);
        disabled_reason_with_addresses("governance.launchpad.reason.notSponsorOwner", &[o])
    } else {
        (None, None)
    };
    options.push(launchpad_option(
        "sponsor-wire",
        has_sponsor && hats_wired,
        wire_disabled_key.is_none(),
        wire_disabled_key,
        wire_disabled_values,
        sponsor_status.deployed_address.clone(),
    ));

    // Squad Admin Ext
    let (admin_disabled_key, admin_disabled_values) = if has_pacto_gov {
        disabled_reason("governance.launchpad.reason.squadAdminIncludedInGov")
    } else if has_admin {
        disabled_reason("governance.launchpad.reason.squadAdminAlreadyDeployed")
    } else {
        (None, None)
    };
    options.push(launchpad_option(
        "squad-admin-ext",
        has_admin,
        admin_disabled_key.is_none(),
        admin_disabled_key,
        admin_disabled_values,
        admin_status.deployed_address.clone(),
    ));

    Ok(SquadDeployLaunchpadState {
        my_roster_evm: my_roster.map(|a| format!("{:#x}", a)),
        pacto_gov: pacto_gov_status,
        sponsor: sponsor_status,
        admin: admin_status,
        options,
    })
}
