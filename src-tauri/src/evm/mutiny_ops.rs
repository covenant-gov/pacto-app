//! Mutiny module reads and writes.

use alloy::primitives::U256;
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::IMutinyModule::{
    activeMutinyIdCall, captainCall, captainResignCall, castVoteCall, executeMutinyCall,
    hasVotedCall, mutinyCall, startMutinyToArbitraryContractCall, startMutinyToArbitraryEoaCall,
    startMutinyToCommitteeCall, startMutinyToCrewMemberCall, startMutinyToPauseCaptainCall,
};
use super::gov_module_write::{resolve_parent_id_for_module, send_gov_module_call};
use super::gov_read::connect_gov_read_provider;
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutinyStatusDto {
    pub active_mutiny_id: String,
    pub proposed_new_captain: String,
    pub started_at: u64,
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
}

#[tauri::command]
pub async fn get_mutiny_status<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    mutiny_module: String,
) -> Result<MutinyStatusDto, String> {
    let module = parse_address(mutiny_module.trim())
        .map_err(|e| wallet_err_json("INVALID_MUTINY", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;

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
            started_at: 0,
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
        started_at: m._startedAt,
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
) -> Result<bool, String> {
    let module = parse_address(mutiny_module.trim())
        .map_err(|e| wallet_err_json("INVALID_MUTINY", e, None))?;
    let voter_addr =
        parse_address(voter.trim()).map_err(|e| wallet_err_json("INVALID_VOTER", e, None))?;
    let mid = U256::from_str_radix(mutiny_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_MUTINY_ID", e.to_string(), None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;
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
) -> Result<MutinyWriteResult, String> {
    let module = parse_address(mutiny_module.trim())
        .map_err(|e| wallet_err_json("INVALID_MUTINY", e, None))?;
    let parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", module))?;
    let (tx_hash, chain, chain_id) =
        send_gov_module_call(app, network, parent, module, calldata).await?;
    Ok(MutinyWriteResult {
        tx_hash,
        chain,
        chain_id,
        mutiny_module: format!("{:#x}", module),
    })
}

#[tauri::command]
pub async fn mutiny_start_to_crew_member<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
) -> Result<MutinyWriteResult, String> {
    let addr = parse_address(proposed.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = startMutinyToCrewMemberCall {
        _proposedCrewMember: addr,
    }
    .abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}

#[tauri::command]
pub async fn mutiny_start_to_committee<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
) -> Result<MutinyWriteResult, String> {
    let addr = parse_address(proposed.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = startMutinyToCommitteeCall {
        _proposedMultisigCommittee: addr,
    }
    .abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}

#[tauri::command]
pub async fn mutiny_start_to_arbitrary_eoa<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
) -> Result<MutinyWriteResult, String> {
    let addr = parse_address(proposed.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = startMutinyToArbitraryEoaCall {
        _proposedArbitraryEoa: addr,
    }
    .abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}

#[tauri::command]
pub async fn mutiny_start_to_arbitrary_contract<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    proposed: String,
) -> Result<MutinyWriteResult, String> {
    let addr = parse_address(proposed.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = startMutinyToArbitraryContractCall {
        _proposedArbitraryContract: addr,
    }
    .abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}

#[tauri::command]
pub async fn mutiny_start_to_pause_captain<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
) -> Result<MutinyWriteResult, String> {
    let calldata = startMutinyToPauseCaptainCall {}.abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}

#[tauri::command]
pub async fn mutiny_cast_vote<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    mutiny_id: String,
) -> Result<MutinyWriteResult, String> {
    let mid = U256::from_str_radix(mutiny_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_MUTINY_ID", e.to_string(), None))?;
    let calldata = castVoteCall { _mutinyId: mid }.abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}

#[tauri::command]
pub async fn mutiny_execute<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    mutiny_id: String,
) -> Result<MutinyWriteResult, String> {
    let mid = U256::from_str_radix(mutiny_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_MUTINY_ID", e.to_string(), None))?;
    let calldata = executeMutinyCall { _mutinyId: mid }.abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}

#[tauri::command]
pub async fn mutiny_captain_resign<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    mutiny_module: String,
    new_captain: String,
) -> Result<MutinyWriteResult, String> {
    let addr = parse_address(new_captain.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    let calldata = captainResignCall { _newCaptain: addr }.abi_encode();
    mutiny_write(app, network, parent_id, mutiny_module, calldata).await
}
