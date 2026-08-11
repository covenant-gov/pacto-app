//! Debug-gated headless login: one command, two depths.
//!
//! Backend depth is a fresh-keypair, backend-only setup for UI-less
//! backend/IPC assertions (the `pnpm test:e2e:tauri` harness).
//! Full depth performs a real recovery-phrase login and persists real
//! PIN-encrypted credentials the same way `createAccount`/`importAccount`
//! do, so the resulting session is indistinguishable from a human login —
//! that is what lets an agent skip the PIN-entry ritual entirely.
//!
//! Both depths require `PACTO_ALLOW_TEST_AUTH=1`. Full depth additionally
//! refuses a sandbox-only identity (one derived from the committed dev-root
//! recipe) whenever the resolved relay set contains anything but a local
//! endpoint, so a publicly-derivable dev key can never quietly become a
//! real account.

use nostr_sdk::prelude::*;
use tauri::{AppHandle, Runtime};

use crate::Profile;

const DEFAULT_DEV_PIN: &str = "123456";

/// Login depth requested by the caller.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DevLoginDepth {
    /// Fresh keypair, minimal profile, pending/current account plumbing.
    /// No PIN-encrypted key is persisted and no frontend session hydrates
    /// from it.
    Backend,
    /// A real recovery-phrase login: PIN-encrypted credentials persisted,
    /// connection opened.
    Full,
}

fn test_auth_allowed() -> bool {
    std::env::var("PACTO_ALLOW_TEST_AUTH").unwrap_or_default() == "1"
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.trim().is_empty())
}

/// `mnemonic` argument if supplied, else `PACTO_DEV_LOGIN_MNEMONIC`.
fn resolve_mnemonic(mnemonic: Option<String>) -> Option<String> {
    non_empty(mnemonic).or_else(|| non_empty(std::env::var("PACTO_DEV_LOGIN_MNEMONIC").ok()))
}

/// `pin` argument if supplied, else `PACTO_DEV_LOGIN_PIN`, else the
/// throwaway dev PIN.
fn resolve_pin(pin: Option<String>) -> String {
    non_empty(pin)
        .or_else(|| non_empty(std::env::var("PACTO_DEV_LOGIN_PIN").ok()))
        .unwrap_or_else(|| DEFAULT_DEV_PIN.to_string())
}

fn sandbox_only_requested() -> bool {
    std::env::var("PACTO_DEV_IDENTITY_SANDBOX_ONLY").unwrap_or_default() == "1"
}

/// Message for the sandbox-only refusal: names the identity's npub (never
/// its secret) and the non-local relays that triggered the refusal.
fn sandbox_only_refusal(npub: &str, offending_relays: &[String]) -> String {
    format!(
        "Refusing dev login for sandbox-only identity {npub}: the resolved relay set includes \
         non-local relay(s) {}. A dev identity derived from the committed recipe must never \
         authenticate outside the local sandbox.",
        offending_relays.join(", ")
    )
}

/// Backend-only depth: fresh keypair, minimal backend setup, no persisted
/// PIN-encrypted key.
async fn login_backend_depth<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    // Generate a fresh Nostr keypair.
    let keys = Keys::generate();
    let npub = keys.public_key.to_bech32().map_err(|e| e.to_string())?;

    // Initialize the Nostr client.
    let client = Client::builder()
        .signer(keys.clone())
        // Gossip is opt-in from nostr-sdk 0.44: absent a gossip database it stays off.
        .opts(ClientOptions::new())
        .monitor(Monitor::new(1024))
        .build();
    crate::set_nostr_client(client);

    // Build a minimal profile and reset state.
    let mut profile = Profile::new();
    profile.id = npub.clone();
    profile.mine = true;
    profile.name = "Fixture Account".to_string();
    {
        let mut st = crate::STATE.lock().await;
        st.clear_session();
        st.profiles.push(profile);
    }

    // Mark the account pending before touching the filesystem so a concurrent
    // `list_accounts` scan (e.g. the login screen's boot-time account check)
    // can't treat the in-flight directory as an orphan and delete it before
    // the pkey is written.
    crate::account_manager::set_pending_account(npub.clone())?;
    crate::account_manager::init_profile_database(&handle, &npub).await?;
    crate::account_manager::set_current_account(npub.clone())?;
    crate::account_manager::clear_pending_account()?;

    // Set up key-derivation version 2 so test sessions can use commands that
    // normally require a PIN-protected account (e.g. sending messages).
    {
        let conn = crate::account_manager::get_db_connection(&handle)?;
        crate::migration::create_new_account_salt(&handle, &conn)?;
        crate::account_manager::return_db_connection(conn);
    }

    let state = crate::STATE.lock().await;
    Ok(serde_json::json!({
        "success": true,
        "npub": npub,
        "profiles": &state.profiles,
        "chats": &state.chats,
        "is_syncing": state.is_syncing,
        "sync_mode": format!("{:?}", state.sync_mode)
    }))
}

