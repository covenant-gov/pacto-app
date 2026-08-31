//! Account lifecycle commands: login/create/import, lock/unlock (PIN and biometric),
//! encrypt/decrypt, and relay-pool population on connect.

use crate::Profile;
use nostr_sdk::prelude::*;
use crate::{account_manager, clear_encryption_key, clear_nostr_client, crypto, db, evm, get_nostr_client, mnemonic_seed_clear, mnemonic_seed_get, mnemonic_seed_set, net_transport, nostr_tags, relay_cert, session, set_nostr_client, trusted_relays, PENDING_INVITE, STATE, SyncMode, TAURI_APP};
use tauri::{AppHandle, Manager, Runtime};

#[derive(serde::Serialize, Clone)]
pub(crate) struct LoginKeyPair {
    pub(crate) public: String,
    pub(crate) private: String,
    /// EVM private key (hex with 0x), derived from Nostr secret. Present for new/imported accounts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) evm_private_key: Option<String>,
    /// EVM address (0x + 40 hex chars). Present when evm_private_key is set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) evm_address: Option<String>,
}

/// Build client and profile state after keys are resolved (mnemonic- or nsec-derived).
pub(crate) async fn complete_login_from_keys(keys: Keys) -> Result<LoginKeyPair, String> {
    let client = Client::builder()
        .signer(keys.clone())
        .opts(ClientOptions::new())
        .monitor(Monitor::new(1024))
        .build();
    set_nostr_client(client);

    let npub = keys.public_key.to_bech32().map_err(|e| e.to_string())?;
    let mut profile = Profile::new();
    profile.id = npub.clone();
    profile.mine = true;
    {
        let mut st = STATE.lock().await;
        st.clear_session();
        st.profiles.push(profile);
    }

    if let Some(handle) = TAURI_APP.get() {
        let app_data = crate::test_sandbox::test_local_data_dir(handle).ok();
        if let Some(data_dir) = app_data {
            let profile_db = data_dir.join(&npub).join("pacto.db");
            if profile_db.exists() {
                let _ = crate::account_manager::set_current_account(npub.clone());
                println!("[Login] Set current account for SQL mode: {}", npub);
                // `ensure_ready` re-encrypts the active EVM signer via `internal_encrypt`, which
                // panics if `ENCRYPTION_KEY` isn't set yet. During a recovery-phrase restore this
                // runs before the PIN is collected; the frontend's own `encryptAndSaveEvmKey` call
                // right after PIN entry covers that case, so skip here and let the already-unlocked
                // (PIN-entered) login path run it instead.
                if crate::current_encryption_key().is_some() {
                    let _ = evm::evm_accounts::ensure_ready(handle.clone()).await;
                }
            } else if let Err(e) = account_manager::init_profile_database(handle, &npub).await {
                eprintln!("[Login] Failed to initialize profile database: {}", e);
            } else if let Err(e) = account_manager::set_current_account(npub.clone()) {
                eprintln!("[Login] Failed to set current account: {}", e);
            } else {
                println!(
                    "[Login] Initialized new profile database and set current account: {}",
                    npub
                );
            }
        }

        // Apply the persisted "Route Traffic Through Tor" preference now that the
        // account DB is selected, before `connect()` first populates the relay pool,
        // so relays are added with the right connection mode from the start.
        net_transport::apply_persisted_setting(handle).await;
    }

    let (evm_private_key, evm_address) = if let Some(m) = crate::mnemonic_seed_get() {
        evm::derive_eth_bip44_v1_from_mnemonic_phrase(&m, 0)
            .map(|(k, a)| (Some(k), Some(a)))
            .unwrap_or((None, None))
    } else if let Some(handle) = TAURI_APP.get() {
        match db::read_stored_evm_address(handle.clone()) {
            Ok(Some(addr)) if addr.len() >= 42 => (None, Some(addr)),
            _ => evm::derive_evm_hex_from_nostr_secret(&keys.secret_key().to_secret_bytes())
                .map(|t| (Some(t.0), Some(t.1)))
                .unwrap_or((None, None)),
        }
    } else {
        evm::derive_evm_hex_from_nostr_secret(&keys.secret_key().to_secret_bytes())
            .map(|t| (Some(t.0), Some(t.1)))
            .unwrap_or((None, None))
    };

    #[cfg(debug_assertions)]
    {
        let _ = crate::sandbox_handle::record_npub(&npub);
    }

    Ok(LoginKeyPair {
        public: npub,
        private: keys.secret_key().to_bech32().map_err(|e| e.to_string())?,
        evm_private_key,
        evm_address,
    })
}

