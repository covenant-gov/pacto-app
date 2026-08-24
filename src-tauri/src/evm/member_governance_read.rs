//! Hat wearer and Squad Admin executor reads for Settings tab columns.

use std::collections::{HashMap, HashSet};

use alloy::eips::BlockNumberOrTag;
use alloy::primitives::{Address, B256, TxHash, U256};
use alloy::providers::Provider;
use alloy::rpc::types::Filter;
use alloy::sol_types::SolEvent;
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use super::contracts::hats::IHats::{isWearerOfHatCall, TransferHat};
use super::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    hasExecutorRoleCall, isExecutorFullPermissionCall, isExecutorPausedCall,
};
use super::gov_read::{connect_gov_read_provider, parse_top_hat_id, resolve_gov_read_network};
use super::pacto_chain_config;
use super::rpc::{
    call::eth_call_decode, connect_read_provider, is_retryable_gov_rpc_error, parse_address,
    wallet_err_json,
};

fn bytes32_tag(label: &str) -> B256 {
    let mut buf = [0u8; 32];
    let b = label.as_bytes();
    let n = b.len().min(32);
    buf[..n].copy_from_slice(&b[..n]);
    B256::from(buf)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HatCheckInput {
    pub hat_id: String,
    pub label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberHatAssignmentDto {
    pub address: String,
    pub hats: Vec<MemberHatLabelDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberHatLabelDto {
    pub hat_id: String,
    pub label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadAdminExecutorRolesDto {
    pub address: String,
    pub full_permission: bool,
    pub paused: bool,
    pub roles: Vec<SquadAdminRoleFlagDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadAdminRoleFlagDto {
    pub role: String,
    pub enabled: bool,
}

async fn is_wearer<P: Provider>(
    provider: &P,
    hats: Address,
    user: Address,
    hat_id: U256,
) -> Result<bool, String> {
    eth_call_decode(
        provider,
        hats,
        &isWearerOfHatCall {
            _user: user,
            _hatId: hat_id,
        },
    )
    .await
    .map_err(|e| wallet_err_json("HATS_WEARER", e, None))
}

#[tauri::command]
pub async fn get_member_hat_wearers<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    hats_contract: Option<String>,
    member_addresses: Vec<String>,
    hat_checks: Vec<HatCheckInput>,
    rpc_urls: Option<Vec<String>>,
) -> Result<Vec<MemberHatAssignmentDto>, String> {
    let net_key = network.to_lowercase();
    let hats = if let Some(raw) = hats_contract
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parse_address(raw).map_err(|e| wallet_err_json("INVALID_HATS", e, None))?
    } else {
        let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net_key)
            .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
        addrs.hats.ok_or_else(|| {
            wallet_err_json(
                "HATS_CONFIG",
                "PACTO_HATS is not configured for this network",
                None,
            )
        })?
    };

    let checks: Vec<(U256, String)> = hat_checks
        .into_iter()
        .filter_map(|c| {
            U256::from_str_radix(c.hat_id.trim(), 10)
                .ok()
                .map(|id| (id, c.label.trim().to_string()))
        })
        .collect();

    let ctx = resolve_gov_read_network(network.as_str(), rpc_urls)?;
    let urls = ctx.rpc_urls.clone();
    let mut url_idx = 0usize;
    let mut provider = connect_read_provider(&urls[url_idx..]).await?;

    const WEARER_CHUNK: usize = 16;
    #[derive(Clone)]
    struct WearerPair {
        addr: Address,
        hat_id: U256,
        label: String,
    }

    let mut pairs: Vec<WearerPair> = Vec::new();
    let mut ordered: Vec<Address> = Vec::new();
    let mut seen = HashSet::new();
    for raw in member_addresses {
        let addr = match parse_address(raw.trim()) {
            Ok(a) => a,
            Err(_) => continue,
        };
        if !seen.insert(addr) {
            continue;
        }
        ordered.push(addr);
        for (hat_id, label) in &checks {
            pairs.push(WearerPair {
                addr,
                hat_id: *hat_id,
                label: label.clone(),
            });
        }
    }

    let mut worn: HashMap<Address, Vec<MemberHatLabelDto>> = HashMap::new();
    for chunk in pairs.chunks(WEARER_CHUNK) {
        let mut pending = chunk.to_vec();
        while !pending.is_empty() {
            let futs = pending.iter().cloned().map(|pair| {
                let provider = provider.clone();
                async move {
                    let result = is_wearer(&provider, hats, pair.addr, pair.hat_id).await;
                    (pair, result)
                }
            });
            let results = join_all(futs).await;
            let mut retry = Vec::new();
            let mut need_failover = false;
            for (pair, result) in results {
                match result {
                    Ok(true) => {
                        worn.entry(pair.addr).or_default().push(MemberHatLabelDto {
                            hat_id: pair.hat_id.to_string(),
                            label: pair.label,
                        });
                    }
                    Ok(false) => {}
                    Err(e) if is_retryable_gov_rpc_error(&e) => {
                        need_failover = true;
                        retry.push(pair);
                    }
                    Err(_) => {}
                }
            }
            if !need_failover {
                break;
            }
            url_idx = url_idx.saturating_add(1);
            if url_idx >= urls.len() {
                break;
            }
            match connect_read_provider(&urls[url_idx..]).await {
                Ok(p) => {
                    provider = p;
                    pending = retry;
                }
                Err(_) => break,
            }
        }
    }

    let mut out = Vec::new();
    for addr in ordered {
        out.push(MemberHatAssignmentDto {
            address: format!("{:#x}", addr),
            hats: worn.remove(&addr).unwrap_or_default(),
        });
    }

    Ok(out)
}

/// Check standard SquadAdmin sentinel roles for one executor address.
#[tauri::command]
pub async fn get_squad_admin_executor_roles<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    squad_admin_proxy: String,
    executor_address: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAdminExecutorRolesDto, String> {
    let admin = parse_address(squad_admin_proxy.trim())
        .map_err(|e| wallet_err_json("INVALID_SQUAD_ADMIN", e, None))?;
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;

    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;

    let full: bool = eth_call_decode(
        &provider,
        admin,
        &isExecutorFullPermissionCall { _executor: exec },
    )
    .await
    .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;

    let paused: bool = eth_call_decode(&provider, admin, &isExecutorPausedCall { _executor: exec })
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;

    let role_tags = ["FULL", "PAUSE"];
    let mut roles = Vec::new();
    for tag in role_tags {
        let role = bytes32_tag(tag);
        let enabled: bool = eth_call_decode(
            &provider,
            admin,
            &hasExecutorRoleCall {
                _executor: exec,
                _role: role,
            },
        )
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
        roles.push(SquadAdminRoleFlagDto {
            role: tag.to_string(),
            enabled,
        });
    }

    Ok(SquadAdminExecutorRolesDto {
        address: format!("{:#x}", exec),
        full_permission: full,
        paused,
        roles,
    })
}

const HAT_LOG_BLOCK_CHUNK: u64 = 2_000;
const HAT_LOG_MAX_CHUNKS: u64 = 24;
const HAT_LOG_DEFAULT_LOOKBACK: u64 = 10_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HatWearersDto {
    pub hat_id: String,
    pub addresses: Vec<String>,
}

pub(crate) fn apply_transfer_hat(
    wearers: &mut HashMap<U256, HashSet<Address>>,
    hat_id: U256,
    from: Address,
    to: Address,
) {
    let set = wearers.entry(hat_id).or_default();
    if !from.is_zero() {
        set.remove(&from);
    }
    if !to.is_zero() {
        set.insert(to);
    }
}

fn parse_tx_hash(raw: &str) -> Result<TxHash, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(wallet_err_json("INVALID_TX", "from_tx_hash is empty", None));
    }
    s.parse::<TxHash>()
        .map_err(|e| wallet_err_json("INVALID_TX", e.to_string(), None))
}

