//! Quartermaster crew roster reads and writes.

use std::collections::HashSet;

use alloy::primitives::{Address, B256, U256};
use alloy::rpc::types::Log;
use alloy::sol_types::{SolCall, SolEvent};
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::access_control::GovCapability;
use super::contracts::hats::IHats::hatSupplyCall;
use super::contracts::pacto_gov::read_bindings::IQuartermaster::{
    bootstrapCrewCall, cancelAddCrewCall, cancelRemoveCrewCall, crewChangeDelayCall,
    crewHatIdCall, executeAddCrewCall, executeRemoveCrewCall, mutinyActiveCall,
    pendingCrewAddAtCall, pendingCrewRemoveAtCall, requestAddCrewCall, requestRemoveCrewCall,
    CrewAddCancelled, CrewAddExecuted, CrewAddRequested, CrewRemoveCancelled, CrewRemoveExecuted,
    CrewRemoveRequested,
};
use super::gov_module_write::{resolve_parent_id_for_module, send_gov_module_call};
use super::gov_read::connect_gov_read_provider;
use super::pacto_chain_config;
use super::rpc::logs::{
    get_logs_chunked, resolve_lookback_range, DEFAULT_LOG_CHUNK_BLOCKS, DEFAULT_LOG_LOOKBACK_BLOCKS,
};
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};
use super::squad_sponsor_common::require_parent_member;

fn encode_request_add_crew(candidate: &str) -> Result<Vec<u8>, String> {
    let addr = parse_address(candidate.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
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
        let addr = parse_address(raw.trim())
            .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
        addrs.push(addr);
    }
    Ok(bootstrapCrewCall {
        _candidates: addrs,
    }
    .abi_encode())
}