/// Import a new profile from a BIP-39 recovery phrase only (`login` remains nsec for unlock).
#[tauri::command]
pub(crate) async fn login_with_recovery_phrase(mnemonic: String) -> Result<LoginKeyPair, String> {
    let trimmed = mnemonic.trim();
    if trimmed.is_empty() {
        return Err("Enter your recovery phrase".to_string());
    }
    if trimmed.starts_with("nsec") {
        return Err("Use your recovery phrase only here, not an nsec key.".to_string());
    }
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    if words.len() != 12 && words.len() != 24 {
        return Err("Recovery phrase must be 12 or 24 words.".to_string());
    }
    clear_nostr_client();
    let phrase = words.join(" ");
    let keys = Keys::from_mnemonic(phrase.clone(), None)
        .map_err(|_| "Invalid recovery phrase. Check spelling and word count.".to_string())?;
    mnemonic_seed_set(phrase);
    complete_login_from_keys(keys).await
}

/// Unlock or dev hot-reload: **nsec only**. Recovery phrase importers must use `login_with_recovery_phrase`.
#[tauri::command]
pub(crate) async fn login(import_key: String) -> Result<LoginKeyPair, String> {
    let import_key = import_key.trim();
    if import_key.is_empty() {
        return Err("Missing key".to_string());
    }

    if let Ok(client) = get_nostr_client() {
        let signer = client.signer().await.map_err(|e| e.to_string())?;
        let new_keys = Keys::parse(import_key).map_err(|_| "Invalid nsec".to_string())?;

        let prev_npub = signer
            .get_public_key()
            .await
            .map_err(|e| e.to_string())?
            .to_bech32()
            .map_err(|e| e.to_string())?;
        let new_npub = new_keys.public_key.to_bech32().map_err(|e| e.to_string())?;
        if prev_npub != new_npub {
            return Err(
                "A different key is already loaded. Restart the app or use the recovery phrase import flow."
                    .to_string(),
            );
        }
        let (evm_private_key, evm_address) =
            evm::derive_evm_hex_from_nostr_secret(&new_keys.secret_key().to_secret_bytes())
                .map(|t| (Some(t.0), Some(t.1)))
                .unwrap_or((None, None));
        return Ok(LoginKeyPair {
            public: prev_npub,
            private: new_keys
                .secret_key()
                .to_bech32()
                .map_err(|e| e.to_string())?,
            evm_private_key,
            evm_address,
        });
    }

    if !import_key.starts_with("nsec") {
        return Err(
            "Unlock uses your saved profile. Use Import on the welcome screen for a recovery phrase."
                .to_string(),
        );
    }

    let keys = Keys::parse(import_key).map_err(|_| "Invalid nsec".to_string())?;
    complete_login_from_keys(keys).await
}

