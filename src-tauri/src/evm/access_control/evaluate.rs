//! Evaluate Hats + SquadAdmin into a capability snapshot; enforce on writes.

use alloy::primitives::{Address, U256};
use alloy::providers::Provider;
use tauri::{AppHandle, Runtime};

use super::capability::{
    capability_allowed, deny_reason, CapabilityFlagDto, GovCapability, HatContext,
    SquadCapabilitiesDto, CAPABILITY_KEYS,
};
use super::identity::resolve_acl_roster_address;
use crate::db;
use crate::evm::contracts::hats::IHats::isWearerOfHatCall;
use crate::evm::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    isExecutorFullPermissionCall, isExecutorPausedCall,
};
use crate::evm::gov_read::{connect_gov_read_provider, parse_top_hat_id};
use crate::evm::nave_pirata_read::read_nave_pirata_deployment;
use crate::evm::pacto_chain_config;
use crate::evm::rpc::call::eth_call_decode;
use crate::evm::rpc::{parse_address, wallet_err_json};

struct SquadAclChain {
    network: String,
    hats: Address,
    safe: Address,
    captain_hat_id: U256,
    crew_hat_id: U256,
    squad_admin: Option<Address>,
}

fn load_pacto_gov_row<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<(String, String), String> {
    let rows = db::list_squad_infra(app.clone(), parent_id.to_string())?;
    let row = rows
        .into_iter()
        .find(|r| r.infra_type == "pacto_gov")
        .ok_or_else(|| {
            wallet_err_json(
                "ACL_NO_GOV",
                "Pacto Gov is not deployed for this parent",
                None,
            )
        })?;
    let chain = row.chain.trim().to_ascii_lowercase();
    let top_hat = row.canonical_ref.trim().to_string();
    if chain.is_empty() || top_hat.is_empty() {
        return Err(wallet_err_json(
            "ACL_GOV_INFRA",
            "Pacto Gov infra row missing chain or top hat",
            None,
        ));
    }
    Ok((chain, top_hat))
}

async fn load_chain_context<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadAclChain, String> {
    let (network, top_hat_raw) = load_pacto_gov_row(app, parent_id)?;
    let top_hat = parse_top_hat_id(top_hat_raw.as_str())
        .map_err(|e| wallet_err_json("INVALID_TOP_HAT", e, None))?;

    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&network)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let hats = addrs.hats.ok_or_else(|| {
        wallet_err_json(
            "HATS_CONFIG",
            "PACTO_HATS is not configured for this network",
            None,
        )
    })?;
    let registry = addrs.nave_pirata_registry.ok_or_else(|| {
        wallet_err_json(
            "REGISTRY_CONFIG",
            "PACTO_NAVE_PIRATA_REGISTRY is not configured for this network",
            None,
        )
    })?;

    let (provider, ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    let deployment =
        read_nave_pirata_deployment(&provider, registry, top_hat, ctx.key.as_str(), ctx.chain_id)
            .await?;

    let safe = parse_address(deployment.safe.as_str())
        .map_err(|e| wallet_err_json("ACL_SAFE", e, None))?;
    let captain_hat_id = U256::from_str_radix(deployment.captain_hat_id.trim(), 10)
        .map_err(|e| wallet_err_json("ACL_HAT_ID", e.to_string(), None))?;
    let crew_hat_id = U256::from_str_radix(deployment.crew_hat_id.trim(), 10)
        .map_err(|e| wallet_err_json("ACL_HAT_ID", e.to_string(), None))?;
    let squad_admin = parse_address(deployment.squad_admin_proxy.as_str()).ok();

    Ok(SquadAclChain {
        network,
        hats,
        safe,
        captain_hat_id,
        crew_hat_id,
        squad_admin: squad_admin.filter(|a| !a.is_zero()),
    })
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

fn role_label(ctx: &HatContext) -> String {
    if ctx.roster_address.is_empty() {
        return "No squad EVM linked".into();
    }
    if ctx.wears_captain && ctx.wears_crew {
        return "Captain + Crew".into();
    }
    if ctx.wears_captain {
        return "Captain".into();
    }
    if ctx.wears_crew {
        return "Crew".into();
    }
    if ctx.captain_is_safe {
        return "No hat · Safe holds captain".into();
    }
    "No on-chain hat".into()
}

fn build_snapshot(
    parent_id: &str,
    ctx: HatContext,
    squad_admin_full: bool,
    squad_admin_paused: bool,
) -> SquadCapabilitiesDto {
    let mut capabilities = std::collections::BTreeMap::new();
    for &cap in CAPABILITY_KEYS {
        let allowed = capability_allowed(cap, &ctx);
        capabilities.insert(
            cap.as_str().to_string(),
            CapabilityFlagDto {
                allowed,
                reason: if allowed {
                    String::new()
                } else {
                    deny_reason(cap, &ctx).to_string()
                },
            },
        );
    }
    SquadCapabilitiesDto {
        parent_id: parent_id.to_string(),
        roster_address: ctx.roster_address.clone(),
        wears_captain: ctx.wears_captain,
        wears_crew: ctx.wears_crew,
        captain_is_safe: ctx.captain_is_safe,
        squad_admin_full,
        squad_admin_paused,
        role_label: role_label(&ctx),
        capabilities,
    }
}

pub async fn evaluate_squad_capabilities<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadCapabilitiesDto, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "ACL_MISSING_PARENT",
            "parentId is required for access control",
            None,
        ));
    }

    let roster = match resolve_acl_roster_address(app, pid) {
        Ok(a) => a,
        Err(_) => {
            return Ok(build_snapshot(
                pid,
                HatContext::default(),
                false,
                false,
            ));
        }
    };

    let chain = load_chain_context(app, pid, rpc_urls.clone()).await?;
    let (provider, _ctx) = connect_gov_read_provider(chain.network.as_str(), rpc_urls).await?;

    let wears_captain =
        is_wearer(&provider, chain.hats, roster, chain.captain_hat_id).await?;
    let wears_crew = is_wearer(&provider, chain.hats, roster, chain.crew_hat_id).await?;
    let safe_wears_captain =
        is_wearer(&provider, chain.hats, chain.safe, chain.captain_hat_id).await?;

    let mut squad_admin_full = false;
    let mut squad_admin_paused = false;
    if let Some(admin) = chain.squad_admin {
        squad_admin_full = eth_call_decode(
            &provider,
            admin,
            &isExecutorFullPermissionCall { _executor: roster },
        )
        .await
        .unwrap_or(false);
        squad_admin_paused = eth_call_decode(
            &provider,
            admin,
            &isExecutorPausedCall { _executor: roster },
        )
        .await
        .unwrap_or(false);
    }

    let ctx = HatContext {
        roster_address: format!("{:#x}", roster),
        wears_captain,
        wears_crew,
        captain_is_safe: safe_wears_captain,
    };
    Ok(build_snapshot(
        pid,
        ctx,
        squad_admin_full,
        squad_admin_paused,
    ))
}

pub async fn require_capability<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    capability: GovCapability,
    rpc_urls: Option<Vec<String>>,
) -> Result<(), String> {
    let snap = evaluate_squad_capabilities(app, parent_id.trim(), rpc_urls).await?;
    let key = capability.as_str();
    let flag = snap.capabilities.get(key);
    if flag.map(|f| f.allowed).unwrap_or(false) {
        return Ok(());
    }
    let reason = flag
        .map(|f| f.reason.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Access denied");
    Err(wallet_err_json("ACL_DENIED", reason, None))
}