fn encode_execute_add_crew(candidate: &str) -> Result<Vec<u8>, String> {
    let addr = parse_address(candidate.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(executeAddCrewCall { _candidate: addr }.abi_encode())
}

fn encode_request_remove_crew(crew: &str) -> Result<Vec<u8>, String> {
    let addr = parse_address(crew.trim()).map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
    Ok(requestRemoveCrewCall { _crew: addr }.abi_encode())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterStatusDto {
    pub crew_change_delay_secs: String,
    pub mutiny_active: bool,
    pub crew_hat_supply: Option<u32>,
    pub bootstrap_available: Option<bool>,
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

fn qm_crew_lifecycle_topic0s() -> [B256; 6] {
    [
        CrewAddRequested::SIGNATURE_HASH,
        CrewAddCancelled::SIGNATURE_HASH,
        CrewAddExecuted::SIGNATURE_HASH,
        CrewRemoveRequested::SIGNATURE_HASH,
        CrewRemoveCancelled::SIGNATURE_HASH,
        CrewRemoveExecuted::SIGNATURE_HASH,
    ]
}

/// Fold Quartermaster lifecycle logs into candidate address sets (Requested − Cancelled/Executed).
fn collect_qm_pending_candidates_from_logs(logs: &[Log]) -> (HashSet<Address>, HashSet<Address>) {
    let mut adds = HashSet::new();
    let mut removes = HashSet::new();
    for log in logs {
        let topics = log.topics();
        let data = log.data().data.as_ref();
        if let Ok(ev) = CrewAddRequested::decode_raw_log(topics, data) {
            adds.insert(ev._candidate);
            continue;
        }
        if let Ok(ev) = CrewAddCancelled::decode_raw_log(topics, data) {
            adds.remove(&ev._candidate);
            continue;
        }
        if let Ok(ev) = CrewAddExecuted::decode_raw_log(topics, data) {
            adds.remove(&ev._candidate);
            continue;
        }
        if let Ok(ev) = CrewRemoveRequested::decode_raw_log(topics, data) {
            removes.insert(ev._crew);
            continue;
        }
        if let Ok(ev) = CrewRemoveCancelled::decode_raw_log(topics, data) {
            removes.remove(&ev._crew);
            continue;
        }
        if let Ok(ev) = CrewRemoveExecuted::decode_raw_log(topics, data) {
            removes.remove(&ev._crew);
        }
    }
    (adds, removes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuartermasterWriteResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub quartermaster: String,
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
        bootstrap_available: Some(supply == 0 && !mutiny_active),
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
    let add_at = eth_call_decode(
        &provider,
        qm,
        &pendingCrewAddAtCall { _candidate: addr },
    )
    .await
    .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    let remove_at = eth_call_decode(
        &provider,
        qm,
        &pendingCrewRemoveAtCall { _crew: addr },
    )
    .await
    .map_err(|e| wallet_err_json("QM_READ", e, None))?;
    Ok(QuartermasterPendingDto {
        address: format!("{:#x}", addr),
        pending_add_at: add_at.to_string(),
        pending_remove_at: remove_at.to_string(),
    })
}

/// True when two address strings match after trim + ASCII case fold.
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

/// Discover still-pending crew add/remove via QM event logs, verified with `pending*At` views.
#[tauri::command]
pub async fn list_quartermaster_pending<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    quartermaster: String,
    from_block: Option<u64>,
    rpc_urls: Option<Vec<String>>,
) -> Result<Vec<QuartermasterPendingActionDto>, String> {
    require_parent_member(&app, &parent_id).await?;
    let qm = parse_address(quartermaster.trim())
        .map_err(|e| wallet_err_json("INVALID_QUARTERMASTER", e, None))?;
    // Bind quartermaster address to this parent via stored infra (rejects mismatches).
    let _parent = resolve_parent_id_for_module(&app, parent_id.as_str(), &format!("{:#x}", qm))?;

    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    let (from, to) =
        resolve_lookback_range(&provider, from_block, DEFAULT_LOG_LOOKBACK_BLOCKS).await?;
    let logs = get_logs_chunked(
        &provider,
        qm,
        from,
        to,
        DEFAULT_LOG_CHUNK_BLOCKS,
        Some(&qm_crew_lifecycle_topic0s()),
    )
    .await?;
    let (add_addrs, remove_addrs) = collect_qm_pending_candidates_from_logs(&logs);

    let candidates: Vec<(QmPendingKind, Address)> = add_addrs
        .into_iter()
        .map(|a| (QmPendingKind::Add, a))
        .chain(remove_addrs.into_iter().map(|a| (QmPendingKind::Remove, a)))
        .collect();

    let verifies = futures_util::future::join_all(candidates.into_iter().map(|(kind, addr)| {
        let provider = provider.clone();
        async move {
            let executable_at: U256 = match kind {
                QmPendingKind::Add => eth_call_decode(
                    &provider,
                    qm,
                    &pendingCrewAddAtCall { _candidate: addr },
                )
                .await
                .map_err(|e| wallet_err_json("QM_READ", e, None))?,
                QmPendingKind::Remove => eth_call_decode(
                    &provider,
                    qm,
                    &pendingCrewRemoveAtCall { _crew: addr },
                )
                .await
                .map_err(|e| wallet_err_json("QM_READ", e, None))?,
            };
            Ok::<_, String>((kind, addr, executable_at))
        }
    }))
    .await;

    let mut rows = Vec::with_capacity(verifies.len());
    for row in verifies {
        rows.push(row?);
    }
    Ok(fold_qm_pending_verifies(rows))
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
    let (tx_hash, chain, chain_id) =
        send_gov_module_call(app, network, parent, qm, calldata, capability, rpc_urls).await?;
    Ok(QuartermasterWriteResult {
        tx_hash,
        chain,
        chain_id,
        quartermaster: format!("{:#x}", qm),
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
    let addr = parse_address(candidate.trim())
        .map_err(|e| wallet_err_json("INVALID_ADDRESS", e, None))?;
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

#[cfg(test)]
mod tests {
    use super::{
        addresses_equal_normalized, collect_qm_pending_candidates_from_logs, encode_bootstrap_crew,
        encode_execute_add_crew, encode_request_add_crew, encode_request_remove_crew,
        fold_qm_pending_verifies, qm_crew_lifecycle_topic0s, QmPendingKind,
    };
    use alloy::primitives::{keccak256, Address, U256};
    use alloy::rpc::types::Log;
    use alloy::sol_types::{SolCall, SolEvent};
    use crate::evm::contracts::pacto_gov::read_bindings::IQuartermaster::{
        bootstrapCrewCall, executeAddCrewCall, requestAddCrewCall, requestRemoveCrewCall,
        CrewAddCancelled, CrewAddExecuted, CrewAddRequested, CrewRemoveRequested,
    };
    use crate::evm::rpc::parse_address;

    const ADDR_A: &str = "0x1111111111111111111111111111111111111111";
    const ADDR_B: &str = "0x2222222222222222222222222222222222222222";

    fn log_from_event<E: SolEvent>(event: E) -> Log {
        Log {
            inner: alloy::primitives::Log {
                address: Address::ZERO,
                data: event.encode_log_data(),
            },
            ..Default::default()
        }
    }

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
    fn crew_lifecycle_topic0s_match_event_signatures() {
        let topics = qm_crew_lifecycle_topic0s();
        assert_eq!(topics.len(), 6);
        assert_eq!(
            topics[0],
            keccak256("CrewAddRequested(address,uint256)")
        );
        assert_eq!(topics[1], keccak256("CrewAddCancelled(address)"));
        assert_eq!(topics[2], keccak256("CrewAddExecuted(address)"));
        assert_eq!(
            topics[3],
            keccak256("CrewRemoveRequested(address,uint256)")
        );
        assert_eq!(topics[4], keccak256("CrewRemoveCancelled(address)"));
        assert_eq!(topics[5], keccak256("CrewRemoveExecuted(address)"));
    }

    #[test]
    fn pending_candidates_track_request_cancel_and_execute() {
        let a = parse_address(ADDR_A).unwrap();
        let b = parse_address(ADDR_B).unwrap();
        let logs = vec![
            log_from_event(CrewAddRequested {
                _candidate: a,
                _executableAt: U256::from(100u64),
            }),
            log_from_event(CrewRemoveRequested {
                _crew: b,
                _executableAt: U256::from(200u64),
            }),
            log_from_event(CrewAddCancelled { _candidate: a }),
            log_from_event(CrewAddRequested {
                _candidate: a,
                _executableAt: U256::from(300u64),
            }),
            log_from_event(CrewAddExecuted { _candidate: a }),
        ];
        let (adds, removes) = collect_qm_pending_candidates_from_logs(&logs);
        assert!(adds.is_empty());
        assert_eq!(removes.len(), 1);
        assert!(removes.contains(&b));
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
}
