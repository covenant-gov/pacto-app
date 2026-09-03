use futures_util::FutureExt;
use lazy_static::lazy_static;
use nostr_sdk::prelude::*;
use once_cell::sync::OnceCell;
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

mod cmds;

mod crypto;

mod test_sandbox;

mod squad_catalog;

mod db;
use db::SlimProfile;

mod account_manager;

mod mls;
pub use mls::MlsService;
mod mls_legacy_checksum;
mod mls_orphan_reaper;
mod mls_store_reset;
mod mls_store_reset_state;

use db::save_chat_messages;

mod voice;

mod net;

mod net_transport;

mod blossom;

mod util;
use util::{calculate_file_hash, format_bytes, get_file_type_description};

mod evm;

#[cfg(target_os = "android")]
#[path = "android/mod.rs"]
mod android;

#[cfg(all(not(target_os = "android"), feature = "whisper"))]
mod whisper;

mod message;
use message::extract_mention_notification_body;
pub use message::{Attachment, Message, Reaction};

mod notification;

mod catch_up;

mod profile;
pub use profile::{Profile, Status};

mod profile_sync;

mod chat;
pub use chat::{Chat, ChatMetadata, ChatType, NotificationLevel};

mod dashboard_poll;

mod commons;
mod join_inbox;

mod sticker_pack;

mod squad_gov_replica;

mod klipy;

mod virtual_channel_bucket;

mod rumor;
pub use rumor::{process_rumor, ConversationType, RumorContext, RumorEvent, RumorProcessingResult};

// Flat event storage layer (protocol-aligned)
mod stored_event;
pub use stored_event::{event_kind, StoredEvent, StoredEventBuilder};

mod deep_link;

// Image caching for avatars, banners, and inline images
mod image_cache;

// Audio processing: resampling (all platforms) + notification playback (desktop only)
mod audio;

// Per-account SQLite schema and data migrations (refinery).
mod migrations;

// Read-only storage-format recognition for the app database (no migration).
mod storage_format;

// Salt/key-derivation migration engine (U2)
mod migration;

// Backend session manager and idle auto-lock (U4)
mod session;

// Repo-root `.env` → process env (debug builds)
mod operator_env;

// Application-wide configuration constants and IPC snapshot.
mod app_config;

// App-local seams over the nostr symbols the 0.45 line removes.
mod nostr_sign;
mod nostr_tags;

// Runtime-resolved trusted relay set: production default, debug-only
// `PACTO_TRUSTED_RELAYS` override.
mod trusted_relays;

// Certificate parsing, expiry classification, and the isolated TLS capture
// path for the relay diagnostics certificate panel (U8).
mod relay_cert;

// Machine-readable record of where this sandbox landed (ports, root, endpoints).
mod sandbox_handle;

// Debug-only headless login used by agents and the e2e harness.
#[cfg(debug_assertions)]
mod dev_login;

// Relay-free seeding harness. Non-default feature; never compiled into
// a release build or the default app binary. See src/bin/relay_free_harness.rs.
#[cfg(feature = "relay-free-harness")]
pub mod harness;

/// Local Sepolia username NFT claim harness (not CI). See `src/bin/username_claim_harness.rs`.
#[cfg(feature = "username-claim-harness")]
pub mod username_claim_harness;

/// # Blossom Media Servers
///
/// Two ordered lists with automatic failover: the first server that accepts wins.
///
/// The split exists because message attachments are AES-256-GCM ciphertext, and
/// most public Blossom servers sniff the blob and whitelist media types — they
/// reject opaque bytes with 415 regardless of the `Content-Type` header. Profile
/// media is plaintext and is published to public nostr profiles, so it prefers a
/// widely mirrored CDN that serves a real media extension.
/// See `docs/messaging/ATTACHMENTS.md`.
static BLOSSOM_BLOB_SERVERS: OnceCell<std::sync::Mutex<Vec<String>>> = OnceCell::new();
static BLOSSOM_MEDIA_SERVERS: OnceCell<std::sync::Mutex<Vec<String>>> = OnceCell::new();

/// Servers that accept opaque blobs (encrypted message attachments).
fn init_blossom_blob_servers() -> Vec<String> {
    vec!["https://nostr.download".to_string()]
}

/// Servers for plaintext profile media (avatars, banners).
fn init_blossom_media_servers() -> Vec<String> {
    vec![
        "https://blossom.primal.net".to_string(),
        "https://nostr.download".to_string(),
    ]
}

/// Upload targets for encrypted attachments.
pub(crate) fn get_blossom_blob_servers() -> Vec<String> {
    BLOSSOM_BLOB_SERVERS
        .get_or_init(|| std::sync::Mutex::new(init_blossom_blob_servers()))
        .lock()
        .unwrap()
        .clone()
}

/// Upload targets for plaintext profile media.
pub(crate) fn get_blossom_media_servers() -> Vec<String> {
    BLOSSOM_MEDIA_SERVERS
        .get_or_init(|| std::sync::Mutex::new(init_blossom_media_servers()))
        .lock()
        .unwrap()
        .clone()
}

/// Session-management helpers re-exported from `session.rs`. The encryption
/// key container, idle timer, and heartbeat live in the session manager.
pub use session::{
    check_session, clear_encryption_key, current_encryption_key, heartbeat, session_heartbeat,
    set_encryption_key, set_timeout_ms, SESSION_MANAGER,
};
// In-memory recovery phrase until `encrypt` persists it via `set_seed`; cleared on logout; replaced on each successful import/create.
lazy_static! {
    static ref MNEMONIC_SEED: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
}

fn mnemonic_seed_set(phrase: String) {
    *MNEMONIC_SEED.lock().expect("mnemonic mutex poisoned") = Some(phrase);
}

fn mnemonic_seed_clear() {
    *MNEMONIC_SEED.lock().expect("mnemonic mutex poisoned") = None;
}

pub(crate) fn mnemonic_seed_get() -> Option<String> {
    MNEMONIC_SEED
        .lock()
        .expect("mnemonic mutex poisoned")
        .clone()
}

