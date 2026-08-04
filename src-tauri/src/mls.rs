//! MLS (Message Layer Security) Module
//!
//! This module provides MLS group messaging capabilities using the nostr-mls crate.
//! We use nostr-mls defaults and communicate exclusively through TRUSTED_RELAYS.
//!
//! ## Storage Schema
//!
//! This module manages the following SQL tables:
//!
//! ### mls_groups table (encrypted metadata)
//! - group_id, engine_group_id, creator_pubkey, name, avatar_ref, created_at, updated_at, evicted
//!
//! ### mls_keypackages table (plaintext)
//! - owner_pubkey, device_id, keypackage_ref, fetched_at, expires_at
//!
//! ### mls_event_cursors table (plaintext)
//! - group_id, last_seen_event_id, last_seen_at
//!
//! ### Messages
//! Messages are stored in the unified Chat storage (see chat.rs), not in MLS-specific storage.
//! This allows protocol-agnostic message handling across DMs and MLS groups.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use mdk_core::prelude::*;
use mdk_sqlite_storage::{EncryptionConfig, MdkSqliteStorage};
use std::sync::Arc;
use tauri::{AppHandle, Runtime, Emitter};
use crate::{get_nostr_client, TAURI_APP, TRUSTED_RELAYS, STATE};
use crate::rumor::{RumorEvent, RumorContext, ConversationType, process_rumor, RumorProcessingResult};
use crate::nostr_tags;
use crate::db::{save_chat, save_chat_messages};
use nostr_sdk::PublicKey;

/// MLS-specific error types following this crate's error style
#[derive(Debug)]
pub enum MlsError {
    NotInitialized,
    InvalidGroupId,
    InvalidKeyPackage,
    GroupNotFound,
    MemberNotFound,
    StorageError(String),
    NetworkError(String),
    CryptoError(String),
    NostrMlsError(String),
}

impl std::fmt::Display for MlsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MlsError::NotInitialized => write!(f, "MLS service not initialized"),
            MlsError::InvalidGroupId => write!(f, "Invalid group ID"),
            MlsError::InvalidKeyPackage => write!(f, "Invalid key package"),
            MlsError::GroupNotFound => write!(f, "Group not found"),
            MlsError::MemberNotFound => write!(f, "Member not found"),
            MlsError::StorageError(e) => write!(f, "Storage error: {}", e),
            MlsError::NetworkError(e) => write!(f, "Network error: {}", e),
            MlsError::CryptoError(e) => write!(f, "Crypto error: {}", e),
            MlsError::NostrMlsError(e) => write!(f, "Nostr MLS error: {}", e),
        }
    }
}

impl std::error::Error for MlsError {}

/// MDK records this when a member's voluntary leave proposal is not auto-committed.
pub(crate) const MLS_LEAVE_PROPOSAL_FAILURE: &str = "not processing proposal from non-admin";

