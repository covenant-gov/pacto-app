use alloy::network::EthereumWallet;
use alloy::signers::local::PrivateKeySigner;
use tauri::{AppHandle, Runtime};

use crate::crypto;
use crate::db;
use super::errors::wallet_err_json;
use crate::evm::evm_accounts::{self};

pub async fn require_treasury_signing_allowed<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let ok = evm_accounts::active_account_allows_treasury_signing(app).await?;
    if ok {
        Ok(())
    } else {
        Err(wallet_err_json(
            "IMPORTED_ACCOUNT_NOT_ALLOWED",
            "Treasury and on-chain deployment require a wallet address derived from your recovery phrase.",
            None,
        ))
    }
}

pub async fn require_roster_treasury_signing_allowed<R: Runtime>(
    app: AppHandle<R>,
    parent_id: &str,
) -> Result<(), String> {
    evm_accounts::require_roster_treasury_signing_allowed(app, parent_id)
        .await
        .map_err(|e| wallet_err_json("IMPORTED_ACCOUNT_NOT_ALLOWED", e, None))
}

pub async fn load_embedded_signer<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(PrivateKeySigner, EthereumWallet), String> {
    let enc = db::get_evm_pkey(app)
        .map_err(|e| wallet_err_json("DB_ERROR", e, None))?
        .ok_or_else(|| wallet_err_json("NO_EVM_KEY", "EVM key not set for this account", None))?;

    let evm_private_key = crypto::internal_decrypt(enc, None)
        .await
        .map_err(|_| wallet_err_json("DECRYPT_FAILED", "Could not decrypt EVM key", None))?;

    let signer: PrivateKeySigner = evm_private_key
        .parse()
        .map_err(|_| wallet_err_json("INVALID_KEY", "Invalid EVM key format", None))?;

    let wallet = EthereumWallet::from(signer.clone());
    Ok((signer, wallet))
}

async fn private_key_signer_from_account_id<R: Runtime>(
    app: &AppHandle<R>,
    account_id: &str,
) -> Result<(PrivateKeySigner, EthereumWallet), String> {
    let (key_hex, _, _) = evm_accounts::resolve_private_key_hex_for_account_id(app, account_id)
        .await
        .map_err(|e| wallet_err_json("ROSTER_SIGNER", e, None))?;
    let signer: PrivateKeySigner = key_hex
        .parse()
        .map_err(|_| wallet_err_json("INVALID_KEY", "Invalid EVM key format", None))?;
    let wallet = EthereumWallet::from(signer.clone());
    Ok((signer, wallet))
}

/// Squad roster-bound signer for a parent; falls back to active squad signer when parent id is empty.
pub async fn load_squad_roster_embedded_signer<R: Runtime>(
    app: AppHandle<R>,
    parent_id: &str,
) -> Result<(PrivateKeySigner, EthereumWallet), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        evm_accounts::require_squad_purpose_signer(app.clone())
            .await
            .map_err(|e| wallet_err_json("SQUAD_SIGNER_REQUIRED", e, None))?;
        return load_embedded_signer(app).await;
    }

    let account_id = evm_accounts::resolve_roster_signing_account_id(&app, pid)
        .map_err(|e| wallet_err_json("ROSTER_SIGNER", e, None))?;
    private_key_signer_from_account_id(&app, account_id.as_str()).await
}

/// Advanced-purpose signer only; resolves key from `active_advanced_evm_account_id`, not squad active signer.
pub async fn load_advanced_embedded_signer<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(PrivateKeySigner, EthereumWallet), String> {
    let (key_hex, _addr) = evm_accounts::resolve_advanced_signing_material(app)
        .await
        .map_err(|e| wallet_err_json("ADVANCED_SIGNER_REQUIRED", e, None))?;

    let signer: PrivateKeySigner = key_hex
        .parse()
        .map_err(|_| wallet_err_json("INVALID_KEY", "Invalid EVM key format", None))?;

    let wallet = EthereumWallet::from(signer.clone());
    Ok((signer, wallet))
}
