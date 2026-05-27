//! Deploy a Safe proxy via `GnosisSafeProxyFactory.createProxyWithNonce`, using addresses from
//! `pacto_chain_config` (env override) or safe-global/safe-deployments defaults.

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::contracts::safe::{
    encode_create_proxy_call, encode_setup_initializer, normalize_owners,
    proxy_address_from_factory_receipt,
};
use super::pacto_chain_config;
use super::rpc::{
    connect_signing_provider, contract_call_request, parse_salt_nonce, send_and_confirm,
    wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::rpc::signer::{
    load_embedded_signer, load_squad_roster_embedded_signer, require_roster_treasury_signing_allowed,
    require_treasury_signing_allowed,
};
use super::squad_sponsor_common::require_sponsor_infra_for_parent;
use super::wallet_chain_config;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeDeployProxyResult {
    pub tx_hash: String,
    pub safe_address: String,
    /// Wallet network key: `mainnet`, `optimism`, or `sepolia`.
    pub chain: String,
    pub chain_id: u64,
}

/// Deploy a new Safe proxy on **mainnet**, **optimism**, or **sepolia** using the embedded EVM key.
#[tauri::command]
pub async fn safe_deploy_proxy<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    owners: Vec<String>,
    threshold: u32,
    salt_nonce: Option<String>,
    parent_id: Option<String>,
) -> Result<SafeDeployProxyResult, String> {
    if let Some(pid) = parent_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        require_sponsor_infra_for_parent(&app, pid)?;
    }

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };
    let Some(addrs) = pacto_chain_config::safe_factory_addresses(&net.key, net.chain_id) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            "Safe factory addresses not defined for this chain",
            None,
        ));
    };

    let owners_norm =
        normalize_owners(&owners).map_err(|e| wallet_err_json("INVALID_OWNERS", e, None))?;
    let th = u64::from(threshold);
    let initializer = encode_setup_initializer(&owners_norm, th, addrs.fallback_handler)
        .map_err(|e| wallet_err_json("INVALID_SAFE_SETUP", e, None))?;

    let salt = parse_salt_nonce(salt_nonce)
        .map_err(|e| wallet_err_json("INVALID_SALT_NONCE", e, None))?;

    let calldata = encode_create_proxy_call(addrs.singleton, initializer, salt);

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    let roster_parent = parent_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let (_signer, wallet) = if let Some(pid) = roster_parent {
        require_roster_treasury_signing_allowed(app.clone(), pid).await?;
        load_squad_roster_embedded_signer(app.clone(), pid).await?
    } else {
        require_treasury_signing_allowed(app.clone()).await?;
        load_embedded_signer(app.clone()).await?
    };
    let provider = connect_signing_provider(&urls, wallet).await?;

    let tx = contract_call_request(addrs.proxy_factory, calldata);
    let receipt = send_and_confirm(
        &provider,
        tx,
        "Timed out waiting for confirmation. The transaction may still complete; check a block explorer using the hash below.",
    )
    .await?;

    let proxy = proxy_address_from_factory_receipt(&receipt, addrs.proxy_factory).map_err(|e| {
        wallet_err_json_with_tx_hash(
            "PARSE_RECEIPT",
            e,
            None,
            format!("0x{:x}", receipt.transaction_hash),
        )
    })?;

    Ok(SafeDeployProxyResult {
        tx_hash: format!("0x{:x}", receipt.transaction_hash),
        safe_address: format!("{:#x}", proxy),
        chain: net.key.clone(),
        chain_id: net.chain_id,
    })
}