/// Read MDK `processed_messages.failure_reason` for a wrapper event (Kind 445).
pub(crate) fn mls_wrapper_failure_reason(event_id: &[u8; 32]) -> Option<String> {
    let handle = TAURI_APP.get()?;
    let npub = crate::account_manager::get_current_account().ok()?;
    let mls_dir = crate::account_manager::get_mls_directory(&handle, &npub).ok()?;
    let db_path = mls_dir.join("vector-mls.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    conn.query_row(
        "SELECT failure_reason FROM processed_messages WHERE wrapper_event_id = ?1",
        rusqlite::params![event_id.as_slice()],
        |row| row.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

/// MLS group metadata stored encrypted in "mls_groups"
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsGroupMetadata {
    // Wire identifier used on the relay (wrapper 'h' tag). UI lists this value.
    pub group_id: String,
    // Engine identifier used locally by nostr-mls for group state lookups.
    // Backwards compatible with existing data via serde default.
    #[serde(default)]
    pub engine_group_id: String,
    pub creator_pubkey: String,
    pub name: String,
    pub avatar_ref: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    // Flag indicating if we were evicted/kicked from this group
    // When true, we skip syncing this group (unless it's a new welcome/invite)
    #[serde(default)]
    pub evicted: bool,
}

/// Keypackage index entry stored in "mls_keypackage_index"
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KeyPackageIndexEntry {
    owner_pubkey: String,
    device_id: String,
    keypackage_ref: String,
    fetched_at: u64,
    expires_at: u64,
}

/// Event cursor tracking for a group stored in "mls_event_cursors"
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventCursor {
    pub last_seen_event_id: String,
    pub last_seen_at: u64,
}

/// Message record for persisting decrypted MLS messages

/// Main MLS service facade
/// 
/// Responsibilities:
/// - Initialize and manage MLS groups using nostr-mls
/// - Handle device keypackage publishing and management
/// - Process incoming MLS events from nostr relays
/// - Manage encrypted group metadata and message storage
pub struct MlsService {
    /// Persistent MLS engine when initialized (SQLite-backed via mdk-sqlite-storage)
    engine: Option<Arc<MDK<MdkSqliteStorage>>>,
    _initialized: bool,
}

/// Whether adding a member device is a first-time invite or a restoration of an existing leaf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MembershipAction {
    Invite,
    Restore,
}

/// A member who already has a live leaf in the group is being restored, not invited for the
/// first time — e.g. after this build's MLS store reset archives their old credential.
fn classify_membership_action(
    current_members: &std::collections::BTreeSet<PublicKey>,
    member_pk: &PublicKey,
) -> MembershipAction {
    if current_members.contains(member_pk) {
        MembershipAction::Restore
    } else {
        MembershipAction::Invite
    }
}

/// Restoring a member revokes their existing leaf, so it is gated like removal: only a group
/// admin may restore. A first-time invite is never gated.
fn authorize_membership_action(
    action: MembershipAction,
    admin_pubkeys: &std::collections::BTreeSet<PublicKey>,
    caller_pk: &PublicKey,
) -> Result<(), MlsError> {
    match action {
        MembershipAction::Invite => Ok(()),
        MembershipAction::Restore if admin_pubkeys.contains(caller_pk) => Ok(()),
        MembershipAction::Restore => Err(MlsError::NostrMlsError(
            "Only a group admin can restore a member who already has a leaf in the group".to_string(),
        )),
    }
}

impl MlsService {
    /// Create a new MLS service instance (no engine initialized)
    pub fn new() -> Self {
        Self {
            engine: None,
            _initialized: false,
        }
    }

    /// SQLCipher key for the MLS store, derived from the unlocked session key.
    ///
    /// MDK 0.8.0 removed the unencrypted store from its public API. The alternative it
    /// offers is a platform keyring, which would add a dependency and a new failure mode;
    /// the session key is already required for any MLS work, is per-account, and survives
    /// a reinstall from the recovery phrase. Domain separation keeps this distinct from
    /// the ChaCha20-Poly1305 key the same bytes serve elsewhere.
    fn mls_store_encryption_key() -> Result<[u8; 32], MlsError> {
        use sha2::{Digest, Sha256};

        let session_key = crate::session::current_encryption_key().ok_or_else(|| {
            MlsError::StorageError(
                "Account is locked: no session key available for the MLS store".to_string(),
            )
        })?;

        let mut hasher = Sha256::new();
        hasher.update(b"pacto/mls-store/v1");
        hasher.update(session_key);
        Ok(hasher.finalize().into())
    }

    fn mls_store_encryption_config(key: [u8; 32]) -> EncryptionConfig {
        EncryptionConfig::new(key)
    }

    /// Create a new MLS service with persistent SQLite-backed storage at:
    ///   [AppData]/npub.../mls/vector-mls.db (account-specific)
    pub fn new_persistent<R: Runtime>(handle: &AppHandle<R>) -> Result<Self, MlsError> {
        Self::new_persistent_inner(handle, false)
    }

    pub(crate) fn new_persistent_for_keypackage_refresh<R: Runtime>(
        handle: &AppHandle<R>,
    ) -> Result<Self, MlsError> {
        Self::new_persistent_inner(handle, true)
    }

    fn new_persistent_inner<R: Runtime>(
        handle: &AppHandle<R>,
        allow_pending_keypackage_refresh: bool,
    ) -> Result<Self, MlsError> {
        let npub = crate::account_manager::get_current_account()
            .map_err(|e| MlsError::StorageError(format!("No account selected: {}", e)))?;

        let mls_dir = crate::account_manager::get_mls_directory(handle, &npub)
            .map_err(|e| MlsError::StorageError(format!("Failed to get MLS directory: {}", e)))?;
        let db_path = mls_dir.join("vector-mls.db");
        let encryption_key = Self::mls_store_encryption_key()?;

        // Detection and archive happen before MDK 0.8.0 can open legacy bytes.
        let reset_outcome = crate::mls_store_reset::ensure_store_ready(
            handle,
            &npub,
            &mls_dir,
            &db_path,
            &encryption_key,
        )
        .map_err(MlsError::StorageError)?;

        if reset_outcome.reset_performed {
            if let Err(e) = crate::mls_store_reset::emit_reset_state(handle) {
                eprintln!("[MLS] Failed to emit store reset state: {}", e);
            }
        }
        if !allow_pending_keypackage_refresh
            && crate::mls_store_reset::keypackage_refresh_required(handle)
                .map_err(MlsError::StorageError)?
        {
            return Err(MlsError::StorageError(
                "MLS store access is paused until this device publishes a fresh KeyPackage"
                    .to_string(),
            ));
        }

        let storage = MdkSqliteStorage::new_with_key(
            &db_path,
            Self::mls_store_encryption_config(encryption_key),
        )
        .map_err(|e| MlsError::StorageError(format!("init sqlite storage: {}", e)))?;
        let mdk = MDK::new(storage);

        Ok(Self {
            engine: Some(Arc::new(mdk)),
            _initialized: true,
        })
    }

    /// Get a clone of the persistent MLS engine (Arc)
    pub fn engine(&self) -> Result<Arc<MDK<MdkSqliteStorage>>, MlsError> {
        self.engine.clone().ok_or(MlsError::NotInitialized)
    }

    /// Publish the device's keypackage to enable others to add this device to groups
    ///
    /// This will:
    /// 1. Generate a new keypackage for the device if needed
    /// 2. Publish it to TRUSTED_RELAYS via nostr-mls
    /// 3. Update "mls_keypackage_index" with the reference
    pub async fn publish_device_keypackage(&self, device_id: &str) -> Result<(), MlsError> {
        // TODO: Use nostr-mls to generate and publish keypackage
        // TODO: Store keypackage reference in "mls_keypackage_index"
        // TODO: Use TRUSTED_RELAYS for publishing
        
        // Stub implementation
        let _ = device_id;
        Ok(())
    }

    /// Create a new MLS group
    /// 
    /// This will:
    /// 1. Create the group using nostr-mls
    /// 2. Add initial member devices
    /// 3. Store encrypted metadata in "mls_groups" using crypto::internal_encrypt
    /// 4. Initialize per-group message storage keys
    /*
    Flow and error surfaces for persistent group creation (UI-visible behavior)
    - Inputs:
      • name: UI-supplied group name (validated in [rust.create_group_chat()](src-tauri/src/lib.rs:3108))
      • avatar_ref: not used for this subtask (None)
      • initial_member_devices: Vec of (member_npub, device_id) pairs chosen by the caller

    - Steps:
      1) Resolve creator pubkey and build NostrGroupConfigData scoped to TRUSTED_RELAYS.
      2) Resolve each member device to its KeyPackage Event before touching the MLS engine:
         • Prefer local plaintext index "mls_keypackage_index" to get keypackage_ref by member npub + device_id.
         • If ref exists: fetch exact event by id; else: fetch latest Kind::MlsKeyPackage by author.
         • Any member device with no resolvable KeyPackage is skipped here (this is a safe-guard; the UI path pre-validates via [rust.create_group_chat()](src-tauri/src/lib.rs:3108) and should not reach here with missing devices).
      3) Create the group with the persistent sqlite-backed engine (no await while engine is in scope):
         • engine.create_group(my_pubkey, member_kp_events, admins=[my_pubkey], group_config)
         • Capture:
           - engine_group_id (internal engine id, hex) for local operations and send path.
           - wire group id used on relays (h tag). We derive a canonical 64-hex when possible; fallback to engine id.
      4) Publish welcome(s) to invited recipients 1:1 via gift_wrap_to on TRUSTED_RELAYS.
      5) Persist encrypted UI metadata ("mls_groups") with:
         • group_id = wire id (relay filtering id, shown in UI)
         • engine_group_id = engine id (used by [rust.send_mls_group_message()](src-tauri/src/lib.rs:3144))
      6) Emit "mls_group_initial_sync" immediately so the frontend can refresh chat list without restart.

    - Error mapping (propagated as strings to the UI):
      • MlsError::NotInitialized: Nostr client/app handle not ready.
      • MlsError::NetworkError: signer resolution, relay parsing, or network fetch/publish failures.
      • MlsError::NostrMlsError: engine create_group/create_message failures (e.g., storage/codec issues).
      • MlsError::StorageError: reading/writing SQL database or sqlite engine initialization paths.
      • MlsError::CryptoError: bech32 conversions or encrypted data (de)serialization.
      These are returned as Err(String) up to [rust.create_group_chat()](src-tauri/src/lib.rs:3108) and surfaced verbatim by the UI.

    - Persistence & discoverability:
      • The group metadata is written to "mls_groups" (encrypted) so it appears in list_mls_groups().
      • Event "mls_group_initial_sync" is emitted here for zero-latency list refresh.

    - Partial membership:
      • If some members had no resolvable KeyPackage at engine time, they are skipped here; however, the preflight in [rust.create_group_chat()](src-tauri/src/lib.rs:3108) aborts early on any missing device, ensuring atomic creation semantics for the UI flow.
    */
    pub async fn create_group(
        &self,
        name: &str,
        avatar_ref: Option<&str>,
        initial_member_devices: &[(String, String)], // (member_pubkey, device_id) pairs
    ) -> Result<String, MlsError> {
        // Persistent group creation using sqlite-backed engine.
        // - Resolve signer and relay config
        // - Use engine.create_group() inside a no-await scope (avoid holding !Send across await)
        // - Publish welcome (if any) to TRUSTED_RELAY
        // - Store encrypted UI metadata to "mls_groups"
        //
        // TODO: Resolve `initial_member_devices` into Vec<Event> KeyPackages (from index or network).

        // Resolve client and my pubkey
        let client = get_nostr_client().map_err(|_| MlsError::NotInitialized)?;
        let signer = client
            .signer()
            .await
            .map_err(|e| MlsError::NetworkError(e.to_string()))?;
        let my_pubkey = signer
            .get_public_key()
            .await
            .map_err(|e| MlsError::NetworkError(e.to_string()))?;
        let creator_pubkey_b32 = my_pubkey
            .to_bech32()
            .map_err(|e| MlsError::CryptoError(e.to_string()))?;

        // Build group config (relay-scoped)
        let relay_urls: Vec<RelayUrl> = TRUSTED_RELAYS
            .iter()
            .filter_map(|r| RelayUrl::parse(r).ok())
            .collect();
        let description = format!("Vector group: {}", name);
        let group_config = NostrGroupConfigData::new(
            name.to_string(),
            description,
            None, // image_hash
            None, // image_key
            None, // image_nonce
            relay_urls,
            vec![my_pubkey], // admins - moved from create_group call
        );

        // Resolve member KeyPackage events before engine usage (awaits allowed here)
        use nostr_sdk::prelude::*;
        let mut member_kp_events: Vec<Event> = Vec::new();
        let mut invited_recipients: Vec<PublicKey> = Vec::new();

        // Load plaintext index
        let index = self.read_keypackage_index().await.unwrap_or_default();

        for (member_npub, device_id) in initial_member_devices.iter() {
            // Parse target public key (used for later gift-wrapping)
            let member_pk = match PublicKey::from_bech32(member_npub) {
                Ok(pk) => pk,
                Err(_) => {
                    eprintln!("[MLS] Invalid member npub: {}", member_npub);
                    continue;
                }
            };

            // Try index first
            let mut ref_event_id_hex: Option<String> = None;
            for entry in &index {
                if entry.owner_pubkey == *member_npub && entry.device_id == *device_id {
                    ref_event_id_hex = Some(entry.keypackage_ref.clone());
                    break;
                }
            }

            let kp_event: Option<Event> = if let Some(id_hex) = ref_event_id_hex {
                // Fetch exact event by id from TRUSTED_RELAY
                let id = match EventId::from_hex(&id_hex) {
                    Ok(v) => v,
                    Err(_) => {
                        println!("[MLS] Invalid keypackage_ref in index for {}:{}", member_npub, device_id);
                        continue;
                    }
                };
                let filter = Filter::new().id(id).limit(1);
                match get_nostr_client()
                    .unwrap()
                    .fetch_events_from(TRUSTED_RELAYS.to_vec(), filter, std::time::Duration::from_secs(10))
                    .await
                {
                    Ok(events) => events.into_iter().next(),
                    Err(e) => {
                        eprintln!("[MLS] Fetch KeyPackage by id failed ({}:{}): {}", member_npub, device_id, e);
                        None
                    }
                }
            } else {
                // Fallback: fetch latest KeyPackage by author from TRUSTED_RELAYS
                let filter = Filter::new()
                    .author(member_pk)
                    .kind(Kind::MlsKeyPackage)
                    .limit(50);
                match get_nostr_client()
                    .unwrap()
                    .fetch_events_from(TRUSTED_RELAYS.to_vec(), filter, std::time::Duration::from_secs(10))
                    .await
                {
                    Ok(events) => {
                        // Heuristic: pick newest by created_at
                        let selected = events.into_iter().max_by_key(|e| e.created_at.as_secs());
                        if selected.is_none() {
                            eprintln!("[MLS] No KeyPackage events found for {}", member_npub);
                        }
                        selected
                    }
                    Err(e) => {
                        eprintln!("[MLS] Fetch KeyPackages for {} failed: {}", member_npub, e);
                        None
                    }
                }
            };

            if let Some(ev) = kp_event {
                member_kp_events.push(ev);
                invited_recipients.push(member_pk);
            } else {
                // Continue without this member device (will create group without them)
                eprintln!("[MLS] Skipping member device {}:{} (no KeyPackage event)", member_npub, device_id);
            }
        }

        let invited_count = member_kp_events.len();

        // Perform engine operations without awaits in scope
        let (group_id_hex, engine_gid_hex, welcome_rumors) = {
            let engine = self.engine()?; // Arc to sqlite engine (may be !Send internally)
            let create_out = engine
                .create_group(
                    &my_pubkey,
                    member_kp_events,              // invited devices' keypackage events
                    group_config,                  // admins now in config
                )
                .map_err(|e| MlsError::NostrMlsError(format!("create_group: {}", e)))?;

            // GroupId is already a GroupId type in MDK (no conversion needed)
            let gid_bytes = create_out.group.mls_group_id.as_slice();
            let engine_gid_hex = hex::encode(gid_bytes);

            // Attempt to derive wire id (wrapper 'h' tag, 64-hex) using a non-published dummy wrapper.
            // If unavailable, fall back to engine id.
            let wire_gid_hex = {
                use nostr_sdk::prelude::*;
                let dummy_rumor = EventBuilder::new(Kind::Custom(9), "vector-mls-bootstrap")
                    .tag(nostr_tags::custom_tag("vector-mls-bootstrap", vec!["true"]))
                    .build(*&my_pubkey);
                if let Ok(wrapper) = engine.create_message(&create_out.group.mls_group_id, dummy_rumor, None) {
                    if let Some(h_tag) = nostr_tags::find_letter(&wrapper.tags, Alphabet::H)
                    {
                        if let Some(canon) = h_tag.content() {
                            if canon.len() == 64 {
                                canon.to_string()
                            } else {
                                // Fallback to engine id if 'h' content is unexpected
                                engine_gid_hex.clone()
                            }
                        } else {
                            engine_gid_hex.clone()
                        }
                    } else {
                        engine_gid_hex.clone()
                    }
                } else {
                    engine_gid_hex.clone()
                }
            };

            // Use wire id for UI/store group_id (relay filtering), engine id for local engine ops.
            let gid_hex = wire_gid_hex;

            (gid_hex, engine_gid_hex, create_out.welcome_rumors)
        }; // engine dropped here before any await

        // Accept 32-hex or 64-hex group ids (engine/codec variability)
        if group_id_hex.len() != 32 && group_id_hex.len() != 64 {
            eprintln!(
                "[MLS] create_group: unexpected group_id length={}, proceeding may affect relay filtering",
                group_id_hex.len()
            );
        }

        // Publish welcomes (gift-wrapped) 1:1 with invited recipients where possible
        if !welcome_rumors.is_empty() {
            if welcome_rumors.len() != invited_count {
                eprintln!(
                    "[MLS] welcome/member count mismatch: welcomes={}, invited={}",
                    welcome_rumors.len(),
                    invited_count
                );
            }
            let min_len = std::cmp::min(welcome_rumors.len(), invited_recipients.len());
            let mut welcome_failures = 0usize;
            for i in 0..min_len {
                let welcome = welcome_rumors[i].clone(); // UnsignedEvent
                let target = invited_recipients[i];
                match get_nostr_client()
                    .unwrap()
                    .gift_wrap_to(TRUSTED_RELAYS.iter().copied(), &target, welcome, [])
                    .await
                {
                    Ok(wrapper_id) => {
                        let recipient = target.to_bech32().unwrap_or_default();
                        println!(
                            "[MLS][welcome][published] wrapper_id={}, recipient={}, relays={:?}",
                            wrapper_id.to_hex(),
                            recipient,
                            TRUSTED_RELAYS
                        );
                    }
                    Err(e) => {
                        welcome_failures += 1;
                        let recipient = target.to_bech32().unwrap_or_default();
                        eprintln!(
                            "[MLS][welcome][publish_error] recipient={}, relays={:?}, err={}",
                            recipient,
                            TRUSTED_RELAYS,
                            e
                        );
                    }
                }
            }
            if invited_count > 0 && welcome_failures > 0 {
                return Err(MlsError::NetworkError(format!(
                    "Failed to deliver MLS welcome to {} of {} members",
                    welcome_failures, invited_count
                )));
            }
        } else {
            println!(
                "[MLS] No welcome rumors (invited={}, self-only path likely)",
                invited_count
            );
            if invited_count > 0 {
                return Err(MlsError::NetworkError(
                    "MLS group create returned no welcomes for invited members".to_string(),
                ));
            }
        }

        // Persist encrypted "mls_groups"
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| MlsError::StorageError(format!("system time error: {}", e)))?
            .as_secs();

        let meta = MlsGroupMetadata {
            group_id: group_id_hex.clone(),        // wire id for UI/filtering
            engine_group_id: engine_gid_hex,       // engine id for local operations
            creator_pubkey: creator_pubkey_b32,
            name: name.to_string(),
            avatar_ref: avatar_ref.map(|s| s.to_string()),
            created_at: now_secs,
            updated_at: now_secs,
            evicted: false,                        // New groups are not evicted
        };

        let mut groups = self.read_groups().await?;
        groups.push(meta.clone());
        self.write_groups(&groups).await?;
        emit_group_metadata_event(&meta);
 
        // Create the Chat in STATE with metadata and save to disk
        {
            let mut state = STATE.lock().await;
            let chat_id = state.create_or_get_mls_group_chat(&group_id_hex, vec![]);
            
            // Set metadata from MlsGroupMetadata
            if let Some(chat) = state.get_chat_mut(&chat_id) {
                chat.metadata.set_name(meta.name.clone());
                chat.metadata.set_member_count(invited_count + 1); // +1 for creator
            }
            
            // Save chat to disk
            if let Some(handle) = TAURI_APP.get() {
                let handle_clone = handle.clone();
                if let Some(chat) = state.get_chat(&chat_id) {
                    if let Err(e) = save_chat(handle_clone, chat).await {
                        eprintln!("[MLS] Failed to save chat after group creation: {}", e);
                    }
                }
            }
        }
 
        // Notify UI: reuse the same event used after welcome-accept so creator also sees the group immediately.
        if let Some(handle) = TAURI_APP.get() {
            handle.emit("mls_group_initial_sync", serde_json::json!({
                "group_id": group_id_hex,
                "processed": 0u32,
                "new": 0u32
            })).unwrap_or_else(|e| {
                eprintln!("[MLS] Failed to emit mls_group_initial_sync after create: {}", e);
            });
        }
 
        println!(
            "[MLS] Created group (persistent) id={}, name=\"{}\", invited_devices_hint={}",
            group_id_hex,
            name,
            initial_member_devices.len()
        );
        Ok(group_id_hex)
    }

    /// Add a member device to an existing group
    ///
    /// This will:
    /// 1. Fetch the device's keypackage from the network
    /// 2. Add the device to the group via nostr-mls
    /// 3. Send the welcome message
    /// 4. Update group metadata
    ///
    /// If the member already has a live leaf in the group, this is a restoration rather than a
    /// first-time invite: the existing leaf is revoked (removed) before the new one is added, so
    /// the epoch advances past whatever secrets an archived credential still holds. Restoration
    /// requires the caller to be a group admin. This revocation only holds when this build
    /// performs the restoration — an admin still on the pre-upgrade build restores access the
    /// old way and does not revoke.
    pub async fn add_member_device(
        &self,
        group_id: &str,
        member_pubkey: &str,
        device_id: &str,
    ) -> Result<(), MlsError> {
        use nostr_sdk::prelude::*;

        // Resolve client
        let client = get_nostr_client().map_err(|_| MlsError::NotInitialized)?;

        // Parse member public key
        let member_pk = PublicKey::from_bech32(member_pubkey)
            .map_err(|e| MlsError::CryptoError(format!("Invalid member npub: {}", e)))?;

        // Find the group's MLS group ID
        let groups = self.read_groups().await?;
        let group_meta = groups.iter()
            .find(|g| g.group_id == group_id || g.engine_group_id == group_id)
            .ok_or(MlsError::GroupNotFound)?;
        
        // Convert engine_group_id hex to GroupId
        let mls_group_id = GroupId::from_slice(
            &hex::decode(&group_meta.engine_group_id)
                .map_err(|e| MlsError::CryptoError(format!("Invalid group ID hex: {}", e)))?
        );

        // A member who already has a leaf is being restored, not invited for the first time.
        let action = {
            let engine = self.engine()?;
            let current_members = engine.get_members(&mls_group_id).map_err(|e| {
                eprintln!("[MLS] Failed to get current members: {}", e);
                MlsError::NostrMlsError(format!("Failed to get group members: {}", e))
            })?;
            classify_membership_action(&current_members, &member_pk)
        };

        if action == MembershipAction::Restore {
            // Restoring access revokes the old leaf, so gate it like removal: admin only.
            let my_pk = client
                .signer()
                .await
                .map_err(|e| MlsError::CryptoError(e.to_string()))?
                .get_public_key()
                .await
                .map_err(|e| MlsError::CryptoError(e.to_string()))?;

            let admin_pubkeys = {
                let engine = self.engine()?;
                engine
                    .get_groups()
                    .ok()
                    .and_then(|stored| {
                        stored
                            .into_iter()
                            .find(|g| g.mls_group_id.as_slice() == mls_group_id.as_slice())
                    })
                    .map(|g| g.admin_pubkeys)
                    .unwrap_or_default()
            };
            authorize_membership_action(action, &admin_pubkeys, &my_pk)?;
        }

        // Fetch member's keypackage. A restoration must resolve fresh from the network: a reset
        // member republishes a new keypackage backed by their new store, and the cached index
        // entry still points at the pre-reset keypackage whose private init key only lives in
        // the archived store — a welcome built against it would be openable only by the archive.
        let kp_event = if action == MembershipAction::Restore {
            Self::fetch_latest_keypackage(&client, member_pk).await
        } else {
            let index = self.read_keypackage_index().await.unwrap_or_default();
            let mut kp_event: Option<Event> = None;

            // Try index first
            for entry in &index {
                if entry.owner_pubkey == member_pubkey && entry.device_id == device_id {
                    let id = EventId::from_hex(&entry.keypackage_ref)
                        .map_err(|e| MlsError::CryptoError(format!("Invalid keypackage ref: {}", e)))?;
                    let filter = Filter::new().id(id).limit(1);
                    if let Ok(events) = client
                        .fetch_events_from(TRUSTED_RELAYS.to_vec(), filter, std::time::Duration::from_secs(10))
                        .await
                    {
                        kp_event = events.into_iter().next();
                    }
                    break;
                }
            }

            // Fallback: fetch latest from network
            if kp_event.is_none() {
                kp_event = Self::fetch_latest_keypackage(&client, member_pk).await;
            }

            kp_event
        };

        let kp_event = kp_event.ok_or_else(|| {
            MlsError::NetworkError(format!("No keypackage found for {}:{}", member_pubkey, device_id))
        })?;

        // Restoration first removes the member's existing (possibly archived) leaf so the epoch
        // advances past whatever secrets the archive holds; the add below then proceeds exactly
        // like a first-time invite. If the remove commits but the add then fails, the member
        // ends up outside the group entirely — reported below as a distinct, explicit error
        // rather than the generic add failure, since that state needs a retry, not a shrug.
        let mut restoration_remove_committed = false;
        if action == MembershipAction::Restore {
            let remove_evolution_event = {
                let engine = self.engine()?;
                engine
                    .remove_members(&mls_group_id, &[member_pk])
                    .map_err(|e| {
                        eprintln!("[MLS] Restoration: failed to remove archived leaf: {}", e);
                        MlsError::NostrMlsError(format!("Failed to remove archived leaf: {}", e))
                    })?
                    .evolution_event
            };

            match client.send_event(&remove_evolution_event).await {
                Ok(output) => crate::record_send_outcome(&remove_evolution_event, &output),
                Err(e) => {
                    eprintln!("[MLS] Restoration: failed to publish remove commit: {}", e);
                    return Err(MlsError::NetworkError(format!(
                        "Failed to publish restoration remove commit: {}", e
                    )));
                }
            }

            {
                let engine = self.engine()?;
                engine.merge_pending_commit(&mls_group_id).map_err(|e| {
                    eprintln!("[MLS] Restoration: failed to merge remove commit: {}", e);
                    MlsError::NostrMlsError(format!("Failed to merge restoration remove commit: {}", e))
                })?;
            }

            restoration_remove_committed = true;
        }

        // Perform engine operations (add member but DON'T merge yet)
        let add_outcome: Result<(), MlsError> = async {
            let (evolution_event, welcome_rumors) = {
                let engine = self.engine()?;

                // Add member to group - returns AddMembersResult with evolution_event and welcome_rumors
                let add_result = engine
                    .add_members(&mls_group_id, std::slice::from_ref(&kp_event))
                    .map_err(|e| {
                        eprintln!("[MLS] Failed to add member: {}", e);
                        MlsError::NostrMlsError(format!("Failed to add member: {}", e))
                    })?;

                (add_result.evolution_event, add_result.welcome_rumors)
            };

            // Send welcome before merging commit (welcome is created for current epoch)
            let mut welcome_send_failed = false;
            if let Some(welcome_rumors) = welcome_rumors {
                if welcome_rumors.is_empty() {
                    welcome_send_failed = true;
                    eprintln!("[MLS] add_member_device: empty welcome rumors");
                }
                for welcome in welcome_rumors {
                    if let Err(e) = client.gift_wrap_to(TRUSTED_RELAYS.iter().copied(), &member_pk, welcome, []).await {
                        eprintln!("[MLS] Failed to send welcome: {}", e);
                        welcome_send_failed = true;
                    }
                }
            } else {
                welcome_send_failed = true;
                eprintln!("[MLS] add_member_device: no welcome rumors returned");
            }

            if welcome_send_failed {
                return Err(MlsError::NetworkError(
                    "Failed to deliver MLS welcome to the new member".to_string(),
                ));
            }

            // Publish evolution event (commit) to the relay
            match client.send_event(&evolution_event).await {
                Ok(output) => crate::record_send_outcome(&evolution_event, &output),
                Err(e) => {
                    eprintln!("[MLS] Failed to publish commit: {}", e);
                    return Err(MlsError::NetworkError(format!("Failed to publish commit: {}", e)));
                }
            }

            // NOW merge the pending commit after welcome and evolution event are sent
            {
                let engine = self.engine()?;
                engine
                    .merge_pending_commit(&mls_group_id)
                    .map_err(|e| {
                        eprintln!("[MLS] Failed to merge commit: {}", e);
                        MlsError::NostrMlsError(format!("Failed to merge commit: {}", e))
                    })?;
            }

            Ok(())
        }
        .await;

        if let Err(e) = add_outcome {
            if restoration_remove_committed {
                eprintln!(
                    "[MLS] Restoration left {} outside the group: remove committed but re-add failed: {}",
                    member_pubkey, e
                );
                return Err(MlsError::NostrMlsError(format!(
                    "Restoration incomplete: the archived leaf for {} was removed but re-adding them failed ({}). They are currently not a member of the group; retry the restore.",
                    member_pubkey, e
                )));
            }
            return Err(e);
        }

        // Update group metadata timestamp
        let mut groups = self.read_groups().await?;
        if let Some(group) = groups.iter_mut().find(|g| g.group_id == group_id) {
            group.updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            self.write_groups(&groups).await?;
        }

        // Emit event to refresh UI
        if let Some(handle) = TAURI_APP.get() {
            handle.emit("mls_group_updated", serde_json::json!({
                "group_id": group_id
            })).ok();
        }

        Ok(())
    }

    /// Fetch the newest published KeyPackage (Kind:443) for a pubkey directly from the network,
    /// bypassing the local keypackage index/cache.
    async fn fetch_latest_keypackage(
        client: &nostr_sdk::Client,
        member_pk: PublicKey,
    ) -> Option<nostr_sdk::Event> {
        use nostr_sdk::prelude::*;

        let filter = Filter::new()
            .author(member_pk)
            .kind(Kind::MlsKeyPackage)
            .limit(50);
        client
            .fetch_events_from(TRUSTED_RELAYS.to_vec(), filter, std::time::Duration::from_secs(10))
            .await
            .ok()
            .and_then(|events| events.into_iter().max_by_key(|e| e.created_at.as_secs()))
    }



    /// Leave a group voluntarily
    ///
    /// This will:
    /// 1. Create a leave proposal using MDK's leave_group()
    /// 2. Publish the evolution event to the relay
    /// 3. Remove the group from local metadata
    ///
    /// Note: The leave creates a proposal that needs to be committed by an admin
    pub async fn leave_group(&self, group_id: &str) -> Result<(), MlsError> {
        use nostr_sdk::prelude::*;

        // Resolve client
        let client = get_nostr_client().map_err(|_| MlsError::NotInitialized)?;

        // Find the group's MLS group ID
        let groups = self.read_groups().await?;
        let group_meta = groups.iter()
            .find(|g| g.group_id == group_id || g.engine_group_id == group_id)
            .ok_or(MlsError::GroupNotFound)?;
        
        // Convert engine_group_id hex to GroupId
        let mls_group_id = GroupId::from_slice(
            &hex::decode(&group_meta.engine_group_id)
                .map_err(|e| MlsError::CryptoError(format!("Invalid group ID hex: {}", e)))?
        );

        // Perform engine operation (leave group)
        let evolution_event = {
            let engine = self.engine()?;
            
            // Leave the group - returns LeaveGroupResult with evolution_event
            let leave_result = engine
                .leave_group(&mls_group_id)
                .map_err(|e| {
                    eprintln!("[MLS] Failed to leave group: {}", e);
                    MlsError::NostrMlsError(format!("Failed to leave group: {}", e))
                })?;

            leave_result.evolution_event
        };

        // Publish the evolution event (leave proposal) to the relay
        match client.send_event(&evolution_event).await {
            Ok(output) => crate::record_send_outcome(&evolution_event, &output),
            Err(e) => eprintln!("[MLS] Failed to publish leave proposal: {}", e),
        }

        // Remove the group from local metadata
        let mut groups = self.read_groups().await?;
        groups.retain(|g| g.group_id != group_id && g.engine_group_id != group_meta.engine_group_id);
        self.write_groups(&groups).await?;

        // Emit event to refresh UI
        if let Some(handle) = TAURI_APP.get() {
            handle.emit("mls_group_left", serde_json::json!({
                "group_id": group_id
            })).ok();
        }

        Ok(())
    }

    /// Remove a member device from a group (admin only)
    ///
    /// This will:
    /// 1. Remove the member using MDK's remove_members()
    /// 2. Publish the commit message to remaining group members
    /// 3. Merge the pending commit locally
    /// 4. Emit UI update event
    pub async fn remove_member_device(
        &self,
        group_id: &str,
        member_pubkey: &str,
        _device_id: &str,
    ) -> Result<(), MlsError> {
        use nostr_sdk::prelude::*;

        // Resolve client
        let client = get_nostr_client().map_err(|_| MlsError::NotInitialized)?;

        // Parse member pubkey
        let member_pk = PublicKey::from_bech32(member_pubkey)
            .map_err(|e| MlsError::CryptoError(format!("Invalid member pubkey: {}", e)))?;

        // Find the group's MLS group ID
        let groups = self.read_groups().await?;
        let group_meta = groups.iter()
            .find(|g| g.group_id == group_id || g.engine_group_id == group_id)
            .ok_or(MlsError::GroupNotFound)?;
        
        // Convert engine_group_id hex to GroupId
        let mls_group_id = GroupId::from_slice(
            &hex::decode(&group_meta.engine_group_id)
                .map_err(|e| MlsError::CryptoError(format!("Invalid group ID hex: {}", e)))?
        );

        // Sync the group first to ensure we have the latest state
        if let Err(e) = self.sync_group_since_cursor(group_id).await {
            eprintln!("[MLS] Failed to sync group before removal: {}", e);
        }
        
        // Perform engine operation (remove member but DON'T merge yet)
        let evolution_event = {
            let engine = self.engine()?;
            
            // Verify the member exists in the group
            let current_members = engine.get_members(&mls_group_id)
                .map_err(|e| {
                    eprintln!("[MLS] Failed to get current members: {}", e);
                    MlsError::NostrMlsError(format!("Failed to get group members: {}", e))
                })?;
            
            if !current_members.contains(&member_pk) {
                eprintln!("[MLS] Member {} not found in group", member_pubkey);
                return Err(MlsError::NostrMlsError(
                    "Member not found in group. The group state may be out of sync.".to_string()
                ));
            }
            
            // Remove member from group - returns RemoveMembersResult with evolution_event
            let remove_result = engine
                .remove_members(&mls_group_id, &[member_pk])
                .map_err(|e| {
                    eprintln!("[MLS] Failed to remove member: {}", e);
                    MlsError::NostrMlsError(format!("Failed to remove member: {}", e))
                })?;

            remove_result.evolution_event
        };

        // Publish evolution event (commit) to the relay
        match client.send_event(&evolution_event).await {
            Ok(output) => crate::record_send_outcome(&evolution_event, &output),
            Err(e) => {
                eprintln!("[MLS] Failed to publish commit: {}", e);
                return Err(MlsError::NetworkError(format!("Failed to publish commit: {}", e)));
            }
        }

        // NOW merge the pending commit after evolution event is sent
        {
            let engine = self.engine()?;
            engine
                .merge_pending_commit(&mls_group_id)
                .map_err(|e| {
                    eprintln!("[MLS] Failed to merge commit: {}", e);
                    MlsError::NostrMlsError(format!("Failed to merge commit: {}", e))
                })?;
        }

        // Emit event to refresh UI member list
        if let Some(handle) = TAURI_APP.get() {
            handle.emit("mls_group_updated", serde_json::json!({
                "group_id": group_id
            })).ok();
        }
        Ok(())
    }

    /// When a member publishes a voluntary leave proposal, MDK rejects it as non-admin and
    /// leaves the group tree unchanged. Group admins finalize the leave with remove + commit.
    pub async fn finalize_voluntary_leave_as_admin(
        &self,
        wire_group_id: &str,
        leaver: nostr_sdk::PublicKey,
    ) -> Result<bool, MlsError> {
        use nostr_sdk::prelude::*;

        let client = get_nostr_client().map_err(|_| MlsError::NotInitialized)?;
        let my_pk = client
            .signer()
            .await
            .map_err(|e| MlsError::CryptoError(e.to_string()))?
            .get_public_key()
            .await
            .map_err(|e| MlsError::CryptoError(e.to_string()))?;

        let groups = self.read_groups().await?;
        let group_meta = groups
            .iter()
            .find(|g| g.group_id == wire_group_id || g.engine_group_id == wire_group_id)
            .ok_or(MlsError::GroupNotFound)?;

        let mls_group_id = GroupId::from_slice(
            &hex::decode(&group_meta.engine_group_id).map_err(|e| {
                MlsError::CryptoError(format!("Invalid group ID hex: {}", e))
            })?,
        );

        let evolution_event = {
            let engine = self.engine()?;

            let is_admin = engine
                .get_groups()
                .ok()
                .and_then(|stored| {
                    stored
                        .into_iter()
                        .find(|g| g.mls_group_id.as_slice() == mls_group_id.as_slice())
                })
                .map(|g| g.admin_pubkeys.contains(&my_pk))
                .unwrap_or(false);
            if !is_admin {
                return Ok(false);
            }

            let current_members = engine.get_members(&mls_group_id).map_err(|e| {
                MlsError::NostrMlsError(format!("Failed to get group members: {}", e))
            })?;
            if !current_members.contains(&leaver) {
                return Ok(false);
            }

            engine
                .remove_members(&mls_group_id, &[leaver])
                .map_err(|e| {
                    MlsError::NostrMlsError(format!("Failed to finalize voluntary leave: {}", e))
                })?
                .evolution_event
        };

        let send_output = client
            .send_event(&evolution_event)
            .await
            .map_err(|e| MlsError::NetworkError(format!("Failed to publish leave commit: {}", e)))?;
        crate::record_send_outcome(&evolution_event, &send_output);

        {
            let engine = self.engine()?;
            engine.merge_pending_commit(&mls_group_id).map_err(|e| {
                MlsError::NostrMlsError(format!("Failed to merge leave commit: {}", e))
            })?;
        }

        if let Some(handle) = TAURI_APP.get() {
            handle
                .emit(
                    "mls_group_updated",
                    serde_json::json!({ "group_id": wire_group_id }),
                )
                .ok();
        }

        if let Err(e) = crate::sync_mls_group_participants(wire_group_id.to_string()).await {
            eprintln!(
                "[MLS] Failed to sync participants after leave finalize ({}): {}",
                wire_group_id, e
            );
        }

        Ok(true)
    }

    /// Sync group messages since last cursor position
    ///
    /// This will:
    /// 1. Read cursor from "mls_event_cursors" for the group
    /// 2. Query TRUSTED_RELAYS for events since cursor
    /// 3. Process each event via engine.process_message
    /// 4. Update cursor position
    ///
    /// Returns (processed_events_count, new_messages_count)
    pub async fn sync_group_since_cursor(&self, group_id: &str) -> Result<(u32, u32), MlsError> {
        use nostr_sdk::prelude::*;

        if group_id.is_empty() {
            return Err(MlsError::InvalidGroupId);
        }

        // 1) Check if this group is marked as evicted
        let groups = self.read_groups().await.ok();
        let group_metadata = groups.as_ref().and_then(|gs| {
            gs.iter().find(|g| g.group_id == group_id || (!g.engine_group_id.is_empty() && g.engine_group_id == group_id))
        });
        
        if let Some(meta) = group_metadata {
            if meta.evicted {
                return Ok((0, 0)); // Skip sync for evicted group
            }
        }

        // 2) Load last cursor and compute since/until window
        let mut cursors = self.read_event_cursors().await.unwrap_or_default();

        let now = Timestamp::now();
        
        let since = if let Some(cur) = cursors.get(group_id) {
            Timestamp::from_secs(cur.last_seen_at)
        } else {
            // No cursor: default to last 48h for initial backfill
            Timestamp::from_secs(now.as_secs().saturating_sub(60 * 60 * 48))
        };
        let until = now;

        // Working group id for fetch/processing; prefer wire id from stored metadata if available
        let gid_for_fetch = if let Some(meta) = group_metadata {
            meta.group_id.clone() // wire id used on relay 'h' tag
        } else {
            group_id.to_string()
        };
        // 2) Build filter for MLS wrapper events (Kind 445) with 'h' tag = gid_for_fetch
        let client = get_nostr_client().map_err(|_| MlsError::NotInitialized)?;
        let group_id_len = gid_for_fetch.len();
        if group_id_len != 32 && group_id_len != 64 {
            eprintln!(
                "[MLS] sync_group_since_cursor: unsupported group_id length {} for id={}; skipping",
                group_id_len,
                gid_for_fetch
            );
            return Ok((0, 0));
        }

        // Canonical group: safe to use relay-side h-tag filter
        let mut filter = Filter::new()
            .kind(Kind::MlsGroupMessage)
            .since(since)
            .until(until)
            .custom_tag(SingleLetterTag::lowercase(Alphabet::H), &gid_for_fetch)
            .limit(1000);

        // 3) Fetch from TRUSTED_RELAYS with reasonable timeout
        let mut used_fallback = false;
        let mut events = match client
            .fetch_events_from(
                TRUSTED_RELAYS.to_vec(),
                filter.clone(),
                std::time::Duration::from_secs(15),
            )
            .await
        {
            Ok(evts) => evts,
            Err(e) => {
                return Err(MlsError::NetworkError(format!(
                    "fetch MLS events (with h tag) failed: {}",
                    e
                )))
            }
        };

        // Fallback: if zero results, try without 'h' tag
        if events.is_empty() {
            used_fallback = true;

            filter = Filter::new()
                .kind(Kind::MlsGroupMessage)
                .since(since)
                .until(until)
                .limit(1000);

            events = match client
                .fetch_events_from(
                    TRUSTED_RELAYS.to_vec(),
                    filter,
                    std::time::Duration::from_secs(15),
                )
                .await
            {
                Ok(evts) => evts,
                Err(e) => {
                    return Err(MlsError::NetworkError(format!(
                        "fetch MLS events (fallback) failed: {}",
                        e
                    )))
                }
            };
        }

        
        if events.is_empty() {
            return Ok((0, 0));
        }

        // 4) Sort by created_at ascending to ensure deterministic processing
        let mut ordered: Vec<nostr_sdk::Event> = events.into_iter().collect();
        ordered.sort_by_key(|e| e.created_at.as_secs());

        // 4b) If we had to fall back to a broad fetch (no 'h' tag in the filter),
        // first, log observed 'h' tags to verify encoding; then, ONLY IF we positively match, filter.
        if used_fallback {
            // Attempt to filter only if we observe any h tag; otherwise, do not filter and rely on engine.
            let saw_any_h = ordered
                .iter()
                .any(|ev| nostr_tags::find_letter(&ev.tags, Alphabet::H).is_some());
            if saw_any_h {
                // Try to narrow to our group via h-tag; if none match, proceed unfiltered and let engine decide.
                let original = ordered.clone();
                let filtered: Vec<nostr_sdk::Event> = original
                    .into_iter()
                    .filter(|ev| {
                        match nostr_tags::find_letter(&ev.tags, Alphabet::H) {
                            Some(tag) => tag.content().map(|s| s == gid_for_fetch).unwrap_or(false),
                            None => false,
                        }
                    })
                    .collect();

                if !filtered.is_empty() {
                    ordered = filtered;
                }
            }
        }

        // 5) Process with persistent engine in a no-await scope
        let mut processed: u32 = 0;
        let mut new_msgs: u32 = 0;
        let mut last_seen_id: Option<nostr_sdk::EventId> = None;
        let mut last_seen_at: u64 = 0;
        
        // Buffer for rumor events to process after engine scope
        let mut rumors_to_process: Vec<(RumorEvent, String, bool)> = Vec::new(); // (rumor, wrapper_id, is_mine)
        
        // Track if we were evicted from this group
        let mut was_evicted = false;
        // Member leave proposals MDK could not commit (non-admin sender).
        let mut leaves_to_finalize: Vec<nostr_sdk::PublicKey> = Vec::new();
        
        // Resolve my pubkey before entering engine scope (for mine flag)
        let my_pubkey_hex = if let Ok(signer) = client.signer().await {
            if let Ok(my_pubkey) = signer.get_public_key().await {
                my_pubkey.to_hex()
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        
        // Read group metadata before entering engine scope
        let group_check_id = if let Ok(groups) = self.read_groups().await {
            if let Some(meta) = groups.iter().find(|g| g.group_id == gid_for_fetch || g.engine_group_id == gid_for_fetch) {
                // Use the engine_group_id for checking
                if !meta.engine_group_id.is_empty() {
                    Some(meta.engine_group_id.clone())
                } else {
                    Some(meta.group_id.clone())
                }
            } else {
                None
            }
        } else {
            None
        };

        {
            let engine = self.engine()?; // Arc<...> held in scope without awaits
            
            if let Some(ref check_id) = group_check_id {
                // Try to verify if the engine knows about this group
                // We'll attempt to create a dummy message to see if the group exists
                let check_gid_bytes = match hex::decode(&check_id) {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        eprintln!("[MLS] Invalid group_id hex for engine check: {}", check_id);
                        vec![]
                    }
                };
                
                if !check_gid_bytes.is_empty() {
                    use nostr_sdk::prelude::*;
                    let check_gid = GroupId::from_slice(&check_gid_bytes);
                    let dummy_rumor = EventBuilder::new(Kind::Custom(9), "engine_check")
                        .build(nostr_sdk::PublicKey::from_hex("000000000000000000000000000000000000000000000000000000000000dead").unwrap());
                    
                    if let Err(e) = engine.create_message(&check_gid, dummy_rumor, None) {
                        eprintln!("[MLS] Engine missing group: {}", e);
                        
                        if let Some(handle) = TAURI_APP.get() {
                            handle.emit("mls_group_needs_rejoin", serde_json::json!({
                                "group_id": gid_for_fetch,
                                "reason": "Group not found in MLS engine state"
                            })).ok();
                        }
                    }
                }
            }
            
            for ev in ordered.iter() {
                // Hard guard: only process/persist wrappers whose 'h' tag matches our target group's wire id.
                // This prevents cross-contamination when the fallback fetch returns events for other groups.
                if let Some(tag) = nostr_tags::find_letter(&ev.tags, Alphabet::H) {
                    if let Some(h_val) = tag.content() {
                        if h_val != gid_for_fetch {
                            // Skip silently - this is expected when multiple groups exist
                            continue;
                        }
                    } else {
                        // Skip silently - empty h tag
                        continue;
                    }
                } else {
                    // Skip silently - no h tag
                    continue;
                }

                match engine.process_message(ev) {
                    Ok(res) => {
                        // Log what type of message we got
                        match res {
                            MessageProcessingResult::ApplicationMessage(msg) => {
                                // Convert MLS ApplicationMessage to RumorEvent for protocol-agnostic processing
                                let rumor_event = RumorEvent {
                                    id: msg.id,
                                    kind: msg.kind,
                                    content: msg.content.clone(),
                                    tags: msg.tags.clone(),
                                    created_at: msg.created_at,
                                    pubkey: msg.pubkey,
                                };

                                let is_mine = !my_pubkey_hex.is_empty() && msg.pubkey.to_hex() == my_pubkey_hex;
                                let wrapper_id = msg.wrapper_event_id.to_hex();

                                // Buffer the rumor for async processing after engine scope
                                rumors_to_process.push((rumor_event, wrapper_id, is_mine));
                                new_msgs = new_msgs.saturating_add(1);
                            }
                            MessageProcessingResult::Commit { mls_group_id: _ } => {
                                // Commit processed - member list may have changed
                                // Check if we're still a member of this group
                                // Use group_check_id (engine's group_id) instead of gid_for_fetch (wrapper id)
                                if let Some(ref check_id) = group_check_id {
                                    let check_gid_bytes = hex::decode(check_id).unwrap_or_default();
                                    if !check_gid_bytes.is_empty() {
                                        let check_gid = GroupId::from_slice(&check_gid_bytes);
                                        let my_pk = nostr_sdk::PublicKey::from_hex(&my_pubkey_hex).ok();
                                        
                                        let still_member = if let Some(pk) = my_pk {
                                            engine.get_members(&check_gid)
                                                .ok()
                                                .map(|members| members.contains(&pk))
                                                .unwrap_or(false)
                                        } else {
                                            false
                                        };
                                        
                                        if !still_member {
                                            // We've been removed from the group!
                                            if let Some(handle) = TAURI_APP.get() {
                                                handle.emit("mls_group_left", serde_json::json!({
                                                    "group_id": gid_for_fetch
                                                })).ok();
                                            }
                                        } else {
                                            // Still a member, just update the UI
                                            if let Some(handle) = TAURI_APP.get() {
                                                handle.emit("mls_group_updated", serde_json::json!({
                                                    "group_id": gid_for_fetch
                                                })).ok();
                                            }
                                        }
                                    }
                                }
                                
                                processed = processed.saturating_add(1);
                            }
                            MessageProcessingResult::Proposal(_proposal) => {
                                // Proposal received (e.g., leave proposal)
                                // Emit event to notify UI that group state may have changed
                                if let Some(handle) = TAURI_APP.get() {
                                    handle.emit("mls_group_updated", serde_json::json!({
                                        "group_id": gid_for_fetch
                                    })).ok();
                                }
                                
                                processed = processed.saturating_add(1);
                            }
                            MessageProcessingResult::ExternalJoinProposal { mls_group_id: _ } => {
                                // No-op for local message persistence
                            }
                            MessageProcessingResult::Unprocessable { mls_group_id: _ } => {
                                if let Some(reason) =
                                    mls_wrapper_failure_reason(ev.id.as_ref())
                                {
                                    if reason.contains(MLS_LEAVE_PROPOSAL_FAILURE) {
                                        leaves_to_finalize.push(ev.pubkey);
                                    }
                                }
                                eprintln!(
                                    "[MLS] Unprocessable event: id={}, created_at={}",
                                    ev.id.to_hex(),
                                    ev.created_at.as_secs()
                                );
                            }
                            MessageProcessingResult::PendingProposal { mls_group_id: _ } => {
                                // Stored awaiting an admin commit; membership may change once
                                // that lands, so refresh the UI the same way a committed
                                // proposal does.
                                if let Some(handle) = TAURI_APP.get() {
                                    handle.emit("mls_group_updated", serde_json::json!({
                                        "group_id": gid_for_fetch
                                    })).ok();
                                }
                            }
                            MessageProcessingResult::IgnoredProposal { mls_group_id: _, reason } => {
                                // Not stored and no state change; nothing for the UI to refresh.
                                eprintln!(
                                    "[MLS] Ignored proposal: id={}, reason={}",
                                    ev.id.to_hex(),
                                    reason
                                );
                            }
                            MessageProcessingResult::PreviouslyFailed => {
                                // Already recorded as failed; replaying it changes nothing.
                                eprintln!("[MLS] Skipping previously failed event: id={}", ev.id.to_hex());
                            }
                        }
                
                        processed = processed.saturating_add(1);
                
                        last_seen_id = Some(ev.id);
                        last_seen_at = ev.created_at.as_secs();
                    }
                    Err(e) => {
                        let error_msg = e.to_string();
                        
                        // Check if this is an eviction error (user was removed from group)
                        if error_msg.contains("own leaf not found") ||
                           error_msg.contains("after being evicted") ||
                           error_msg.contains("evicted from it") {
                            eprintln!("[MLS] ⚠️  EVICTION DETECTED - We were removed from group: {}", gid_for_fetch);
                            
                            // Set flag to remove this group after engine scope
                            was_evicted = true;
                        } else if !error_msg.contains("group not found") {
                            eprintln!(
                                "[MLS] process_message failed (group_id={}, id={}): {}",
                                gid_for_fetch,
                                ev.id,
                                e
                            );
                        }
                        // Continue processing subsequent events
                    }
                }
            }
        } // engine dropped here before any await

        if !was_evicted && !leaves_to_finalize.is_empty() {
            let unique_leavers: HashSet<_> = leaves_to_finalize.into_iter().collect();
            for leaver in unique_leavers {
                match self
                    .finalize_voluntary_leave_as_admin(&gid_for_fetch, leaver)
                    .await
                {
                    Ok(true) => {
                        eprintln!(
                            "[MLS] Finalized voluntary leave for {} in group {}",
                            leaver.to_hex(),
                            gid_for_fetch
                        );
                    }
                    Ok(false) => {}
                    Err(e) => {
                        eprintln!(
                            "[MLS] Failed to finalize voluntary leave for {} in {}: {}",
                            leaver.to_hex(),
                            gid_for_fetch,
                            e
                        );
                    }
                }
            }
        }

        // Process buffered rumors and persist after engine scope ends using unified Chat storage
        // BUT: Skip if we were evicted from this group during sync
        if !rumors_to_process.is_empty() && !was_evicted {
            // Get or create the MLS group chat in STATE with metadata
            let chat_id = {
                let mut state = STATE.lock().await;
                
                // Get group metadata to populate Chat metadata
                let group_meta = self.read_groups().await.ok()
                    .and_then(|groups| groups.into_iter().find(|g| g.group_id == gid_for_fetch));
                
                // Create or get the chat
                let chat_id = state.create_or_get_mls_group_chat(&gid_for_fetch, vec![]);
                
                // Update metadata if we have group info
                let mut metadata_updated = false;
                if let Some(meta) = group_meta {
                    if let Some(chat) = state.get_chat_mut(&chat_id) {
                        chat.metadata.set_name(meta.name.clone());
                        metadata_updated = true;
                    }
                }
                
                // Save chat to disk if metadata was updated
                if metadata_updated {
                    if let Some(handle) = TAURI_APP.get() {
                        let handle_clone = handle.clone();
                        if let Some(chat) = state.get_chat(&chat_id) {
                            if let Err(e) = save_chat(handle_clone, chat).await {
                                eprintln!("[MLS] Failed to save chat after metadata update: {}", e);
                            }
                        }
                    }
                }
                
                chat_id
            };
            
            for (rumor_event, _wrapper_id, is_mine) in rumors_to_process.iter() {
                let rumor_context = RumorContext {
                    sender: rumor_event.pubkey,
                    is_mine: *is_mine,
                    conversation_id: gid_for_fetch.clone(),
                    conversation_type: ConversationType::MlsGroup,
                };

                // Process the rumor using our protocol-agnostic processor
                match process_rumor(rumor_event.clone(), rumor_context).await {
                    Ok(result) => {
                        match result {
                            RumorProcessingResult::TextMessage(msg) | RumorProcessingResult::FileAttachment(msg) => {
                                // Check if message already exists in database (important for sync with partial message loading)
                                let mut already_in_db = false;
                                if let Some(handle) = TAURI_APP.get() {
                                    if let Ok(exists) = crate::db::message_exists_in_db(&handle, &msg.id).await {
                                        already_in_db = exists;
                                    }
                                }

                                // Add message to the unified Chat storage
                                let was_added = {
                                    let mut state = STATE.lock().await;
                                    state.add_message_to_chat(&chat_id, msg.clone())
                                };

                                if let Some(handle) = TAURI_APP.get() {
                                    crate::db::apply_mls_virtual_bucket_side_effects(
                                        handle,
                                        &chat_id,
                                        msg.virtual_bucket.as_deref(),
                                        &msg.content,
                                        msg.npub.as_deref(),
                                    );
                                }

                                if already_in_db || !was_added {
                                    continue;
                                }

                                if let Some(handle) = TAURI_APP.get() {
                                    let group_name = crate::db::load_mls_groups(handle).await
                                        .ok()
                                        .and_then(|groups| {
                                            groups.into_iter()
                                                .find(|g| g.group_id == gid_for_fetch || g.engine_group_id == gid_for_fetch)
                                                .map(|g| g.name)
                                        });
                                    handle.emit("mls_message_new", serde_json::json!({
                                        "group_id": gid_for_fetch,
                                        "message": msg,
                                        "group_name": group_name
                                    })).unwrap_or_else(|e| {
                                        eprintln!("[MLS] Failed to emit mls_message_new event: {}", e);
                                    });
                                    let _ = crate::db::save_message(handle.clone(), &chat_id, &msg).await;
                                }
                            }
                            RumorProcessingResult::Reaction(reaction) => {
                                // Reactions now work with unified storage!
                                let (was_added, chat_id_for_save) = {
                                    let mut state = STATE.lock().await;
                                    let added = if let Some((chat_id, msg)) = state.find_chat_and_message_mut(&reaction.reference_id) {
                                        msg.add_reaction(reaction.clone(), Some(chat_id))
                                    } else {
                                        false
                                    };
                                    
                                    // Get chat_id for saving if reaction was added
                                    let chat_id_for_save = if added {
                                        state.find_message(&reaction.reference_id)
                                            .map(|(chat, _)| chat.id().clone())
                                    } else {
                                        None
                                    };
                                    
                                    (added, chat_id_for_save)
                                };
                                
                                // Save the updated message to database immediately (like DM reactions)
                                if was_added {
                                    if let Some(chat_id) = chat_id_for_save {
                                        if let Some(handle) = TAURI_APP.get() {
                                            let updated_message = {
                                                let state = STATE.lock().await;
                                                state.find_message(&reaction.reference_id)
                                                    .map(|(_, msg)| msg.clone())
                                            };
                                            
                                            if let Some(msg) = updated_message {
                                                let _ = crate::db::save_message(handle.clone(), &chat_id, &msg).await;
                                            }
                                        }
                                    }
                                }
                            }
                            RumorProcessingResult::DashboardPollCreate(msg) => {
                                if let Some(handle) = TAURI_APP.get() {
                                    if let Ok(exists) = crate::db::message_exists_in_db(&handle, &msg.id).await {
                                        if exists {
                                            continue;
                                        }
                                    }
                                }
                                let was_added = {
                                    let mut state = STATE.lock().await;
                                    state.add_message_to_chat(&chat_id, msg.clone())
                                };
                                if was_added {
                                    if let Some(handle) = TAURI_APP.get() {
                                        handle.emit("mls_message_new", serde_json::json!({
                                            "group_id": gid_for_fetch,
                                            "message": msg,
                                        })).unwrap_or_else(|e| {
                                            eprintln!("[MLS] Failed to emit mls_message_new (poll create): {}", e);
                                        });
                                    }
                                    if let Some(handle) = TAURI_APP.get() {
                                        let _ = crate::db::save_message(handle.clone(), &chat_id, &msg).await;
                                    }
                                }
                            }
                            RumorProcessingResult::DashboardPollVoteIngested => {}
                            RumorProcessingResult::TypingIndicator { profile_id, until } => {
                                // Update the chat's typing participants
                                let active_typers = {
                                    let mut state = STATE.lock().await;
                                    if let Some(chat) = state.get_chat_mut(&chat_id) {
                                        chat.update_typing_participant(profile_id.clone(), until);
                                        chat.get_active_typers()
                                    } else {
                                        vec![]
                                    }
                                };
                                
                                // Emit typing update event to frontend
                                if let Some(handle) = TAURI_APP.get() {
                                    let _ = handle.emit("typing-update", serde_json::json!({
                                        "conversation_id": gid_for_fetch,
                                        "typers": active_typers,
                                    }));
                                }
                            }
                            RumorProcessingResult::UnknownEvent(mut event) => {
                                // Store unknown events for future compatibility
                                if let Some(handle) = TAURI_APP.get() {
                                    if let Ok(chat_int_id) = crate::db::get_chat_id_by_identifier(handle, &chat_id) {
                                        event.chat_id = chat_int_id;
                                        let _ = crate::db::save_event(handle, &event).await;
                                    }
                                }
                            }
                            RumorProcessingResult::Ignored => {
                                // Rumor was ignored (e.g., expired typing indicator)
                            }
                            RumorProcessingResult::Edit { message_id, new_content, edited_at, event } => {
                                // Skip if this edit event was already processed (deduplication)
                                if let Some(handle) = TAURI_APP.get() {
                                    if crate::db::event_exists(handle, &event.id).unwrap_or(false) {
                                        continue; // Already processed, skip
                                    }

                                    // Save edit event to database
                                    if let Ok(chat_int_id) = crate::db::get_chat_id_by_identifier(handle, &chat_id) {
                                        let mut event_with_chat = event;
                                        event_with_chat.chat_id = chat_int_id;
                                        let _ = crate::db::save_event(handle, &event_with_chat).await;
                                    }
                                }

                                // Update message in state and emit to frontend
                                let mut state = STATE.lock().await;
                                if let Some(chat) = state.get_chat_mut(&chat_id) {
                                    if let Some(msg) = chat.get_message_mut(&message_id) {
                                        msg.apply_edit(new_content, edited_at);

                                        // Emit update to frontend
                                        if let Some(handle) = TAURI_APP.get() {
                                            let _ = handle.emit("message_update", serde_json::json!({
                                                "old_id": &message_id,
                                                "message": &msg,
                                                "chat_id": &chat_id
                                            }));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[MLS] Failed to process rumor: {}", e);
                    }
                }
            }
            
            // Persist the chat and new messages using unified storage
            if let Some(handle) = TAURI_APP.get() {
                let state = STATE.lock().await;
                if let Some(chat) = state.get_chat(&chat_id) {
                    // Save chat metadata
                    let _ = save_chat(handle.clone(), chat).await;
                    
                    // Only save the newly added messages (much more efficient!)
                    // Get the last N messages where N = number of new messages processed
                    if new_msgs > 0 {
                        let messages_to_save: Vec<_> = chat.messages.iter()
                            .rev()
                            .take(new_msgs as usize)
                            .cloned()
                            .collect();
                        
                        if !messages_to_save.is_empty() {
                            let _ = save_chat_messages(handle.clone(), &chat_id, &messages_to_save).await;
                        }
                    }
                }
            }
        }

        // 6) Clean up if we were evicted from the group
        if was_evicted {
            // Remove cursor for this group (will be reset if re-invited)
            cursors.remove(&gid_for_fetch);
            if let Err(e) = self.write_event_cursors(&cursors).await {
                eprintln!("[MLS] Failed to remove cursor for evicted group: {}", e);
            }
            
            // Perform full cleanup using the helper method
            if let Err(e) = self.cleanup_evicted_group(&gid_for_fetch).await {
                eprintln!("[MLS] Failed to cleanup evicted group: {}", e);
            }
        } else {
            // 7) Advance cursor if anything processed (only if not evicted)
            if processed > 0 {
                if let Some(id) = last_seen_id {
                    cursors.insert(
                        gid_for_fetch.clone(),
                        EventCursor {
                            last_seen_event_id: id.to_hex(),
                            last_seen_at,
                        },
                    );
                    // Persist updated cursors
                    if let Err(e) = self.write_event_cursors(&cursors).await {
                        eprintln!("[MLS] write_event_cursors failed: {}", e);
                    }
                }
            }
        }

        Ok((processed, new_msgs))
    }

    /// Clean up an evicted group (mark as evicted, remove from STATE, delete from DB)
    /// This can be called from both sync and live subscription handlers
    pub async fn cleanup_evicted_group(&self, group_id: &str) -> Result<(), MlsError> {
        // 1. Find and mark the specific group as evicted in metadata
        let groups = self.read_groups().await.unwrap_or_default();
        let mut marked_group: Option<crate::mls::MlsGroupMetadata> = None;
        
        for group in &groups {
            if group.group_id == group_id || group.engine_group_id == group_id {
                let mut updated_group = group.clone();
                updated_group.evicted = true;
                marked_group = Some(updated_group);
                break;
            }
        }
        
        // 2. If we found the group, update only that specific group
        if let Some(group_to_update) = marked_group {
            let handle = TAURI_APP.get().ok_or(MlsError::NotInitialized)?.clone();
            if let Err(e) = crate::db::save_mls_group(handle, &group_to_update).await {
                eprintln!("[MLS] Failed to mark group as evicted: {}", e);
            }
        }
        
        // 3. Remove from in-memory STATE
        {
            let mut state = STATE.lock().await;
            state.chats.retain(|c| c.id() != group_id);
        }
        
        // 4. Delete from database
        if let Some(handle) = TAURI_APP.get() {
            if let Err(e) = crate::db::delete_chat(handle.clone(), group_id).await {
                eprintln!("[MLS] Failed to delete chat from storage: {}", e);
            }
        }
        
        // 5. Emit event to frontend
        if let Some(handle) = TAURI_APP.get() {
            if let Err(e) = handle.emit("mls_group_left", serde_json::json!({
                "group_id": group_id
            })) {
                eprintln!("[MLS] Failed to emit mls_group_left event: {}", e);
            }
        }
        
        Ok(())
    }

    // Internal helper methods for database access
    // These follow the read/modify/write pattern used in the codebase
    
    /// Read and decrypt group metadata from database
    pub async fn read_groups(&self) -> Result<Vec<MlsGroupMetadata>, MlsError> {
        let handle = TAURI_APP.get().ok_or(MlsError::NotInitialized)?.clone();
        crate::db::load_mls_groups(&handle)
            .await
            .map_err(|e| MlsError::StorageError(e))
    }

    /// Write encrypted group metadata to database
    pub async fn write_groups(&self, groups: &[MlsGroupMetadata]) -> Result<(), MlsError> {
        let handle = TAURI_APP.get().ok_or(MlsError::NotInitialized)?.clone();
        crate::db::save_mls_groups(handle, groups)
            .await
            .map_err(|e| MlsError::StorageError(e))
    }

    /// Read keypackage index from database
    #[allow(dead_code)]
    async fn read_keypackage_index(&self) -> Result<Vec<KeyPackageIndexEntry>, MlsError> {
        let handle = TAURI_APP.get().ok_or(MlsError::NotInitialized)?.clone();
        let packages = crate::db::load_mls_keypackages(&handle)
            .await
            .map_err(|e| MlsError::StorageError(e))?;
        
        // Convert from JSON values to KeyPackageIndexEntry
        let entries: Vec<KeyPackageIndexEntry> = packages.iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect();
        
        Ok(entries)
    }

    /// Write keypackage index to database
    #[allow(dead_code)]
    async fn write_keypackage_index(&self, index: &[KeyPackageIndexEntry]) -> Result<(), MlsError> {
        let handle = TAURI_APP.get().ok_or(MlsError::NotInitialized)?.clone();
        
        // Convert to JSON values
        let packages: Vec<serde_json::Value> = index.iter()
            .filter_map(|entry| serde_json::to_value(entry).ok())
            .collect();
        
        crate::db::save_mls_keypackages(handle, &packages)
            .await
            .map_err(|e| MlsError::StorageError(e))
    }

    /// Read event cursors from database
    #[allow(dead_code)]
    pub async fn read_event_cursors(&self) -> Result<HashMap<String, EventCursor>, MlsError> {
        let handle = TAURI_APP.get().ok_or(MlsError::NotInitialized)?.clone();
        crate::db::load_mls_event_cursors(&handle)
            .await
            .map_err(|e| MlsError::StorageError(e))
    }

    /// Write event cursors to database
    #[allow(dead_code)]
    pub async fn write_event_cursors(&self, cursors: &HashMap<String, EventCursor>) -> Result<(), MlsError> {
        let handle = TAURI_APP.get().ok_or(MlsError::NotInitialized)?.clone();
        crate::db::save_mls_event_cursors(handle, cursors)
            .await
            .map_err(|e| MlsError::StorageError(e))
    }

    #[cfg(test)]
    /// Run an in-memory MLS smoke test with the provided Nostr client
    ///
    /// This is a network-only smoke test that validates basic MLS operations
    /// without persisting any state to disk. It performs the following:
    /// - Publishes Saul's device KeyPackage
    /// - Creates a temporary group (Kim creator, Saul member; Kim admin)
    /// - Sends one MLS application message
    /// - Observes the wrapper on the relay
    ///
    /// All operations are wrapped in a timeout to prevent hanging.
    pub async fn run_mls_smoke_test_with_client(
        client: &nostr_sdk::Client,
        relay: &str,
        timeout: std::time::Duration,
    ) -> Result<(), MlsError> {
        use nostr_sdk::prelude::*;

        match tokio::time::timeout(timeout, async {
            println!("[MLS Smoke Test] Start (relay: {})", relay);

            // Use two ephemeral identities (do NOT use the logged-in client's keys)
            use nostr_sdk::prelude::Keys;
            let kim_keys = Keys::generate();
            let saul_keys = Keys::generate();
            println!(
                "[MLS Smoke Test] Ephemeral identities: kim={}, saul={}",
                kim_keys.public_key().to_bech32().unwrap_or_default(),
                saul_keys.public_key().to_bech32().unwrap_or_default()
            );

            // Two independent in-memory MLS engines (no disk I/O). MDK 0.8.0 always keys the
            // store, so the test supplies a fixed key rather than a session-derived one.
            let test_key = EncryptionConfig::new([7u8; 32]);
            let kim_mls = MDK::new(MdkSqliteStorage::new_with_key(":memory:", test_key.clone()).map_err(|e| MlsError::StorageError(e.to_string()))?);
            let saul_mls = MDK::new(MdkSqliteStorage::new_with_key(":memory:", test_key).map_err(|e| MlsError::StorageError(e.to_string()))?);

            // RelayUrl (nostr-mls type)
            let relay_url = RelayUrl::parse(relay)
                .map_err(|e| MlsError::NetworkError(format!("RelayUrl::parse: {}", e)))?;

            // 1) Saul publishes a device KeyPackage (so Kim can add him)
            println!("[MLS Smoke Test] Saul publishing device KeyPackage...");
            let saul_kp = saul_mls
                .create_key_package_for_event(&saul_keys.public_key(), [relay_url.clone()])
                .map_err(|e| MlsError::NostrMlsError(format!("create_key_package_for_event (saul): {}", e)))?;
    
            // Build + sign with Saul's ephemeral keys, then publish with the app's client
            let saul_kp_event = EventBuilder::new(Kind::MlsKeyPackage, saul_kp.content)
                .tags(saul_kp.tags_443)
                .build(saul_keys.public_key())
                .sign(&saul_keys)
                .await
                .map_err(|e| MlsError::NostrMlsError(format!("sign saul keypackage: {}", e)))?;
            client
                .send_event_to([relay], &saul_kp_event)
                .await
                .map_err(|e| MlsError::NetworkError(format!("publish saul keypackage: {}", e)))?;
            println!("[MLS Smoke Test] Saul KeyPackage published id={}", saul_kp_event.id);

            // 2) Kim creates a temporary two-member group (Kim creator + Saul member)
            println!("[MLS Smoke Test] Kim creating temporary group with Saul as member...");
            let name = format!(
                "Vector-MLS-Test-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
            );
            let description = "Vector MLS in-memory smoke test (Kim+Saul)".to_owned();
    
            let group_config = NostrGroupConfigData::new(
                name,
                description,
                None, // image_hash
                None, // image_key
                None, // image_nonce
                vec![relay_url.clone()],
                vec![kim_keys.public_key()], // admins - moved from create_group call
            );
    
            // IMPORTANT: Non-empty member_key_package_events (Saul). The creator (Kim) must not be in member_key_package_events.
            let group_create = kim_mls
                .create_group(
                    &kim_keys.public_key(),
                    vec![saul_kp_event.clone()],      // Saul invited via his KeyPackage
                    group_config,                     // admins now in config
                )
                .map_err(|e| MlsError::NostrMlsError(format!("create_group (kim): {}", e)))?;
    
            let kim_group = group_create.group;
            let welcome_rumor = group_create
                .welcome_rumors
                .first()
                .cloned()
                .ok_or_else(|| MlsError::NostrMlsError("no welcome rumor produced".into()))?;
            println!("[MLS Smoke Test] Group created; welcome rumor produced");
    
            // 2b) Saul processes the welcome locally and joins (no network, purely in-memory)
            saul_mls
                .process_welcome(&nostr_sdk::EventId::all_zeros(), &welcome_rumor)
                .map_err(|e| MlsError::NostrMlsError(format!("saul process_welcome: {}", e)))?;
            let welcomes = saul_mls
                .get_pending_welcomes(None)
                .map_err(|e| MlsError::NostrMlsError(format!("saul get_pending_welcomes: {}", e)))?;
            let welcome = welcomes
                .first()
                .cloned()
                .ok_or_else(|| MlsError::NostrMlsError("saul has no pending welcomes".into()))?;
            saul_mls
                .accept_welcome(&welcome)
                .map_err(|e| MlsError::NostrMlsError(format!("saul accept_welcome: {}", e)))?;
            println!("[MLS Smoke Test] Saul joined the group locally");

            // 3) Kim sends an MLS application message and publishes the wrapper to the relay
            let group_id = &kim_group.mls_group_id; // Already a GroupId in MDK
            println!("[MLS Smoke Test] Kim sending application message...");
            let rumor = EventBuilder::new(Kind::PrivateDirectMessage, "Vector-MLS-Test: hello")
                .tag(nostr_tags::custom_tag("vector-mls-test", vec!["true"]))
                .build(kim_keys.public_key());
    
            let mls_wrapper = kim_mls
                .create_message(&group_id, rumor, None)
                .map_err(|e| MlsError::NostrMlsError(format!("kim create_message: {}", e)))?;
    
            client
                .send_event_to([relay], &mls_wrapper)
                .await
                .map_err(|e| MlsError::NetworkError(format!("publish mls wrapper: {}", e)))?;
            println!(
                "[MLS Smoke Test] MLS wrapper published id={}, kind={:?}",
                mls_wrapper.id,
                mls_wrapper.kind
            );

            // 4) Verify network visibility once and then process locally on Saul
            let filter = Filter::new()
                .kind(Kind::MlsGroupMessage)
                .since(Timestamp::now() - 300u64); // widen observation window (5 minutes)

            let fetched = client
                .fetch_events_from(
                    vec![relay.to_string()],
                    filter,
                    std::time::Duration::from_secs(10),
                )
                .await
                .map_err(|e| MlsError::NetworkError(format!("fetch MLS events: {}", e)))?;

            if fetched.iter().any(|e| e.id == mls_wrapper.id) {
                println!("[MLS Smoke Test] Observed wrapper on relay");
                println!("[MLS Smoke Test] Saul processing locally after relay observation...");
            } else {
                println!("[MLS Smoke Test] Wrapper not observed in single fetch window; processing locally anyway...");
            }
    
            match saul_mls.process_message(&mls_wrapper) {
                Ok(_res) => println!("[MLS Smoke Test] Saul process_message => OK"),
                Err(e) => println!("[MLS Smoke Test] Saul process_message note: {}", e),
            }

            println!("[MLS Smoke Test] Completed in-memory smoke test (Kim+Saul, no disk).");
            Ok(())
        })
        .await
        {
            Ok(r) => r,
            Err(_) => Err(MlsError::NetworkError(format!(
                "MLS smoke test timed out after {}s",
                timeout.as_secs()
            ))),
        }
    }
}

/// Send an MLS message (rumor) to a group
///
/// This function takes a group_id, an UnsignedEvent (rumor), and an optional pending_id,
/// and sends it through the MLS protocol.
/// It's used by the protocol-agnostic message sending system to route group messages through MLS.
///
/// If a pending_id is provided, it will update that pending message with the real message ID
/// and handle success/failure state updates.
pub async fn send_mls_message(group_id: &str, rumor: nostr_sdk::UnsignedEvent, pending_id: Option<String>) -> Result<(), String> {
    let group_id = group_id.to_string();
    let pending_id = pending_id.clone();
    
    // Run non-Send MLS engine work on blocking thread
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get()
            .ok_or_else(|| "App handle not initialized".to_string())?
            .clone();
        
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            // Get the Nostr client
            let client = get_nostr_client()
                .map_err(|_| "Nostr client not initialized".to_string())?;
            
            // Create MLS service instance
            let service = MlsService::new_persistent(&handle)
                .map_err(|e| format!("Failed to create MLS service: {}", e))?;
            
            // Look up the group to get the engine_group_id (do this before getting engine)
            let groups = service.read_groups().await
                .map_err(|e| format!("Failed to read groups: {}", e))?;
            
            let group_meta = groups.iter()
                .find(|g| g.group_id == group_id)
                .ok_or_else(|| format!("Group not found: {}", group_id))?;
            
            // Parse the engine group ID
            let engine_group_id = if group_meta.engine_group_id.is_empty() {
                return Err("Group has no engine_group_id".to_string());
            } else {
                GroupId::from_slice(
                    &hex::decode(&group_meta.engine_group_id)
                        .map_err(|e| format!("Invalid engine_group_id hex: {}", e))?
                )
            };
            
            // Now get the MLS engine and create message (no await while engine is in scope)
            let mls_wrapper_result = {
                let engine = service.engine()
                    .map_err(|e| format!("Failed to get MLS engine: {}", e))?;
                
                engine.create_message(&engine_group_id, rumor.clone(), None)
            }; // engine dropped here
            
            // Check for eviction errors after engine is dropped
            let mls_wrapper = match mls_wrapper_result {
                Ok(wrapper) => wrapper,
                Err(e) => {
                    let error_msg = e.to_string();
                    
                    // Check if this is an eviction error
                    if error_msg.contains("own leaf not found") ||
                       error_msg.contains("after being evicted") ||
                       error_msg.contains("evicted from it") ||
                       error_msg.contains("group not found") {
                        eprintln!("[MLS] Eviction detected while sending to group: {}", group_id);
                        
                        // Perform cleanup (we're in an async context now)
                        if let Err(cleanup_err) = service.cleanup_evicted_group(&group_id).await {
                            eprintln!("[MLS] Failed to cleanup evicted group: {}", cleanup_err);
                        }
                    }
                    
                    // Mark pending message as failed if we have a pending_id
                    if let Some(ref pid) = pending_id {
                        let mut state = crate::STATE.lock().await;
                        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == group_id) {
                            if let Some(msg) = chat.messages.iter_mut().find(|m| m.id == *pid) {
                                msg.failed = true;
                                msg.pending = false;
                                
                                if let Some(handle) = TAURI_APP.get() {
                                    handle.emit("message_update", serde_json::json!({
                                        "old_id": pid,
                                        "message": msg,
                                        "chat_id": &group_id
                                    })).ok();
                                }
                            }
                        }
                    }
                    
                    return Err(format!("Failed to create MLS message: {}", e));
                }
            };
            
            // Get the inner rumor ID for the final update
            let inner_event_id = rumor.id.map(|id| id.to_hex());
            
            // Check if this is a typing indicator and add expiration to wrapper if so
            let is_typing_indicator = rumor.kind == nostr_sdk::Kind::ApplicationSpecificData
                && rumor.content == "typing";
            
            // Send the message and handle success/failure
            let send_result = if is_typing_indicator {
                // For typing indicators, add a 30-second expiration to the wrapper event
                use nostr_sdk::{EventBuilder, Tag, Timestamp};
                
                let expiry_time = Timestamp::from_secs(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs()
                        + 30,
                );
                
                // Create a new wrapper event with expiration tag
                let mut wrapper_builder = EventBuilder::new(mls_wrapper.kind, &mls_wrapper.content);
                
                // Copy all existing tags
                for tag in mls_wrapper.tags.iter() {
                    wrapper_builder = wrapper_builder.tag(tag.clone());
                }
                
                // Add expiration tag
                wrapper_builder = wrapper_builder.tag(Tag::expiration(expiry_time));
                
                // Build and sign the wrapper
                let signer = client.signer().await
                    .map_err(|e| format!("Failed to get signer: {}", e))?;
                let wrapper_with_expiry = wrapper_builder.sign(&signer).await
                    .map_err(|e| format!("Failed to sign wrapper with expiration: {}", e))?;
                
                // Send the wrapper with expiration
                client
                    .send_event_to(TRUSTED_RELAYS.iter().copied(), &wrapper_with_expiry)
                    .await
                    .inspect(|output| crate::record_send_outcome(&wrapper_with_expiry, output))
            } else {
                // Send normal wrapper without expiration
                client
                    .send_event_to(TRUSTED_RELAYS.iter().copied(), &mls_wrapper)
                    .await
                    .inspect(|output| crate::record_send_outcome(&mls_wrapper, output))
            };
            
            // Update pending message based on send result
            if let (Some(ref pid), Some(ref real_id)) = (&pending_id, &inner_event_id) {
                match send_result {
                    Ok(_) => {
                        // Mark message as successfully sent and update ID
                        let mut state = crate::STATE.lock().await;
                        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == group_id) {
                            if let Some(msg) = chat.messages.iter_mut().find(|m| m.id == *pid) {
                                // Update to real ID and mark as sent
                                msg.id = real_id.clone();
                                msg.pending = false;
                                
                                // Emit update
                                if let Some(handle) = TAURI_APP.get() {
                                    handle.emit("message_update", serde_json::json!({
                                        "old_id": pid,
                                        "message": msg,
                                        "chat_id": &group_id
                                    })).ok();
                                }
                                
                                // Save to database
                                let msg_clone = msg.clone();
                                drop(state);
                                if let Some(handle) = TAURI_APP.get() {
                                    let _ = crate::db::save_message(handle.clone(), &group_id, &msg_clone).await;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        // Mark message as failed (keep pending ID)
                        let mut state = crate::STATE.lock().await;
                        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == group_id) {
                            if let Some(msg) = chat.messages.iter_mut().find(|m| m.id == *pid) {
                                msg.failed = true;
                                msg.pending = false;
                                
                                // Emit update
                                if let Some(handle) = TAURI_APP.get() {
                                    handle.emit("message_update", serde_json::json!({
                                        "old_id": pid,
                                        "message": msg,
                                        "chat_id": &group_id
                                    })).ok();
                                }
                            }
                        }
                        return Err(format!("Failed to send MLS wrapper: {}", e));
                    }
                }
            } else {
                // No pending_id provided, just return the send result
                send_result.map_err(|e| format!("Failed to send MLS wrapper: {}", e))?;
            }
            
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Emit a frontend event whenever MLS group metadata changes so the UI can hydrate quickly.
pub fn emit_group_metadata_event(meta: &MlsGroupMetadata) {
    if let Some(handle) = TAURI_APP.get() {
        if let Err(e) = handle.emit(
            "mls_group_metadata",
            serde_json::json!({ "metadata": metadata_to_frontend(meta) }),
        ) {
            eprintln!("[MLS] Failed to emit mls_group_metadata event: {}", e);
        }
    }
}

fn seconds_to_millis(value: u64) -> u64 {
    value.saturating_mul(1000)
}

pub fn metadata_to_frontend(meta: &MlsGroupMetadata) -> serde_json::Value {
    serde_json::json!({
        "group_id": meta.group_id,
        "engine_group_id": meta.engine_group_id,
        "creator_pubkey": meta.creator_pubkey,
        "name": meta.name,
        "avatar_ref": meta.avatar_ref,
        "created_at": seconds_to_millis(meta.created_at),
        "updated_at": seconds_to_millis(meta.updated_at),
        "evicted": meta.evicted,
    })
}

#[cfg(test)]
mod mls_smoke_tests {
    use super::MlsService;
    use nostr_sdk::{Client, ClientOptions, Keys};
    use std::time::Duration;

    #[tokio::test]
    #[ignore = "requires a running Nostr relay (e.g., ws://localhost:7000)"]
    async fn run_mls_smoke_test_with_local_relay() {
        let relay = std::env::var("MLS_SMOKE_RELAY")
            .unwrap_or_else(|_| "ws://localhost:7000".to_string());

        let signer = Keys::generate();
        let client = Client::builder()
            .signer(signer)
            .opts(ClientOptions::new())
            .build();

        client
            .add_relay(&relay)
            .await
            .expect("failed to add smoke-test relay");
        client.connect().await;

        MlsService::run_mls_smoke_test_with_client(
            &client,
            &relay,
            Duration::from_secs(30),
        )
        .await
        .expect("MLS smoke test failed");
    }
}

#[cfg(test)]
mod mls_restore_tests {
    use super::*;
    use nostr_sdk::prelude::*;

    /// Two independent in-memory MDK engines, plus a group Kim (admin) created with Saul as an
    /// initial member. Mirrors `run_mls_smoke_test_with_client`'s setup but purely local: no
    /// relay, no `AppHandle` — the only I/O is signing events in memory.
    async fn kim_group_with_saul() -> (
        MDK<MdkSqliteStorage>,
        MDK<MdkSqliteStorage>,
        Keys,
        Keys,
        GroupId,
        RelayUrl,
    ) {
        let kim_keys = Keys::generate();
        let saul_keys = Keys::generate();
        let kim_mls = MDK::new(
            MdkSqliteStorage::new_with_key(":memory:", EncryptionConfig::new([7u8; 32])).unwrap(),
        );
        let saul_mls = MDK::new(
            MdkSqliteStorage::new_with_key(":memory:", EncryptionConfig::new([8u8; 32])).unwrap(),
        );
        let relay_url = RelayUrl::parse("wss://relay.test").unwrap();

        let saul_kp_event = fresh_keypackage_event(&saul_mls, &saul_keys, &relay_url).await;

        let group_config = NostrGroupConfigData::new(
            "restore-test".to_string(),
            "restore-test group".to_string(),
            None,
            None,
            None,
            vec![relay_url.clone()],
            vec![kim_keys.public_key()],
        );
        let group_create = kim_mls
            .create_group(&kim_keys.public_key(), vec![saul_kp_event], group_config)
            .expect("create group");

        let group_id = group_create.group.mls_group_id;
        (kim_mls, saul_mls, kim_keys, saul_keys, group_id, relay_url)
    }

    /// Builds and signs a fresh KeyPackage (Kind:443) event for `keys`, without publishing it
    /// anywhere — matches what `add_member_device`'s restoration path resolves from the network.
    async fn fresh_keypackage_event(
        engine: &MDK<MdkSqliteStorage>,
        keys: &Keys,
        relay_url: &RelayUrl,
    ) -> Event {
        let kp = engine
            .create_key_package_for_event(&keys.public_key(), [relay_url.clone()])
            .expect("create keypackage");
        EventBuilder::new(Kind::MlsKeyPackage, kp.content)
            .tags(kp.tags_443)
            .build(keys.public_key())
            .sign(keys)
            .await
            .expect("sign keypackage")
    }

    fn group_epoch(engine: &MDK<MdkSqliteStorage>, group_id: &GroupId) -> u64 {
        engine
            .get_groups()
            .expect("get_groups")
            .into_iter()
            .find(|g| g.mls_group_id.as_slice() == group_id.as_slice())
            .expect("group present")
            .epoch
    }

    // Engine-level: restoring a member who already has a leaf must remove the archived leaf
    // before adding the fresh one back, so the identity collapses to exactly one leaf and the
    // epoch advances past whatever secrets the archived leaf held.
    #[tokio::test]
    async fn restoring_existing_member_collapses_to_one_leaf_and_advances_two_epochs() {
        let (kim_mls, saul_mls, _kim_keys, saul_keys, group_id, relay_url) =
            kim_group_with_saul().await;

        let before_epoch = group_epoch(&kim_mls, &group_id);
        let current_members = kim_mls.get_members(&group_id).expect("get_members");
        assert_eq!(
            classify_membership_action(&current_members, &saul_keys.public_key()),
            MembershipAction::Restore
        );

        // Mirrors `add_member_device`'s restoration branch: remove the archived leaf, merge,
        // then re-add with a freshly resolved keypackage (never the cached/stale one).
        kim_mls
            .remove_members(&group_id, &[saul_keys.public_key()])
            .expect("remove archived leaf");
        kim_mls.merge_pending_commit(&group_id).expect("merge remove");
        assert!(
            !kim_mls
                .get_members(&group_id)
                .expect("get_members")
                .contains(&saul_keys.public_key()),
            "leaf must be gone after the remove commits"
        );

        let fresh_kp_event = fresh_keypackage_event(&saul_mls, &saul_keys, &relay_url).await;
        kim_mls
            .add_members(&group_id, std::slice::from_ref(&fresh_kp_event))
            .expect("re-add member");
        kim_mls.merge_pending_commit(&group_id).expect("merge add");

        let after_members = kim_mls.get_members(&group_id).expect("get_members");
        assert!(after_members.contains(&saul_keys.public_key()));
        assert_eq!(
            after_members.len(),
            2,
            "exactly kim + saul as identities, no third identity introduced"
        );

        let after_epoch = group_epoch(&kim_mls, &group_id);
        assert_eq!(
            after_epoch,
            before_epoch + 2,
            "one commit for the remove, one for the add"
        );
    }

    // Engine-level: a member with no existing leaf takes the ordinary invite path — a single
    // add commit, epoch advances by one, no remove is performed.
    #[tokio::test]
    async fn restoring_absent_member_behaves_as_plain_add() {
        let (kim_mls, _saul_mls, _kim_keys, _saul_keys, group_id, relay_url) =
            kim_group_with_saul().await;

        let uma_keys = Keys::generate();
        let uma_mls = MDK::new(
            MdkSqliteStorage::new_with_key(":memory:", EncryptionConfig::new([9u8; 32])).unwrap(),
        );

        let before_epoch = group_epoch(&kim_mls, &group_id);
        let current_members = kim_mls.get_members(&group_id).expect("get_members");
        assert_eq!(
            classify_membership_action(&current_members, &uma_keys.public_key()),
            MembershipAction::Invite
        );

        let uma_kp_event = fresh_keypackage_event(&uma_mls, &uma_keys, &relay_url).await;
        kim_mls
            .add_members(&group_id, std::slice::from_ref(&uma_kp_event))
            .expect("add new member");
        kim_mls.merge_pending_commit(&group_id).expect("merge add");

        let after_members = kim_mls.get_members(&group_id).expect("get_members");
        assert!(after_members.contains(&uma_keys.public_key()));

        let after_epoch = group_epoch(&kim_mls, &group_id);
        assert_eq!(
            after_epoch,
            before_epoch + 1,
            "a first-time invite is a single commit, unlike a two-commit restoration"
        );
    }

    // Pure helper: classification depends only on current membership, not on any I/O.
    #[test]
    fn classify_membership_action_matches_current_membership() {
        let existing = Keys::generate().public_key();
        let newcomer = Keys::generate().public_key();
        let mut members = std::collections::BTreeSet::new();
        members.insert(existing);

        assert_eq!(
            classify_membership_action(&members, &existing),
            MembershipAction::Restore
        );
        assert_eq!(
            classify_membership_action(&members, &newcomer),
            MembershipAction::Invite
        );
    }

    // Pure helper: this is the decision `add_member_device` cannot exercise without a live
    // client/AppHandle — a non-admin restoration is refused, while an invite is never gated.
    #[test]
    fn non_admin_restoration_is_refused_but_invite_is_never_gated() {
        let admin = Keys::generate().public_key();
        let non_admin = Keys::generate().public_key();
        let mut admins = std::collections::BTreeSet::new();
        admins.insert(admin);

        assert!(authorize_membership_action(MembershipAction::Restore, &admins, &non_admin).is_err());
        assert!(authorize_membership_action(MembershipAction::Restore, &admins, &admin).is_ok());
        assert!(authorize_membership_action(MembershipAction::Invite, &admins, &non_admin).is_ok());
    }
}
