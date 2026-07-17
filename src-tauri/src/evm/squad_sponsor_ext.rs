//! SquadSponsorExt address-list eligibility: read owner/permits + `setPermittedAddress`.

use alloy::primitives::Address;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorExt::{
    addressOwnerCall, hatsWiredCall, permittedAddressCall, setPermittedAddressCall,
};
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::{load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, parse_address,
    send_and_confirm, wallet_err_json,
};
use super::squad_sponsor_common::{require_parent_member, resolve_sponsor_for_parent};
use super::wallet_chain_config;

/// Ext exposes only a single-address `permittedAddress` view, so each member costs one
/// eth_call; cap the fan-out per status call.
const MAX_MEMBER_PERMIT_LOOKUPS: usize = 64;

/// Valid, deduped member addresses to check, capped at the RPC fan-out limit.
/// The bool flags whether valid addresses beyond the cap were skipped.
fn member_lookup_list(member_addresses: &[String]) -> (Vec<Address>, bool) {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for raw in member_addresses {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let addr = match parse_address(trimmed) {
            Ok(a) if !a.is_zero() => a,
            _ => continue,
        };
        if !seen.insert(addr) {
            continue;
        }
        if out.len() == MAX_MEMBER_PERMIT_LOOKUPS {
            return (out, true);
        }
        out.push(addr);
    }
    (out, false)
}

fn encode_set_permitted_address(member: &str, permitted: bool) -> Result<Vec<u8>, String> {
    let addr = parse_address(member.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    if addr.is_zero() {
        return Err(wallet_err_json(
            "INVALID_ADDRESS",
            "member address must be non-zero",
            None,
        ));
    }
    Ok(setPermittedAddressCall {
        member: addr,
        permitted,
    }
    .abi_encode())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorExtMemberPermit {
    pub address: String,
    pub permitted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorExtStatus {
    pub chain: String,
    pub chain_id: u64,
    pub parent_id: String,
    pub sponsor_address: String,
    pub address_owner: String,
    pub hats_wired: bool,
    pub member_permits: Vec<SquadSponsorExtMemberPermit>,
    pub member_permits_truncated: bool,
}

/// Ext has only a single-address permit view: member lookups stop at the fan-out cap and set
/// `memberPermitsTruncated`; callers with larger rosters page `member_addresses` in chunks.
#[tauri::command]
pub async fn get_squad_sponsor_ext_status<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    member_addresses: Vec<String>,
    sponsor_address: Option<String>,
) -> Result<SquadSponsorExtStatus, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }
    require_parent_member(&app, pid).await?;

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    let provider = connect_read_provider(&urls).await?;
    let sponsor = resolve_sponsor_for_parent(
        &provider,
        addrs.squad_sponsor_factory,
        pid,
        sponsor_address.as_deref(),
    )
    .await?;

    let owner: Address = eth_call_decode(&provider, sponsor, &addressOwnerCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    let hats_wired: bool = eth_call_decode(&provider, sponsor, &hatsWiredCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;

    let (members, member_permits_truncated) = member_lookup_list(&member_addresses);
    let mut member_permits = Vec::with_capacity(members.len());
    for addr in members {
        let permitted: bool =
            eth_call_decode(&provider, sponsor, &permittedAddressCall { member: addr })
                .await
                .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
        member_permits.push(SquadSponsorExtMemberPermit {
            address: format!("{:#x}", addr),
            permitted,
        });
    }

    Ok(SquadSponsorExtStatus {
        chain: net.key.clone(),
        chain_id: net.chain_id,
        parent_id: pid.to_string(),
        sponsor_address: format!("{:#x}", sponsor),
        address_owner: format!("{:#x}", owner),
        hats_wired,
        member_permits,
        member_permits_truncated,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorSetPermittedResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub sponsor_address: String,
    pub member_address: String,
    pub permitted: bool,
}

#[tauri::command]
pub async fn squad_sponsor_set_permitted_address<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    member_address: String,
    permitted: bool,
    sponsor_address: Option<String>,
) -> Result<SquadSponsorSetPermittedResult, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    let read_provider = connect_read_provider(&urls).await?;
    let sponsor = resolve_sponsor_for_parent(
        &read_provider,
        addrs.squad_sponsor_factory,
        pid,
        sponsor_address.as_deref(),
    )
    .await?;

    let hats_wired: bool = eth_call_decode(&read_provider, sponsor, &hatsWiredCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    if hats_wired {
        return Err(wallet_err_json(
            "SPONSOR_HATS_WIRED",
            "address-list sponsorship is closed after hats wiring",
            None,
        ));
    }

    let owner: Address = eth_call_decode(&read_provider, sponsor, &addressOwnerCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;

    require_roster_treasury_signing_allowed(app.clone(), pid).await?;
    let (signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;
    if signer.address() != owner {
        return Err(wallet_err_json(
            "NOT_SPONSOR_OWNER",
            "only the squad sponsor address owner can update permitted addresses",
            None,
        ));
    }

    let member = parse_address(member_address.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    if member.is_zero() {
        return Err(wallet_err_json(
            "INVALID_ADDRESS",
            "member address must be non-zero",
            None,
        ));
    }
    let roster = crate::db::list_squad_member_evm(app.clone(), pid.to_string(), None)?;
    let member_on_roster = roster.iter().any(|row| {
        parse_address(row.evm_address.as_str())
            .map(|a| a == member)
            .unwrap_or(false)
    });
    if !member_on_roster {
        return Err(wallet_err_json(
            "INVALID_ADDRESS",
            "permitted address must be a squad-assigned roster EVM for a member of this parent",
            None,
        ));
    }
    let calldata = encode_set_permitted_address(member_address.as_str(), permitted)?;

    let provider = connect_signing_provider(&urls, wallet).await?;
    let tx = contract_call_request(sponsor, calldata);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for setPermittedAddress confirmation.",
    )
    .await?;

    Ok(SquadSponsorSetPermittedResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        chain: net.key.clone(),
        chain_id: net.chain_id,
        sponsor_address: format!("{:#x}", sponsor),
        member_address: format!("{:#x}", member),
        permitted,
    })
}

#[cfg(test)]
mod tests {
    use super::encode_set_permitted_address;
    use alloy::sol_types::SolCall;
    use crate::evm::contracts::pacto_sponsor::ISquadSponsorExt::setPermittedAddressCall;
    use crate::evm::rpc::parse_address;

    const ADDR: &str = "0x1111111111111111111111111111111111111111";

    #[test]
    fn encode_set_permitted_address_matches_sol() {
        let encoded = encode_set_permitted_address(ADDR, true).expect("encode");
        assert_eq!(
            encoded,
            setPermittedAddressCall {
                member: parse_address(ADDR).unwrap(),
                permitted: true,
            }
            .abi_encode()
        );
        assert!(encode_set_permitted_address("bad", true).is_err());
        assert!(encode_set_permitted_address(
            "0x0000000000000000000000000000000000000000",
            true
        )
        .is_err());
    }
}
