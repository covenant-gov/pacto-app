//! Aztec Wallet Module
//!
//! Tauri commands for Aztec wallet operations.
//! Uses the sidecar process for Aztec.js interactions.

use std::cmp::min;
use log::info;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::aztec_sidecar::{SidecarSupervisor, SidecarInfo, SidecarHealth};

lazy_static::lazy_static! {
    static ref SIDECAR: SidecarSupervisor = SidecarSupervisor::new();
}

/// Aztec chain configuration
pub const AZTEC_TESTNET_RPC: &str = "https://rpc.testnet.aztec-labs.com";

/// Aztec wallet state stored in our DB
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AztecAccountInfo {
    pub aztec_address: String,
    pub evm_address: String,
    pub partial_address: String,
    pub public_keys: AztecPublicKeys,
    pub is_deployed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AztecPublicKeys {
    pub npk_m: String,
    pub ivpk_m: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AztecWalletSummary {
    pub address: String,
    pub is_deployed: bool,
    pub eth_balance: Option<String>,
    pub token_balances: Vec<AztecTokenBalance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AztecTokenBalance {
    pub symbol: String,
    pub address: String,
    pub balance: String,
    pub balance_decimal: String,
}

/// Aztec transfer request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AztecTransferRequest {
    pub to_address: String,
    pub amount: String,
    pub asset: String, // "ETH" or token address
    pub memo: Option<String>,
}

/// Aztec transfer result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AztecTransferResult {
    pub tx_hash: String,
    pub block_number: Option<String>,
}

/// Error response
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AztecError {
    code: String,
    message: String,
}

// ============================================
// TAURI COMMANDS
// ============================================

/// Start the Aztec sidecar process
#[tauri::command]
pub async fn aztec_start_sidecar(port: Option<u16>) -> Result<SidecarInfo, String> {
    let port = port.unwrap_or(4892);
    SIDECAR.start(port).await
}

/// Stop the Aztec sidecar process
#[tauri::command]
pub async fn aztec_stop_sidecar() -> Result<(), String> {
    SIDECAR.stop().await
}

/// Debug: Get diagnostic info about the sidecar
#[tauri::command]
pub async fn aztec_debug_info() -> Result<serde_json::Value, String> {
    let is_running = SIDECAR.is_running();
    let info = SIDECAR.get_info().await;
    
    let (port, url, token_prefix) = match info {
        Ok(info) => {
            let token_prefix = if info.auth_token.len() > 8 { &info.auth_token[..8] } else { &info.auth_token };
            (info.port, info.url, token_prefix.to_string())
        }
        Err(e) => (0, format!("Error: {}", e), String::new()),
    };
    
    // Scan multiple ports to find any running sidecar
    let mut port_scan_results = Vec::new();
    for test_port in 4892..=4896u16 {
        let health_url = format!("http://127.0.0.1:{}/health", test_port);
        match reqwest::get(&health_url).await {
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                port_scan_results.push(serde_json::json!({
                    "port": test_port,
                    "status": status.to_string(),
                    "response": text,
                    "found": true
                }));
            }
            Err(e) => {
                port_scan_results.push(serde_json::json!({
                    "port": test_port,
                    "error": e.to_string(),
                    "found": false
                }));
            }
        }
    }
    
    // Test a simple RPC call
    let rpc_test = SIDECAR.test_rpc_call().await;
    
    // Test account creation
    let account_test = SIDECAR.test_account_creation().await;
    
    Ok(serde_json::json!({
        "is_running": is_running,
        "stored_port": port,
        "stored_url": url,
        "stored_token_prefix": token_prefix,
        "port_scan": port_scan_results,
        "rpc_test": rpc_test,
        "account_test": account_test,
    }))
}

/// Get sidecar health status
#[tauri::command]
pub async fn aztec_sidecar_health() -> Result<SidecarHealth, String> {
    SIDECAR.health_check().await
}

/// Get sidecar info
#[tauri::command]
pub async fn aztec_sidecar_info() -> Result<SidecarInfo, String> {
    SIDECAR.get_info().await
}

/// Connect to Aztec node and verify connection
#[tauri::command]
pub async fn aztec_connect_node() -> Result<serde_json::Value, String> {
    let result = SIDECAR.request(
        "node.connect",
        serde_json::json!({
            "rpcUrl": AZTEC_TESTNET_RPC
        })
    ).await?;
    
    Ok(result)
}

/// Get Aztec node info
#[tauri::command]
pub async fn aztec_get_node_info() -> Result<serde_json::Value, String> {
    let result = SIDECAR.request(
        "node.getInfo",
        serde_json::json!({
            "rpcUrl": AZTEC_TESTNET_RPC
        })
    ).await?;
    
    Ok(result)
}

