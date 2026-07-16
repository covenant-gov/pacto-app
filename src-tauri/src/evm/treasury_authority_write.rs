//! Treasury Authority write path: propose, crewVote, captainVote, execute.

use alloy::primitives::{Bytes, U256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::ITreasuryAuthority::{
    captainVoteCall, crewVoteCall, executeCall, proposeCall, Operation,
};
use super::access_control::GovCapability;
use super::gov_module_write::{resolve_parent_id_for_module, send_gov_module_call};
use super::rpc::{parse_address, wallet_err_json};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreasuryAuthorityWriteResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub treasury_authority: String,
}

fn parse_operation(raw: &str) -> Result<Operation, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "call" | "" => Ok(Operation::CALL),
        "delegatecall" => Ok(Operation::DELEGATECALL),
        other => Err(format!("unsupported operation: {other}")),
    }
}

fn parse_data_hex(raw: &str) -> Result<Bytes, String> {
    let s = raw.trim();
    if s.is_empty() || s == "0x" {
        return Ok(Bytes::new());
    }
    let hex_body = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(hex_body).map_err(|e| format!("invalid data hex: {e}"))?;
    Ok(Bytes::from(bytes))
}

#[tauri::command]
pub async fn treasury_authority_propose<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    treasury_authority: String,
    to: String,
    value_wei: String,
    data_hex: String,
    operation: String,
) -> Result<TreasuryAuthorityWriteResult, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let target =
        parse_address(to.trim()).map_err(|e| wallet_err_json("INVALID_TARGET", e, None))?;
    let value = U256::from_str_radix(value_wei.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_VALUE", e.to_string(), None))?;
    let data = parse_data_hex(data_hex.as_str())
        .map_err(|e| wallet_err_json("INVALID_DATA", e, None))?;
    let op = parse_operation(operation.as_str())
        .map_err(|e| wallet_err_json("INVALID_OPERATION", e, None))?;

    let pid = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", ta))?;
    let calldata = proposeCall {
        _to: target,
        _value: value,
        _data: data,
        _op: op,
    }
    .abi_encode();
    let (tx_hash, chain, chain_id) = send_gov_module_call(
        app,
        network,
        pid,
        ta,
        calldata,
        GovCapability::ProposeTreasury,
    )
    .await?;
    Ok(TreasuryAuthorityWriteResult {
        tx_hash,
        chain,
        chain_id,
        treasury_authority: format!("{:#x}", ta),
    })
}

#[tauri::command]
pub async fn treasury_authority_crew_vote<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    treasury_authority: String,
    proposal_id: String,
    support: bool,
) -> Result<TreasuryAuthorityWriteResult, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let pid_u = U256::from_str_radix(proposal_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_PROPOSAL_ID", e.to_string(), None))?;
    let parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", ta))?;
    let calldata = crewVoteCall {
        _proposalId: pid_u,
        _support: support,
    }
    .abi_encode();
    let (tx_hash, chain, chain_id) = send_gov_module_call(
        app,
        network,
        parent,
        ta,
        calldata,
        GovCapability::CrewVote,
    )
    .await?;
    Ok(TreasuryAuthorityWriteResult {
        tx_hash,
        chain,
        chain_id,
        treasury_authority: format!("{:#x}", ta),
    })
}

#[tauri::command]
pub async fn treasury_authority_captain_vote<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    treasury_authority: String,
    proposal_id: String,
    support: bool,
) -> Result<TreasuryAuthorityWriteResult, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let pid_u = U256::from_str_radix(proposal_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_PROPOSAL_ID", e.to_string(), None))?;
    let parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", ta))?;
    let calldata = captainVoteCall {
        _proposalId: pid_u,
        _support: support,
    }
    .abi_encode();
    let (tx_hash, chain, chain_id) = send_gov_module_call(
        app,
        network,
        parent,
        ta,
        calldata,
        GovCapability::CaptainVote,
    )
    .await?;
    Ok(TreasuryAuthorityWriteResult {
        tx_hash,
        chain,
        chain_id,
        treasury_authority: format!("{:#x}", ta),
    })
}

#[tauri::command]
pub async fn treasury_authority_execute<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    treasury_authority: String,
    proposal_id: String,
) -> Result<TreasuryAuthorityWriteResult, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let pid_u = U256::from_str_radix(proposal_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_PROPOSAL_ID", e.to_string(), None))?;
    let parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", ta))?;
    let calldata = executeCall {
        _proposalId: pid_u,
    }
    .abi_encode();
    let (tx_hash, chain, chain_id) = send_gov_module_call(
        app,
        network,
        parent,
        ta,
        calldata,
        GovCapability::ExecuteTreasury,
    )
    .await?;
    Ok(TreasuryAuthorityWriteResult {
        tx_hash,
        chain,
        chain_id,
        treasury_authority: format!("{:#x}", ta),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_data_hex, parse_operation};

    #[test]
    fn parse_operation_accepts_call_and_delegatecall() {
        assert!(parse_operation("call").is_ok());
        assert!(parse_operation("").is_ok());
        assert!(parse_operation("DELEGATECALL").is_ok());
        assert!(parse_operation("create").is_err());
    }

    #[test]
    fn parse_data_hex_empty_and_valid() {
        assert!(parse_data_hex("0x").unwrap().is_empty());
        assert!(parse_data_hex("").unwrap().is_empty());
        assert_eq!(parse_data_hex("0xabcd").unwrap().as_ref(), &[0xab, 0xcd]);
        assert!(parse_data_hex("0xzz").is_err());
    }
}