// Replaceable Nostr client (cleared on logout so create_account/login can set a new one without restart).
lazy_static! {
    static ref NOSTR_CLIENT: std::sync::RwLock<Option<Arc<Client>>> = std::sync::RwLock::new(None);
}
pub(crate) fn get_nostr_client() -> Result<Arc<Client>, String> {
    NOSTR_CLIENT
        .read()
        .map_err(|e| e.to_string())?
        .as_ref()
        .cloned()
        .ok_or_else(|| "Nostr client not initialized".to_string())
}
pub(crate) fn set_nostr_client(client: Client) {
    *NOSTR_CLIENT.write().expect("NOSTR_CLIENT lock") = Some(Arc::new(client));
    LOGIN_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

/// Bumped on every `set_nostr_client` call (every login path funnels through it)
/// and on `clear_nostr_client` (logout / pre-login teardown). The live-monitor
/// loops capture this value when they spawn; diagnostic writes compare their
/// captured generation against the current one and skip on mismatch, so a stale
/// monitor left running for a previous account can never attribute a failure
/// reason, log line, or metric sample to the current one.
pub(crate) static LOGIN_GENERATION: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

/// Current login generation, for capture by a newly spawned monitor task.
pub(crate) fn current_login_generation() -> u64 {
    LOGIN_GENERATION.load(std::sync::atomic::Ordering::SeqCst)
}
pub(crate) fn clear_nostr_client() {
    *NOSTR_CLIENT.write().expect("NOSTR_CLIENT lock") = None;
    LOGIN_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

pub(crate) static TAURI_APP: OnceCell<AppHandle> = OnceCell::new();

/// Convenience guard: fail unless the global app handle is initialized and the
/// current account has migrated to key-derivation version 2.
fn require_key_derivation_version_2() -> Result<(), String> {
    let handle = TAURI_APP
        .get()
        .ok_or_else(|| "App handle not initialized".to_string())?;
    crate::migration::require_key_derivation_version_2_on_handle(&handle)
}

#[derive(Clone)]
struct PendingInviteAcceptance {
    invite_code: String,
    inviter_pubkey: PublicKey,
}

static PENDING_INVITE: OnceCell<PendingInviteAcceptance> = OnceCell::new();

// TEMPORARY cache of wrapper_event_ids for fast duplicate detection during INIT SYNC ONLY
// - Populated at init with recent wrapper_ids (last 30 days) to avoid SQL queries for each historical event
// - Only used for historical sync events (is_new = false), NOT for real-time new events
// - Cleared when sync finishes to free memory
lazy_static! {
    static ref WRAPPER_ID_CACHE: Mutex<std::collections::HashSet<String>> =
        Mutex::new(std::collections::HashSet::new());
}

/// Consecutive handling timeouts per gift-wrap wrapper id. After
/// `GIFTWRAP_TIMEOUT_DISCARD_AFTER`, the wrapper is quarantined like a panic.
const GIFTWRAP_TIMEOUT_DISCARD_AFTER: u32 = 3;
lazy_static! {
    static ref GIFTWRAP_TIMEOUT_COUNTS: std::sync::Mutex<std::collections::HashMap<String, u32>> =
        std::sync::Mutex::new(std::collections::HashMap::new());
}

/// Returns true once the same wrapper has timed out `GIFTWRAP_TIMEOUT_DISCARD_AFTER` times.
fn note_giftwrap_timeout(wrapper_event_id: &str) -> bool {
    let Ok(mut counts) = GIFTWRAP_TIMEOUT_COUNTS.lock() else {
        return true;
    };
    let entry = counts.entry(wrapper_event_id.to_string()).or_insert(0);
    *entry = entry.saturating_add(1);
    *entry >= GIFTWRAP_TIMEOUT_DISCARD_AFTER
}

fn clear_giftwrap_timeout_count(wrapper_event_id: &str) {
    if let Ok(mut counts) = GIFTWRAP_TIMEOUT_COUNTS.lock() {
        counts.remove(wrapper_event_id);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
enum SyncMode {
    ForwardSync,  // Initial sync from most recent message going backward
    BackwardSync, // Syncing historically old messages
    DeepRescan,   // Deep rescan mode - continues until 30 days of no events
    CatchUp,      // Bounded forward walk from last_catch_up_until to now (wake/reconnect recovery)
    Finished,     // Sync complete
}

#[derive(serde::Serialize, Clone, Debug)]
struct ChatState {
    profiles: Vec<Profile>,
    chats: Vec<Chat>,
    is_syncing: bool,
    sync_window_start: u64, // Start timestamp of current window
    sync_window_end: u64,   // End timestamp of current window
    sync_mode: SyncMode,
    sync_empty_iterations: u8, // Counter for consecutive empty iterations
    sync_total_iterations: u8, // Counter for total iterations in current mode
    last_catch_up_until: u64,  // Unix timestamp of the last time an account-wide sync reached "now"
    // Monotonic-clock reading (seconds since MONOTONIC_EPOCH, immune to wall-clock jumps) at
    // the same moment `last_catch_up_until` was recorded. `None` until the first catch-up
    // completes in this process. See `should_enter_catch_up`.
    #[serde(skip)]
    last_catch_up_monotonic: Option<u64>,
    // True while a slice's window has been claimed (window advanced) but its fetch/processing
    // has not yet completed. Guards the continuation branches below against a concurrent
    // fetch_messages(false) call (e.g. a wake trigger racing the normal continuation loop)
    // advancing sync_window_end a second time before the first call's fetch finishes.
    slice_in_flight: bool,
    // True when a slice attempt was deferred because the relay pool was empty (or the stream
    // failed with "no relays specified") rather than a genuine per-relay error. Unlike
    // `abandon_sync_slice`, `defer_sync_slice_for_empty_pool` leaves `sync_mode` and the claimed
    // window untouched and only sets this so `next_sync_slice` retries the *same* window next
    // time instead of advancing past it or ending the walk.
    sync_slice_relay_wait: bool,
    // `is_last` slice flag captured at deferral time (see `sync_slice_relay_wait`), replayed
    // unchanged to `record_slice_result` once the deferred slice is retried.
    sync_slice_deferred_is_last: bool,
}

impl ChatState {
    fn new() -> Self {
        Self {
            profiles: Vec::new(),
            chats: Vec::new(),
            is_syncing: false,
            sync_window_start: 0,
            sync_window_end: 0,
            sync_mode: SyncMode::Finished,
            sync_empty_iterations: 0,
            sync_total_iterations: 0,
            last_catch_up_until: 0,
            last_catch_up_monotonic: None,
            slice_in_flight: false,
            sync_slice_relay_wait: false,
            sync_slice_deferred_is_last: false,
        }
    }

    /// Reset in-memory chats and sync progress (logout, or before binding a new key).
    fn clear_session(&mut self) {
        *self = Self::new();
    }

    /// Load a Vector Profile in to the state from our SlimProfile database format
    async fn from_db_profile(&mut self, slim: SlimProfile) {
        // Check if profile already exists
        if let Some(position) = self
            .profiles
            .iter()
            .position(|profile| profile.id == slim.id)
        {
            // Replace existing profile
            let mut full_profile = slim.to_profile();

            // Check if this is our profile: we need to mark it as such
            let client = get_nostr_client().expect("Nostr client not initialized");
            let signer = client.signer().await.unwrap();
            let my_public_key = signer.get_public_key().await.unwrap();
            let profile_pubkey = PublicKey::from_bech32(&full_profile.id).unwrap();
            full_profile.mine = my_public_key == profile_pubkey;

            self.profiles[position] = full_profile;
        } else {
            // Add new profile
            self.profiles.push(slim.to_profile());
        }
    }

    /// Merge multiple Vector Profiles from SlimProfile format in to the state at once
    async fn merge_db_profiles(&mut self, slim_profiles: Vec<SlimProfile>) {
        for slim in slim_profiles {
            self.from_db_profile(slim).await;
        }
    }

    /// Get a profile by ID
    fn get_profile(&self, id: &str) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    /// Get a mutable profile by ID
    fn get_profile_mut(&mut self, id: &str) -> Option<&mut Profile> {
        self.profiles.iter_mut().find(|p| p.id == id)
    }

    /// Get a chat by ID
    pub(crate) fn get_chat(&self, id: &str) -> Option<&Chat> {
        self.chats.iter().find(|c| c.id == id)
    }

    /// Get a mutable chat by ID
    fn get_chat_mut(&mut self, id: &str) -> Option<&mut Chat> {
        self.chats.iter_mut().find(|c| c.id == id)
    }

    /// Create a new chat for a DM with a specific user
    fn create_dm_chat(&mut self, their_npub: &str) -> String {
        // Check if chat already exists
        if self.get_chat(&their_npub).is_none() {
            let chat = Chat::new_dm(their_npub.to_string());
            self.chats.push(chat);
        }

        their_npub.to_string()
    }

    /// Create or get an MLS group chat
    fn create_or_get_mls_group_chat(
        &mut self,
        group_id: &str,
        participants: Vec<String>,
    ) -> String {
        // Check if chat already exists
        if self.get_chat(group_id).is_none() {
            let chat = Chat::new_mls_group(group_id.to_string(), participants);
            self.chats.push(chat);
        }

        group_id.to_string()
    }

    /// Add a message to a chat via its ID
    fn add_message_to_chat(&mut self, chat_id: &str, message: Message) -> bool {
        let is_msg_added = match self.get_chat_mut(chat_id) {
            Some(chat) => {
                // Add the message to the existing chat
                chat.internal_add_message(message)
            }
            None => {
                // Chat doesn't exist, create it and add the message
                // Determine chat type based on chat_id format
                let chat = if chat_id.starts_with("npub1") {
                    // DM chat: use the chat_id as the participant
                    Chat::new_dm(chat_id.to_string())
                } else {
                    // MLS group: participants will be set later
                    Chat::new(chat_id.to_string(), ChatType::MlsGroup, vec![])
                };
                let mut chat = chat;
                let was_added = chat.internal_add_message(message);
                self.chats.push(chat);
                was_added
            }
        };

        // Sort our chat positions based on last message time
        self.chats.sort_by(|a, b| {
            // Get last message time for both chats
            let a_time = a.last_message_time();
            let b_time = b.last_message_time();

            // Compare timestamps in reverse order (newest first)
            b_time.cmp(&a_time)
        });

        is_msg_added
    }

    /// Add a message to a chat via its participant npub
    fn add_message_to_participant(&mut self, their_npub: &str, message: Message) -> bool {
        // Ensure profiles exist for the participant
        if self.get_profile(their_npub).is_none() {
            // Create a basic profile for the participant
            let mut profile = Profile::new();
            profile.id = their_npub.to_string();
            profile.mine = false; // It's not our profile

            // Update the frontend about the new profile
            if let Some(handle) = TAURI_APP.get() {
                handle.emit("profile_update", &profile).unwrap();
            }

            // Add to our profiles list
            self.profiles.push(profile);
        }

        // Create or get the chat ID
        let chat_id = self.create_dm_chat(their_npub);

        // Add the message to the chat
        self.add_message_to_chat(&chat_id, message)
    }

    /// Per-chat unread counts (R14, R15: includes MLS groups, not only DM
    /// peers — every entry in `self.chats` is walked the same way
    /// regardless of type). A chat at Nothing contributes zero (R17, KD4)
    /// via U2's badge-contribution predicate: every message this walk
    /// counts is at least Record tier (an own message, which would be
    /// Passive, already stops the walk below), so contribution reduces to
    /// the chat's own level.
    fn unread_counts_by_chat(&self) -> std::collections::HashMap<String, u32> {
        let mut counts = std::collections::HashMap::new();

        for chat in &self.chats {
            if !notification::contributes_to_badge(
                notification::Tier::Record,
                chat.notification_level,
            ) {
                continue;
            }

            // Skip DM chats whose peer is blocked. The old profile-level
            // mute skip is gone (KTD6) — DM muting is the chat-level check
            // above, since a DM chat's id is its peer's npub.
            let mut skip_for_profile_block = false;
            if let ChatType::DirectMessage = chat.chat_type {
                if let Some(profile) = self.get_profile(&chat.id) {
                    if profile.blocked {
                        skip_for_profile_block = true;
                    }
                }
            }
            if skip_for_profile_block {
                continue;
            }

            // Find the last read message ID for this chat
            let last_read_id = &chat.last_read;

            // Walk backwards from the end to count unread messages
            // Stop when we hit: 1) our own message, or 2) the last_read message
            let mut unread_count: u32 = 0;
            for msg in chat.messages.iter().rev() {
                // If we hit our own message, stop - we clearly read everything before it
                if msg.mine {
                    break;
                }

                // If we hit the last_read message, stop - everything at and before this is read
                if !last_read_id.is_empty() && msg.id == *last_read_id {
                    break;
                }

                // Count this message as unread
                unread_count += 1;
            }

            if unread_count > 0 {
                counts.insert(chat.id.clone(), unread_count);
            }
        }

        counts
    }

    /// Total unread count across every chat. Kept for test assertions;
    /// the real dock-badge total is folded independently in
    /// `update_unread_counter` rather than calling this.
    #[cfg(test)]
    fn count_unread_messages(&self) -> u32 {
        self.unread_counts_by_chat().values().sum()
    }

    /// Find a message by its ID across all chats
    fn find_message(&self, message_id: &str) -> Option<(&Chat, &Message)> {
        for chat in &self.chats {
            if let Some(message) = chat.messages.iter().find(|m| m.id == message_id) {
                return Some((chat, message));
            }
        }
        None
    }

    /// Find a chat and message by message ID across all chats (mutable)
    fn find_chat_and_message_mut(&mut self, message_id: &str) -> Option<(&str, &mut Message)> {
        for chat in &mut self.chats {
            if let Some(message) = chat.messages.iter_mut().find(|m| m.id == message_id) {
                return Some((&chat.id, message));
            }
        }
        None
    }
}

lazy_static! {
    pub(crate) static ref STATE: Mutex<ChatState> = Mutex::new(ChatState::new());
}

/// Max poll attempts `wait_for_populated_relay_pool` makes after the initial check.
const RELAY_POOL_WAIT_MAX_ATTEMPTS: u32 = 5;
/// Starting backoff delay between poll attempts, doubling each time up to a 1.6s cap
/// (200ms, 400ms, 800ms, 1.6s, 1.6s — worst case ~4.6s total).
const RELAY_POOL_WAIT_INITIAL_DELAY: std::time::Duration = std::time::Duration::from_millis(200);
const RELAY_POOL_WAIT_MAX_DELAY: std::time::Duration = std::time::Duration::from_millis(1600);

/// Bounded, backed-off wait for the relay pool to gain at least one relay. Login/startup adds
/// relays to the pool right after the client is built (see `connect`), and this can race a
/// caller that is about to establish a stream or subscription — which would otherwise fail
/// immediately with nostr-sdk's "no relays specified"/"no relays".
/// Polls with exponential backoff instead of busy-looping, and gives up after
/// `RELAY_POOL_WAIT_MAX_ATTEMPTS` so a genuinely relay-less session still fails fast rather than
/// hanging. Returns `true` once a relay is present (whether immediately or after waiting).
async fn wait_for_populated_relay_pool(client: &Client) -> bool {
    if !client.relays().await.is_empty() {
        return true;
    }

    let mut delay = RELAY_POOL_WAIT_INITIAL_DELAY;
    for _ in 0..RELAY_POOL_WAIT_MAX_ATTEMPTS {
        tokio::time::sleep(delay).await;
        if !client.relays().await.is_empty() {
            return true;
        }
        delay = std::cmp::min(delay * 2, RELAY_POOL_WAIT_MAX_DELAY);
    }
    false
}

/// Per-event ceiling on gift-wrap handling. An unwind is not the only way one inbound
/// event can end the intake loop: a payload that allocates or spins never unwinds, so a
/// deadline is the only bound that catches it.
const EVENT_HANDLING_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Result of one bounded gift-wrap intake attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IntakeOutcome {
    /// Handling completed; carries `handle_event`'s accepted-as-new verdict.
    Handled(bool),
    /// Handling unwound. A payload that panics does so deterministically, so the
    /// wrapper is permanently unhandleable and is recorded as discarded.
    Panicked,
    /// Handling exceeded the deadline. Retryable until the same wrapper times out
    /// `GIFTWRAP_TIMEOUT_DISCARD_AFTER` times in this process, then quarantined.
    TimedOut,
}

impl IntakeOutcome {
    /// Whether `handle_event` accepted the event as new.
    fn accepted_new(self) -> bool {
        matches!(self, IntakeOutcome::Handled(true))
    }

    /// Whether the failure repeats on every retry, so the wrapper should be recorded
    /// as discarded rather than re-fetched on each launch. Timeouts need the per-id
    /// counter in `note_giftwrap_timeout` — use that path from `handle_event_guarded`.
    #[cfg(test)]
    fn is_permanent_failure(self) -> bool {
        matches!(self, IntakeOutcome::Panicked)
    }
}

/// Run one intake attempt behind a failure boundary: catch an unwind, and abandon an
/// attempt that outlives `deadline`. Generic over the attempt so the boundary is
/// exercisable without a live relay.
async fn bounded_intake<F>(
    wrapper_event_id: &str,
    attempt: F,
    deadline: std::time::Duration,
) -> IntakeOutcome
where
    F: Future<Output = bool>,
{
    let guarded = std::panic::AssertUnwindSafe(attempt).catch_unwind();
    match tokio::time::timeout(deadline, guarded).await {
        Ok(Ok(accepted)) => IntakeOutcome::Handled(accepted),
        Ok(Err(_)) => {
            eprintln!(
                "[Intake] Gift wrap {} panicked while being handled; discarding it",
                wrapper_event_id
            );
            IntakeOutcome::Panicked
        }
        Err(_) => {
            eprintln!(
                "[Intake] Gift wrap {} exceeded the {}s handling deadline; abandoned for retry",
                wrapper_event_id,
                deadline.as_secs()
            );
            IntakeOutcome::TimedOut
        }
    }
}

/// Handle one inbound gift wrap so a hostile payload costs one event instead of the
/// whole intake path. Every intake caller goes through this rather than `handle_event`.
async fn handle_event_guarded(event: Event, is_new: bool) -> bool {
    let wrapper_event_id = event.id.to_hex();
    let outcome = bounded_intake(
        &wrapper_event_id,
        crate::cmds::chat::handle_event(event, is_new),
        EVENT_HANDLING_TIMEOUT,
    )
    .await;

    let quarantine = match outcome {
        IntakeOutcome::Panicked => true,
        IntakeOutcome::TimedOut => {
            let discard = note_giftwrap_timeout(&wrapper_event_id);
            if discard {
                eprintln!(
                    "[Intake] Gift wrap {} timed out {} times; discarding it",
                    wrapper_event_id, GIFTWRAP_TIMEOUT_DISCARD_AFTER
                );
            }
            discard
        }
        IntakeOutcome::Handled(_) => {
            clear_giftwrap_timeout_count(&wrapper_event_id);
            false
        }
    };

    if quarantine {
        if let Some(handle) = TAURI_APP.get() {
            let _ = db::record_discarded_giftwrap(handle, &wrapper_event_id).await;
        }
        WRAPPER_ID_CACHE.lock().await.insert(wrapper_event_id);
    }

    outcome.accepted_new()
}

#[cfg(test)]
mod intake_boundary_tests {
    use super::{
        bounded_intake, clear_giftwrap_timeout_count, note_giftwrap_timeout, ChatState,
        IntakeOutcome, SyncMode, GIFTWRAP_TIMEOUT_DISCARD_AFTER,
    };
    use crate::cmds::chat::abandon_sync_slice;
    use std::time::Duration;

    #[tokio::test]
    async fn a_well_formed_attempt_is_untouched_by_the_boundary() {
        let outcome = bounded_intake("ok", async { true }, Duration::from_secs(5)).await;
        assert_eq!(outcome, IntakeOutcome::Handled(true));
        assert!(outcome.accepted_new());
        assert!(!outcome.is_permanent_failure());

        let duplicate = bounded_intake("dup", async { false }, Duration::from_secs(5)).await;
        assert_eq!(duplicate, IntakeOutcome::Handled(false));
        assert!(!duplicate.accepted_new());
        assert!(!duplicate.is_permanent_failure());
    }

    #[tokio::test]
    async fn an_unwinding_payload_is_caught_and_treated_as_permanent() {
        let outcome = bounded_intake(
            "hostile",
            async { panic!("NIP-44 v2 decrypt out of bounds") },
            Duration::from_secs(5),
        )
        .await;
        assert_eq!(outcome, IntakeOutcome::Panicked);
        assert!(!outcome.accepted_new());
        assert!(outcome.is_permanent_failure());
    }

    #[tokio::test]
    async fn a_stalling_payload_is_abandoned_at_the_deadline_and_stays_retryable() {
        let outcome = bounded_intake(
            "stalled",
            async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                true
            },
            Duration::from_millis(20),
        )
        .await;
        assert_eq!(outcome, IntakeOutcome::TimedOut);
        assert!(!outcome.accepted_new());
        assert!(
            !outcome.is_permanent_failure(),
            "a single stall must stay retryable so a slow disk cannot drop a pending invitation"
        );
    }

    #[test]
    fn repeated_timeouts_for_the_same_wrapper_eventually_quarantine() {
        clear_giftwrap_timeout_count("wrap-timeout-q");
        for _ in 0..(GIFTWRAP_TIMEOUT_DISCARD_AFTER - 1) {
            assert!(!note_giftwrap_timeout("wrap-timeout-q"));
        }
        assert!(note_giftwrap_timeout("wrap-timeout-q"));
        clear_giftwrap_timeout_count("wrap-timeout-q");
        assert!(!note_giftwrap_timeout("wrap-timeout-q"));
    }

    #[tokio::test]
    async fn the_loop_survives_a_failure_and_processes_the_following_event() {
        let mut accepted = 0u16;
        for attempt in 0..3u8 {
            let outcome = match attempt {
                0 => bounded_intake("first", async { true }, Duration::from_secs(5)).await,
                1 => {
                    bounded_intake("hostile", async { panic!("boom") }, Duration::from_secs(5))
                        .await
                }
                _ => bounded_intake("third", async { true }, Duration::from_secs(5)).await,
            };
            if outcome.accepted_new() {
                accepted += 1;
            }
        }
        assert_eq!(
            accepted, 2,
            "the event after the hostile one must still be accepted"
        );
    }

    #[test]
    fn abandoning_a_slice_releases_both_in_flight_guards() {
        let mut state = ChatState::new();
        state.is_syncing = true;
        state.slice_in_flight = true;
        state.sync_mode = SyncMode::ForwardSync;
        state.sync_empty_iterations = 3;
        state.sync_total_iterations = 7;

        abandon_sync_slice(&mut state);

        assert!(!state.is_syncing);
        assert!(
            !state.slice_in_flight,
            "releasing is_syncing alone still refuses every later slice"
        );
        assert_eq!(state.sync_mode, SyncMode::Finished);
        assert_eq!(state.sync_empty_iterations, 0);
        assert_eq!(state.sync_total_iterations, 0);
    }
}

/*
MLS live subscriptions overview (using Marmot/MDK):
- GiftWrap subscription (Kind::GiftWrap):
  • Carries DMs/files and also MLS Welcomes. Welcomes are detected after unwrap in handle_event()
    when rumor.kind == Kind::MlsWelcome. We immediately persist via the MDK engine on a blocking
    thread (spawn_blocking) and emit "mls_invite_received" so the frontend can refresh
    list_pending_mls_welcomes without a manual sync.

- MLS Group Messages subscription (Kind::MlsGroupMessage):
  • Subscribed live in parallel to GiftWraps. We extract the wire group id from the 'h' tag and
    check membership using encrypted metadata (mls_groups). If a message is for a group we belong to,
    we process it via the MDK engine on a blocking thread, then persist to "mls_messages_{group_id}"
    and "mls_timeline_{group_id}" and emit "mls_message_new" for immediate UI updates.
  • For non-members: We attempt to process as a Welcome message (for invites from MDK-compatible clients).

- Deduplication:
  • Real-time path uses the same keys as sync (inner_event_id, wrapper_event_id). We only insert if
    inner_event_id is not present in the group messages map, and append to the timeline if absent.
    This prevents duplicates when subsequent explicit sync covers the same events.

- Send-boundary:
  • All MDK engine interactions occur inside tokio::task::spawn_blocking. We avoid awaits
    while holding the engine to respect non-Send constraints required by Tauri command futures.

- Privacy & logging:
  • We do not log plaintext message content. Logs are limited to ids, counts, kinds, and outcomes
    to aid QA without leaking sensitive content.
*/

// ============================================================================
// Relay Metrics & Logging
// ============================================================================

#[cfg(test)]
mod relay_failure_diagnostics_tests {
    use super::{clear_nostr_client, current_login_generation};
    use crate::cmds::auth::clear_relay_diagnostics_on_logout;
    use crate::cmds::relays::{
        add_relay_log, add_relay_log_if_current, clear_relay_failure,
        clear_relay_failure_if_current, normalize_relay_url, relay_failure_for,
        store_relay_failure_if_current, update_relay_metrics, update_relay_metrics_if_current,
        RelayFailure, RelayFailureCode, RelayInfo, DIAGNOSTICS_TEST_LOCK, RELAY_FAILURES,
        RELAY_LOGS, RELAY_METRICS,
    };

    fn failure(code: RelayFailureCode) -> RelayFailure {
        RelayFailure { code, detail: None }
    }

    #[test]
    fn store_then_read_round_trips_and_relays_are_independent() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let generation = current_login_generation();
        store_relay_failure_if_current(
            "wss://round-trip-a.example",
            failure(RelayFailureCode::ConnectionRefused),
            generation,
        );
        store_relay_failure_if_current(
            "wss://round-trip-b.example",
            failure(RelayFailureCode::TimedOut),
            generation,
        );

        let a = relay_failure_for("wss://round-trip-a.example", "disconnected").unwrap();
        let b = relay_failure_for("wss://round-trip-b.example", "terminated").unwrap();
        assert_eq!(a.code, RelayFailureCode::ConnectionRefused);
        assert_eq!(b.code, RelayFailureCode::TimedOut);

        clear_relay_failure("wss://round-trip-a.example");
        clear_relay_failure("wss://round-trip-b.example");
    }

    #[test]
    fn get_relays_projection_omits_reason_when_connected_but_map_retains_it() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let generation = current_login_generation();
        let url = "wss://still-stored.example";
        store_relay_failure_if_current(url, failure(RelayFailureCode::TlsFailed), generation);

        // The read-side gate (KTD8): a "connected" status omits the reason from the
        // get_relays projection even though the map entry is untouched.
        assert!(relay_failure_for(url, "connected").is_none());
        assert!(RELAY_FAILURES
            .read()
            .unwrap()
            .contains_key(&normalize_relay_url(url)));
        assert!(relay_failure_for(url, "disconnected").is_some());

        clear_relay_failure(url);
    }

    #[test]
    fn clearing_on_connected_removes_the_entry() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let generation = current_login_generation();
        let url = "wss://clears-on-connect.example";
        store_relay_failure_if_current(
            url,
            failure(RelayFailureCode::NetworkUnreachable),
            generation,
        );
        assert!(relay_failure_for(url, "disconnected").is_some());

        clear_relay_failure(url);

        assert!(!RELAY_FAILURES
            .read()
            .unwrap()
            .contains_key(&normalize_relay_url(url)));
    }

    #[test]
    fn trailing_slash_key_normalizes_both_directions() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let generation = current_login_generation();

        // Stored with a trailing slash, looked up without one.
        store_relay_failure_if_current(
            "wss://slash-fixture-a.example/",
            failure(RelayFailureCode::ProtocolError),
            generation,
        );
        assert!(relay_failure_for("wss://slash-fixture-a.example", "disconnected").is_some());
        clear_relay_failure("wss://slash-fixture-a.example");
        assert!(relay_failure_for("wss://slash-fixture-a.example/", "disconnected").is_none());

        // Stored without a trailing slash, looked up with one.
        store_relay_failure_if_current(
            "wss://slash-fixture-b.example",
            failure(RelayFailureCode::ProtocolError),
            generation,
        );
        assert!(relay_failure_for("wss://slash-fixture-b.example/", "disconnected").is_some());
        clear_relay_failure("wss://slash-fixture-b.example/");
        assert!(relay_failure_for("wss://slash-fixture-b.example", "disconnected").is_none());
    }

    #[test]
    fn removing_a_relay_clears_reason_and_readding_shows_none() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let generation = current_login_generation();
        let url = "wss://remove-readd.example";
        store_relay_failure_if_current(url, failure(RelayFailureCode::Unknown), generation);
        assert!(relay_failure_for(url, "disconnected").is_some());

        // Mirrors remove_custom_relay's clear-after-pool-removal.
        clear_relay_failure(url);
        // Re-adding the same URL must show no stale reason.
        assert!(relay_failure_for(url, "disconnected").is_none());
    }

    #[test]
    fn disabling_custom_and_default_relay_each_clear() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let generation = current_login_generation();
        let custom_url = "wss://disable-custom.example";
        let default_url = "wss://disable-default.example";
        store_relay_failure_if_current(
            custom_url,
            failure(RelayFailureCode::DnsFailed),
            generation,
        );
        store_relay_failure_if_current(
            default_url,
            failure(RelayFailureCode::DnsFailed),
            generation,
        );

        // Mirrors toggle_custom_relay's and toggle_default_relay's disable branches, which
        // both route through clear_relay_failure identically.
        clear_relay_failure(custom_url);
        clear_relay_failure(default_url);

        assert!(relay_failure_for(custom_url, "disconnected").is_none());
        assert!(relay_failure_for(default_url, "disconnected").is_none());
    }

    #[test]
    fn write_under_a_stale_login_generation_is_skipped() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let url = "wss://stale-generation.example";
        // Guaranteed to differ from the live generation without depending on its exact value.
        let stale_generation = current_login_generation().wrapping_sub(1000);

        store_relay_failure_if_current(url, failure(RelayFailureCode::Unknown), stale_generation);

        assert!(relay_failure_for(url, "disconnected").is_none());
    }

    #[test]
    fn logout_bumps_generation_so_pre_logout_monitor_writes_are_skipped() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let url = "wss://pre-logout-generation.example";
        let pre_logout = current_login_generation();
        store_relay_failure_if_current(url, failure(RelayFailureCode::Unknown), pre_logout);
        assert!(relay_failure_for(url, "disconnected").is_some());

        clear_nostr_client();
        assert_ne!(current_login_generation(), pre_logout);

        // Stale monitor still holding the pre-logout generation must not wipe or refill.
        clear_relay_failure_if_current(url, pre_logout);
        assert!(relay_failure_for(url, "disconnected").is_some());

        store_relay_failure_if_current(url, failure(RelayFailureCode::TimedOut), pre_logout);
        assert_eq!(
            relay_failure_for(url, "disconnected").unwrap().code,
            RelayFailureCode::Unknown
        );

        add_relay_log_if_current(url, "warn", "stale monitor line", pre_logout);
        update_relay_metrics_if_current(url, pre_logout, |m| m.ping_ms = Some(9));
        assert!(RELAY_LOGS
            .read()
            .unwrap()
            .get(&normalize_relay_url(url))
            .is_none());
        assert!(RELAY_METRICS
            .read()
            .unwrap()
            .get(&normalize_relay_url(url))
            .is_none());

        // Unguarded user clear still works after the bump.
        clear_relay_failure(url);
        assert!(relay_failure_for(url, "disconnected").is_none());
        store_relay_failure_if_current(
            url,
            failure(RelayFailureCode::TlsFailed),
            current_login_generation(),
        );
        assert_eq!(
            relay_failure_for(url, "disconnected").unwrap().code,
            RelayFailureCode::TlsFailed
        );
        clear_relay_failure(url);
    }

    #[test]
    fn logout_clears_failures_logs_and_metrics() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let generation = current_login_generation();
        let url = "wss://logout-fixture.example";
        store_relay_failure_if_current(url, failure(RelayFailureCode::Unknown), generation);
        add_relay_log(url, "warn", "fixture entry");
        update_relay_metrics(url, |m| m.ping_ms = Some(1));

        clear_relay_diagnostics_on_logout();

        assert!(RELAY_FAILURES.read().unwrap().is_empty());
        assert!(RELAY_LOGS.read().unwrap().is_empty());
        assert!(RELAY_METRICS.read().unwrap().is_empty());
    }

    /// Not just `.is_none()` on the Rust value -- asserts the actual wire shape, since a plain
    /// `Option<T>` field with no `skip_serializing_if` would otherwise cross IPC as an explicit
    /// `null`, which is present, not absent.
    #[test]
    fn failure_reason_serializes_as_an_absent_key_not_null_or_an_empty_object() {
        let info = RelayInfo {
            url: "wss://no-reason.example".to_string(),
            status: "connected".to_string(),
            is_default: false,
            is_custom: true,
            enabled: true,
            mode: "both".to_string(),
            failure_reason: None,
        };

        let value = serde_json::to_value(&info).unwrap();
        let object = value.as_object().unwrap();
        assert!(
            !object.contains_key("failure_reason"),
            "expected failure_reason to be absent, got {:?}",
            object.get("failure_reason")
        );
    }
}

