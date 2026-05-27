//! Hat wearer and Squad Admin executor reads for Settings tab columns.

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use super::contracts::hats::IHats::isWearerOfHatCall;
use super::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    hasExecutorRoleCall, isExecutorFullPermissionCall, isExecutorPausedCall,
};
use super::gov_read::connect_gov_read_provider;
use super::pacto_chain_config;
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};

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
) -> Result<Vec<MemberHatAssignmentDto>, String> {
    let net_key = network.to_lowercase();
    let hats = if let Some(raw) = hats_contract.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
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

    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;
    let mut out = Vec::new();

    for raw in member_addresses {
        let addr = match parse_address(raw.trim()) {
            Ok(a) => a,
            Err(_) => continue,
        };
        let mut worn = Vec::new();
        for (hat_id, label) in &checks {
            if is_wearer(&provider, hats, addr, *hat_id).await? {
                worn.push(MemberHatLabelDto {
                    hat_id: hat_id.to_string(),
                    label: label.clone(),
                });
            }
        }
        out.push(MemberHatAssignmentDto {
            address: format!("{:#x}", addr),
            hats: worn,
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
) -> Result<SquadAdminExecutorRolesDto, String> {
    let admin = parse_address(squad_admin_proxy.trim())
        .map_err(|e| wallet_err_json("INVALID_SQUAD_ADMIN", e, None))?;
    let exec = parse_address(executor_address.trim())
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))?;

    let (provider, _ctx) = connect_gov_read_provider(network.as_str()).await?;

    let full: bool = eth_call_decode(
        &provider,
        admin,
        &isExecutorFullPermissionCall { _executor: exec },
    )
    .await
    .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;

    let paused: bool = eth_call_decode(
        &provider,
        admin,
        &isExecutorPausedCall { _executor: exec },
    )
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
