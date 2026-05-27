//! Read Hats tree nodes under a top hat via `IHats` view calls.

use alloy::primitives::U256;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

use super::contracts::hats::IHats::{
    buildHatIdCall, isValidHatIdCall, viewHatCall,
};
use super::gov_read::{connect_gov_read_provider, parse_top_hat_id};
use super::pacto_chain_config;
use super::rpc::{call::eth_call_decode, wallet_err_json};

const DEFAULT_MAX_NODES: u32 = 48;
const HARD_MAX_NODES: u32 = 128;
const DEFAULT_MAX_DEPTH: u32 = 6;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HatTreeNodeDto {
    pub hat_id: String,
    pub details: String,
    pub max_supply: u32,
    pub supply: u32,
    pub active: bool,
    pub children: Vec<HatTreeNodeDto>,
}

struct FlatHatNode {
    hat_id: U256,
    parent_id: Option<U256>,
    details: String,
    max_supply: u32,
    supply: u32,
    active: bool,
}

fn build_tree(flat: &[FlatHatNode], root_id: U256) -> Option<HatTreeNodeDto> {
    let root = flat.iter().find(|n| n.hat_id == root_id)?;
    let mut children_by_parent: HashMap<U256, Vec<U256>> = HashMap::new();
    for n in flat {
        if let Some(p) = n.parent_id {
            children_by_parent.entry(p).or_default().push(n.hat_id);
        }
    }

    fn node_for(id: U256, flat: &[FlatHatNode], children_by_parent: &HashMap<U256, Vec<U256>>) -> Option<HatTreeNodeDto> {
        let n = flat.iter().find(|x| x.hat_id == id)?;
        let child_ids = children_by_parent.get(&id).cloned().unwrap_or_default();
        let children = child_ids
            .into_iter()
            .filter_map(|cid| node_for(cid, flat, children_by_parent))
            .collect();
        Some(HatTreeNodeDto {
            hat_id: n.hat_id.to_string(),
            details: n.details.clone(),
            max_supply: n.max_supply,
            supply: n.supply,
            active: n.active,
            children,
        })
    }

    node_for(root.hat_id, flat, &children_by_parent)
}

#[tauri::command]
pub async fn get_hats_tree<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    top_hat_id: String,
    max_depth: Option<u32>,
    max_nodes: Option<u32>,
) -> Result<HatTreeNodeDto, String> {
    let top_hat = parse_top_hat_id(top_hat_id.as_str())
        .map_err(|e| wallet_err_json("INVALID_TOP_HAT", e, None))?;

    let net_key = network.to_lowercase();
    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net_key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let Some(hats) = addrs.hats else {
        return Err(wallet_err_json(
            "HATS_CONFIG",
            "PACTO_HATS is not configured for this network",
            None,
        ));
    };

    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;
    let max_nodes = max_nodes.unwrap_or(DEFAULT_MAX_NODES).clamp(1, HARD_MAX_NODES);
    let max_depth = max_depth.unwrap_or(DEFAULT_MAX_DEPTH).clamp(1, 12);

    let mut flat: Vec<FlatHatNode> = Vec::new();
    let mut queue: Vec<(U256, Option<U256>, u32)> = vec![(top_hat, None, 0)];

    while let Some((hat_id, parent_id, depth)) = queue.pop() {
        if flat.len() as u32 >= max_nodes {
            break;
        }
        if depth > max_depth {
            continue;
        }

        let valid: bool = eth_call_decode(&provider, hats, &isValidHatIdCall { _hatId: hat_id })
            .await
            .map_err(|e| wallet_err_json("HATS_VALIDATE", e, None))?;
        if !valid {
            continue;
        }

        let decoded = eth_call_decode(&provider, hats, &viewHatCall { _hatId: hat_id })
            .await
            .map_err(|e| wallet_err_json("HATS_VIEW", e, None))?;

        flat.push(FlatHatNode {
            hat_id,
            parent_id,
            details: decoded.details,
            max_supply: decoded.maxSupply,
            supply: decoded.supply,
            active: decoded.active,
        });

        if depth < max_depth && (flat.len() as u32) < max_nodes {
            for local in 1..=decoded.lastHatId {
                if flat.len() as u32 >= max_nodes {
                    break;
                }
                let child_id: U256 = eth_call_decode(
                    &provider,
                    hats,
                    &buildHatIdCall {
                        _admin: hat_id,
                        _newHat: local,
                    },
                )
                .await
                .map_err(|e| wallet_err_json("HATS_BUILD_ID", e, None))?;
                queue.push((child_id, Some(hat_id), depth + 1));
            }
        }
    }

    build_tree(&flat, top_hat).ok_or_else(|| {
        wallet_err_json(
            "HATS_TREE",
            "top hat id is not valid on the configured Hats contract",
            None,
        )
    })
}