/// Create an Aztec account from an EVM private key
///
/// This implements the same-seed approach where the EVM private key
/// is used for the Aztec ECDSA account contract.
#[tauri::command]
pub async fn aztec_create_account_from_evm<R: Runtime>(
    handle: AppHandle<R>,
    evm_private_key_hex: String,
) -> Result<AztecAccountInfo, String> {
    info!("aztec_create_account_from_evm called");
    
    // First, ensure the sidecar is running
    let running = SIDECAR.is_running();
    info!("is_running() returned: {}", running);
    
    if !running {
        info!("Sidecar not running, calling start()...");
        let start_result = SIDECAR.start(4892).await;
        info!("start() result: {:?}", start_result);
        if let Err(e) = start_result {
            return Err(format!("Failed to start sidecar: {}", e));
        }
    } else {
        info!("Sidecar already running, skipping start()");
    }
    
    // Wait a bit to ensure sidecar is stable
    info!("Waiting 500ms for sidecar to stabilize...");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    info!("Wait complete, making request...");
    
    info!("Making echo call via request()...");
    let echo_result = SIDECAR.request(
        "system.echo",
        serde_json::json!({ "test": "from_create_account" })
    ).await;
    info!("Echo result from request(): {:?}", echo_result);
    
    // Get the EVM private key from the active account
    let pkey = if evm_private_key_hex.is_empty() {
        info!("Getting EVM key from active account...");
        match crate::evm_accounts::decrypt_active_evm_private_key_plaintext(handle.clone()).await {
            Ok(key) => key,
            Err(e) => {
                info!("Failed to get EVM key, using placeholder: {}", e);
                "0x0000000000000000000000000000000000000000000000000000000000000001".to_string()
            }
        }
    } else {
        evm_private_key_hex
    };
    
    info!("EVM key obtained (prefix: {}...), calling sidecar...", &pkey[..min(10, pkey.len())]);
    
    // Call sidecar to create account
    let result = SIDECAR.request(
        "account.createFromEVMKey",
        serde_json::json!({
            "evmPrivateKey": pkey,
            "rpcUrl": AZTEC_TESTNET_RPC
        })
    ).await?;
    
    info!("Sidecar returned result: {:?}", result);
    
    let address = result["address"].as_str()
        .ok_or("No address in response")?;
    let partial_address = result["partialAddress"].as_str()
        .ok_or("No partial address in response")?;
    let public_keys = result["publicKeys"].clone();
    
    Ok(AztecAccountInfo {
        aztec_address: address.to_string(),
        evm_address: crate::evm_accounts::resolve_default_shared_evm_address_string(handle)
            .await
            .unwrap_or_default(),
        partial_address: partial_address.to_string(),
        public_keys: AztecPublicKeys {
            npk_m: public_keys["npkM"].as_str().unwrap_or("").to_string(),
            ivpk_m: public_keys["ivpkM"].as_str().unwrap_or("").to_string(),
        },
        is_deployed: false,
    })
}

/// Get Aztec account info for the active EVM account
#[tauri::command]
pub async fn aztec_get_account<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<Option<AztecAccountInfo>, String> {
    // Check if we have an Aztec account stored for this EVM account
    // For now, return None - full implementation would query the DB
    
    // TODO: Query DB for aztec_accounts table
    Ok(None)
}

/// Get balance for an Aztec address
#[tauri::command]
pub async fn aztec_get_balance(
    aztec_address: String,
    asset: Option<String>, // None = ETH, or token address
) -> Result<String, String> {
    // This would call the sidecar to get balance
    // For now, return a placeholder
    Ok("0".to_string())
}

/// Build and send an Aztec transfer
///
/// Note: This requires the account to be deployed and have Fee Juice for fees.
#[tauri::command]
pub async fn aztec_build_and_send_transfer<R: Runtime>(
    handle: AppHandle<R>,
    to_address: String,
    amount: String,
    asset: Option<String>,
) -> Result<AztecTransferResult, String> {
    // Ensure sidecar is running
    if !SIDECAR.is_running() {
        SIDECAR.start(4892).await?;
    }
    
    // Get the sender account
    let _from_address = crate::evm_accounts::resolve_default_shared_evm_address_string(handle.clone())
        .await
        .ok_or("No active EVM account")?;
    
    // TODO: Full implementation would:
    // 1. Create the transfer transaction via sidecar
    // 2. Wait for proof generation
    // 3. Broadcast and wait for receipt
    // 4. Return the result
    
    Err("Transfer not yet implemented - requires deployed account with Fee Juice".to_string())
}

/// Get test accounts from the sidecar (for testing only)
#[tauri::command]
pub async fn aztec_get_test_accounts() -> Result<Vec<serde_json::Value>, String> {
    if !SIDECAR.is_running() {
        SIDECAR.start(4892).await?;
    }
    
    let result = SIDECAR.request(
        "account.getTestAccounts",
        serde_json::json!({
            "rpcUrl": AZTEC_TESTNET_RPC
        })
    ).await?;
    
    if let Some(accounts) = result.as_array() {
        Ok(accounts.clone())
    } else {
        Ok(vec![result])
    }
}

// ============================================
// INITIALIZATION
// ============================================

/// Initialize the Aztec sidecar supervisor
pub fn init_sidecar() {
    info!("Initializing Aztec sidecar supervisor");
    SIDECAR.start_health_loop();
}

/// Shutdown the Aztec sidecar
pub async fn shutdown_sidecar() {
    info!("Shutting down Aztec sidecar");
    let _ = SIDECAR.stop().await;
}
