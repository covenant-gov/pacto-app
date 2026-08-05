//! SquadSponsorExt address-list eligibility: read owner/permits + `setPermittedAddress`.

use alloy::primitives::Address;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorExt::{
    addressOwnerCall, hatsWiredCall, permittedAddressCall, setPermittedAddressCall,
};
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::{
    load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, parse_address,
    send_and_confirm, wallet_err_json,
};
use super::squad_sponsor_common::{require_parent_member, resolve_sponsor_for_parent};
use super::squad_sponsor_deposit::{require_network_config, require_non_empty_parent_id};

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

/// Permit edits close once hats eligibility is wired on-chain.
fn ensure_hats_not_wired(hats_wired: bool) -> Result<(), String> {
    if hats_wired {
        return Err(wallet_err_json(
            "SPONSOR_HATS_WIRED",
            "address-list sponsorship is closed after hats wiring",
            None,
        ));
    }
    Ok(())
}

/// Only the on-chain address owner may edit the permit list.
fn ensure_signer_is_sponsor_owner(signer: Address, owner: Address) -> Result<(), String> {
    if signer != owner {
        return Err(wallet_err_json(
            "NOT_SPONSOR_OWNER",
            "only the squad sponsor address owner can update permitted addresses",
            None,
        ));
    }
    Ok(())
}

/// Parsed member address; rejects malformed and zero addresses.
fn parse_member_address(raw: &str) -> Result<Address, String> {
    let addr =
        parse_address(raw.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    if addr.is_zero() {
        return Err(wallet_err_json(
            "INVALID_ADDRESS",
            "member address must be non-zero",
            None,
        ));
    }
    Ok(addr)
}

/// Permitted addresses must be squad-assigned roster EVMs; unparseable roster rows are ignored.
fn roster_contains_member<'a>(roster: impl Iterator<Item = &'a str>, member: Address) -> bool {
    roster
        .filter_map(|raw| parse_address(raw).ok())
        .any(|a| a == member)
}

