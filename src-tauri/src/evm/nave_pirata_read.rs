//! Read Nave Pirata deployment record from `INavePirataRegistry`.

use alloy::primitives::{Address, U256};
use alloy::providers::Provider;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_gov::read_bindings::INavePirataRegistry::deploymentCall;
use super::gov_read::{connect_gov_read_provider, parse_top_hat_id};
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::wallet_err_json;

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

#[tauri::command]
pub async fn get_nave_pirata_deployment<R: Runtime>(
    _app: AppHandle<R>,
    network: String,
    top_hat_id: String,
) -> Result<NavePirataDeploymentDto, String> {
    let top_hat = parse_top_hat_id(top_hat_id.as_str())
        .map_err(|e| wallet_err_json("INVALID_TOP_HAT", e, None))?;

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

    let (provider, ctx) = connect_gov_read_provider(network.as_str()).await?;
    read_nave_pirata_deployment(&provider, registry, top_hat, ctx.key.as_str(), ctx.chain_id).await
}