fn hats_logs_err(e: impl std::fmt::Display) -> String {
    wallet_err_json(
        "HATS_LOGS",
        crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
        None,
    )
}

/// Current wearers for role hats from bounded Hats `TransferHat` logs.
#[tauri::command]
pub async fn get_hat_wearers_for_ids<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    hat_ids: Vec<String>,
    from_tx_hash: Option<String>,
    hats_contract: Option<String>,
    rpc_urls: Option<Vec<String>>,
) -> Result<Vec<HatWearersDto>, String> {
    let wanted: Vec<U256> = hat_ids
        .iter()
        .filter_map(|raw| parse_top_hat_id(raw.trim()).ok())
        .collect();
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let wanted_set: HashSet<U256> = wanted.iter().copied().collect();

    let net_key = network.to_lowercase();
    let hats = if let Some(raw) = hats_contract
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parse_address(raw).map_err(|e| wallet_err_json("INVALID_HATS", e, None))?
    } else {
        let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net_key)
            .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
        addrs.hats.ok_or_else(|| {
            wallet_err_json(
                "HATS_CONFIG",
                "PACTO_HATS is not configured for this network",
                None,
            )
        })?
    };

    let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    let latest = provider
        .get_block_number()
        .await
        .map_err(hats_logs_err)?;

    let mut from_block = latest.saturating_sub(HAT_LOG_DEFAULT_LOOKBACK);
    if let Some(raw) = from_tx_hash.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let hash = parse_tx_hash(raw)?;
        if let Some(receipt) = provider
            .get_transaction_receipt(hash)
            .await
            .map_err(hats_logs_err)?
        {
            if let Some(block) = receipt.block_number {
                from_block = block;
            }
        }
    }

    let span = latest.saturating_sub(from_block).saturating_add(1);
    let max_span = HAT_LOG_BLOCK_CHUNK.saturating_mul(HAT_LOG_MAX_CHUNKS);
    if span > max_span {
        from_block = latest.saturating_sub(max_span.saturating_sub(1));
    }

    let mut logs = Vec::new();
    let mut cursor = from_block;
    let mut chunks = 0u64;
    while cursor <= latest && chunks < HAT_LOG_MAX_CHUNKS {
        let end = cursor.saturating_add(HAT_LOG_BLOCK_CHUNK.saturating_sub(1)).min(latest);
        let filter = Filter::new()
            .address(hats)
            .event_signature(TransferHat::SIGNATURE_HASH)
            .from_block(BlockNumberOrTag::Number(cursor))
            .to_block(BlockNumberOrTag::Number(end));
        let chunk = provider
            .get_logs(&filter)
            .await
            .map_err(hats_logs_err)?;
        logs.extend(chunk);
        chunks += 1;
        if end == latest {
            break;
        }
        cursor = end.saturating_add(1);
    }

    logs.sort_by_key(|l| (l.block_number.unwrap_or(0), l.log_index.unwrap_or(0)));

    let mut wearers: HashMap<U256, HashSet<Address>> = HashMap::new();
    for log in logs {
        let decoded = match TransferHat::decode_raw_log(log.topics(), log.data().data.as_ref()) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if !wanted_set.contains(&decoded.id) {
            continue;
        }
        apply_transfer_hat(&mut wearers, decoded.id, decoded.from, decoded.to);
    }

    Ok(wanted
        .into_iter()
        .map(|hat_id| {
            let mut addresses: Vec<String> = wearers
                .get(&hat_id)
                .map(|set| set.iter().map(|a| format!("{:#x}", a)).collect())
                .unwrap_or_default();
            addresses.sort();
            HatWearersDto {
                hat_id: hat_id.to_string(),
                addresses,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_hat_tracks_mint_move_and_burn() {
        let mut wearers = HashMap::new();
        let hat = U256::from(7u64);
        let a = Address::repeat_byte(0x11);
        let b = Address::repeat_byte(0x22);
        apply_transfer_hat(&mut wearers, hat, Address::ZERO, a);
        apply_transfer_hat(&mut wearers, hat, a, b);
        assert_eq!(wearers.get(&hat).map(|s| s.len()), Some(1));
        assert!(wearers.get(&hat).unwrap().contains(&b));
        apply_transfer_hat(&mut wearers, hat, b, Address::ZERO);
        assert!(wearers.get(&hat).unwrap().is_empty());
    }
}