/// Adds default + custom relays to the pool (skipping ones already present),
/// using the current transport mode (`net_transport::nostr_connection_mode`)
/// for newly added relays. Shared by `connect()` and by
/// `rebuild_relay_pool_connection_mode` (Tor toggle), which first empties
/// the pool so every relay picks up the new mode.
pub(crate) async fn populate_relay_pool<R: Runtime>(client: &Client, handle: &AppHandle<R>) {
    // Check which relays are already in the pool
    let existing_relays = client.relays().await;

    // Get disabled default relays
    let disabled_defaults = crate::cmds::relays::get_disabled_default_relays(handle).await.unwrap_or_default();

    // Add default relays (unless disabled or already present). A debug relay
    // override means "route all traffic here", so seeding the public defaults
    // beside it would put sandbox traffic on production relays.
    let seeded_defaults: &[&str] = if crate::trusted_relays::is_overridden() {
        &[]
    } else {
        crate::cmds::relays::DEFAULT_RELAYS
    };
    for default_url in seeded_defaults {
        let is_disabled = disabled_defaults
            .iter()
            .any(|d| d.to_lowercase() == default_url.to_lowercase());

        // Check if relay already exists in pool (case-insensitive)
        let already_exists = existing_relays
            .iter()
            .any(|(url, _)| url.to_string().to_lowercase() == default_url.to_lowercase());

        if already_exists {
            continue;
        }

        if !is_disabled {
            match client
                .pool()
                .add_relay(
                    *default_url,
                    RelayOptions::new()
                        .reconnect(false)
                        .connection_mode(net_transport::nostr_connection_mode()),
                )
                .await
            {
                Ok(_) => {
                    println!("[Relay] Added default relay: {}", default_url);
                    crate::cmds::relays::add_relay_log(default_url, "info", "Added to relay pool");
                }
                Err(e) => {
                    eprintln!("[Relay] Failed to add default relay {}: {}", default_url, e);
                    crate::cmds::relays::add_relay_log(default_url, "error", &format!("Failed to add: {}", e));
                }
            }
        } else {
            crate::cmds::relays::add_relay_log(default_url, "info", "Skipped (disabled by user)");
        }
    }

    // Add user's custom relays (if any)
    match crate::cmds::relays::get_custom_relays(handle.clone()).await {
        Ok(custom_relays) => {
            for relay in custom_relays {
                if relay.enabled {
                    match client
                        .pool()
                        .add_relay(&relay.url, crate::cmds::relays::relay_options_for_mode(&relay.mode))
                        .await
                    {
                        Ok(_) => {
                            println!(
                                "[Relay] Added custom relay: {} (mode: {})",
                                relay.url, relay.mode
                            );
                            crate::cmds::relays::add_relay_log(
                                &relay.url,
                                "info",
                                &format!("Added to relay pool (mode: {})", relay.mode),
                            );
                        }
                        Err(e) => {
                            eprintln!("[Relay] Failed to add custom relay {}: {}", relay.url, e);
                            crate::cmds::relays::add_relay_log(&relay.url, "error", &format!("Failed to add: {}", e));
                        }
                    }
                }
            }
        }
        Err(e) => eprintln!("[Relay] Failed to load custom relays: {}", e),
    }
}

/// Drops every relay from the live pool and re-adds default + custom relays
/// with the current transport mode, then reconnects. Called by the Tor
/// routing toggle so already-open relay connections pick up the new
/// connection mode without an app restart. A no-op if not logged in.
pub(crate) async fn rebuild_relay_pool_connection_mode<R: Runtime>(handle: &AppHandle<R>) {
    let Ok(client) = get_nostr_client() else {
        return;
    };
    client.pool().force_remove_all_relays().await;
    populate_relay_pool(&client, handle).await;
    client.connect().await;
}

/// Returns `true` if the client has connected, `false` if it was already connected
#[tauri::command]
pub(crate) async fn connect<R: Runtime>(handle: AppHandle<R>) -> bool {
    let client = get_nostr_client().expect("Nostr client not initialized");

    populate_relay_pool(&client, &handle).await;

    // Connect to all relays in the pool
    client.connect().await;

    // If the account-wide sync deferred a slice waiting on relays (see
    // `defer_sync_slice_for_empty_pool`), this call just populated the pool
    // it was waiting on — retry now instead of leaving it deferred until some unrelated trigger
    // (wake/reconnect) happens to fire `crate::cmds::chat::fetch_messages(false)` again.
    if STATE.lock().await.sync_slice_relay_wait {
        let handle_retry = handle.clone();
        tokio::spawn(async move {
            crate::cmds::chat::fetch_messages(handle_retry, false, None).await;
        });
    }

    true
}

