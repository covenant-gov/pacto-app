//! Read Treasury Authority proposals via `nextProposalId` then `proposal(id)`.

use alloy::primitives::{Address, U256};
use alloy::providers::Provider;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::CrewVoteMode;
use super::contracts::pacto_gov::read_bindings::ITreasuryAuthority::{
    crewVoteModeCall, hasVotedCall, nextProposalIdCall, proposalCall, quorumBpsCall, Operation,
};
use super::gov_read::connect_gov_read_provider;
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};

const HARD_MAX_SCAN: u32 = 256;

/// Exclusive `nextProposalId` → last id to read, capped.
fn proposal_scan_last_id(next: U256, hard_max: u32) -> u32 {
    if next <= U256::from(1u64) {
        return 0;
    }
    let last = next - U256::from(1u64);
    match u64::try_from(last) {
        Ok(n) => u32::try_from(n).unwrap_or(hard_max).min(hard_max),
        Err(_) => hard_max,
    }
}

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
    hard_max: u32,
) -> Result<Vec<TreasuryProposalDto>, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let next = eth_call_decode(provider, treasury_authority, &nextProposalIdCall {})
        .await
        .map_err(|e| wallet_err_json("PROPOSAL_READ", e, None))?;
    let last = proposal_scan_last_id(next, hard_max);

    let mut out = Vec::new();
    for id in 1..=last {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreasuryVoteConfigDto {
    pub crew_vote_mode: String,
    pub quorum_bps: u64,
}

pub(crate) fn crew_vote_mode_wire(mode: CrewVoteMode) -> &'static str {
    match mode {
        CrewVoteMode::QUORUM_OF_CAST => "quorum",
        CrewVoteMode::MAJORITY_SNAPSHOT | CrewVoteMode::__Invalid => "majority",
    }
}

#[tauri::command]
pub async fn get_treasury_vote_config<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    treasury_authority: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<TreasuryVoteConfigDto, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    let mode = eth_call_decode(&provider, ta, &crewVoteModeCall {})
        .await
        .map_err(|e| wallet_err_json("TA_READ", e, None))?;
    let bps = eth_call_decode(&provider, ta, &quorumBpsCall {})
        .await
        .map_err(|e| wallet_err_json("TA_READ", e, None))?;
    let quorum_bps = u64::try_from(bps).unwrap_or(u64::MAX);
    Ok(TreasuryVoteConfigDto {
        crew_vote_mode: crew_vote_mode_wire(mode).to_string(),
        quorum_bps,
    })
}

#[tauri::command]
pub async fn list_treasury_proposals<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    treasury_authority: String,
    max_scan: Option<u32>,
    rpc_urls: Option<Vec<String>>,
) -> Result<Vec<TreasuryProposalDto>, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let cap = max_scan.unwrap_or(HARD_MAX_SCAN).clamp(1, HARD_MAX_SCAN);

    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    list_treasury_proposals_on_chain(&provider, ta, cap).await
}

#[cfg(test)]
mod tests {
    use super::CrewVoteMode;
    use super::{crew_vote_mode_wire, proposal_scan_last_id};
    use alloy::primitives::U256;

    #[test]
    fn next_one_means_no_proposals() {
        assert_eq!(proposal_scan_last_id(U256::from(1u64), 256), 0);
        assert_eq!(proposal_scan_last_id(U256::ZERO, 256), 0);
    }

    #[test]
    fn next_three_reads_ids_one_and_two() {
        assert_eq!(proposal_scan_last_id(U256::from(3u64), 256), 2);
    }

    #[test]
    fn runaway_next_clamps_to_hard_max() {
        assert_eq!(proposal_scan_last_id(U256::from(10_000u64), 256), 256);
    }

    #[test]
    fn crew_vote_mode_wire_maps_quorum_and_majority() {
        assert_eq!(crew_vote_mode_wire(CrewVoteMode::QUORUM_OF_CAST), "quorum");
        assert_eq!(
            crew_vote_mode_wire(CrewVoteMode::MAJORITY_SNAPSHOT),
            "majority"
        );
    }
}

#[tauri::command]
pub async fn treasury_proposal_has_voted<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    treasury_authority: String,
    proposal_id: String,
    voter: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<bool, String> {
    let ta = parse_address(treasury_authority.trim())
        .map_err(|e| wallet_err_json("INVALID_TREASURY_AUTHORITY", e, None))?;
    let voter_addr =
        parse_address(voter.trim()).map_err(|e| wallet_err_json("INVALID_VOTER", e, None))?;
    let pid = U256::from_str_radix(proposal_id.trim(), 10)
        .map_err(|e| wallet_err_json("INVALID_PROPOSAL_ID", e.to_string(), None))?;

    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
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
