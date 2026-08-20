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
use crate::evm::sponsor_userop::parse_war_game_userop_context;

/// Live Nave Pirata vs throwaway WarGameRegistry stack. Never dual-read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GovStack {
    #[default]
    Live,
    WarGame,
}

impl GovStack {
    pub fn from_wargame(wargame: Option<bool>) -> Self {
        if wargame.unwrap_or(false) {
            Self::WarGame
        } else {
            Self::Live
        }
    }

    pub fn infra_type(self) -> &'static str {
        match self {
            Self::Live => "pacto_gov",
            Self::WarGame => "pacto_gov_wargame",
        }
    }

    /// War-game module `to` uses WarGameRegistry hats; anything else stays live.
    pub fn for_wargame_target(wargame_payload: Option<&str>, to: Address) -> Self {
        if wargame_payload
            .and_then(parse_war_game_userop_context)
            .is_some_and(|c| c.targets(to))
        {
            Self::WarGame
        } else {
            Self::Live
        }
    }
}

struct SquadAclChain {
    network: String,
    hats: Address,
    safe: Address,
    captain_hat_id: U256,
    crew_hat_id: U256,
    squad_admin: Option<Address>,
}

fn load_gov_infra_row<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    stack: GovStack,
) -> Result<(String, String), String> {
    let want = stack.infra_type();
    let rows = db::list_squad_infra(app.clone(), parent_id.to_string())?;
    let row = rows
        .into_iter()
        .find(|r| r.infra_type == want)
        .ok_or_else(|| match stack {
            GovStack::Live => wallet_err_json(
                "ACL_NO_GOV",
                "Pacto Gov is not deployed for this parent",
                None,
            ),
            GovStack::WarGame => wallet_err_json(
                "ACL_NO_GOV",
                "War-game stack is not deployed for this parent",
                None,
            ),
        })?;
    let chain = row.chain.trim().to_ascii_lowercase();
    let top_hat = row.canonical_ref.trim().to_string();
    if chain.is_empty() || top_hat.is_empty() {
        return Err(wallet_err_json(
            "ACL_GOV_INFRA",
            match stack {
                GovStack::Live => "Pacto Gov infra row missing chain or top hat",
                GovStack::WarGame => "War-game infra row missing chain or top hat",
            },
            None,
        ));
    }
    Ok((chain, top_hat))
}

async fn load_chain_context<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    rpc_urls: Option<Vec<String>>,
    stack: GovStack,
) -> Result<SquadAclChain, String> {
    let (network, top_hat_raw) = load_gov_infra_row(app, parent_id, stack)?;
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
    let registry = match stack {
        GovStack::Live => addrs.nave_pirata_registry.ok_or_else(|| {
            wallet_err_json(
                "REGISTRY_CONFIG",
                "PACTO_NAVE_PIRATA_REGISTRY is not configured for this network",
                None,
            )
        })?,
        GovStack::WarGame => addrs.war_game_registry.ok_or_else(|| {
            wallet_err_json(
                "REGISTRY_CONFIG",
                "PACTO_WAR_GAME_REGISTRY is not configured for this network",
                None,
            )
        })?,
    };

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
    stack: GovStack,
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
            return Ok(build_snapshot(pid, HatContext::default(), false, false));
        }
    };

    let chain = load_chain_context(app, pid, rpc_urls.clone(), stack).await?;
    let (provider, _ctx) = connect_gov_read_provider(chain.network.as_str(), rpc_urls).await?;

    let wears_captain = is_wearer(&provider, chain.hats, roster, chain.captain_hat_id).await?;
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
    stack: GovStack,
) -> Result<(), String> {
    let snap = evaluate_squad_capabilities(app, parent_id.trim(), rpc_urls, stack).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;
    use serde_json::json;

    #[test]
    fn gov_stack_infra_type_does_not_dual_read() {
        assert_eq!(GovStack::Live.infra_type(), "pacto_gov");
        assert_eq!(GovStack::WarGame.infra_type(), "pacto_gov_wargame");
    }

    #[test]
    fn gov_stack_from_wargame_flag() {
        assert_eq!(GovStack::from_wargame(None), GovStack::Live);
        assert_eq!(GovStack::from_wargame(Some(false)), GovStack::Live);
        assert_eq!(GovStack::from_wargame(Some(true)), GovStack::WarGame);
    }

    #[test]
    fn gov_stack_for_wargame_target_only_when_active_module() {
        let ta = address!("0x5412b91d05101d3bd802e4e8d4c576f0e525aeda");
        let other = address!("0x9999999999999999999999999999999999999999");
        let payload = json!({
            "v": 1,
            "status": "active",
            "gameSquadId": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "safe": "0x1111111111111111111111111111111111111111",
            "quartermaster": "0x2222222222222222222222222222222222222222",
            "mutinyModule": "0x3333333333333333333333333333333333333333",
            "treasuryAuthority": format!("{ta:#x}"),
            "squadAdminProxy": "0x4444444444444444444444444444444444444444",
            "sponsor": "0x5555555555555555555555555555555555555555",
            "round": "1",
        })
        .to_string();
        assert_eq!(
            GovStack::for_wargame_target(Some(payload.as_str()), ta),
            GovStack::WarGame
        );
        assert_eq!(
            GovStack::for_wargame_target(Some(payload.as_str()), other),
            GovStack::Live
        );
        assert_eq!(GovStack::for_wargame_target(None, ta), GovStack::Live);
    }
}