// Tauri command that uses the crypto module
#[tauri::command]
pub(crate) async fn encrypt<R: Runtime>(
    handle: AppHandle<R>,
    input: String,
    password: Option<String>,
) -> Result<String, String> {
    session::heartbeat();
    let res = if let Some(pass) = password {
        crate::migration::encrypt_with_password(&handle, &input, &pass).await?
    } else {
        crypto::internal_encrypt(input).await
    };

    // If we have one; save the in-memory seed phrase in an encrypted at-rest format
    if let Some(seed) = mnemonic_seed_get() {
        let _ = db::set_seed(handle.clone(), seed).await;
    }

    // Check if we have a pending invite acceptance to broadcast
    if let Some(pending_invite) = PENDING_INVITE.get() {
        // Get the Nostr client
        if let Ok(client) = get_nostr_client() {
            // Clone the data we need before the async block
            let invite_code = pending_invite.invite_code.clone();
            let inviter_pubkey = pending_invite.inviter_pubkey.clone();

            // Spawn the broadcast in a separate task to avoid blocking
            tokio::spawn(async move {
                // Create and publish the acceptance event
                let event_builder =
                    EventBuilder::new(Kind::ApplicationSpecificData, "vector_invite_accepted")
                        .tag(nostr_tags::custom_tag("l", vec!["vector"]))
                        .tag(nostr_tags::custom_tag("d", vec![invite_code.as_str()]))
                        .tag(Tag::public_key(inviter_pubkey));

                // Build the event
                match client.sign_event_builder(event_builder).await {
                    Ok(event) => {
                        // Send only to trusted relays
                        match client
                            .send_event_to(trusted_relays::trusted_relays().iter().cloned(), &event)
                            .await
                        {
                            Ok(output) => {
                                crate::cmds::relays::record_send_outcome(&event, &output);
                                println!(
                                    "Successfully broadcast invite acceptance to trusted relays"
                                );
                            }
                            Err(e) => eprintln!("Failed to broadcast invite acceptance: {}", e),
                        }
                    }
                    Err(e) => eprintln!("Failed to sign invite acceptance event: {}", e),
                }
            });
        }
    }

    // Bootstrap MLS device keypackage for newly created accounts (non-blocking)
    // This ensures keypackages are published immediately after PIN setup, not just on restart
    tokio::spawn(async move {
        // Brief delay to allow encryption key to be set
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;

        // Skip if no account selected (migration pending)
        if crate::account_manager::get_current_account().is_err() {
            println!("[MLS] Skipping KeyPackage bootstrap - no account selected (migration may be pending)");
            return;
        }

        println!("[MLS] Ensuring persistent device KeyPackage after PIN setup...");
        match crate::cmds::mls_groups::regenerate_device_keypackage(true).await {
            Ok(info) => {
                let device_id = info.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
                let cached = info
                    .get("cached")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                println!(
                    "[MLS] Device KeyPackage ready: device_id={}, cached={}",
                    device_id, cached
                );
            }
            Err(e) => eprintln!("[MLS] Device KeyPackage bootstrap failed: {}", e),
        }
    });

    Ok(res)
}

// Tauri command that uses the crypto module
#[tauri::command]
pub(crate) async fn decrypt<R: Runtime>(
    handle: AppHandle<R>,
    ciphertext: String,
    password: Option<String>,
) -> Result<String, String> {
    session::heartbeat();
    // Perform decryption
    let res = if let Some(pass) = password {
        crate::migration::decrypt_with_password(&handle, &ciphertext, &pass).await?
    } else {
        crypto::internal_decrypt(ciphertext)
            .await
            .map_err(|_| "Decryption failed".to_string())?
    };

    // On success, ensure persistent device KeyPackage and run non-blocking smoke test
    // Best-effort persistent device KeyPackage bootstrap (non-blocking)
    tokio::spawn(async move {
        // brief delay to allow any post-login setup to settle
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;

        // Skip if no account selected (e.g. setup pending)
        if crate::account_manager::get_current_account().is_err() {
            println!("[MLS] Skipping KeyPackage bootstrap - no account selected");
            return;
        }

        println!("[MLS] Ensuring persistent device KeyPackage...");
        match crate::cmds::mls_groups::regenerate_device_keypackage(true).await {
            Ok(info) => {
                let device_id = info.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
                let cached = info
                    .get("cached")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                println!(
                    "[MLS] Device KeyPackage ready: device_id={}, cached={}",
                    device_id, cached
                );
            }
            Err(e) => eprintln!("[MLS] Device KeyPackage bootstrap failed: {}", e),
        }
    });

    Ok(res)
}