/// Full depth: a real recovery-phrase login through the existing login
/// path, with real PIN-encrypted credentials persisted the same way
/// `createAccount`/`importAccount` do, and the connection opened.
async fn login_full_depth<R: Runtime>(
    handle: AppHandle<R>,
    mnemonic: Option<String>,
    pin: Option<String>,
) -> Result<serde_json::Value, String> {
    let Some(phrase) = resolve_mnemonic(mnemonic) else {
        // The frontend autologin hook calls this unconditionally on every
        // debug boot; an unconfigured identity must be a clean no-op, not
        // an error, so an ordinary `make dev` still shows the welcome screen.
        return Ok(serde_json::json!({
            "skipped": true,
            "reason": "No dev login mnemonic configured (PACTO_DEV_LOGIN_MNEMONIC unset and no mnemonic argument supplied)",
        }));
    };
    let pin = resolve_pin(pin);

    // Parse first (no side effects) so the sandbox-only refusal and the
    // idempotence check below can name/compare the identity before any
    // state changes.
    let keys = Keys::from_mnemonic(phrase.clone(), None)
        .map_err(|_| "Invalid recovery phrase. Check spelling and word count.".to_string())?;
    let npub = keys.public_key.to_bech32().map_err(|e| e.to_string())?;

    if sandbox_only_requested() && !crate::trusted_relays::all_relays_local() {
        return Err(sandbox_only_refusal(
            &npub,
            &crate::trusted_relays::non_local_relays(),
        ));
    }

    // Idempotence: a second full-depth call in the same process for the
    // same identity adopts the already-open session instead of rebuilding
    // the client and re-encrypting credentials. A second call from a fresh
    // process (e.g. relaunching against a sandbox root that already has
    // this account persisted) still runs the full path below, which is
    // itself idempotent: `login_with_recovery_phrase` reuses the existing
    // profile database instead of recreating it, and `encrypt_with_password`
    // reuses the existing salt instead of minting a new one.
    if crate::account_manager::get_current_account()
        .ok()
        .as_deref()
        == Some(npub.as_str())
        && crate::get_nostr_client().is_ok()
    {
        let _ = crate::sandbox_handle::record_npub(&npub);
        return Ok(serde_json::json!({ "success": true, "npub": npub }));
    }

    let keypair = crate::login_with_recovery_phrase(phrase).await?;

    let pkey_ciphertext =
        crate::migration::encrypt_with_password(&handle, &keypair.private, &pin).await?;
    crate::db::set_pkey(handle.clone(), pkey_ciphertext).await?;
    if let Some(seed) = crate::mnemonic_seed_get() {
        let _ = crate::db::set_seed(handle.clone(), seed).await;
    }

    // Bootstrap the MLS device keypackage the same way a human PIN-encrypt
    // does, so the resulting session can actually be invited into a squad.
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        if crate::account_manager::get_current_account().is_err() {
            return;
        }
        if let Err(e) = crate::regenerate_device_keypackage(true).await {
            eprintln!("[dev_login] Device KeyPackage bootstrap failed: {}", e);
        }
    });

    crate::connect(handle.clone()).await;

    if let (Some(evm_private_key), Some(evm_address)) =
        (keypair.evm_private_key.clone(), keypair.evm_address.clone())
    {
        let evm_ciphertext =
            crate::migration::encrypt_with_password(&handle, &evm_private_key, &pin).await?;
        crate::db::set_evm_pkey(handle.clone(), evm_ciphertext).await?;
        crate::db::set_evm_address(handle.clone(), evm_address).await?;
    }

    let _ = crate::sandbox_handle::record_npub(&keypair.public);
    Ok(serde_json::json!({ "success": true, "npub": keypair.public }))
}

