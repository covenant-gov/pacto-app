//! Read Treasury Authority proposals via sequential `proposal(id)` scans.

use alloy::primitives::{Address, U256};
use alloy::providers::Provider;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::ITreasuryAuthority::{
    hasVotedCall, proposalCall, Operation,
};
use super::gov_read::connect_gov_read_provider;
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};

const DEFAULT_MAX_SCAN: u32 = 64;
const HARD_MAX_SCAN: u32 = 256;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreasuryProposalDto {
    pub proposal_id: String,
    pub proposer: String,
    pub to: String,
    pub value_wei: String,
    pub operation: String,
    pub data_hex: String,
    pub deadline: u64,
    pub snapshot: u64,
    pub yeas: u64,
    pub nays: u64,
    pub captain_approved: bool,
    pub captain_defeated: bool,
    pub executed: bool,
    pub status: String,
}

fn operation_label(op: Operation) -> &'static str {
    match op {
        Operation::CALL => "call",
        Operation::DELEGATECALL => "delegatecall",
        Operation::__Invalid => "unknown",
    }
}

fn derive_proposal_status(
    executed: bool,
    captain_defeated: bool,
    deadline: u64,
    yeas: u64,
    nays: u64,
    snapshot: u64,
    now: u64,
) -> &'static str {
    if executed {
        return "executed";
    }
    if captain_defeated {
        return "captain_vetoed";
    }
    if now >= deadline {
        return "expired";
    }
    let crew_passed = if snapshot == 0 {
        false
    } else {
        yeas * 2 > snapshot || yeas > nays
    };
    if crew_passed {
        "active_passed_crew"
    } else {
        "active"
    }
}

pub async fn list_treasury_proposals_on_chain<P: Provider>(
    provider: &P,
    treasury_authority: Address,
    max_scan: u32,
) -> Result<Vec<TreasuryProposalDto>, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut out = Vec::new();
    for id in 1..=max_scan {
        let pid = U256::from(id);
        let decoded = eth_call_decode(provider, treasury_authority, &proposalCall { _id: pid })
            .await
            .map_err(|e| wallet_err_json("PROPOSAL_READ", e, None))?;

        if decoded._proposer.is_zero() {
            break;
        }

        out.push(TreasuryProposalDto {
            proposal_id: id.to_string(),
            proposer: format!("{:#x}", decoded._proposer),
            to: format!("{:#x}", decoded._to),
            value_wei: decoded._value.to_string(),
            operation: operation_label(decoded._op).to_string(),
            data_hex: format!("0x{}", hex::encode(decoded._data.as_ref())),
            deadline: decoded._deadline,
            snapshot: decoded._snapshot,
            yeas: decoded._yeas,
            nays: decoded._nays,
            captain_approved: decoded._captainApproved,
            captain_defeated: decoded._captainDefeated,
            executed: decoded._executed,
            status: derive_proposal_status(
                decoded._executed,
                decoded._captainDefeated,
                decoded._deadline,
                decoded._yeas,
                decoded._nays,
                decoded._snapshot,
                now,
            )
            .to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_treasury_proposals<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    treasury_authority: String,
    max_scan: Option<u32>,
) -> Result<Vec<TreasuryProposalDto>, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let scan = max_scan.unwrap_or(DEFAULT_MAX_SCAN).clamp(1, HARD_MAX_SCAN);

    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;
    list_treasury_proposals_on_chain(&provider, ta, scan).await
}

#[tauri::command]
pub async fn treasury_proposal_has_voted<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    treasury_authority: String,
    proposal_id: String,
    voter: String,
) -> Result<bool, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let voter_addr = parse_address(voter.trim())
        .map_err(|e| wallet_err_json("INVALID_VOTER", e, None))?;
    let pid = U256::from_str_radix(proposal_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_PROPOSAL_ID", e.to_string(), None))?;

    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;
    eth_call_decode(
        &provider,
        ta,
        &hasVotedCall {
            _proposalId: pid,
            _voter: voter_addr,
        },
    )
    .await
    .map_err(|e| wallet_err_json("VOTE_READ", e, None))
}
