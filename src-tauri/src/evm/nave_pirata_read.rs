//! Read Nave Pirata deployment record from `INavePirataRegistry`.

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::INavePirataRegistry::deploymentCall;
use super::contracts::pacto_gov::read_bindings::IWarGameRegistry::activeCall;
use super::gov_read::{connect_gov_read_provider, parse_top_hat_id};
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::{parse_address, wallet_err_json};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavePirataDeploymentDto {
    pub chain: String,
    pub chain_id: u64,
    pub top_hat_id: String,
    pub safe: String,
    pub quartermaster: String,
    pub mutiny_module: String,
    pub treasury_authority: String,
    pub squad_admin_proxy: String,
    pub captain_hat_id: String,
    pub crew_hat_id: String,
    pub squad_admin_hat_id: String,
    pub mutiny_role_hat_id: String,
    pub quartermaster_role_hat_id: String,
    pub treasury_authority_role_hat_id: String,
    pub deployed_at: u64,
    pub deployer: String,
}

/// True when `to` is one of the five on-chain gov modules for this deployment.
pub fn deployment_mentions_module(d: &NavePirataDeploymentDto, to: Address) -> bool {
    [
        d.safe.as_str(),
        d.quartermaster.as_str(),
        d.mutiny_module.as_str(),
        d.treasury_authority.as_str(),
        d.squad_admin_proxy.as_str(),
    ]
    .into_iter()
    .filter_map(|raw| parse_address(raw).ok())
    .any(|addr| addr == to)
}

fn deployment_to_dto(
    chain: &str,
    chain_id: u64,
    top_hat: U256,
    d: super::contracts::pacto_gov::read_bindings::INavePirataRegistry::Deployment,
) -> Result<NavePirataDeploymentDto, String> {
    if d.safe.is_zero() {
        return Err(wallet_err_json(
            "DEPLOYMENT_NOT_FOUND",
            "no registry deployment for this top hat id",
            None,
        ));
    }
    Ok(NavePirataDeploymentDto {
        chain: chain.to_string(),
        chain_id,
        top_hat_id: top_hat.to_string(),
        safe: format!("{:#x}", d.safe),
        quartermaster: format!("{:#x}", d.quartermaster),
        mutiny_module: format!("{:#x}", d.mutinyModule),
        treasury_authority: format!("{:#x}", d.treasuryAuthority),
        squad_admin_proxy: format!("{:#x}", d.squadAdminProxy),
        captain_hat_id: d.captainHatId.to_string(),
        crew_hat_id: d.crewHatId.to_string(),
        squad_admin_hat_id: d.squadAdminHatId.to_string(),
        mutiny_role_hat_id: d.mutinyRoleHatId.to_string(),
        quartermaster_role_hat_id: d.quartermasterRoleHatId.to_string(),
        treasury_authority_role_hat_id: d.treasuryAuthorityRoleHatId.to_string(),
        deployed_at: d.deployedAt,
        deployer: format!("{:#x}", d.deployer),
    })
}

pub async fn read_nave_pirata_deployment<P: Provider>(
    provider: &P,
    registry: Address,
    top_hat: U256,
    chain: &str,
    chain_id: u64,
) -> Result<NavePirataDeploymentDto, String> {
    let d = eth_call_decode(provider, registry, &deploymentCall { _topHatId: top_hat })
        .await
        .map_err(|e| wallet_err_json("REGISTRY_READ", e, None))?;
    deployment_to_dto(chain, chain_id, top_hat, d)
}

fn war_game_deployment_to_dto(
    chain: &str,
    chain_id: u64,
    d: super::contracts::pacto_gov::read_bindings::IWarGameRegistry::Deployment,
) -> Option<NavePirataDeploymentDto> {
    if d.safe.is_zero() {
        return None;
    }
    Some(NavePirataDeploymentDto {
        chain: chain.to_string(),
        chain_id,
        top_hat_id: d.topHatId.to_string(),
        safe: format!("{:#x}", d.safe),
        quartermaster: format!("{:#x}", d.quartermaster),
        mutiny_module: format!("{:#x}", d.mutinyModule),
        treasury_authority: format!("{:#x}", d.treasuryAuthority),
        squad_admin_proxy: format!("{:#x}", d.squadAdminProxy),
        captain_hat_id: d.captainHatId.to_string(),
        crew_hat_id: d.crewHatId.to_string(),
        squad_admin_hat_id: d.squadAdminHatId.to_string(),
        mutiny_role_hat_id: d.mutinyRoleHatId.to_string(),
        quartermaster_role_hat_id: d.quartermasterRoleHatId.to_string(),
        treasury_authority_role_hat_id: d.treasuryAuthorityRoleHatId.to_string(),
        deployed_at: d.deployedAt,
        deployer: format!("{:#x}", d.deployer),
    })
}