/// Export the current session's decryption key as lowercase hex, so the frontend can hand it
/// to the OS biometric-gated secure storage (`setData`) during biometric-unlock enrollment.
/// Requires an active unlocked session (a PIN unlock/create/import already ran in this process).
/// This is no more sensitive than the existing `decrypt` command already handing the frontend
/// the decrypted nsec itself post-unlock — the webview already holds plaintext secrets in memory
/// at this point in the login flow.
#[tauri::command]
pub(crate) fn export_encryption_key_material() -> Result<String, String> {
    let key = session::current_encryption_key().ok_or_else(|| "Not unlocked".to_string())?;
    Ok(hex::encode(key))
}

/// Unlock using key material recovered from OS biometric-gated storage (Touch ID / Windows
/// Hello), instead of deriving the key from a typed PIN. `key_hex` is exactly what
/// `export_encryption_key_material` produced at enrollment time.
///
/// The key is validated by decrypting the stored `pkey` *before* it is installed into the
/// global session, so a bad/stale/corrupted stored blob never makes `check_session` briefly
/// report `unlocked: true` for key material that doesn't actually decrypt anything. Once
/// installed, the account's persisted idle-lock timeout is restored (mirrors the PIN-unlock
/// paths in `migration.rs`) before an already-loaded client is reused or a fresh one is built.
#[tauri::command]
pub(crate) async fn unlock_with_biometric_key<R: Runtime>(
    handle: AppHandle<R>,
    key_hex: String,
) -> Result<LoginKeyPair, String> {
    let key = parse_biometric_key_hex(&key_hex)?;

    let encrypted_pkey = match db::get_pkey(handle.clone()) {
        Ok(Some(v)) if !v.is_empty() => v,
        _ => return Err("No stored key found".to_string()),
    };

    let nsec = crypto::decrypt_with_key(&encrypted_pkey, &key)
        .map_err(|()| "Biometric key material is no longer valid. Use your PIN.".to_string())?;

    let keys = Keys::parse(&nsec).map_err(|_| "Invalid stored key".to_string())?;

    session::set_encryption_key(key);
    if let Ok(conn) = account_manager::get_db_connection(&handle) {
        session::load_timeout_ms_from_conn(&conn);
        account_manager::return_db_connection(conn);
    }

    match reuse_loaded_client_if_matching(&keys).await {
        Ok(Some(pair)) => Ok(pair),
        Ok(None) => complete_login_from_keys(keys).await,
        Err(e) => {
            session::clear_encryption_key();
            Err(e)
        }
    }
}

#[cfg(test)]
mod biometric_unlock_tests {
    use super::parse_biometric_key_hex;

    #[test]
    fn parse_biometric_key_hex_round_trips_valid_key() {
        let key = [0x42u8; 32];
        let key_hex = hex::encode(key);
        assert_eq!(parse_biometric_key_hex(&key_hex).unwrap(), key);
    }

    #[test]
    fn parse_biometric_key_hex_trims_whitespace() {
        let key = [0x07u8; 32];
        let key_hex = format!("  {}\n", hex::encode(key));
        assert_eq!(parse_biometric_key_hex(&key_hex).unwrap(), key);
    }

    #[test]
    fn parse_biometric_key_hex_rejects_too_short() {
        let short_hex = hex::encode([0u8; 16]);
        assert!(parse_biometric_key_hex(&short_hex).is_err());
    }

    #[test]
    fn parse_biometric_key_hex_rejects_too_long() {
        let long_hex = hex::encode([0u8; 64]);
        assert!(parse_biometric_key_hex(&long_hex).is_err());
    }