// ============================================================================
// Relay Failure Classification
// ============================================================================

// ============================================================================
// Pre-add relay probe (U3): resolve, connect through a throwaway pool, and run
// one bounded read-only query before the operator ever saves the URL. Never
// touches `get_nostr_client()` or the operator's live pool (R6, KTD5).
// ============================================================================

// ============================================================================

// ============================================================================
// Custom Relay Management
// ============================================================================

// ============================================================================

// MLS Tauri Commands

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    operator_env::load_operator_env();

    // stderr is unbuffered even when piped, so this line is visible in the
    // e2e harness if we get past .so constructors and into Rust `main`.
    if test_sandbox::sandbox_root().is_some() {
        eprintln!("[sandbox] boot");
    }

    if let Err(e) = trusted_relays::init_from_env() {
        eprintln!("[trusted_relays] {e}");
        std::process::exit(1);
    }

    // Runs before any account or database work: a world boot may never resolve
    // the real OS app-data directory. See docs/build/DEV_SANDBOX.md.
    if let Err(e) = test_sandbox::enforce_dev_world_root() {
        eprintln!("[dev-world] {e}");
        std::process::exit(1);
    }

    // A second launch against a root a live process already holds would
    // otherwise silently share (and corrupt) that process's SQLite/MLS
    // store, now that the single-instance guard is skipped for sandboxes.
    // Held for this process's whole run -- see test_sandbox.rs -- and
    // released on drop, which fires when `run()` returns at app exit.
    let _sandbox_launch_lock = match test_sandbox::acquire_sandbox_launch_lock() {
        Ok(guard) => guard,
        Err(e) => {
            eprintln!("[sandbox] {e}");
            std::process::exit(1);
        }
    };

    #[cfg(target_os = "linux")]
    {
        // WebKitGTK can be quite funky cross-platform: as a result, we'll fallback to a more compatible renderer
        // In theory, this will make Vector run more consistently across a wider range of Linux Desktop distros.
        // Also set before spawn in scripts/run-e2e-tauri.mjs — constructors can
        // SIGILL on a headless Xvfb display before this line runs.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".to_string());
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "panic".to_string()
        };
        eprintln!("[PANIC] {} at {}", message, location);
        log::error!("[PANIC] {} at {}", message, location);
    }));

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_biometry::init());

    // MCP Bridge plugin for AI-assisted debugging (desktop debug builds only).
    // Loopback-only, on the branch-derived base port so parallel sandboxes do
    // not collide. The plugin scans forward from the base, so the bound port is
    // resolved here and published in the sandbox handle.
    #[cfg(all(debug_assertions, desktop))]
    let bound_bridge_port: Option<u16>;
    #[cfg(all(debug_assertions, desktop))]
    {
        const BRIDGE_BIND_ADDRESS: &str = "127.0.0.1";
        let base = std::env::var("PACTO_MCP_BRIDGE_PORT")
            .ok()
            .and_then(|p| p.trim().parse::<u16>().ok())
            .unwrap_or(9223);
        let port =
            tauri_plugin_mcp_bridge::discovery::find_available_port(BRIDGE_BIND_ADDRESS, base);
        bound_bridge_port = Some(port);
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address(BRIDGE_BIND_ADDRESS)
                .base_port(port)
                .build(),
        );
    }
    #[cfg(not(all(debug_assertions, desktop)))]
    let bound_bridge_port: Option<u16> = None;

    // Publish where this sandbox landed before the app is built, so an
    // orchestrator finds the handle even if window creation stalls. No-op
    // without a sandbox root.
    match sandbox_handle::write_handle(bound_bridge_port) {
        Ok(Some(path)) => println!("[sandbox] handle written: {}", path.display()),
        Ok(None) => {}
        Err(e) => eprintln!("[sandbox] failed to write handle: {e}"),
    }

    // Desktop-only plugins
    #[cfg(desktop)]
    {
        // Window state plugin: saves and restores window position, size, maximized state, etc.
        // Exclude VISIBLE flag so window starts hidden (we show it after content loads to prevent white flash)
        //
        // Filename is keyed off the sandbox root (debug builds only): the
        // plugin always saves under the shared app_config_dir, which
        // test_sandbox does not redirect, so concurrent sandboxes would
        // otherwise restore geometry from one shared file and stack on top
        // of each other. See test_sandbox::window_state_filename.
        use tauri_plugin_window_state::StateFlags;
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_filename(crate::test_sandbox::window_state_filename())
                .build(),
        );

        // Single-instance plugin: ensures deep links are passed to existing instance.
        //
        // Skipped for a dev sandbox. The guard is keyed on the app identifier, so it
        // cannot tell two sandboxes apart: the second one hands its argv to the first
        // and exits, which surfaces as an app that writes its handle, starts its
        // bridge, and then never logs in. Parallel agent sandboxes are separate
        // accounts in separate data directories and must run side by side.
        //
        // `multi_instance_allowed` is debug-only, so a release build always registers
        // the plugin no matter what the environment says.
        if !crate::test_sandbox::multi_instance_allowed() {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                // Handle deep links from single-instance (Windows/Linux)
                let urls: Vec<String> = args
                    .iter()
                    .filter(|arg| arg.starts_with("vector://") || arg.contains("vectorapp.io"))
                    .cloned()
                    .collect();
                if !urls.is_empty() {
                    deep_link::handle_deep_link(app, urls);
                }
                // Focus the existing window
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }));
        }
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_process::init())?;

            let handle = app.app_handle().clone();

            // Setup a graceful shutdown for our Nostr subscriptions
            let window = app.get_webview_window("main").unwrap();
            #[cfg(desktop)]
            let handle_for_window_state = handle.clone();
            window.on_window_event(move |event| {
                match event {
                    // This catches when the window is being closed
                    tauri::WindowEvent::CloseRequested { .. } => {
                        // Save window state (position, size, maximized, etc.) before closing
                        #[cfg(desktop)]
                        {
                            use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                            let _ = handle_for_window_state.save_window_state(StateFlags::all());
                        }

                        // Cleanly shutdown our Nostr client
                        if let Ok(nostr_client) = get_nostr_client() {
                            tauri::async_runtime::block_on(async {
                                // Shutdown the Nostr client
                                nostr_client.shutdown().await;
                            });
                        }
                    }
                    _ => {}
                }
            });

            // Migrate any legacy `vector.db`/`vector-mls.db` profiles
            // (pre-rename from the upstream Vector project) to
            // `pacto.db`/`pacto-mls.db` before anything else touches storage.
            account_manager::migrate_legacy_databases(&handle);

            // Auto-select account on startup if one exists but isn't selected
            {
                let handle_clone = handle.clone();
                let _ = account_manager::auto_select_account(&handle_clone);
            }

            // Startup log: persistent MLS device_id if present
            {
                let handle_clone = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(Some(id)) = db::load_mls_device_id(&handle_clone).await {
                        println!("[MLS] Found persistent mls_device_id at startup: {}", id);
                    }
                });
            }

            // Set as our accessible static app handle
            TAURI_APP.set(handle.clone()).unwrap();

            // Start the profile sync background processor
            tauri::async_runtime::spawn(async {
                profile_sync::start_profile_sync_processor().await;
            });

            // Debug-only background connectivity probe for the resolved relay set;
            // no-op unless PACTO_TRUSTED_RELAYS was set.
            trusted_relays::probe_endpoints_in_background();

            // Setup deep link listener for macOS/iOS/Android
            // On these platforms, deep links are received as events rather than CLI args
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle_for_deep_link = handle.clone();
                let _listener_id = app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    deep_link::handle_deep_link(&handle_for_deep_link, urls);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::get_theme,
            db::get_pkey,
            db::set_pkey,
            db::get_evm_pkey,
            db::set_evm_pkey,
            db::get_evm_address,
            db::set_evm_address,
            db::get_dm_peer_evm_address,
            db::set_dm_peer_evm_address,
            db::get_safe,
            db::set_safe,
            db::list_parent_treasury_safes,
            db::add_parent_treasury_safe,
            db::list_squad_infra,
            squad_gov_replica::list_squad_gov_replica,
            squad_gov_replica::upsert_squad_gov_replica,
            db::list_squad_infra_canonical_refs,
            db::list_squad_contract_allowlist,
            db::upsert_squad_contract_allowlist,
            db::remove_squad_contract_allowlist,
            db::list_squad_tracked_tokens,
            db::upsert_squad_tracked_token,
            db::remove_squad_tracked_token,
            db::list_squad_sponsored_fee_usage,
            db::upsert_squad_infra,
            dashboard_poll::list_dashboard_polls,
            dashboard_poll::send_dashboard_poll_create,
            dashboard_poll::send_dashboard_poll_vote,
            catch_up::list_catch_up_entries,
            catch_up::catch_up_count,
            catch_up::resolve_catch_up_entry,
            catch_up::resolve_all_catch_up_entries,
            catch_up::record_action_needed_entry,
            commons::commons_publish_broadcast,
            commons::commons_list_cached_broadcasts,
            commons::commons_fetch_broadcasts,
            commons::commons_get_local_active,
            commons::commons_cancel_broadcast,
            join_inbox::join_inbox_init,
            join_inbox::join_inbox_get_state,
            join_inbox::join_inbox_reclaim_if_split,
            join_inbox::join_inbox_add_holder,
            join_inbox::join_inbox_remove_holder,
            join_inbox::join_inbox_rotate_key,
            join_inbox::join_inbox_sync_join_dms,
            join_inbox::join_inbox_send_join_response,
            db::upsert_squad_member_evm,
            db::list_squad_member_evm,
            db::upsert_squad_member_evm_account,
            db::list_evm_account_squad_bindings,
            db::resolve_squad_roster_evm_address,
            squad_catalog::list_squads,
            squad_catalog::get_squad,
            squad_catalog::upsert_squad,
            squad_catalog::delete_squad,
            db::get_seed,
            db::set_seed,
            db::get_sql_setting,
            db::set_sql_setting,
            db::remove_setting,
            net_transport::set_tor_routing_enabled,
            net_transport::get_tor_status,
            profile::load_profile,
            profile::update_profile,
            profile::update_status,
            profile::upload_avatar,
            chat::mark_as_read,
            chat::set_notification_level,
            profile::toggle_blocked,
            profile::set_nickname,
            profile::get_profile,
            message::message,
            message::paste_message,
            message::voice_message,
            message::file_message,
            message::file_message_compressed,
            message::forward_attachment,
            message::get_file_info,
            message::cache_android_file,
            message::cache_file_bytes,
            message::get_cached_file_info,
            message::get_cached_image_preview,
            message::start_cached_bytes_compression,
            message::get_cached_bytes_compression_status,
            message::send_cached_file,
            message::send_file_bytes,
            message::klipy_gif_message,
            message::clear_cached_file,
            message::clear_android_file_cache,
            message::clear_all_android_file_cache,
            message::get_image_preview_base64,
            message::start_image_precompression,
            message::get_compression_status,
            message::clear_compression_cache,
            message::send_cached_compressed_file,
            message::react_to_message,
            message::edit_message,
            message::fetch_msg_metadata,
            cmds::chat::fetch_messages,
            cmds::auth::deep_rescan,
            cmds::auth::is_scanning,
            cmds::chat::get_chat_messages_paginated,
            cmds::chat::get_message_views,
            cmds::mls_groups::replay_mls_automation_side_effects,
            cmds::chat::get_messages_around_id,
            cmds::chat::get_chat_message_count,
            cmds::chat::delete_dm_chat,
            cmds::storage::get_file_hash_index,
            cmds::chat::evict_chat_messages,
            cmds::media::generate_blurhash_preview,
            cmds::media::decode_blurhash,
            cmds::media::download_attachment,
            cmds::media::save_attachment_as,
            cmds::auth::login,
            cmds::auth::login_with_recovery_phrase,
            #[cfg(debug_assertions)]
            cmds::relays::debug_hot_reload_sync,
            #[cfg(debug_assertions)]
            dev_login::dev_login,
            cmds::relays::notifs,
            cmds::relays::get_relays,
            cmds::relays::get_media_servers,
            // Custom relay management
            cmds::relays::get_custom_relays,
            cmds::relays::add_custom_relay,
            cmds::relays::remove_custom_relay,
            cmds::relays::toggle_custom_relay,
            cmds::relays::toggle_default_relay,
            cmds::relays::update_relay_mode,
            cmds::relays::validate_relay_url_cmd,
            cmds::relays::get_relay_metrics,
            cmds::relays::get_relay_logs,
            cmds::relays::monitor_relay_connections,
            cmds::relays::probe_relay,
            cmds::relays::get_relay_certificate,
            cmds::chat::start_typing,
            cmds::auth::connect,
            cmds::auth::encrypt,
            cmds::auth::decrypt,
            cmds::voice::start_recording,
            cmds::voice::stop_recording,
            cmds::chat::update_unread_counter,
            cmds::chat::get_unread_counts,
            cmds::auth::logout,
            cmds::auth::create_account,
            cmds::app::get_platform_features,
            cmds::voice::transcribe,
            cmds::voice::download_whisper_model,
            cmds::invites::get_or_create_invite_code,
            cmds::invites::accept_invite_code,
            cmds::invites::get_invited_users,
            cmds::profile_sync::check_fawkes_badge,
            cmds::storage::get_storage_info,
            cmds::storage::clear_storage,
            cmds::mls_groups::load_mls_device_id,
            cmds::mls_groups::load_mls_keypackages,
            cmds::app::sign_evm_hash,
            evm::wallet_prices::wallet_get_usd_spot_prices,
            evm::wallet_ops::get_wallet_summary,
            evm::wallet_ops::get_evm_native_balance,
            evm::wallet_ops::get_evm_erc20_balance,
            evm::wallet_ops::wallet_build_and_send_transaction,
            evm::wallet_ops::wallet_wait_for_transaction,
            evm::evm_accounts::list_evm_accounts,
            evm::evm_accounts::export_evm_account_key_plaintext,
            evm::evm_accounts::add_evm_account,
            evm::evm_accounts::import_evm_account,
            evm::evm_accounts::update_evm_account,
            evm::evm_accounts::set_active_evm_account,
            evm::evm_accounts::set_default_shared_evm_account,
            evm::evm_accounts::set_active_advanced_evm_account,
            evm::advanced_contract_call::evm_send_advanced_contract_call,
            evm::squad_allowlist::evm_send_squad_allowlisted_contract_call,
            evm::safe_deploy::safe_deploy_proxy,
            evm::nave_pirata_deploy::deploy_nave_pirata_for_parent,
            evm::war_game_deploy::deploy_war_game_for_parent,
            evm::squad_sponsor_deploy::deploy_squad_sponsor_for_parent,
            evm::squad_sponsor_deploy::deploy_squad_sponsor_hats_for_parent,
            evm::squad_sponsor_deposit::deposit_squad_sponsor,
            evm::squad_sponsor_withdraw::withdraw_squad_sponsor,
            evm::squad_sponsor_withdraw::get_squad_sponsor_withdrawable,
            evm::squad_sponsor_read::get_squad_sponsor_summary,
            evm::sponsor_userop::get_bundler_status,
            evm::sponsor_userop::set_pimlico_api_key,
            evm::sponsor_userop::clear_pimlico_api_key,
            evm::username::username_name_available,
            evm::username::username_can_bootstrap_claim,
            evm::username::username_npub_of,
            evm::username::username_record_of,
            evm::username::username_eligible_member,
            evm::username::username_is_pending_transfer,
            evm::username::username_bootstrap_spendable_pool_wei,
            evm::username::username_global_spendable_pool_wei,
            evm::username::username_mint_fee,
            evm::username::username_used_nonce,
            evm::username::username_get_cached_claim,
            evm::username::username_claim,
            evm::username::username_initiate_address_transfer,
            evm::username::username_claim_address_transfer,
            evm::username::username_cancel_address_transfer,
            evm::squad_sponsor_ext::get_squad_sponsor_ext_status,
            evm::squad_sponsor_ext::squad_sponsor_set_permitted_address,
            evm::squad_admin_deploy::deploy_squad_admin_for_parent,
            evm::squad_admin_write::squad_admin_create_role,
            evm::squad_admin_write::squad_admin_enable_executor,
            evm::squad_admin_write::squad_admin_enable_full_permission,
            evm::nave_pirata_read::get_nave_pirata_deployment,
            evm::nave_pirata_read::get_war_game_deployment,
            evm::treasury_authority_write::treasury_authority_propose,
            evm::treasury_authority_write::treasury_authority_crew_vote,
            evm::treasury_authority_write::treasury_authority_captain_vote,
            evm::treasury_authority_write::treasury_authority_execute,
            evm::treasury_proposals_read::list_treasury_proposals,
            evm::treasury_proposals_read::get_treasury_vote_config,
            evm::treasury_proposals_read::treasury_proposal_has_voted,
            evm::mutiny_ops::get_mutiny_status,
            evm::mutiny_ops::mutiny_has_voted,
            evm::mutiny_ops::mutiny_start_to_crew_member,
            evm::mutiny_ops::mutiny_start_to_committee,
            evm::mutiny_ops::mutiny_start_to_arbitrary_eoa,
            evm::mutiny_ops::mutiny_start_to_arbitrary_contract,
            evm::mutiny_ops::mutiny_start_to_pause_captain,
            evm::mutiny_ops::mutiny_cast_vote,
            evm::mutiny_ops::mutiny_execute,
            evm::mutiny_ops::mutiny_expire,
            evm::mutiny_ops::mutiny_captain_resign,
            evm::quartermaster_ops::get_quartermaster_status,
            evm::quartermaster_ops::get_quartermaster_pending,
            evm::quartermaster_ops::list_quartermaster_pending,
            evm::quartermaster_ops::quartermaster_request_add_crew,
            evm::quartermaster_ops::quartermaster_cancel_add_crew,
            evm::quartermaster_ops::quartermaster_execute_add_crew,
            evm::quartermaster_ops::quartermaster_bootstrap_crew,
            evm::quartermaster_ops::quartermaster_request_remove_crew,
            evm::quartermaster_ops::quartermaster_cancel_remove_crew,
            evm::quartermaster_ops::quartermaster_execute_remove_crew,
            evm::quartermaster_ops::crew_offboard_has_voted,
            evm::quartermaster_ops::quartermaster_propose_offboard,
            evm::quartermaster_ops::quartermaster_crew_offboard_vote,
            evm::quartermaster_ops::quartermaster_execute_offboard,
            evm::quartermaster_ops::quartermaster_expire_offboard,
            evm::gov_read::get_evm_block_number,
            evm::hats_read::get_hats_tree,
            evm::member_governance_read::get_member_hat_wearers,
            evm::member_governance_read::get_hat_wearers_for_ids,
            evm::member_governance_read::get_squad_admin_executor_roles,
            evm::access_control::get_squad_capabilities,
            evm::roster_bind_cert::sign_squad_roster_bind_cert,
            cmds::mls_groups::regenerate_device_keypackage,
            // MLS core commands
            cmds::mls_groups::create_group_chat,
            cmds::mls_groups::sync_mls_groups_now,
            cmds::mls_groups::list_mls_groups,
            cmds::mls_groups::get_mls_group_metadata,
            cmds::mls_groups::get_mls_store_reset_state,
            // MLS welcome/invite commands
            cmds::mls_groups::list_pending_mls_welcomes,
            cmds::mls_groups::accept_mls_welcome,
            // MLS advanced helpers
            cmds::mls_groups::add_mls_member_device,
            cmds::mls_groups::invite_member_to_group,
            cmds::mls_groups::remove_mls_member_device,
            cmds::mls_groups::get_mls_group_members,
            cmds::mls_groups::leave_mls_group,
            cmds::chat::list_group_cursors,
            cmds::mls_groups::refresh_keypackages_for_contact,
            // Profile sync commands
            cmds::profile_sync::queue_profile_sync,
            cmds::profile_sync::queue_chat_profiles_sync,
            cmds::profile_sync::refresh_profile_now,
            cmds::profile_sync::sync_all_profiles,
            // Deep link commands
            deep_link::get_pending_deep_link,
            // Account manager commands
            account_manager::get_current_account,
            account_manager::list_all_accounts,
            account_manager::check_any_account_exists,
            account_manager::switch_account,
            // Storage-format compatibility commands
            storage_format::get_storage_compatibility,
            // Session management commands (U4)
            session::check_session,
            session::session_heartbeat,
            session::get_session_timeout,
            session::set_session_timeout,
            // Biometric unlock commands
            cmds::auth::export_encryption_key_material,
            cmds::auth::unlock_with_biometric_key,
            // Image cache commands
            image_cache::get_or_cache_image,
            image_cache::clear_image_cache,
            image_cache::get_image_cache_stats,
            image_cache::cache_url_image,
            // Sticker packs
            sticker_pack::fetch_sticker_image,
            sticker_pack::list_sticker_packs,
            sticker_pack::save_sticker_pack,
            sticker_pack::upload_sticker_image,
            // Klipy GIFs
            klipy::klipy_is_configured,
            klipy::klipy_report_share,
            klipy::klipy_search_gifs,
            klipy::klipy_trending_gifs,
            klipy::klipy_fetch_media,
            // Notification sound commands (desktop only)
            #[cfg(desktop)]
            audio::get_notification_settings,
            #[cfg(desktop)]
            audio::set_notification_settings,
            #[cfg(desktop)]
            audio::preview_notification_sound,
            #[cfg(desktop)]
            audio::select_custom_notification_sound,
            // Maintenance (periodic cleanup tasks)
            cmds::app::run_maintenance,
            cmds::app::relaunch_app,
            #[cfg(all(not(target_os = "android"), feature = "whisper"))]
            whisper::delete_whisper_model,
            #[cfg(all(not(target_os = "android"), feature = "whisper"))]
            whisper::list_models,
            // Runtime configuration / feature flags
            app_config::get_app_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