/// Fresh `WarGameRegistry.active(gameSquadId)`. `None` when the registry has no active stack.
pub async fn read_war_game_active_deployment<P: Provider>(
    provider: &P,
    registry: Address,
    game_squad_id: B256,
    chain: &str,
    chain_id: u64,
) -> Result<Option<NavePirataDeploymentDto>, String> {
    let d = eth_call_decode(
        provider,
        registry,
        &activeCall {
            squadId: game_squad_id,
        },
    )
    .await
    .map_err(|e| wallet_err_json("REGISTRY_READ", e, None))?;
    Ok(war_game_deployment_to_dto(chain, chain_id, d))
}

async fn read_registry_deployment_for_network(
    network: String,
    top_hat_id: String,
    rpc_urls: Option<Vec<String>>,
    registry: Address,
) -> Result<NavePirataDeploymentDto, String> {
    let top_hat = parse_top_hat_id(top_hat_id.as_str())
        .map_err(|e| wallet_err_json("INVALID_TOP_HAT", e, None))?;
    let (provider, ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?;
    read_nave_pirata_deployment(&provider, registry, top_hat, ctx.key.as_str(), ctx.chain_id).await
}

#[tauri::command]
pub async fn get_nave_pirata_deployment<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    top_hat_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<NavePirataDeploymentDto, String> {
    let net_key = network.to_lowercase();
    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net_key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let Some(registry) = addrs.nave_pirata_registry else {
        return Err(wallet_err_json(
            "REGISTRY_CONFIG",
            "PACTO_NAVE_PIRATA_REGISTRY is not configured for this network",
            None,
        ));
    };
    read_registry_deployment_for_network(network, top_hat_id, rpc_urls, registry).await
}

#[tauri::command]
pub async fn get_war_game_deployment<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    top_hat_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<NavePirataDeploymentDto, String> {
    let net_key = network.to_lowercase();
    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net_key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let Some(registry) = addrs.war_game_registry else {
        return Err(wallet_err_json(
            "REGISTRY_CONFIG",
            "PACTO_WAR_GAME_REGISTRY is not configured for this network",
            None,
        ));
    };
    read_registry_deployment_for_network(network, top_hat_id, rpc_urls, registry).await
}

#[cfg(test)]
mod tests {
    use super::deployment_mentions_module;
    use super::NavePirataDeploymentDto;
    use alloy::primitives::address;

    fn fixture(admin: &str, ta: &str) -> NavePirataDeploymentDto {
        NavePirataDeploymentDto {
            chain: "sepolia".into(),
            chain_id: 11155111,
            top_hat_id: "1".into(),
            safe: "0x1111111111111111111111111111111111111111".into(),
            quartermaster: "0x2222222222222222222222222222222222222222".into(),
            mutiny_module: "0x3333333333333333333333333333333333333333".into(),
            treasury_authority: ta.into(),
            squad_admin_proxy: admin.into(),
            captain_hat_id: "1".into(),
            crew_hat_id: "2".into(),
            squad_admin_hat_id: "3".into(),
            mutiny_role_hat_id: "4".into(),
            quartermaster_role_hat_id: "5".into(),
            treasury_authority_role_hat_id: "6".into(),
            deployed_at: 0,
            deployer: "0x7777777777777777777777777777777777777777".into(),
        }
    }

    #[test]
    fn deployment_mentions_only_on_chain_modules() {
        let ta = address!("0x5412b91d05101d3bd802e4e8d4c576f0e525aeda");
        let admin = address!("0x4444444444444444444444444444444444444444");
        let other = address!("0x9999999999999999999999999999999999999999");
        let d = fixture(&format!("{admin:#x}"), &format!("{ta:#x}"));
        assert!(deployment_mentions_module(&d, ta));
        assert!(deployment_mentions_module(&d, admin));
        assert!(!deployment_mentions_module(&d, other));
    }
}