    #[test]
    fn parse_biometric_key_hex_rejects_non_hex() {
        let not_hex = "z".repeat(64);
        assert!(parse_biometric_key_hex(&not_hex).is_err());
    }
}

#[tauri::command]
pub(crate) async fn deep_rescan<R: Runtime>(handle: AppHandle<R>) -> Result<bool, String> {
    // Check if a scan is already in progress
    {
        let state = STATE.lock().await;
        if state.is_syncing {
            return Err(
                "Already Scanning! Please wait for the current scan to finish.".to_string(),
            );
        }
    }

    // Start a deep rescan by forcing DeepRescan mode
    {
        let mut state = STATE.lock().await;
        let now = Timestamp::now();

        // Set up for deep rescan starting from now
        state.is_syncing = true;
        state.sync_mode = SyncMode::DeepRescan;
        state.sync_empty_iterations = 0;
        state.sync_total_iterations = 0;

        // Start with a 2-day window from now
        let two_days_ago = now.as_secs() - (60 * 60 * 24 * 2);
        state.sync_window_start = two_days_ago;
        state.sync_window_end = now.as_secs();
    }

    // Trigger the first fetch
    crate::cmds::chat::fetch_messages(handle, false, None).await;

    Ok(true)
}

#[tauri::command]
pub(crate) async fn is_scanning() -> bool {
    let state = STATE.lock().await;
    state.is_syncing
}

#[tauri::command]
pub(crate) async fn logout<R: Runtime>(handle: AppHandle<R>) {
    // Lock the state while we wipe disk and session so nothing races with stale in-memory chats.
    let mut state = STATE.lock().await;
    state.clear_session();

    // Close the database connection pool BEFORE attempting to delete files
    // This is critical on Windows where open file handles prevent deletion
    account_manager::close_db_connection();

    // Delete the current account's profile directory (SQL database and MLS data)
    if let Ok(npub) = account_manager::get_current_account() {
        if let Ok(profile_dir) = account_manager::get_profile_directory(&handle, &npub) {
            if profile_dir.exists() {
                if let Err(e) = std::fs::remove_dir_all(&profile_dir) {
                    eprintln!("[Logout] Failed to remove profile directory: {}", e);
                }
            }
        }
    }

    // Delete the downloads folder (pacto folder in Downloads or Documents on iOS)
    let base_directory = if cfg!(target_os = "ios") {
        tauri::path::BaseDirectory::Document
    } else {
        tauri::path::BaseDirectory::Download
    };

    if let Ok(downloads_dir) = handle.path().resolve("pacto", base_directory) {
        if downloads_dir.exists() {
            let _ = std::fs::remove_dir_all(&downloads_dir);
        }
    }

    // Delete the legacy MLS folder in the app data dir (backwards compatibility).
    // Resolved through the sandbox helper so a sandboxed run never reaches the
    // real OS app-data directory.
    if let Ok(mls_dir) = crate::test_sandbox::test_data_dir(&handle).map(|d| d.join("mls")) {
        if mls_dir.exists() {
            let _ = std::fs::remove_dir_all(&mls_dir);
        }
    }

    // Clear in-memory current account and Nostr client so backend is in logged-out state.
    // (Clearing client allows create_account/login to set a new one without restart.)
    clear_nostr_client();
    let _ = account_manager::clear_current_account();
    mnemonic_seed_clear();
    clear_encryption_key();

    clear_relay_diagnostics_on_logout();
    relay_cert::clear_certificate_cache();
    // `state` guard dropped here
}

/// Diagnostics are account-scoped (R15): clear stored failure reasons, plus the relay logs and
/// metrics that render in the same panel and otherwise hold ten entries per relay for the life
/// of the process with no other clear site in the crate. Split out of `logout` so it is
/// testable without the filesystem and account side effects the rest of `logout` carries.
pub(crate) fn clear_relay_diagnostics_on_logout() {
    if let Ok(mut failures) = crate::cmds::relays::RELAY_FAILURES.write() {
        failures.clear();
    }
    if let Ok(mut logs) = crate::cmds::relays::RELAY_LOGS.write() {
        logs.clear();
    }
    if let Ok(mut metrics) = crate::cmds::relays::RELAY_METRICS.write() {
        metrics.clear();
    }
    // `state` guard dropped here
}