/// Debug-only headless login for automated end-to-end tests and agent-driven
/// sandboxes. Requires `PACTO_ALLOW_TEST_AUTH=1` for both depths.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn dev_login<R: Runtime>(
    handle: AppHandle<R>,
    depth: DevLoginDepth,
    mnemonic: Option<String>,
    pin: Option<String>,
) -> Result<serde_json::Value, String> {
    if !test_auth_allowed() {
        return Err("Test auth disabled".to_string());
    }

    match depth {
        DevLoginDepth::Backend => login_backend_depth(handle).await,
        DevLoginDepth::Full => login_full_depth(handle, mnemonic, pin).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;

    // Env-mutating tests share process-wide state; the crate test binary is
    // multi-threaded, so serialize them.
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    fn clear_dev_login_env() {
        std::env::remove_var("PACTO_ALLOW_TEST_AUTH");
        std::env::remove_var("PACTO_DEV_LOGIN_MNEMONIC");
        std::env::remove_var("PACTO_DEV_LOGIN_PIN");
        std::env::remove_var("PACTO_DEV_IDENTITY_SANDBOX_ONLY");
    }

    #[test]
    fn depth_deserializes_lowercase_only() {
        assert_eq!(
            serde_json::from_str::<DevLoginDepth>("\"backend\"").unwrap(),
            DevLoginDepth::Backend
        );
        assert_eq!(
            serde_json::from_str::<DevLoginDepth>("\"full\"").unwrap(),
            DevLoginDepth::Full
        );
        assert!(serde_json::from_str::<DevLoginDepth>("\"Full\"").is_err());
        assert!(serde_json::from_str::<DevLoginDepth>("\"shallow\"").is_err());
    }

    #[test]
    fn mnemonic_argument_wins_over_env() {
        let _guard = ENV_MUTEX.lock();
        clear_dev_login_env();
        std::env::set_var("PACTO_DEV_LOGIN_MNEMONIC", "env phrase");
        assert_eq!(
            resolve_mnemonic(Some("arg phrase".to_string())),
            Some("arg phrase".to_string())
        );
        clear_dev_login_env();
    }

    #[test]
    fn mnemonic_falls_back_to_env_then_none() {
        let _guard = ENV_MUTEX.lock();
        clear_dev_login_env();
        std::env::set_var("PACTO_DEV_LOGIN_MNEMONIC", "env phrase");
        assert_eq!(resolve_mnemonic(None), Some("env phrase".to_string()));

        clear_dev_login_env();
        assert_eq!(resolve_mnemonic(None), None);
    }

    #[test]
    fn pin_precedence_argument_then_env_then_default() {
        let _guard = ENV_MUTEX.lock();
        clear_dev_login_env();
        assert_eq!(resolve_pin(Some("111111".to_string())), "111111");

        std::env::set_var("PACTO_DEV_LOGIN_PIN", "222222");
        assert_eq!(resolve_pin(None), "222222");
        // Argument still wins even with the env var set.
        assert_eq!(resolve_pin(Some("111111".to_string())), "111111");

        clear_dev_login_env();
        assert_eq!(resolve_pin(None), DEFAULT_DEV_PIN);
        clear_dev_login_env();
    }

    #[test]
    fn test_auth_gate_requires_exact_flag_value() {
        let _guard = ENV_MUTEX.lock();
        clear_dev_login_env();
        assert!(!test_auth_allowed());
        std::env::set_var("PACTO_ALLOW_TEST_AUTH", "true");
        assert!(!test_auth_allowed());
        std::env::set_var("PACTO_ALLOW_TEST_AUTH", "1");
        assert!(test_auth_allowed());
        clear_dev_login_env();
    }

    #[test]
    fn sandbox_only_refusal_names_identity_and_relays_not_secrets() {
        let message = sandbox_only_refusal(
            "npub1exampledevidentity",
            &[
                "wss://relay.example.com".to_string(),
                "wss://other.example.com".to_string(),
            ],
        );
        assert!(message.contains("npub1exampledevidentity"));
        assert!(message.contains("wss://relay.example.com"));
        assert!(message.contains("wss://other.example.com"));
        let lower = message.to_lowercase();
        assert!(!lower.contains("nsec"));
        assert!(!lower.contains("mnemonic"));
        assert!(!lower.contains("pin"));
    }
}
