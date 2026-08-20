//! Quartermaster crew roster reads and writes.

use alloy::primitives::{Address, U256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::access_control::GovCapability;
use super::contracts::hats::IHats::hatSupplyCall;
use super::contracts::pacto_gov::read_bindings::IQuartermaster::{
    activeCrewOffboardIdCall, bootstrapCrewCall, cancelAddCrewCall, cancelRemoveCrewCall,
    crewChangeDelayCall, crewHatIdCall, crewOffboardCall, crewOffboardExpiryCall,
    crewOffboardQuorumBpsCall, crewOffboardVoteCall, executeAddCrewCall, executeOffboardCall,
    executeRemoveCrewCall, expireOffboardCall, hasCrewOffboardVoteCall, mutinyActiveCall,
    pendingAddsCall, pendingCrewAddAtCall, pendingCrewRemoveAtCall, pendingRemovesCall,
    proposeOffboardCall, requestAddCrewCall, requestRemoveCrewCall,
};
use super::gov_module_write::{resolve_parent_id_for_module, send_gov_module_call};
use super::gov_read::connect_gov_read_provider;
use super::pacto_chain_config;
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};
use super::squad_sponsor_common::require_parent_member;

fn encode_request_add_crew(candidate: &str) -> Result<Vec<u8>, String> {
    let addr =
        parse_address(candidate.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(requestAddCrewCall { _candidate: addr }.abi_encode())
}

fn encode_bootstrap_crew(candidates: &[String]) -> Result<Vec<u8>, String> {
    if candidates.is_empty() {
        return Err(wallet_err_json(
            "INVALID_CANDIDATES",
            "Select at least one squad member to bootstrap as crew.",
            None,
        ));
    }
    let mut addrs = Vec::with_capacity(candidates.len());
    for raw in candidates {
        let addr =
            parse_address(raw.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
        addrs.push(addr);
    }
    Ok(bootstrapCrewCall { _candidates: addrs }.abi_encode())
}

fn encode_execute_add_crew(candidate: &str) -> Result<Vec<u8>, String> {
    let addr =
        parse_address(candidate.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(executeAddCrewCall { _candidate: addr }.abi_encode())
}

fn encode_request_remove_crew(crew: &str) -> Result<Vec<u8>, String> {
    let addr =
        parse_address(crew.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(requestRemoveCrewCall { _crew: addr }.abi_encode())
}

fn parse_offboard_id(raw: &str) -> Result<U256, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(wallet_err_json(
            "INVALID_OFFBOARD_ID",
            "offboard id is required",
            None,
        ));
    }
    U256::from_str_radix(trimmed, 10)
        .map_err(|e| wallet_err_json("INVALID_OFFBOARD_ID", e.to_string(), None))
}

fn encode_propose_offboard(target: &str) -> Result<Vec<u8>, String> {
    let addr =
        parse_address(target.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(proposeOffboardCall { _target: addr }.abi_encode())
}

fn encode_crew_offboard_vote(offboard_id: &str, support: bool) -> Result<Vec<u8>, String> {
    let id = parse_offboard_id(offboard_id)?;
    Ok(crewOffboardVoteCall {
        _offboardId: id,
        _support: support,
    }
    .abi_encode())
}

fn encode_execute_offboard(offboard_id: &str) -> Result<Vec<u8>, String> {
    let id = parse_offboard_id(offboard_id)?;
    Ok(executeOffboardCall { _offboardId: id }.abi_encode())
}

fn encode_expire_offboard(offboard_id: &str) -> Result<Vec<u8>, String> {
    let id = parse_offboard_id(offboard_id)?;
    Ok(expireOffboardCall { _offboardId: id }.abi_encode())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrewOffboardDto {
    pub offboard_id: String,
    pub target: String,
    pub proposer: String,
    pub deadline: u64,
    pub snapshot: u64,
    pub yeas: u64,
    pub nays: u64,
    pub executed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterStatusDto {
    pub crew_change_delay_secs: String,
    pub mutiny_active: bool,
    pub crew_hat_supply: Option<u32>,
    pub bootstrap_available: Option<bool>,
    pub active_crew_offboard_id: String,
    pub crew_offboard_expiry_secs: String,
    pub crew_offboard_quorum_bps: String,
    pub offboard: Option<CrewOffboardDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterPendingDto {
    pub address: String,
    pub pending_add_at: String,
    pub pending_remove_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QmPendingKind {
    Add,
    Remove,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterPendingActionDto {
    /// `"add"` or `"remove"`.
    pub kind: String,
    pub address: String,
    pub executable_at: String,
}

fn zip_pending(
    kind: QmPendingKind,
    addrs: Vec<Address>,
    executable_ats: Vec<U256>,
) -> Vec<(QmPendingKind, Address, U256)> {
    addrs
        .into_iter()
        .zip(executable_ats)
        .map(|(addr, executable_at)| (kind, addr, executable_at))
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterWriteResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub quartermaster: String,
    pub funded_by: String,
}

#[tauri::command]
pub async fn get_quartermaster_status<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    quartermaster: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterStatusDto, String> {
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    let delay = eth_call_decode(&provider, qm, &crewChangeDelayCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let mutiny_active = eth_call_decode(&provider, qm, &mutinyActiveCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let offboard_id: U256 = eth_call_decode(&provider, qm, &activeCrewOffboardIdCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let offboard_expiry = eth_call_decode(&provider, qm, &crewOffboardExpiryCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let offboard_quorum = eth_call_decode(&provider, qm, &crewOffboardQuorumBpsCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;

    let offboard = if offboard_id.is_zero() {
        None
    } else {
        let row = eth_call_decode(&provider, qm, &crewOffboardCall { _id: offboard_id })
            .await
            .map_err(|e| wallet_err_json("QM_READ", e, None))?;
        Some(CrewOffboardDto {
            offboard_id: offboard_id.to_string(),
            target: format!("{:#x}", row._target),
            proposer: format!("{:#x}", row._proposer),
            deadline: row._deadline,
            snapshot: row._snapshot,
            yeas: row._yeas,
            nays: row._nays,
            executed: row._executed,
        })
    };

    let crew_hat_id = eth_call_decode(&provider, qm, &crewHatIdCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let net_key = network.to_lowercase();
    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net_key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let hats = addrs.hats.ok_or_else(|| {
        wallet_err_json(
            "HATS_CONFIG",
            "PACTO_HATS is not configured for this network",
            None,
        )
    })?;
    let supply: u32 = eth_call_decode(
        &provider,
        hats,
        &hatSupplyCall {
            _hatId: crew_hat_id,
        },
    )
    .await
    .map_err(|e| wallet_err_json("QM_READ", e, None))?;

    Ok(QuartermasterStatusDto {
        crew_change_delay_secs: delay.to_string(),
        mutiny_active,
        crew_hat_supply: Some(supply),
        bootstrap_available: Some(supply == 0 && !mutiny_active && offboard_id.is_zero()),
        active_crew_offboard_id: offboard_id.to_string(),
        crew_offboard_expiry_secs: offboard_expiry.to_string(),
        crew_offboard_quorum_bps: offboard_quorum.to_string(),
        offboard,
    })
}

#[tauri::command]
pub async fn get_quartermaster_pending<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    quartermaster: String,
    address: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterPendingDto, String> {
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let addr =
        parse_address(address.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    let add_at = eth_call_decode(&provider, qm, &pendingCrewAddAtCall { _candidate: addr })
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let remove_at = eth_call_decode(&provider, qm, &pendingCrewRemoveAtCall { _crew: addr })
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    Ok(QuartermasterPendingDto {
        address: format!("{:#x}", addr),
        pending_add_at: add_at.to_string(),
        pending_remove_at: remove_at.to_string(),
    })
}

/// True when two address strings match after trim + ASCII case fold.
#[cfg(test)]
fn addresses_equal_normalized(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Keep nonzero `executable_at` rows and sort for stable UI ordering.
fn fold_qm_pending_verifies(
    rows: impl IntoIterator<Item = (QmPendingKind, Address, U256)>,
) -> Vec<QuartermasterPendingActionDto> {
    let mut out = Vec::new();
    for (kind, addr, executable_at) in rows {
        if executable_at.is_zero() {
            continue;
        }
        out.push(QuartermasterPendingActionDto {
            kind: match kind {
                QmPendingKind::Add => "add".into(),
                QmPendingKind::Remove => "remove".into(),
            },
            address: format!("{:#x}", addr),
            executable_at: executable_at.to_string(),
        });
    }
    out.sort_by(|a, b| {
        a.executable_at
            .cmp(&b.executable_at)
            .then_with(|| a.address.cmp(&b.address))
            .then_with(|| a.kind.cmp(&b.kind))
    });
    out
}

/// List pending crew add/remove from on-chain enumerable views.
#[tauri::command]
pub async fn list_quartermaster_pending<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<Vec<QuartermasterPendingActionDto>, String> {
    require_parent_member(&app, &parent_id).await?;
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let _parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", qm))?;

    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    let adds = eth_call_decode(&provider, qm, &pendingAddsCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let removes = eth_call_decode(&provider, qm, &pendingRemovesCall {})
        .await
        .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    Ok(fold_qm_pending_verifies(
        zip_pending(QmPendingKind::Add, adds._candidates, adds._executableAts)
            .into_iter()
            .chain(zip_pending(
                QmPendingKind::Remove,
                removes._crew,
                removes._executableAts,
            )),
    ))
}

async fn qm_write<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    calldata: Vec<u8>,
    capability: GovCapability,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", qm))?;
    let (tx_hash, chain, chain_id, funded_by) =
        send_gov_module_call(app, network, parent, qm, calldata, capability, rpc_urls).await?;
    Ok(QuartermasterWriteResult {
        tx_hash,
        chain,
        chain_id,
        quartermaster: format!("{:#x}", qm),
        funded_by,
    })
}

#[tauri::command]
pub async fn quartermaster_request_add_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidate: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_request_add_crew(&candidate)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_cancel_add_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidate: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let addr =
        parse_address(candidate.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = cancelAddCrewCall { _candidate: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_execute_add_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidate: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_execute_add_crew(&candidate)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterExecute,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_bootstrap_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    candidates: Vec<String>,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_bootstrap_crew(&candidates)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_request_remove_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    crew: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_request_remove_crew(&crew)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_cancel_remove_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    crew: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let addr =
        parse_address(crew.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = cancelRemoveCrewCall { _crew: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterMutateCrew,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_execute_remove_crew<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    crew: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let addr =
        parse_address(crew.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = executeRemoveCrewCall { _crew: addr }.abi_encode();
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::QuartermasterExecute,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn crew_offboard_has_voted<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    quartermaster: String,
    offboard_id: String,
    voter: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<bool, String> {
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    let voter_addr =
        parse_address(voter.trim()).map_err(|e| wallet_err_json("INVALID_VOTER", e, None))?;
    let id = parse_offboard_id(&offboard_id)?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    eth_call_decode(
        &provider,
        qm,
        &hasCrewOffboardVoteCall {
            _offboardId: id,
            _voter: voter_addr,
        },
    )
    .await
    .map_err(|e| wallet_err_json("QM_READ", e, None))
}

#[tauri::command]
pub async fn quartermaster_propose_offboard<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    target: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_propose_offboard(&target)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::ProposeCrewOffboard,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_crew_offboard_vote<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    offboard_id: String,
    support: bool,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_crew_offboard_vote(&offboard_id, support)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::CastCrewOffboardVote,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_execute_offboard<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    offboard_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_execute_offboard(&offboard_id)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::ExecuteCrewOffboard,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn quartermaster_expire_offboard<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    offboard_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<QuartermasterWriteResult, String> {
    let calldata = encode_expire_offboard(&offboard_id)?;
    qm_write(
        app,
        network,
        parent_id,
        quartermaster,
        calldata,
        GovCapability::ExecuteCrewOffboard,
        rpc_urls,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        addresses_equal_normalized, encode_bootstrap_crew, encode_crew_offboard_vote,
        encode_execute_add_crew, encode_execute_offboard, encode_expire_offboard,
        encode_propose_offboard, encode_request_add_crew, encode_request_remove_crew,
        fold_qm_pending_verifies, parse_offboard_id, zip_pending, QmPendingKind,
    };
    use crate::evm::contracts::pacto_gov::read_bindings::IQuartermaster::{
        bootstrapCrewCall, crewOffboardVoteCall, executeAddCrewCall, executeOffboardCall,
        expireOffboardCall, proposeOffboardCall, requestAddCrewCall, requestRemoveCrewCall,
    };
    use crate::evm::rpc::parse_address;
    use alloy::primitives::U256;
    use alloy::sol_types::SolCall;

    const ADDR_A: &str = "0x1111111111111111111111111111111111111111";
    const ADDR_B: &str = "0x2222222222222222222222222222222222222222";

    #[test]
    fn request_add_crew_encodes_selector_and_address() {
        let encoded = encode_request_add_crew(ADDR_A).expect("encode");
        let expected = requestAddCrewCall {
            _candidate: parse_address(ADDR_A).unwrap(),
        }
        .abi_encode();
        assert_eq!(encoded, expected);
        assert!(encode_request_add_crew("not-an-address").is_err());
    }

    #[test]
    fn execute_and_remove_encode_expected_calls() {
        let add = encode_execute_add_crew(ADDR_A).expect("add");
        assert_eq!(
            add,
            executeAddCrewCall {
                _candidate: parse_address(ADDR_A).unwrap(),
            }
            .abi_encode()
        );
        let rem = encode_request_remove_crew(ADDR_B).expect("remove");
        assert_eq!(
            rem,
            requestRemoveCrewCall {
                _crew: parse_address(ADDR_B).unwrap(),
            }
            .abi_encode()
        );
    }

    #[test]
    fn bootstrap_crew_rejects_empty_and_encodes_batch() {
        assert!(encode_bootstrap_crew(&[]).is_err());
        assert!(encode_bootstrap_crew(&[String::from("bad")]).is_err());
        let encoded = encode_bootstrap_crew(&[ADDR_A.into(), ADDR_B.into()]).expect("encode");
        let expected = bootstrapCrewCall {
            _candidates: vec![
                parse_address(ADDR_A).unwrap(),
                parse_address(ADDR_B).unwrap(),
            ],
        }
        .abi_encode();
        assert_eq!(encoded, expected);
        assert!(encoded.len() > 4);
    }

    #[test]
    fn zip_pending_pairs_addresses_with_etas() {
        let a = parse_address(ADDR_A).unwrap();
        let b = parse_address(ADDR_B).unwrap();
        let rows = zip_pending(
            QmPendingKind::Add,
            vec![a, b],
            vec![U256::from(10u64), U256::from(20u64)],
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (QmPendingKind::Add, a, U256::from(10u64)));
        assert_eq!(rows[1], (QmPendingKind::Add, b, U256::from(20u64)));
    }

    #[test]
    fn zip_pending_empty_is_empty() {
        assert!(zip_pending(QmPendingKind::Remove, vec![], vec![]).is_empty());
    }

    #[test]
    fn addresses_equal_normalized_trims_and_ignores_case() {
        assert!(addresses_equal_normalized(
            " 0xAbCDEF0000000000000000000000000000000001 ",
            "0xabcdef0000000000000000000000000000000001"
        ));
        assert!(!addresses_equal_normalized(ADDR_A, ADDR_B));
    }

    #[test]
    fn fold_qm_pending_verifies_drops_zero_and_sorts() {
        let a = parse_address(ADDR_A).unwrap();
        let b = parse_address(ADDR_B).unwrap();
        let out = fold_qm_pending_verifies([
            (QmPendingKind::Add, a, U256::ZERO),
            (QmPendingKind::Remove, b, U256::from(50u64)),
            (QmPendingKind::Add, a, U256::from(10u64)),
        ]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].kind, "add");
        assert_eq!(out[0].executable_at, "10");
        assert_eq!(out[1].kind, "remove");
        assert_eq!(out[1].executable_at, "50");
    }

    #[test]
    fn offboard_encodes_propose_vote_execute_expire() {
        assert_eq!(parse_offboard_id("4").unwrap(), U256::from(4u64));
        assert!(parse_offboard_id("").is_err());
        assert!(parse_offboard_id("0x1").is_err());

        let propose = encode_propose_offboard(ADDR_A).expect("propose");
        assert_eq!(
            propose,
            proposeOffboardCall {
                _target: parse_address(ADDR_A).unwrap(),
            }
            .abi_encode()
        );
        assert!(encode_propose_offboard("bad").is_err());

        let vote = encode_crew_offboard_vote("3", true).expect("vote");
        assert_eq!(
            vote,
            crewOffboardVoteCall {
                _offboardId: U256::from(3u64),
                _support: true,
            }
            .abi_encode()
        );
        let nay = encode_crew_offboard_vote("3", false).expect("nay");
        assert_ne!(vote, nay);

        let exec = encode_execute_offboard("3").expect("exec");
        assert_eq!(
            exec,
            executeOffboardCall {
                _offboardId: U256::from(3u64),
            }
            .abi_encode()
        );
        let expire = encode_expire_offboard("3").expect("expire");
        assert_eq!(
            expire,
            expireOffboardCall {
                _offboardId: U256::from(3u64),
            }
            .abi_encode()
        );
        assert_ne!(exec, expire);
    }
}