/// Creates a new Nostr keypair derived from a BIP39 Seed Phrase
#[tauri::command]
pub(crate) async fn create_account() -> Result<LoginKeyPair, String> {
    session::heartbeat();
    // Generate a BIP39 Mnemonic Seed Phrase
    let mnemonic = bip39::Mnemonic::generate(12).map_err(|e| e.to_string())?;
    let mnemonic_string = mnemonic.to_string();

    // Derive our nsec from our Mnemonic
    let keys = Keys::from_mnemonic(mnemonic_string.clone(), None).map_err(|e| e.to_string())?;

    // Initialise the Nostr client
    let client = Client::builder()
        .signer(keys.clone())
        .opts(ClientOptions::new())
        .monitor(Monitor::new(1024))
        .build();
    set_nostr_client(client);

    // Add our profile (at least, the npub of it) to our state
    let npub = keys.public_key.to_bech32().map_err(|e| e.to_string())?;
    let mut profile = Profile::new();
    profile.id = npub.clone();
    profile.mine = true;
    {
        let mut st = STATE.lock().await;
        st.clear_session();
        st.profiles.push(profile);
    }

    // Save the seed in memory, ready for post-pin-setup encryption
    mnemonic_seed_set(mnemonic_string.clone());

    // Store npub temporarily - database will be created when set_pkey is called (after user sets PIN)
    // This prevents creating "dead accounts" if user quits before setting a PIN
    account_manager::set_pending_account(npub.clone())?;

    // BIP-44 account #0 from the same recovery phrase as Nostr (see docs/wallet/HD_DERIVATION_V1.md).
    let (evm_private_key, evm_address) =
        evm::derive_eth_bip44_v1_from_mnemonic_phrase(&mnemonic_string, 0)
            .map(|(k, a)| (Some(k), Some(a)))
            .unwrap_or((None, None));

    Ok(LoginKeyPair {
        public: npub,
        private: keys.secret_key().to_bech32().map_err(|e| e.to_string())?,
        evm_private_key,
        evm_address,
    })
}

/// Parse a 64-hex-char string into a 32-byte key. Pure/no I/O so it's unit-testable without an
/// `AppHandle`.
pub(crate) fn parse_biometric_key_hex(key_hex: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(key_hex.trim()).map_err(|_| "Invalid biometric key material".to_string())?;
    bytes.try_into().map_err(|_| "Invalid biometric key material".to_string())
}

/// If a Nostr client is already loaded (idle auto-lock only clears the session key, not the
/// client/`STATE` — see `SessionManager::clear`), reuse it instead of rebuilding, mirroring
/// `login`'s already-loaded-client branch so a lock-screen biometric unlock doesn't wipe
/// in-memory chat/profile state or bump `LOGIN_GENERATION` under a live session. Returns
/// `Ok(None)` when no client is loaded yet, so the caller falls through to a cold-start unlock.
pub(crate) async fn reuse_loaded_client_if_matching(keys: &Keys) -> Result<Option<LoginKeyPair>, String> {
    let client = match get_nostr_client() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let prev_npub = signer
        .get_public_key()
        .await
        .map_err(|e| e.to_string())?
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let new_npub = keys.public_key.to_bech32().map_err(|e| e.to_string())?;
    if prev_npub != new_npub {
        return Err("A different key is already loaded. Restart the app.".to_string());
    }
    let (evm_private_key, evm_address) =
        evm::derive_evm_hex_from_nostr_secret(&keys.secret_key().to_secret_bytes())
            .map(|t| (Some(t.0), Some(t.1)))
            .unwrap_or((None, None));
    Ok(Some(LoginKeyPair {
        public: prev_npub,
        private: keys.secret_key().to_bech32().map_err(|e| e.to_string())?,
        evm_private_key,
        evm_address,
    }))
}
