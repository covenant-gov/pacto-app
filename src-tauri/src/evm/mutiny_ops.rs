//! Mutiny module reads and writes.

use alloy::primitives::U256;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::access_control::GovCapability;
use super::contracts::pacto_gov::read_bindings::IMutinyModule::{
    activeMutinyIdCall, captainCall, captainResignCall, castVoteCall, executeMutinyCall,
    expireMutinyCall, hasVotedCall, mutinyCall, startMutinyToArbitraryContractCall,
    startMutinyToArbitraryEoaCall, startMutinyToCommitteeCall, startMutinyToCrewMemberCall,
    startMutinyToPauseCaptainCall,
};
use super::gov_module_write::{resolve_parent_id_for_module, send_gov_module_call};
use super::gov_read::connect_gov_read_provider;
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};

fn parse_mutiny_id(raw: &str) -> Result<U256, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(wallet_err_json(
            "INVALID_MUTINY_ID",
            "mutiny id is required",
            None,
        ));
    }
    U256::from_str_radix(trimmed, 10)
        .map_err(|e| wallet_err_json("INVALID_MUTINY_ID", e.to_string(), None))
}

fn encode_start_to_crew_member(proposed: &str) -> Result<Vec<u8>, String> {
    let addr =
        parse_address(proposed.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(startMutinyToCrewMemberCall {
        _proposedCrewMember: addr,
    }
    .abi_encode())
}

fn encode_cast_vote(mutiny_id: &str) -> Result<Vec<u8>, String> {
    let mid = parse_mutiny_id(mutiny_id)?;
    Ok(castVoteCall { _mutinyId: mid }.abi_encode())
}

fn encode_execute_mutiny(mutiny_id: &str) -> Result<Vec<u8>, String> {
    let mid = parse_mutiny_id(mutiny_id)?;
    Ok(executeMutinyCall { _mutinyId: mid }.abi_encode())
}

fn encode_expire_mutiny(mutiny_id: &str) -> Result<Vec<u8>, String> {
    let mid = parse_mutiny_id(mutiny_id)?;
    Ok(expireMutinyCall { _mutinyId: mid }.abi_encode())
}

#[derive(Clone, Copy)]
enum MutinyWriteKind {
    Expire,
    Execute,
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Chain snapshot vs submitted id. `None` means the write may proceed.
fn classify_mutiny_round_preflight(
    submitted: U256,
    active: U256,
    executed: bool,
    deadline: u64,
    now_secs: u64,
    kind: MutinyWriteKind,
) -> Option<(&'static str, &'static str)> {
    if active.is_zero() || active != submitted || executed {
        return Some(("MUTINY_NOT_ACTIVE", "no active mutiny matching this id"));
    }
    match kind {
        MutinyWriteKind::Expire if now_secs < deadline => {
            Some(("MUTINY_NOT_EXPIRED", "mutiny voting window is still open"))
        }
        MutinyWriteKind::Execute if deadline > 0 && now_secs >= deadline => {
            Some(("MUTINY_EXPIRED", "mutiny deadline has passed"))
        }
        _ => None,
    }
}

async fn preflight_mutiny_write(
    network: &str,
    mutiny_module: &str,
    mutiny_id: &str,
    kind: MutinyWriteKind,
    rpc_urls: Option<Vec<String>>,
) -> Result<(), String> {
    let submitted = parse_mutiny_id(mutiny_id)?;
    let module = parse_address(mutiny_module.trim())
        .map_err(|e| wallet_err_json("INVALID_MUTINY", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network, rpc_urls).await?;
    let active: U256 = eth_call_decode(&provider, module, &activeMutinyIdCall {})
        .await
        .map_err(|e| wallet_err_json("MUTINY_READ", e, None))?;
    if active.is_zero() || active != submitted {
        return Err(wallet_err_json(
            "MUTINY_NOT_ACTIVE",
            "no active mutiny matching this id",
            None,
        ));
    }
    let m = eth_call_decode(&provider, module, &mutinyCall { _id: active })
        .await
        .map_err(|e| wallet_err_json("MUTINY_READ", e, None))?;
    if let Some((code, msg)) = classify_mutiny_round_preflight(
        submitted,
        active,
        m._executed,
        m._deadline,
        unix_now_secs(),
        kind,
    ) {
        return Err(wallet_err_json(code, msg, None));
    }
    Ok(())
}

fn encode_captain_resign(new_captain: &str) -> Result<Vec<u8>, String> {
    let addr = parse_address(new_captain.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(captainResignCall { _newCaptain: addr }.abi_encode())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutinyStatusDto {
    pub active_mutiny_id: String,
    pub proposed_new_captain: String,
    pub from_captain: String,
    pub started_at: u64,
    pub deadline: u64,
    pub snapshot: u64,
    pub yeas: u64,
    pub executed: bool,
    pub captain: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutinyWriteResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub mutiny_module: String,
    pub funded_by: String,
}

#[tauri::command]
pub async fn get_mutiny_status<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    mutiny_module: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyStatusDto, String> {
    let module = parse_address(mutiny_module.trim())
        .map_err(|e| wallet_err_json("INVALID_MUTINY", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;

    let active_id: U256 = eth_call_decode(&provider, module, &activeMutinyIdCall {})
        .await
        .map_err(|e| wallet_err_json("MUTINY_READ", e, None))?;
    let captain = eth_call_decode(&provider, module, &captainCall {})
        .await
        .map_err(|e| wallet_err_json("MUTINY_READ", e, None))?;

    if active_id.is_zero() {
        return Ok(MutinyStatusDto {
            active_mutiny_id: "0".into(),
            proposed_new_captain: String::new(),
            from_captain: String::new(),
            started_at: 0,
            deadline: 0,
            snapshot: 0,
            yeas: 0,
            executed: false,
            captain: format!("{:#x}", captain),
        });
    }

    let m = eth_call_decode(&provider, module, &mutinyCall { _id: active_id })
        .await
        .map_err(|e| wallet_err_json("MUTINY_READ", e, None))?;

    Ok(MutinyStatusDto {
        active_mutiny_id: active_id.to_string(),
        proposed_new_captain: format!("{:#x}", m._proposedNewCaptain),
        from_captain: format!("{:#x}", m._fromCaptain),
        started_at: m._startedAt,
        deadline: m._deadline,
        snapshot: m._snapshot,
        yeas: m._yeas,
        executed: m._executed,
        captain: format!("{:#x}", captain),
    })
}

#[tauri::command]
pub async fn mutiny_has_voted<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    mutiny_module: String,
    mutiny_id: String,
    voter: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<bool, String> {
    let module = parse_address(mutiny_module.trim())
        .map_err(|e| wallet_err_json("INVALID_MUTINY", e, None))?;
    let voter_addr =
        parse_address(voter.trim()).map_err(|e| wallet_err_json("INVALID_VOTER", e, None))?;
    let mid = U256::from_str_radix(mutiny_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_MUTINY_ID", e.to_string(), None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    eth_call_decode(
        &provider,
        module,
        &hasVotedCall {
            _mutinyId: mid,
            _voter: voter_addr,
        },
    )
    .await
    .map_err(|e| wallet_err_json("MUTINY_VOTE_READ", e, None))
}

async fn mutiny_write<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    calldata: Vec<u8>,
    capability: GovCapability,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let module = parse_address(mutiny_module.trim())
        .map_err(|e| wallet_err_json("INVALID_MUTINY", e, None))?;
    let parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", module))?;
    let (tx_hash, chain, chain_id, funded_by) =
        send_gov_module_call(app, network, parent, module, calldata, capability, rpc_urls).await?;
    Ok(MutinyWriteResult {
        tx_hash,
        chain,
        chain_id,
        mutiny_module: format!("{:#x}", module),
        funded_by,
    })
}

#[tauri::command]
pub async fn mutiny_start_to_crew_member<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let calldata = encode_start_to_crew_member(&proposed)?;
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::StartMutiny,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_start_to_committee<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let addr =
        parse_address(proposed.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = startMutinyToCommitteeCall {
        _proposedMultisigCommittee: addr,
    }
    .abi_encode();
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::StartMutiny,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_start_to_arbitrary_eoa<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let addr =
        parse_address(proposed.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = startMutinyToArbitraryEoaCall {
        _proposedArbitraryEoa: addr,
    }
    .abi_encode();
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::StartMutiny,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_start_to_arbitrary_contract<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let addr =
        parse_address(proposed.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = startMutinyToArbitraryContractCall {
        _proposedArbitraryContract: addr,
    }
    .abi_encode();
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::StartMutiny,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_start_to_pause_captain<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let calldata = startMutinyToPauseCaptainCall {}.abi_encode();
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::StartMutiny,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_cast_vote<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    mutiny_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let calldata = encode_cast_vote(&mutiny_id)?;
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::CastMutinyVote,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_execute<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    mutiny_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let calldata = encode_execute_mutiny(&mutiny_id)?;
    preflight_mutiny_write(
        network.as_str(),
        mutiny_module.as_str(),
        mutiny_id.as_str(),
        MutinyWriteKind::Execute,
        rpc_urls.clone(),
    )
    .await?;
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::ExecuteMutiny,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_expire<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    mutiny_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let calldata = encode_expire_mutiny(&mutiny_id)?;
    preflight_mutiny_write(
        network.as_str(),
        mutiny_module.as_str(),
        mutiny_id.as_str(),
        MutinyWriteKind::Expire,
        rpc_urls.clone(),
    )
    .await?;
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::ExecuteMutiny,
        rpc_urls,
    )
    .await
}

#[tauri::command]
pub async fn mutiny_captain_resign<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    new_captain: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<MutinyWriteResult, String> {
    let calldata = encode_captain_resign(&new_captain)?;
    mutiny_write(
        app,
        network,
        parent_id,
        mutiny_module,
        calldata,
        GovCapability::CaptainResign,
        rpc_urls,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        classify_mutiny_round_preflight, encode_captain_resign, encode_cast_vote,
        encode_execute_mutiny, encode_expire_mutiny, encode_start_to_crew_member, parse_mutiny_id,
        MutinyWriteKind,
    };
    use crate::evm::contracts::pacto_gov::read_bindings::IMutinyModule::{
        captainResignCall, castVoteCall, executeMutinyCall, expireMutinyCall,
        startMutinyToCrewMemberCall,
    };
    use crate::evm::rpc::parse_address;
    use alloy::primitives::U256;
    use alloy::sol_types::SolCall;

    const ADDR: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn parse_mutiny_id_decimal_only() {
        assert_eq!(parse_mutiny_id("42").unwrap(), U256::from(42u64));
        assert_eq!(parse_mutiny_id(" 7 ").unwrap(), U256::from(7u64));
        assert!(parse_mutiny_id("0x1").is_err());
        assert!(parse_mutiny_id("").is_err());
    }

    #[test]
    fn start_cast_execute_encode_selectors() {
        let start = encode_start_to_crew_member(ADDR).expect("start");
        assert_eq!(
            start,
            startMutinyToCrewMemberCall {
                _proposedCrewMember: parse_address(ADDR).unwrap(),
            }
            .abi_encode()
        );
        assert!(encode_start_to_crew_member("bad").is_err());

        let vote = encode_cast_vote("3").expect("vote");
        assert_eq!(
            vote,
            castVoteCall {
                _mutinyId: U256::from(3u64),
            }
            .abi_encode()
        );
        assert!(encode_cast_vote("nope").is_err());

        let exec = encode_execute_mutiny("9").expect("exec");
        assert_eq!(
            exec,
            executeMutinyCall {
                _mutinyId: U256::from(9u64),
            }
            .abi_encode()
        );

        let expire = encode_expire_mutiny("9").expect("expire");
        assert_eq!(
            expire,
            expireMutinyCall {
                _mutinyId: U256::from(9u64),
            }
            .abi_encode()
        );
        assert_ne!(expire, exec);
        assert!(encode_expire_mutiny("nope").is_err());
    }

    #[test]
    fn preflight_rejects_cleared_or_mismatched_round() {
        let nine = U256::from(9u64);
        assert_eq!(
            classify_mutiny_round_preflight(
                nine,
                U256::ZERO,
                false,
                100,
                200,
                MutinyWriteKind::Expire
            )
            .map(|p| p.0),
            Some("MUTINY_NOT_ACTIVE")
        );
        assert_eq!(
            classify_mutiny_round_preflight(
                nine,
                U256::from(3u64),
                false,
                100,
                200,
                MutinyWriteKind::Expire
            )
            .map(|p| p.0),
            Some("MUTINY_NOT_ACTIVE")
        );
        assert_eq!(
            classify_mutiny_round_preflight(nine, nine, true, 100, 200, MutinyWriteKind::Expire)
                .map(|p| p.0),
            Some("MUTINY_NOT_ACTIVE")
        );
        assert_eq!(
            classify_mutiny_round_preflight(nine, nine, false, 200, 100, MutinyWriteKind::Expire)
                .map(|p| p.0),
            Some("MUTINY_NOT_EXPIRED")
        );
        assert_eq!(
            classify_mutiny_round_preflight(nine, nine, false, 100, 200, MutinyWriteKind::Execute)
                .map(|p| p.0),
            Some("MUTINY_EXPIRED")
        );
        assert!(classify_mutiny_round_preflight(
            nine,
            nine,
            false,
            100,
            200,
            MutinyWriteKind::Expire
        )
        .is_none());
        assert!(classify_mutiny_round_preflight(
            nine,
            nine,
            false,
            200,
            100,
            MutinyWriteKind::Execute
        )
        .is_none());
    }

    #[test]
    fn captain_resign_encodes_new_captain() {
        let encoded = encode_captain_resign(ADDR).expect("resign");
        assert_eq!(
            encoded,
            captainResignCall {
                _newCaptain: parse_address(ADDR).unwrap(),
            }
            .abi_encode()
        );
        assert!(encode_captain_resign("0xzz").is_err());
    }
}