fn encode_set_permitted_address(member: &str, permitted: bool) -> Result<Vec<u8>, String> {
    let addr = parse_member_address(member)?;
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
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadSponsorExtStatus, String> {
    let pid = require_non_empty_parent_id(&parent_id)?;
    require_parent_member(&app, pid).await?;

    let net = require_network_config(&network)?;

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
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
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadSponsorSetPermittedResult, String> {
    let pid = require_non_empty_parent_id(&parent_id)?;

    let net = require_network_config(&network)?;

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
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
    ensure_hats_not_wired(hats_wired)?;

    let owner: Address = eth_call_decode(&read_provider, sponsor, &addressOwnerCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;

    require_roster_treasury_signing_allowed(app.clone(), pid).await?;
    let (signer, wallet) = load_squad_roster_embedded_signer(app.clone(), pid).await?;
    ensure_signer_is_sponsor_owner(signer.address(), owner)?;

    let member = parse_member_address(&member_address)?;
    let roster = crate::db::list_squad_member_evm(app.clone(), pid.to_string(), None)?;
    if !roster_contains_member(roster.iter().map(|row| row.evm_address.as_str()), member) {
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
    use super::*;

    fn err_code(err: &str) -> String {
        serde_json::from_str::<serde_json::Value>(err)
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(String::from))
            .unwrap_or_default()
    }

    const ADDR_A: &str = "0x1111111111111111111111111111111111111111";
    const ADDR_B: &str = "0x2222222222222222222222222222222222222222";
    const ZERO: &str = "0x0000000000000000000000000000000000000000";

    fn addr_str(byte: u8) -> String {
        format!("0x{:0>40}", format!("{:02x}", byte).repeat(20))
    }

    #[test]
    fn encode_set_permitted_address_matches_sol() {
        let encoded = encode_set_permitted_address(ADDR_A, true).expect("encode");
        assert_eq!(
            encoded,
            setPermittedAddressCall {
                member: parse_address(ADDR_A).unwrap(),
                permitted: true,
            }
            .abi_encode()
        );
    }

    #[test]
    fn member_lookup_list_skips_empty_invalid_and_zero() {
        let input = vec![
            String::new(),
            "   ".to_string(),
            "not-an-address".to_string(),
            ZERO.to_string(),
            ADDR_A.to_string(),
        ];
        let (members, truncated) = member_lookup_list(&input);
        assert_eq!(members, vec![parse_address(ADDR_A).unwrap()]);
        assert!(!truncated);
    }

    #[test]
    fn member_lookup_list_dedupes_case_insensitively() {
        const HEXY: &str = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
        let input = vec![
            HEXY.to_string(),
            HEXY.to_uppercase().replacen("0X", "0x", 1),
            format!("  {HEXY}  "),
        ];
        let (members, truncated) = member_lookup_list(&input);
        assert_eq!(members, vec![parse_address(HEXY).unwrap()]);
        assert!(!truncated);
    }

    #[test]
    fn member_lookup_list_caps_at_max_and_flags_truncation() {
        let input: Vec<String> = (1u8..=65).map(addr_str).collect();
        let (members, truncated) = member_lookup_list(&input);
        assert_eq!(members.len(), MAX_MEMBER_PERMIT_LOOKUPS);
        assert!(truncated);
        assert_eq!(members[0], parse_address(&addr_str(1)).unwrap());

        let exact: Vec<String> = (1u8..=64).map(addr_str).collect();
        let (members, truncated) = member_lookup_list(&exact);
        assert_eq!(members.len(), MAX_MEMBER_PERMIT_LOOKUPS);
        assert!(!truncated);
    }

    #[test]
    fn ensure_hats_not_wired_gates_permit_edits() {
        assert!(ensure_hats_not_wired(false).is_ok());
        let err = ensure_hats_not_wired(true).unwrap_err();
        assert_eq!(err_code(&err), "SPONSOR_HATS_WIRED");
    }

    #[test]
    fn ensure_signer_is_sponsor_owner_rejects_non_owner() {
        let owner = parse_address(ADDR_A).unwrap();
        assert!(ensure_signer_is_sponsor_owner(owner, owner).is_ok());
        let err =
            ensure_signer_is_sponsor_owner(parse_address(ADDR_B).unwrap(), owner).unwrap_err();
        assert_eq!(err_code(&err), "NOT_SPONSOR_OWNER");
    }

    #[test]
    fn parse_member_address_rejects_malformed_and_zero() {
        assert!(parse_member_address(ADDR_A).is_ok());
        assert!(parse_member_address(&format!("  {ADDR_A}  ")).is_ok());
        let err = parse_member_address("bad").unwrap_err();
        assert_eq!(err_code(&err), "INVALID_ADDRESS");
        let err = parse_member_address(ZERO).unwrap_err();
        assert_eq!(err_code(&err), "INVALID_ADDRESS");
    }

    #[test]
    fn roster_contains_member_matches_only_roster_evm_addresses() {
        let member = parse_address(ADDR_A).unwrap();
        let roster = vec![
            "garbage".to_string(),
            ADDR_B.to_string(),
            ADDR_A.to_string(),
        ];
        assert!(roster_contains_member(
            roster.iter().map(|s| s.as_str()),
            member
        ));
        let other = vec![ADDR_B.to_string()];
        assert!(!roster_contains_member(
            other.iter().map(|s| s.as_str()),
            member
        ));
        let empty: Vec<String> = vec![];
        assert!(!roster_contains_member(
            empty.iter().map(|s| s.as_str()),
            member
        ));
    }

    #[test]
    fn ext_status_serializes_camel_case_with_truncation_flag() {
        let status = SquadSponsorExtStatus {
            chain: "sepolia".to_string(),
            chain_id: 11155111,
            parent_id: "squad-1".to_string(),
            sponsor_address: ADDR_A.to_string(),
            address_owner: ADDR_B.to_string(),
            hats_wired: false,
            member_permits: vec![SquadSponsorExtMemberPermit {
                address: ADDR_A.to_string(),
                permitted: true,
            }],
            member_permits_truncated: true,
        };
        let v = serde_json::to_value(&status).expect("serialize");
        assert_eq!(v.get("hatsWired").and_then(|x| x.as_bool()), Some(false));
        assert_eq!(
            v.get("memberPermitsTruncated").and_then(|x| x.as_bool()),
            Some(true)
        );
        assert!(v.get("member_permits_truncated").is_none());
        assert_eq!(
            v.get("memberPermits")
                .and_then(|x| x.as_array())
                .map(|a| a.len()),
            Some(1)
        );
    }
}
