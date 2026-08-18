use futures_util::FutureExt;
use lazy_static::lazy_static;
use nostr_sdk::prelude::*;
use once_cell::sync::OnceCell;
use rand::distributions::Alphanumeric;
use rand::{thread_rng, Rng};
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Mutex;

mod crypto;

mod test_sandbox;

mod squad_catalog;

mod db;
use db::SlimProfile;

mod account_manager;

mod mls;
pub use mls::MlsService;
mod mls_store_reset;
mod mls_store_reset_state;

use db::save_chat_messages;

mod voice;
use voice::AudioRecorder;

mod net;

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
mod squad_bot;

mod sticker_pack;

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

    /// Total unread count across every chat (feeds the OS dock badge).
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

/// Grace period after a Finished account-wide sync before a `fetch_messages(false)` call
/// (wake/reconnect trigger) is worth re-checking for missed events.
const CATCH_UP_GRACE_SECS: u64 = 60;
/// Overlap subtracted from `last_catch_up_until` on CatchUp entry, to avoid missing events
/// that landed exactly at the boundary of the previous sync.
const CATCH_UP_OVERLAP_SECS: u64 = 30;
/// Max span of a single CatchUp slice, matching the initial login window.
const CATCH_UP_SLICE_SECS: u64 = 60 * 60 * 24 * 2;

lazy_static! {
    /// Arbitrary fixed point captured at process start. `Instant::elapsed()` against this is a
    /// monotonic clock reading immune to wall-clock adjustments (NTP, manual changes, sleep/
    /// resume skew) — used to detect catch-up staleness even when the wall clock lies.
    static ref MONOTONIC_EPOCH: std::time::Instant = std::time::Instant::now();
}

/// Seconds elapsed since `MONOTONIC_EPOCH`. Not itself unit-tested (it reads the real clock);
/// `should_enter_catch_up` and friends take the reading as a plain `u64` parameter so their
/// staleness logic is.
fn monotonic_now_secs() -> u64 {
    MONOTONIC_EPOCH.elapsed().as_secs()
}

/// Should a Finished, account-wide sync be promoted into a bounded CatchUp walk?
/// True once the grace window since the last successful catch-up has elapsed, judged by
/// whichever clock shows more elapsed time: the wall clock (`now` vs. `last_catch_up_until`)
/// or a monotonic clock reading (`now_monotonic` vs. `last_catch_up_monotonic`, seconds since
/// an arbitrary process-start epoch). The wall clock alone is not reliable here: a backward
/// step (NTP correction, manual clock change, or clock skew on sleep/resume) can make
/// `now.saturating_sub(last_catch_up_until)` read small or zero even though real time — which
/// the monotonic clock still measures correctly, being immune to wall-clock adjustments — has
/// genuinely moved on. `last_catch_up_monotonic` is `None` before any catch-up has completed
/// in this process; the wall-clock delta alone decides in that case (matching the already-
/// covered "never recorded" / zero-watermark behavior).
fn should_enter_catch_up(
    last_catch_up_until: u64,
    now: u64,
    last_catch_up_monotonic: Option<u64>,
    now_monotonic: u64,
) -> bool {
    let wall_clock_elapsed = now.saturating_sub(last_catch_up_until);
    let elapsed = match last_catch_up_monotonic {
        Some(anchor) => std::cmp::max(wall_clock_elapsed, now_monotonic.saturating_sub(anchor)),
        None => wall_clock_elapsed,
    };
    elapsed > CATCH_UP_GRACE_SECS
}

/// Computes the next CatchUp slice, walking FORWARD from `window_start` towards `now` in
/// `CATCH_UP_SLICE_SECS`-bounded steps. `window_start` is `last_catch_up_until` on first
/// entry (`apply_overlap = true`, to re-cover the boundary) or the previous slice's `until`
/// on every later slice of the same walk (`apply_overlap = false`). Returns
/// `(since, until, is_last_slice)`; `is_last_slice` is true once the slice reaches `now`.
fn catch_up_window(window_start: u64, now: u64, apply_overlap: bool) -> (u64, u64, bool) {
    let raw_since = if apply_overlap {
        window_start.saturating_sub(CATCH_UP_OVERLAP_SECS)
    } else {
        window_start
    };
    // A zero watermark means "no catch-up ever recorded" (fresh `ChatState`), not a
    // decades-stale window. Floor it the same way `single_relay_fetch_since` floors its
    // no-prior-catch-up fallback, so the first promotion on a fresh session starts at most
    // `CATCH_UP_SLICE_SECS` back instead of walking forward from the Unix epoch.
    let since = if window_start == 0 {
        std::cmp::max(raw_since, now.saturating_sub(CATCH_UP_SLICE_SECS))
    } else {
        raw_since
    };
    let until = std::cmp::min(now, since + CATCH_UP_SLICE_SECS);
    let is_last_slice = until >= now;
    (since, until, is_last_slice)
}

/// Full entry gate for promoting a Finished, account-wide sync into CatchUp. Requires no
/// sync already in flight — the same `is_syncing` in-flight guard `ForwardSync` sets when
/// the login sync starts — so a duplicate wake/reconnect trigger arriving while a CatchUp
/// (or any other) walk is still running never spawns a second, parallel window.
fn should_promote_to_catch_up(
    mode: SyncMode,
    is_syncing: bool,
    last_catch_up_until: u64,
    now: u64,
    last_catch_up_monotonic: Option<u64>,
    now_monotonic: u64,
) -> bool {
    mode == SyncMode::Finished
        && !is_syncing
        && should_enter_catch_up(
            last_catch_up_until,
            now,
            last_catch_up_monotonic,
            now_monotonic,
        )
}

/// Bounds a single-relay reconnect fetch: caps it at the 2-day `CATCH_UP_SLICE_SECS` window,
/// but narrows it to the gap since the last recorded account-wide catch-up (with the same
/// overlap used by `catch_up_window`) when that gap is smaller. A relay reconnecting shortly
/// after a full catch-up therefore does not redundantly re-fetch the whole 2-day window, while
/// a relay with no prior catch-up (`last_catch_up_until == 0`) or a long outage still gets the
/// full 2-day cap.
fn single_relay_fetch_since(last_catch_up_until: u64, now: u64) -> u64 {
    let two_day_floor = now.saturating_sub(CATCH_UP_SLICE_SECS);
    let recent_bound = last_catch_up_until.saturating_sub(CATCH_UP_OVERLAP_SECS);
    std::cmp::max(two_day_floor, recent_bound)
}

/// Branch-selection for the next sync slice, extracted from `fetch_messages` so the
/// ForwardSync/BackwardSync/DeepRescan/CatchUp continuation and promotion logic is
/// unit-testable without a Tauri `AppHandle` or Nostr client. Mutates `state` to claim the
/// returned window (and, on promotion, to enter `SyncMode::CatchUp`) exactly as the inlined
/// version did, including setting `slice_in_flight` so a concurrent call sees the claim.
/// Returns `None` when there is nothing to do this call: a slice is already claimed by a
/// concurrent invocation (`slice_in_flight`), or the account-wide sync is `Finished` and
/// still within the catch-up grace window.
///
/// A slice deferred by `defer_sync_slice_for_empty_pool` (`sync_slice_relay_wait`) is retried
/// first, before the `slice_in_flight` check: it re-claims the *exact* window that deferral
/// captured rather than falling through to the normal branch selection, which would advance
/// past it (ForwardSync/BackwardSync/DeepRescan) or require the catch-up grace window to
/// re-elapse (CatchUp/Finished).
fn next_sync_slice(
    state: &mut ChatState,
    now: u64,
    now_monotonic: u64,
) -> Option<(u64, u64, bool)> {
    if state.sync_slice_relay_wait {
        state.sync_slice_relay_wait = false;
        state.slice_in_flight = true;
        return Some((
            state.sync_window_start,
            state.sync_window_end,
            state.sync_slice_deferred_is_last,
        ));
    }

    if state.slice_in_flight {
        return None;
    }

    let (since, until, is_last) = if state.sync_mode == SyncMode::ForwardSync {
        // Forward sync (filling gaps from last message to now)
        let window_start = state.sync_window_start;
        let new_window_start = window_start - (60 * 60 * 24 * 2); // Always 2 days
        state.sync_window_start = new_window_start;
        state.sync_window_end = window_start;
        (new_window_start, window_start, false)
    } else if state.sync_mode == SyncMode::BackwardSync {
        // Backward sync (historically old messages)
        let window_start = state.sync_window_start;
        let new_window_start = window_start - (60 * 60 * 24 * 2); // Always 2 days
        state.sync_window_start = new_window_start;
        state.sync_window_end = window_start;
        (new_window_start, window_start, false)
    } else if state.sync_mode == SyncMode::DeepRescan {
        // Deep rescan mode - scan backwards in 2-day increments until 30 days of no events
        let window_start = state.sync_window_start;
        let new_window_start = window_start - (60 * 60 * 24 * 2); // Always 2 days
        state.sync_window_start = new_window_start;
        state.sync_window_end = window_start;
        (new_window_start, window_start, false)
    } else if state.sync_mode == SyncMode::CatchUp {
        // Continuing a CatchUp walk: advance forward from the previous slice's `until`.
        let (since, until, is_last) = catch_up_window(state.sync_window_end, now, false);
        state.sync_window_start = since;
        state.sync_window_end = until;
        (since, until, is_last)
    } else if should_promote_to_catch_up(
        state.sync_mode,
        state.is_syncing,
        state.last_catch_up_until,
        now,
        state.last_catch_up_monotonic,
        now_monotonic,
    ) {
        // Stale account-wide sync (wake/reconnect trigger past the grace window):
        // promote into a bounded forward CatchUp walk instead of returning None below.
        let (since, until, is_last) = catch_up_window(state.last_catch_up_until, now, true);
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.sync_empty_iterations = 0;
        state.sync_total_iterations = 0;
        state.sync_window_start = since;
        state.sync_window_end = until;
        (since, until, is_last)
    } else {
        // Finished within the grace window, or unknown state: nothing to do.
        return None;
    };

    state.slice_in_flight = true;
    Some((since, until, is_last))
}

/// Post-fetch continue/terminate decision, extracted from `fetch_messages` for the same
/// reason as `next_sync_slice`. `events_found` is `total_events_count` for DeepRescan and
/// `new_messages_count` for every other mode — the caller selects which. `oldest_message_time`
/// is the oldest message timestamp across all chats, read only for the ForwardSync ->
/// BackwardSync transition. Always releases `slice_in_flight` before returning, whether the
/// walk continues or terminates, so the next slice (continuation loop or a racing
/// wake/reconnect trigger) can proceed.
fn record_slice_result(
    state: &mut ChatState,
    new_messages_count: u16,
    events_found: u16,
    catch_up_is_last_slice: bool,
    oldest_message_time: Option<u64>,
    now: u64,
    now_monotonic: u64,
) -> bool {
    let mut continue_sync = true;

    state.sync_total_iterations += 1;

    if events_found > 0 {
        state.sync_empty_iterations = 0;
    } else {
        state.sync_empty_iterations += 1;
    }

    if state.sync_mode == SyncMode::ForwardSync {
        // Forward sync transitions to backward sync after:
        // 1. Finding messages and going 3 more iterations without messages, or
        // 2. Going 5 iterations without finding any messages
        let enough_empty_iterations = state.sync_empty_iterations >= 5;
        let found_then_empty = new_messages_count > 0 && state.sync_empty_iterations >= 3;

        if found_then_empty || enough_empty_iterations {
            state.sync_mode = SyncMode::BackwardSync;
            state.sync_empty_iterations = 0;
            state.sync_total_iterations = 0;

            if let Some(oldest_ts) = oldest_message_time {
                state.sync_window_end = oldest_ts;
                state.sync_window_start = oldest_ts - (60 * 60 * 24 * 2); // 2 days before oldest
            } else {
                // Still start backward sync, but from recent history
                let thirty_days_ago = now - (60 * 60 * 24 * 30);
                state.sync_window_end = thirty_days_ago;
                state.sync_window_start = thirty_days_ago - (60 * 60 * 24 * 2);
            }
        }
    } else if state.sync_mode == SyncMode::BackwardSync {
        // For backward sync, continue until no messages found for 5 consecutive iterations
        if state.sync_empty_iterations >= 5 {
            state.sync_mode = SyncMode::Finished;
            continue_sync = false;
        }
    } else if state.sync_mode == SyncMode::DeepRescan {
        // For deep rescan, continue until no messages found for 15 consecutive iterations
        // (30 days of no events at 2 days/iteration)
        if state.sync_empty_iterations >= 15 {
            state.sync_mode = SyncMode::Finished;
            continue_sync = false;
        }
    } else if state.sync_mode == SyncMode::CatchUp {
        // CatchUp terminates once the slice we just processed reached "now" (not on empty
        // iterations — a quiet inbox is a perfectly valid CatchUp outcome).
        if catch_up_is_last_slice {
            state.sync_mode = SyncMode::Finished;
            continue_sync = false;
        }
    } else {
        continue_sync = false; // Unknown state, stop syncing
    }
    // Every path that lands here with `continue_sync == false` is a normal completion of a
    // full account-wide walk (BackwardSync/DeepRescan exhausting empty iterations, or CatchUp
    // reaching "now") — advance the watermark. A failed relay event stream never reaches this
    // function at all (it returns early with its own reset), so there's no "failed" case to
    // gate out separately here.
    if !continue_sync {
        state.last_catch_up_until = now;
        state.last_catch_up_monotonic = Some(now_monotonic);
    }
    state.slice_in_flight = false;
    continue_sync
}

#[cfg(test)]
mod unread_count_tests {
    use super::*;

    fn unread_message(id: &str, mine: bool) -> Message {
        Message {
            id: id.to_string(),
            content: "hi".to_string(),
            at: 1,
            mine,
            ..Default::default()
        }
    }

    #[test]
    fn nothing_level_chat_contributes_zero_to_map_and_total() {
        let mut state = ChatState::new();
        let mut chat = Chat::new_dm("npub1peer".to_string());
        chat.notification_level = NotificationLevel::Nothing;
        chat.messages.push(unread_message("m1", false));
        chat.messages.push(unread_message("m2", false));
        state.chats.push(chat);

        assert!(state.unread_counts_by_chat().is_empty());
        assert_eq!(state.count_unread_messages(), 0);
    }

    #[test]
    fn mentions_chat_total_ignores_nothing_chat_unread() {
        let mut state = ChatState::new();

        let mut counted = Chat::new_dm("npub1peer".to_string());
        counted.notification_level = NotificationLevel::Mentions;
        counted.messages.push(unread_message("m1", false));
        counted.messages.push(unread_message("m2", false));
        state.chats.push(counted);

        let mut silenced = Chat::new_dm("npub1other".to_string());
        silenced.notification_level = NotificationLevel::Nothing;
        silenced.messages.push(unread_message("m3", false));
        silenced.messages.push(unread_message("m4", false));
        silenced.messages.push(unread_message("m5", false));
        state.chats.push(silenced);

        assert_eq!(state.count_unread_messages(), 2);
    }

    #[test]
    fn map_includes_mls_chats_keyed_by_group_id() {
        let mut state = ChatState::new();
        let mut group = Chat::new_mls_group(
            "group-abc".to_string(),
            vec!["npub1a".to_string(), "npub1b".to_string()],
        );
        group.messages.push(unread_message("m1", false));
        state.chats.push(group);

        let counts = state.unread_counts_by_chat();
        assert_eq!(counts.get("group-abc"), Some(&1));
    }

    #[test]
    fn reverse_walk_stops_at_own_most_recent_message_for_mls_chats() {
        let mut state = ChatState::new();
        let mut group = Chat::new_mls_group("group-abc".to_string(), vec!["npub1a".to_string()]);
        group.messages.push(unread_message("m1", false));
        group.messages.push(unread_message("m2", true)); // own message: stop here
        group.messages.push(unread_message("m3", false));
        group.messages.push(unread_message("m4", false));
        state.chats.push(group);

        let counts = state.unread_counts_by_chat();
        assert_eq!(counts.get("group-abc"), Some(&2));
    }

    #[test]
    fn marking_mls_chat_read_drops_its_count_to_zero() {
        let mut state = ChatState::new();
        let mut group = Chat::new_mls_group("group-abc".to_string(), vec!["npub1a".to_string()]);
        group.messages.push(unread_message("m1", false));
        group.messages.push(unread_message("m2", false));
        state.chats.push(group);
        assert_eq!(state.unread_counts_by_chat().get("group-abc"), Some(&2));

        // Same watermark logic `mark_as_read` applies: pick the last non-mine message.
        let chat = state
            .chats
            .iter_mut()
            .find(|c| c.id == "group-abc")
            .unwrap();
        assert!(chat.set_as_read());

        assert!(state.unread_counts_by_chat().get("group-abc").is_none());
        assert_eq!(state.count_unread_messages(), 0);
    }

    #[test]
    fn raising_a_nothing_chat_to_mentions_recounts_its_already_received_messages() {
        let mut state = ChatState::new();
        let mut chat = Chat::new_dm("npub1peer".to_string());
        chat.notification_level = NotificationLevel::Nothing;
        chat.messages.push(unread_message("m1", false));
        chat.messages.push(unread_message("m2", false));
        state.chats.push(chat);
        assert_eq!(state.count_unread_messages(), 0);

        state.chats[0].notification_level = NotificationLevel::Mentions;
        assert_eq!(state.count_unread_messages(), 2);
    }

    #[test]
    fn blocked_dm_peer_contributes_zero_even_at_all_level() {
        let mut state = ChatState::new();
        let mut profile = Profile::new();
        profile.id = "npub1peer".to_string();
        profile.blocked = true;
        state.profiles.push(profile);

        let mut chat = Chat::new_dm("npub1peer".to_string());
        chat.notification_level = NotificationLevel::All;
        chat.messages.push(unread_message("m1", false));
        state.chats.push(chat);

        assert!(state.unread_counts_by_chat().is_empty());
    }
}

#[cfg(test)]
mod catch_up_tests {
    use super::{
        catch_up_window, should_enter_catch_up, should_promote_to_catch_up,
        single_relay_fetch_since, SyncMode, CATCH_UP_GRACE_SECS, CATCH_UP_OVERLAP_SECS,
        CATCH_UP_SLICE_SECS,
    };

    #[test]
    fn within_grace_window_does_not_enter_catch_up() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - 30; // 30s ago, well within the 60s grace window
        assert!(!should_enter_catch_up(last_catch_up_until, now, None, 0));
    }

    #[test]
    fn promotion_blocked_while_a_sync_is_already_in_flight() {
        // The in-flight guard: even with a stale watermark, a sync already running
        // (is_syncing = true) must not spawn a second, parallel CatchUp window.
        let now = 1_000_000u64;
        let last_catch_up_until = now - 60 * 60; // 1 hour ago: stale enough on its own
        assert!(!should_promote_to_catch_up(
            SyncMode::Finished,
            true,
            last_catch_up_until,
            now,
            None,
            0
        ));
        assert!(should_promote_to_catch_up(
            SyncMode::Finished,
            false,
            last_catch_up_until,
            now,
            None,
            0
        ));
    }

    #[test]
    fn promotion_only_fires_from_finished_mode() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - 60 * 60;
        for mode in [
            SyncMode::ForwardSync,
            SyncMode::BackwardSync,
            SyncMode::DeepRescan,
            SyncMode::CatchUp,
        ] {
            assert!(!should_promote_to_catch_up(
                mode,
                false,
                last_catch_up_until,
                now,
                None,
                0
            ));
        }
    }

    #[test]
    fn exactly_at_grace_boundary_does_not_enter_catch_up() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - CATCH_UP_GRACE_SECS;
        assert!(!should_enter_catch_up(last_catch_up_until, now, None, 0));
    }

    #[test]
    fn stale_last_catch_up_enters_catch_up() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - 60 * 60; // 1 hour ago (the test name already conveys the scenario)
        assert!(should_enter_catch_up(last_catch_up_until, now, None, 0));
    }

    #[test]
    fn zero_watermark_enters_catch_up() {
        // A never-recorded (0) watermark is maximally stale and must enter catch-up.
        let now = 1_000_000u64;
        assert!(should_enter_catch_up(0, now, None, 0));
    }

    #[test]
    fn first_slice_covers_a_single_two_day_window_ending_at_now() {
        // last_catch_up_until 1 hour ago fetches a single 2-day window ending at now.
        let now = 2_000_000u64;
        let last_catch_up_until = now - 60 * 60;
        let (since, until, is_last) = catch_up_window(last_catch_up_until, now, true);

        assert_eq!(since, last_catch_up_until - 30); // overlap applied
        assert_eq!(until, now); // capped at now, well inside the 2-day slice cap
        assert!(is_last);
    }

    #[test]
    fn zero_watermark_floors_to_two_day_cap_instead_of_the_unix_epoch() {
        // A fresh ChatState's last_catch_up_until is 0 (never recorded), not a genuine
        // decades-old watermark. Mirrors single_relay_fetch_falls_back_to_two_day_cap_with_no_prior_catch_up:
        // the walk must start no further back than the 2-day slice cap.
        let now = 2_000_000_000u64;
        let (since, until, is_last) = catch_up_window(0, now, true);

        assert!(since >= now - CATCH_UP_SLICE_SECS);
        assert_eq!(until, now);
        assert!(is_last);
    }

    #[test]
    fn zero_watermark_still_promotes_to_catch_up() {
        let now = 2_000_000_000u64;
        assert!(should_promote_to_catch_up(
            SyncMode::Finished,
            false,
            0,
            now,
            None,
            0
        ));
    }

    #[test]
    fn wide_gap_produces_bounded_forward_slices_until_reaching_now() {
        // A gap wider than one slice must walk FORWARD (not backward) in
        // CATCH_UP_SLICE_SECS-bounded steps, ending exactly at `now`.
        let now = 10 * CATCH_UP_SLICE_SECS + 1_000;
        let last_catch_up_until = 500u64; // gap spans several slices

        let (since1, until1, is_last1) = catch_up_window(last_catch_up_until, now, true);
        assert_eq!(since1, last_catch_up_until - 30);
        assert_eq!(until1, since1 + CATCH_UP_SLICE_SECS);
        assert!(
            until1 < now,
            "first slice of a wide gap must not reach now yet"
        );
        assert!(!is_last1);

        // Next slice continues forward from the previous slice's `until`, no overlap.
        let (since2, until2, is_last2) = catch_up_window(until1, now, false);
        assert_eq!(since2, until1);
        assert!(
            since2 > since1,
            "window must advance forward, never backward"
        );
        assert!(!is_last2);

        // Walk remaining slices until the loop terminates at `now`.
        let mut since = since2;
        let mut until = until2;
        let mut is_last = is_last2;
        let mut iterations = 1;
        while !is_last {
            let (s, u, last) = catch_up_window(until, now, false);
            assert!(s >= since, "window must never move backward");
            since = s;
            until = u;
            is_last = last;
            iterations += 1;
            assert!(iterations < 100, "catch-up walk did not terminate");
        }
        assert_eq!(until, now);
    }

    #[test]
    fn single_relay_fetch_falls_back_to_two_day_cap_with_no_prior_catch_up() {
        // last_catch_up_until == 0 (never recorded): full 2-day cap, not the recent-gap bound.
        let now = 2_000_000_000u64;
        assert_eq!(single_relay_fetch_since(0, now), now - CATCH_UP_SLICE_SECS);
    }

    #[test]
    fn single_relay_fetch_narrows_to_recent_catch_up_gap() {
        // Reconnecting 10 minutes after a full account-wide catch-up must not re-fetch 2 days.
        let now = 2_000_000_000u64;
        let last_catch_up_until = now - 600;
        let since = single_relay_fetch_since(last_catch_up_until, now);
        assert_eq!(since, last_catch_up_until - CATCH_UP_OVERLAP_SECS);
        assert!(
            since > now - CATCH_UP_SLICE_SECS,
            "narrowed window must be tighter than the 2-day cap"
        );
    }

    #[test]
    fn single_relay_fetch_stays_capped_at_two_days_for_a_long_outage() {
        // A relay down far longer than 2 days must not walk back further than the cap.
        let now = 2_000_000_000u64;
        let last_catch_up_until = now - 10 * CATCH_UP_SLICE_SECS;
        assert_eq!(
            single_relay_fetch_since(last_catch_up_until, now),
            now - CATCH_UP_SLICE_SECS
        );
    }
}

#[cfg(test)]
mod fetch_messages_state_machine_tests {
    use super::{
        abandon_sync_slice, defer_sync_slice_for_empty_pool, is_empty_relay_pool_error,
        next_sync_slice, record_slice_result, ChatState, SyncMode, CATCH_UP_GRACE_SECS,
        CATCH_UP_SLICE_SECS,
    };

    #[test]
    fn promotion_claims_a_catch_up_slice_and_marks_it_in_flight() {
        // Fresh ChatState: Finished, not syncing, never caught up. A wake/reconnect trigger
        // must promote into CatchUp and claim the slice.
        let mut state = ChatState::new();
        let now = 2_000_000_000u64;

        let result = next_sync_slice(&mut state, now, 0);

        assert!(result.is_some());
        let (since, until, is_last) = result.unwrap();
        assert!(since >= now - CATCH_UP_SLICE_SECS);
        assert_eq!(until, now);
        assert!(is_last);
        assert_eq!(state.sync_mode, SyncMode::CatchUp);
        assert!(state.is_syncing);
        assert!(state.slice_in_flight);
    }

    #[test]
    fn continuation_advances_the_catch_up_window_forward() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.sync_window_start = 1_000;
        state.sync_window_end = 5_000;
        let now = 5_000 + CATCH_UP_SLICE_SECS * 3;

        let (since, until, is_last) = next_sync_slice(&mut state, now, 0).unwrap();

        // Continuation has no overlap and starts exactly where the previous slice ended.
        assert_eq!(since, 5_000);
        assert_eq!(until, 5_000 + CATCH_UP_SLICE_SECS);
        assert!(!is_last);
        assert_eq!(state.sync_window_start, since);
        assert_eq!(state.sync_window_end, until);
        assert!(state.slice_in_flight);
    }

    #[test]
    fn a_concurrent_call_is_rejected_while_a_slice_is_in_flight() {
        // This is the regression guard for the concurrency bug: a second fetch_messages(false)
        // call (wake trigger racing the normal continuation loop, or vice versa) must not
        // advance sync_window_end a second time while the first call's slice is still in flight.
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.sync_window_start = 1_000;
        state.sync_window_end = 5_000;
        state.slice_in_flight = true; // another call already claimed this slice

        let result = next_sync_slice(&mut state, 50_000, 0);

        assert!(
            result.is_none(),
            "a concurrent call must be rejected as a no-op duplicate"
        );
        // The window must be untouched: the in-flight call's own window is still authoritative.
        assert_eq!(state.sync_window_start, 1_000);
        assert_eq!(state.sync_window_end, 5_000);
    }

    #[test]
    fn catch_up_terminates_on_the_last_slice_and_advances_the_watermark() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.slice_in_flight = true;
        let now = 2_000_000_000u64;

        let continue_sync = record_slice_result(
            &mut state, /* new_messages_count */ 0, /* events_found */ 0,
            /* catch_up_is_last_slice */ true, /* oldest_message_time */ None, now, 0,
        );

        assert!(
            !continue_sync,
            "CatchUp reaching its last slice must terminate the walk"
        );
        assert_eq!(state.sync_mode, SyncMode::Finished);
        assert_eq!(
            state.last_catch_up_until, now,
            "a normal completion must advance the watermark"
        );
        assert!(
            !state.slice_in_flight,
            "the claim must be released once the slice is recorded"
        );
    }

    #[test]
    fn catch_up_continues_and_releases_the_in_flight_claim_when_not_the_last_slice() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.slice_in_flight = true;
        let last_catch_up_until_before = state.last_catch_up_until;

        let continue_sync = record_slice_result(&mut state, 0, 0, false, None, 2_000_000_000u64, 0);

        assert!(continue_sync);
        assert_eq!(
            state.sync_mode,
            SyncMode::CatchUp,
            "walk keeps going until the last slice"
        );
        assert_eq!(
            state.last_catch_up_until, last_catch_up_until_before,
            "no watermark advance mid-walk"
        );
        assert!(
            !state.slice_in_flight,
            "the claim must be released so the next slice can proceed"
        );
    }

    #[test]
    fn backward_sync_terminates_after_five_empty_iterations_and_advances_the_watermark() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::BackwardSync;
        state.is_syncing = true;
        state.sync_empty_iterations = 4;
        state.slice_in_flight = true;
        let now = 2_000_000_000u64;

        let continue_sync = record_slice_result(&mut state, 0, 0, false, None, now, 0);

        assert!(!continue_sync);
        assert_eq!(state.sync_mode, SyncMode::Finished);
        assert_eq!(state.last_catch_up_until, now);
    }

    #[test]
    fn a_backward_wall_clock_jump_does_not_suppress_a_catch_up_that_was_otherwise_due() {
        // Regression guard: an NTP correction or manual clock change stepping the wall clock
        // backward must not make a genuinely due catch-up look fresh. The monotonic reading
        // (immune to wall-clock adjustments) is what actually elapsed and must win.
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::Finished;
        state.is_syncing = false;
        state.last_catch_up_until = 1_000_000; // wall clock at the last successful catch-up
        state.last_catch_up_monotonic = Some(1_000); // monotonic reading at that same moment

        // The wall clock has jumped BACKWARD: it now reads before the last catch-up watermark,
        // so the wall-clock delta alone would saturate to 0 and hide the staleness.
        let now_wall_clock = 999_000u64;
        assert!(now_wall_clock < state.last_catch_up_until);

        // Real (monotonic) time has genuinely moved on well past the grace window.
        let now_monotonic = 1_000 + CATCH_UP_GRACE_SECS + 30;

        let result = next_sync_slice(&mut state, now_wall_clock, now_monotonic);

        assert!(
            result.is_some(),
            "monotonic elapsed time must still trigger the overdue catch-up"
        );
        assert_eq!(state.sync_mode, SyncMode::CatchUp);
    }

    #[test]
    fn deferred_slice_from_an_empty_pool_is_retried_immediately_not_abandoned() {
        // Regression guard: on a first-boot login, the account-wide sync
        // claims its initial ForwardSync window, but the relay pool is still empty when the
        // stream tries to establish (relay setup hasn't completed yet). The old behavior
        // (`abandon_sync_slice`) reset the walk to `Finished` permanently in practice — nothing
        // else re-triggers `fetch_messages(false)` on a fresh session, and even a prompt retry
        // within the 60s catch-up grace window would see `next_sync_slice` return `None` (see
        // `abandon_sync_slice_leaves_a_prompt_retry_with_nothing_to_do` below).
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::ForwardSync;
        state.is_syncing = true;
        state.sync_window_start = 1_000_000;
        state.sync_window_end = 1_100_000;
        state.slice_in_flight = true; // claimed by the slice that's about to fail

        let now = 2_000_000_000u64;

        // The stream establishment failed because the pool was empty — defer, don't abandon.
        defer_sync_slice_for_empty_pool(&mut state, /* is_last */ false);

        assert!(
            !state.slice_in_flight,
            "the claim is released so a retry isn't rejected as a concurrent duplicate"
        );
        assert_eq!(
            state.sync_mode,
            SyncMode::ForwardSync,
            "deferral must not terminate the walk like abandon_sync_slice does"
        );
        assert!(state.is_syncing, "still syncing — just waiting on relays");

        // A relay connects moments later (well within the 60s catch-up grace window) and the
        // caller retries via fetch_messages(false) -> next_sync_slice.
        let retry = next_sync_slice(&mut state, now, 0);

        assert_eq!(
            retry,
            Some((1_000_000, 1_100_000, false)),
            "the exact deferred window must be retried, not skipped or gated on the grace window"
        );
        assert!(
            state.slice_in_flight,
            "the retried slice re-claims the in-flight guard"
        );
        assert!(
            !state.sync_slice_relay_wait,
            "the deferred-retry flag is consumed once the slice is re-claimed"
        );
    }

    #[test]
    fn abandon_sync_slice_leaves_a_prompt_retry_with_nothing_to_do() {
        // Contrast case: the OLD (pre-fix) permanent-abandon path. A retry that arrives
        // promptly (well inside the 60s catch-up grace window) finds nothing to do, because
        // `abandon_sync_slice` doesn't preserve the claimed window and `next_sync_slice`
        // requires the grace window to elapse before promoting a `Finished` sync into anything.
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::ForwardSync;
        state.is_syncing = true;
        state.sync_window_start = 1_000_000;
        state.sync_window_end = 1_100_000;
        state.slice_in_flight = true;
        state.last_catch_up_until = 1_999_999_970; // a very recent watermark from earlier in the session

        let now = 2_000_000_000u64; // 30s later — inside the 60s grace window

        abandon_sync_slice(&mut state);
        assert_eq!(state.sync_mode, SyncMode::Finished);

        let retry = next_sync_slice(&mut state, now, 0);
        assert_eq!(
            retry, None,
            "abandon_sync_slice leaves a prompt retry with nothing to do inside the grace window"
        );
    }

    #[test]
    fn empty_relay_pool_error_detection_matches_no_relays_variants_only() {
        assert!(is_empty_relay_pool_error("no relays specified"));
        assert!(is_empty_relay_pool_error("No Relays"));
        assert!(!is_empty_relay_pool_error("relay banned"));
        assert!(!is_empty_relay_pool_error("connection refused"));
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

#[tauri::command]
async fn fetch_messages<R: Runtime>(handle: AppHandle<R>, init: bool, relay_url: Option<String>) {
    let client = get_nostr_client().expect("Nostr client not initialized");

    // Grab our pubkey
    let signer = match client.signer().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Sync] Failed to get Nostr signer: {}", e);
            return;
        }
    };
    let my_public_key = match signer.get_public_key().await {
        Ok(pk) => pk,
        Err(e) => {
            eprintln!("[Sync] Failed to get public key from signer: {}", e);
            return;
        }
    };

    // If relay_url is provided, this is a single-relay sync that bypasses global state
    if relay_url.is_some() {
        // Single relay sync - bounded by the 2-day cap, narrowed to the gap since the last
        // account-wide catch-up. Read-only lock: does not mutate ChatState.
        let now = Timestamp::now();
        let last_catch_up_until = STATE.lock().await.last_catch_up_until;
        let since = single_relay_fetch_since(last_catch_up_until, now.as_secs());

        let filter = Filter::new()
            .pubkey(my_public_key)
            .kind(Kind::GiftWrap)
            .since(Timestamp::from_secs(since))
            .until(now);

        // Fetch from specific relay only
        let relay_url_str = relay_url.unwrap();
        let mut events = match client
            .stream_events_from(
                vec![relay_url_str.clone()],
                filter,
                std::time::Duration::from_secs(30),
            )
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                eprintln!(
                    "[Single-Relay Sync] Failed to fetch events from {}: {}",
                    relay_url_str, e
                );
                return;
            }
        };

        // Process events without affecting global sync state
        while let Some(event) = events.next().await {
            handle_event_guarded(event, false).await;
        }

        // Also sync MLS group messages after single-relay reconnection
        if let Err(e) = sync_mls_groups_now(None).await {
            eprintln!("[Single-Relay Sync] Failed to sync MLS groups: {}", e);
        }

        return; // Exit early for single-relay syncs
    }

    // Regular sync logic with global state management
    let (since_timestamp, until_timestamp, catch_up_is_last_slice) = {
        let mut state = STATE.lock().await;

        if init {
            // Set current account for SQL mode if profile database exists
            // This must be done BEFORE loading chats/messages so SQL mode is active
            let signer = client.signer().await.unwrap();
            let my_public_key = signer.get_public_key().await.unwrap();
            let npub = my_public_key.to_bech32().unwrap();

            let app_data = crate::test_sandbox::test_data_dir(&handle).ok();
            if let Some(data_dir) = app_data {
                let profile_db = data_dir.join(&npub).join("pacto.db");
                if profile_db.exists() {
                    let _ = crate::account_manager::set_current_account(npub.clone());
                    println!("[Startup] Set current account for SQL mode: {}", npub);
                }
            }

            // Load our DB (if we haven't already; i.e: our profile is the single loaded profile since login)
            let mut needs_integrity_check = false;
            if state.profiles.len() == 1 {
                let profiles = db::get_all_profiles(&handle).await.unwrap();
                // Load our Profile Cache into the state
                state.merge_db_profiles(profiles).await;

                // Spawn background task to cache profile images for offline support
                tokio::spawn(async {
                    profile::cache_all_profile_images().await;
                });

                // Load chats and their messages from database
                let slim_chats_result = db::get_all_chats(&handle).await;
                if let Ok(slim_chats) = slim_chats_result {
                    // Load MLS groups to check for evicted status
                    let mls_groups: Option<Vec<mls::MlsGroupMetadata>> =
                        db::load_mls_groups(&handle).await.ok();

                    // Convert slim chats to full chats and load their messages
                    for slim_chat in slim_chats {
                        let mut chat = slim_chat.to_chat();

                        // Skip MLS group chats that are marked as evicted
                        // MLS group chat IDs are just the group_id (no prefix)
                        if chat.chat_type == ChatType::MlsGroup {
                            if let Some(ref groups) = mls_groups {
                                if let Some(group) =
                                    groups.iter().find(|g| g.group_id.as_str() == chat.id())
                                {
                                    if group.evicted {
                                        println!(
                                            "[Startup] Skipping evicted MLS group chat: {}",
                                            chat.id()
                                        );
                                        continue; // Skip this chat
                                    }
                                }
                            }
                        }

                        // Load only the last message for preview (optimization: full messages loaded on-demand by frontend)
                        let last_messages_result =
                            db::get_chat_last_messages(&handle, &chat.id(), 1).await;
                        if let Ok(last_messages) = last_messages_result {
                            for message in last_messages {
                                // Check if this message has downloaded attachments (for integrity check)
                                if !needs_integrity_check
                                    && message.attachments.iter().any(|att| att.downloaded)
                                {
                                    needs_integrity_check = true;
                                }
                                chat.internal_add_message(message);
                            }
                        } else {
                            eprintln!(
                                "Failed to load last message for chat {}: {:?}",
                                chat.id(),
                                last_messages_result
                            );
                        }

                        // Ensure profiles exist for all chat participants
                        for participant in chat.participants() {
                            if state.get_profile(participant).is_none() {
                                // Create a basic profile for the participant
                                let mut profile = Profile::new();
                                profile.id = participant.clone();
                                profile.mine = false; // It's not our profile
                                state.profiles.push(profile);
                            }
                        }

                        // Add chat to state
                        state.chats.push(chat);

                        // Sort the chats by their last received message
                        state
                            .chats
                            .sort_by(|a, b| b.last_message_time().cmp(&a.last_message_time()));
                    }
                } else {
                    eprintln!(
                        "Failed to load chats from database: {:?}",
                        slim_chats_result
                    );
                }
            }

            if needs_integrity_check {
                // Clean up empty file attachments first
                cleanup_empty_file_attachments(&handle, &mut state).await;

                // Check integrity without dropping state
                check_attachment_filesystem_integrity(&handle, &mut state).await;

                // Preload ID caches for maximum performance
                if let Err(e) = db::preload_id_caches(&handle).await {
                    eprintln!("[Cache] Failed to preload ID caches: {}", e);
                }

                // Preload wrapper_event_ids for fast duplicate detection during sync
                // Load last 30 days of wrapper_ids to cover typical sync window
                if let Ok(wrapper_ids) = db::load_recent_wrapper_ids(&handle, 30).await {
                    let mut cache = WRAPPER_ID_CACHE.lock().await;
                    *cache = wrapper_ids;
                }

                // Build dm_flags (has_from_me / has_from_them per DM) from DB so frontend can show Friends vs Requests vs Pending
                let mut dm_flags = serde_json::Map::new();
                for chat in &state.chats {
                    if chat.id().starts_with("npub1") || chat.chat_type == ChatType::DirectMessage {
                        if let Ok((has_from_me, has_from_them)) =
                            db::get_dm_sent_received(&handle, chat.id())
                        {
                            dm_flags.insert(chat.id().clone(), serde_json::json!({ "has_from_me": has_from_me, "has_from_them": has_from_them }));
                        }
                    }
                }
                // Send the state to our frontend to signal finalised init with a full state
                handle
                    .emit(
                        "init_finished",
                        serde_json::json!({
                            "profiles": &state.profiles,
                            "chats": &state.chats,
                            "dm_flags": serde_json::Value::Object(dm_flags)
                        }),
                    )
                    .unwrap();
            } else {
                // Even if no integrity check needed, still clean up empty files
                cleanup_empty_file_attachments(&handle, &mut state).await;

                // Preload ID caches for maximum performance
                if let Err(e) = db::preload_id_caches(&handle).await {
                    eprintln!("[Cache] Failed to preload ID caches: {}", e);
                }

                // Preload wrapper_event_ids for fast duplicate detection during sync
                // Load last 30 days of wrapper_ids to cover typical sync window
                if let Ok(wrapper_ids) = db::load_recent_wrapper_ids(&handle, 30).await {
                    let mut cache = WRAPPER_ID_CACHE.lock().await;
                    *cache = wrapper_ids;
                }

                // Build dm_flags (has_from_me / has_from_them per DM) from DB so frontend can show Friends vs Requests vs Pending
                let mut dm_flags = serde_json::Map::new();
                for chat in &state.chats {
                    if chat.id().starts_with("npub1") || chat.chat_type == ChatType::DirectMessage {
                        if let Ok((has_from_me, has_from_them)) =
                            db::get_dm_sent_received(&handle, chat.id())
                        {
                            dm_flags.insert(chat.id().clone(), serde_json::json!({ "has_from_me": has_from_me, "has_from_them": has_from_them }));
                        }
                    }
                }
                // No integrity check needed, send init immediately
                handle
                    .emit(
                        "init_finished",
                        serde_json::json!({
                            "profiles": &state.profiles,
                            "chats": &state.chats,
                            "dm_flags": serde_json::Value::Object(dm_flags)
                        }),
                    )
                    .unwrap();
            }

            // ALWAYS begin with an initial sync of at least the last 2 days
            let now = Timestamp::now();

            state.is_syncing = true;
            state.slice_in_flight = true;
            state.sync_mode = SyncMode::ForwardSync;
            state.sync_empty_iterations = 0;
            state.sync_total_iterations = 0;

            // Initial 2-day window: now - 2 days → now
            let two_days_ago = now.as_secs() - (60 * 60 * 24 * 2);

            state.sync_window_start = two_days_ago;
            state.sync_window_end = now.as_secs();

            (Timestamp::from_secs(two_days_ago), now, false)
        } else {
            match next_sync_slice(&mut state, Timestamp::now().as_secs(), monotonic_now_secs()) {
                Some((since, until, is_last)) => (
                    Timestamp::from_secs(since),
                    Timestamp::from_secs(until),
                    is_last,
                ),
                // Nothing to do: a slice is already in flight for a concurrent call, or the
                // sync is Finished within the catch-up grace window.
                None => return,
            }
        }
    };

    // If sync is finished, emit the finished event and return
    {
        let state = STATE.lock().await;
        if state.sync_mode == SyncMode::Finished {
            // Only emit if this is not a single-relay sync
            if relay_url.is_none() {
                handle.emit("sync_finished", ()).unwrap();
            }
            return;
        }
    }

    // Emit our current "Sync Range" to the frontend (only for general syncs, not single-relay)
    if relay_url.is_none() {
        handle
            .emit(
                "sync_progress",
                serde_json::json!({
                    "since": since_timestamp.as_secs(),
                    "until": until_timestamp.as_secs(),
                    "mode": format!("{:?}", STATE.lock().await.sync_mode)
                }),
            )
            .unwrap();
    }

    // Fetch GiftWraps related to us within the time window
    let filter = Filter::new()
        .pubkey(my_public_key)
        .kind(Kind::GiftWrap)
        .since(since_timestamp)
        .until(until_timestamp);

    let mut event_stream = if let Some(url) = &relay_url {
        // Fetch from specific relay
        match client
            .stream_events_from(vec![url], filter, std::time::Duration::from_secs(30))
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                eprintln!("[Sync] Relay event stream failed for {}: {}", url, e);
                let mut state = STATE.lock().await;
                abandon_sync_slice(&mut state);
                return;
            }
        }
    } else {
        // Fetch from all relays. A brand-new session's account-wide stream can race relay setup
        // (login/startup adds relays to the pool right after this fires) — give the pool a
        // bounded chance to gain a relay before establishing the stream, instead of racing
        // ahead into a doomed "no relays specified" attempt: the stream must not be established
        // before the pool is populated.
        if client.relays().await.is_empty() {
            wait_for_populated_relay_pool(&client).await;
        }
        match client
            .stream_events(filter, std::time::Duration::from_secs(60))
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                let mut state = STATE.lock().await;
                if is_empty_relay_pool_error(&e.to_string()) {
                    // Retryable: the pool is (still) empty, even after the bounded wait above.
                    // Defer instead of abandoning so the exact same window is retried once a
                    // relay connects (see `connect`'s retry hook), rather than leaving the
                    // account looking synced while it silently ingests nothing forever.
                    println!(
                        "[Sync] Account-wide relay event stream deferred: {} (will retry once a relay connects)",
                        e
                    );
                    defer_sync_slice_for_empty_pool(&mut state, catch_up_is_last_slice);
                } else {
                    eprintln!("[Sync] Account-wide relay event stream failed: {}", e);
                    abandon_sync_slice(&mut state);
                }
                return;
            }
        }
    };

    // Count total events fetched (for DeepRescan) and new messages added (for other modes)
    // We'll compute total count while iterating; placeholder will be set after loop
    let mut new_messages_count: u16 = 0;
    while let Some(event) = event_stream.next().await {
        // Count the amount of accepted (new) events
        if handle_event_guarded(event, false).await {
            new_messages_count += 1;
        }
    }

    // After processing all events, total_events_count equals the number of processed events
    let total_events_count = new_messages_count as u16;
    let should_continue = {
        let mut state = STATE.lock().await;

        // For DeepRescan, use total events count; for other modes, use new messages count
        let events_found = if state.sync_mode == SyncMode::DeepRescan {
            total_events_count
        } else {
            new_messages_count
        };

        // Oldest message timestamp across all chats, needed only for the ForwardSync ->
        // BackwardSync transition; computed here since it needs `state.chats`.
        let oldest_message_time = state
            .chats
            .iter()
            .filter_map(|chat| chat.last_message_time())
            .min();

        record_slice_result(
            &mut state,
            new_messages_count,
            events_found,
            catch_up_is_last_slice,
            oldest_message_time,
            Timestamp::now().as_secs(),
            monotonic_now_secs(),
        )
    };

    if should_continue {
        // Keep synchronising
        if relay_url.is_none() {
            handle.emit("sync_slice_finished", ()).unwrap();
        }
    } else {
        // We're done with sync - update state first, then emit event
        {
            let mut state = STATE.lock().await;
            state.sync_mode = SyncMode::Finished;
            state.is_syncing = false;
            state.sync_empty_iterations = 0;
            state.sync_total_iterations = 0;
            // last_catch_up_until was already advanced inside record_slice_result for the
            // normal-completion case; nothing further to do here.
        } // Release lock before emitting event

        // Clear the wrapper_id cache - it's only needed during sync
        {
            let mut cache = WRAPPER_ID_CACHE.lock().await;
            let cache_size = cache.len();
            cache.clear();
            cache.shrink_to_fit();
            // Each entry: 64-char hex String (~88 bytes) + HashSet overhead (~48 bytes) ≈ 136 bytes
            println!(
                "[Startup] Sync Complete - Dumped NIP-59 Decryption Cache (~{} KB Memory freed)",
                (cache_size * 136) / 1024
            );
        }

        if relay_url.is_none() {
            handle.emit("sync_finished", ()).unwrap();

            // Now that regular sync is complete and chats are loaded, sync MLS groups
            // This ensures chat data is in memory before MLS tries to sync participants
            let handle_clone = handle.clone();
            tokio::task::spawn(async move {
                // Small delay to ensure init_finished has been processed
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if let Err(e) = sync_mls_groups_now(None).await {
                    eprintln!("[MLS] Post-sync MLS group sync failed: {}", e);
                }

                // After MLS sync completes, check if weekly VACUUM is needed
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if let Err(e) = db::check_and_vacuum_if_needed(&handle_clone).await {
                    eprintln!("[Maintenance] Weekly VACUUM check failed: {}", e);
                }
            });
        }
    }
}

/// Removes attachments with empty file hash from all messages
/// Also removes messages that have ONLY corrupted attachments (no content)
/// This cleans up corrupted uploads that resulted in 0-byte files
async fn cleanup_empty_file_attachments<R: Runtime>(handle: &AppHandle<R>, state: &mut ChatState) {
    const EMPTY_FILE_HASH: &str =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let mut cleaned_count = 0;
    let mut chats_to_update = Vec::new();

    for chat in &mut state.chats {
        let mut chat_had_changes = false;

        // First pass: remove attachments with empty file hash
        for message in &mut chat.messages {
            let original_count = message.attachments.len();

            // Remove attachments with empty file hash in their URL
            message
                .attachments
                .retain(|attachment| !attachment.url.contains(EMPTY_FILE_HASH));

            let removed = original_count - message.attachments.len();
            if removed > 0 {
                cleaned_count += removed;
                chat_had_changes = true;
            }
        }

        // Second pass: remove messages that are now empty (no content, no attachments)
        let messages_before = chat.messages.len();
        chat.messages
            .retain(|message| !message.content.is_empty() || !message.attachments.is_empty());

        if chat.messages.len() < messages_before {
            chat_had_changes = true;
        }

        // If this chat had changes, save all its messages
        if chat_had_changes {
            chats_to_update.push((chat.id(), chat.messages.clone()));
        }
    }

    // Save updated chats to database
    for (chat_id, messages) in chats_to_update {
        if let Err(e) = save_chat_messages(handle.clone(), &chat_id, &messages).await {
            eprintln!(
                "Failed to save chat after cleaning empty attachments: {}",
                e
            );
        }
    }

    if cleaned_count > 0 {
        eprintln!("Cleaned up {} empty file attachments", cleaned_count);
    }
}

/// Checks if downloaded attachments still exist on the filesystem
/// Sets downloaded=false for any missing files and updates the database
async fn check_attachment_filesystem_integrity<R: Runtime>(
    handle: &AppHandle<R>,
    state: &mut ChatState,
) {
    let mut total_checked = 0;
    let mut chats_with_updates = std::collections::HashMap::new();

    // Capture the starting timestamp
    let start_time = std::time::Instant::now();

    // First pass: count total attachments to check
    let mut total_attachments = 0;
    for chat in &state.chats {
        for message in &chat.messages {
            for attachment in &message.attachments {
                if attachment.downloaded {
                    total_attachments += 1;
                }
            }
        }
    }

    // Iterate through all chats and their messages with mutable access to update downloaded status
    for (chat_idx, chat) in state.chats.iter_mut().enumerate() {
        let mut updated_messages = Vec::new();

        for message in &mut chat.messages {
            let mut message_updated = false;

            for attachment in &mut message.attachments {
                // Only check attachments that are marked as downloaded
                if attachment.downloaded {
                    total_checked += 1;

                    // Emit progress every 2 attachments or on the last one, but only if process has taken >1 second
                    if (total_checked % 2 == 0 || total_checked == total_attachments)
                        && start_time.elapsed().as_secs() >= 1
                    {
                        handle
                            .emit(
                                "progress_operation",
                                serde_json::json!({
                                    "type": "progress",
                                    "current": total_checked,
                                    "total": total_attachments,
                                    "message": "Checking file integrity"
                                }),
                            )
                            .unwrap();
                    }

                    // Check if the file exists on the filesystem
                    let file_path = std::path::Path::new(&attachment.path);
                    if !file_path.exists() {
                        // File is missing, set downloaded to false
                        attachment.downloaded = false;
                        message_updated = true;
                        attachment.path = String::new();
                    }
                }
            }

            // If any attachment in this message was updated, we need to save the message
            if message_updated {
                updated_messages.push(message.clone());
            }
        }

        // If any messages in this chat were updated, store them for database update
        if !updated_messages.is_empty() {
            chats_with_updates.insert(chat_idx, updated_messages);
        }
    }

    // Update database for any messages with missing attachments
    if !chats_with_updates.is_empty() {
        // Only emit progress if process has taken >1 second
        if start_time.elapsed().as_secs() >= 1 {
            handle
                .emit(
                    "progress_operation",
                    serde_json::json!({
                        "type": "progress",
                        "total": chats_with_updates.len(),
                        "current": 0,
                        "message": "Updating database..."
                    }),
                )
                .unwrap();
        }

        // Save updated messages for each chat that had changes
        let mut saved_count = 0;
        let total_chats = chats_with_updates.len();
        for (chat_idx, _updated_messages) in chats_with_updates {
            // Since we're iterating over existing indices, we know the chat exists
            let chat = &state.chats[chat_idx];
            let chat_id = chat.id().clone();

            // Save
            let all_messages = &chat.messages;
            if let Err(e) = save_chat_messages(handle.clone(), &chat_id, all_messages).await {
                eprintln!("Failed to update messages after filesystem check: {}", e);
            } else {
                saved_count += 1;
            }

            // Emit progress for database updates, but only if process has taken >1 second
            if ((saved_count) % 5 == 0 || saved_count == total_chats)
                && start_time.elapsed().as_secs() >= 1
            {
                handle
                    .emit(
                        "progress_operation",
                        serde_json::json!({
                            "type": "progress",
                            "current": saved_count,
                            "total": total_chats,
                            "message": "Updating database"
                        }),
                    )
                    .unwrap();
            }
        }
    }
}

#[tauri::command]
async fn start_typing(receiver: String) -> bool {
    let client = get_nostr_client().expect("Nostr client not initialized");
    let signer = client.signer().await.unwrap();
    let my_public_key = signer.get_public_key().await.unwrap();

    // Check if this is a group chat (group IDs are hex, not bech32)
    match PublicKey::from_bech32(receiver.as_str()) {
        Ok(pubkey) => {
            // This is a DM - use NIP-17 gift wrapping

            // Build and broadcast the Typing Indicator
            let rumor = EventBuilder::new(Kind::ApplicationSpecificData, "typing")
                .tag(Tag::public_key(pubkey))
                .tag(nostr_tags::d_tag(vec!["vector"]))
                .tag(Tag::expiration(Timestamp::from_secs(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs()
                        + 30,
                )))
                .build(my_public_key);

            // Gift Wrap and send our Typing Indicator to receiver via our Trusted Relay
            // Note: we set a 30-second expiry so that relays can purge typing indicators quickly
            let expiry_time = Timestamp::from_secs(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    + 30,
            );
            match client
                .gift_wrap_to(
                    trusted_relays::trusted_relays().iter().cloned(),
                    &pubkey,
                    rumor,
                    [Tag::expiration(expiry_time)],
                )
                .await
            {
                Ok(_) => true,
                Err(_) => false,
            }
        }
        Err(_) => {
            // This is a group chat - use MLS
            let group_id = receiver.clone();

            // Build the typing indicator rumor
            let rumor = EventBuilder::new(Kind::ApplicationSpecificData, "typing")
                .tag(nostr_tags::d_tag(vec!["vector"]))
                .tag(Tag::expiration(Timestamp::from_secs(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs()
                        + 30,
                )))
                .build(my_public_key);

            // Send via MLS
            match mls::send_mls_message(&group_id, rumor, None).await {
                Ok(_) => true,
                Err(_e) => false,
            }
        }
    }
}

/// Get paginated messages for a chat directly from the database
/// Also adds the messages to the backend state for cache synchronization
#[tauri::command]
async fn get_chat_messages_paginated<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    limit: usize,
    offset: usize,
) -> Result<Vec<Message>, String> {
    // Load messages from database
    let messages = db::get_chat_messages_paginated(&handle, &chat_id, limit, offset).await?;

    // Also add these messages to the backend state for cache synchronization
    // This ensures operations like fetch_msg_metadata can find the messages
    if !messages.is_empty() {
        let mut state = STATE.lock().await;
        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
            for msg in &messages {
                // Only add if not already present (avoid duplicates)
                if !chat.messages.iter().any(|m| m.id == msg.id) {
                    chat.messages.push(msg.clone());
                }
            }
            // Sort messages by timestamp to maintain order
            chat.messages.sort_by_key(|m| m.at);
        }
    }

    Ok(messages)
}

/// Get the total message count for a chat
#[tauri::command]
async fn get_chat_message_count<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
) -> Result<usize, String> {
    db::get_chat_message_count(&handle, &chat_id).await
}

/// Get message views (composed from events table) for a chat
/// This is the new event-based approach that computes reactions from flat events
#[tauri::command]
async fn get_message_views<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    limit: usize,
    offset: usize,
    virtual_bucket_filter: Option<String>,
) -> Result<Vec<Message>, String> {
    // Convert chat identifier to database ID (MLS groups: create row if missing so new channels load)
    let chat_int_id = db::resolve_chat_id_for_message_load(&handle, &chat_id)?;

    // Get materialized message views from events
    let messages =
        db::get_message_views(&handle, chat_int_id, limit, offset, virtual_bucket_filter).await?;

    // Sync to backend state for cache compatibility (uses binary search for efficient insertion)
    if !messages.is_empty() {
        let mut state = STATE.lock().await;
        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
            for msg in messages.iter().cloned() {
                chat.internal_add_message(msg);
            }
        }
    }

    Ok(messages)
}

/// Re-apply governance/treasury/roster automation side effects from persisted MLS chat rows.
#[tauri::command]
async fn replay_mls_automation_side_effects<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
) -> Result<u32, String> {
    db::replay_automation_side_effects_for_chat(&handle, chat_id.trim()).await
}

/// Get messages around a specific message ID (for scrolling to replied-to messages)
/// Loads messages from (target - context_before) to the most recent
#[tauri::command]
async fn get_messages_around_id<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    target_message_id: String,
    context_before: usize,
) -> Result<Vec<Message>, String> {
    let messages =
        db::get_messages_around_id(&handle, &chat_id, &target_message_id, context_before).await?;

    // Sync to backend state so fetch_msg_metadata and other functions can find these messages
    if !messages.is_empty() {
        let mut state = STATE.lock().await;
        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
            for msg in messages.iter().cloned() {
                chat.internal_add_message(msg);
            }
        }
    }

    Ok(messages)
}

/// Evict messages from the backend cache for a specific chat
/// Called by frontend when LRU eviction occurs to keep caches in sync
#[tauri::command]
async fn evict_chat_messages(chat_id: String, keep_count: usize) -> Result<(), String> {
    let mut state = STATE.lock().await;
    if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
        let total = chat.messages.len();
        if total > keep_count {
            // Keep only the last `keep_count` messages (most recent)
            let drain_count = total - keep_count;
            chat.messages.drain(0..drain_count);
        }
    }
    Ok(())
}

/// Delete a DM chat and all its messages from the database and in-memory state.
/// chat_id is the other party's npub for DMs. Persists a deletion cutoff so relay
/// replay cannot restore history at or before the delete time.
///
/// Returns as soon as SQLite work finishes. In-memory `STATE` cleanup is best-effort
/// and must not block the invoke when sync holds the lock.
#[tauri::command]
async fn delete_dm_chat<R: Runtime>(handle: AppHandle<R>, chat_id: String) -> Result<(), String> {
    let deleted_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    db::upsert_dm_deletion_cutoff(&handle, &chat_id, deleted_at).await?;
    match db::delete_chat(handle.clone(), &chat_id).await {
        Ok(()) => {}
        Err(e) if e.starts_with("Chat not found:") => {}
        Err(e) => return Err(e),
    }
    drop_dm_chat_from_state(chat_id);
    Ok(())
}

/// Remove a DM from in-memory chats without awaiting a contended `STATE` lock.
fn drop_dm_chat_from_state(chat_id: String) {
    match STATE.try_lock() {
        Ok(mut state) => {
            state.chats.retain(|c| c.id != chat_id);
        }
        Err(_) => {
            tokio::spawn(async move {
                let mut state = STATE.lock().await;
                state.chats.retain(|c| c.id != chat_id);
            });
        }
    }
}

/// Build and return the file hash index for deduplication
/// Returns a map of file_hash -> attachment reference data
#[tauri::command]
async fn get_file_hash_index<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<std::collections::HashMap<String, db::AttachmentRef>, String> {
    db::build_file_hash_index(&handle).await
}

/// Outcome of attempting to process an MLS Welcome extracted from a gift-wrapped rumor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WelcomeOutcome {
    /// `process_welcome` succeeded.
    Processed,
    /// The MDK engine gave a permanent verdict (a known replay error); retrying
    /// will never succeed, so the wrapper can be treated as handled.
    PermanentFailure,
    /// Everything else (MLS service/engine init failure, task join failure, or an
    /// unrecognized `process_welcome` error); may succeed on a later retry.
    TransientFailure,
}

impl WelcomeOutcome {
    /// Whether this outcome should be recorded as permanently handled so historical
    /// resync stops retrying it.
    fn should_mark_handled(self) -> bool {
        matches!(
            self,
            WelcomeOutcome::Processed | WelcomeOutcome::PermanentFailure
        )
    }
}

/// Classify a `process_welcome` error message as permanent (no retry will ever help)
/// or transient (may succeed later). Once a welcome permanently fails (e.g. no
/// matching key package after a seed restore), the MDK engine marks the wrapper
/// event processed/failed forever; these replay errors carry no new information.
fn classify_welcome_error(msg: &str) -> WelcomeOutcome {
    const PERMANENT_ERRORS: [&str; 2] = [
        "missing welcome for processed welcome",
        "processed welcome not found",
    ];
    if PERMANENT_ERRORS.contains(&msg) {
        WelcomeOutcome::PermanentFailure
    } else {
        WelcomeOutcome::TransientFailure
    }
}

#[cfg(test)]
mod welcome_outcome_tests {
    use super::{classify_welcome_error, WelcomeOutcome};

    #[test]
    fn classifies_missing_welcome_for_processed_welcome_as_permanent() {
        assert_eq!(
            classify_welcome_error("missing welcome for processed welcome"),
            WelcomeOutcome::PermanentFailure
        );
    }

    #[test]
    fn classifies_processed_welcome_not_found_as_permanent() {
        assert_eq!(
            classify_welcome_error("processed welcome not found"),
            WelcomeOutcome::PermanentFailure
        );
    }

    #[test]
    fn classifies_unknown_error_as_transient() {
        assert_eq!(
            classify_welcome_error("database is locked"),
            WelcomeOutcome::TransientFailure
        );
    }

    #[test]
    fn only_processed_and_permanent_failure_should_mark_handled() {
        assert!(WelcomeOutcome::Processed.should_mark_handled());
        assert!(WelcomeOutcome::PermanentFailure.should_mark_handled());
        assert!(!WelcomeOutcome::TransientFailure.should_mark_handled());
    }
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
        handle_event(event, is_new),
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

/// Park the walk and release *both* sync in-flight guards. Every `fetch_messages` path
/// that returns before `record_slice_result` must use this: clearing `is_syncing` alone
/// still refuses every later slice, because `next_sync_slice` bails on `slice_in_flight`.
fn abandon_sync_slice(state: &mut ChatState) {
    state.is_syncing = false;
    state.slice_in_flight = false;
    state.sync_mode = SyncMode::Finished;
    state.sync_empty_iterations = 0;
    state.sync_total_iterations = 0;
}

/// Defer the in-flight slice because the relay pool was empty (or the stream failed with "no
/// relays specified"/"no relays") rather than abandoning it permanently like `abandon_sync_slice`
/// does. Keeps `sync_mode`, `is_syncing`, and the claimed `sync_window_start`/`sync_window_end`
/// untouched, and only releases `slice_in_flight` — so `next_sync_slice` retries the *exact*
/// window on its next call instead of skipping ahead (ForwardSync/BackwardSync/DeepRescan) or
/// requiring the catch-up grace window to elapse again (CatchUp/Finished). A `fetch_messages`
/// call arriving after the deferral is not rejected — it performs the retry itself, which is the
/// point. Exactly one caller can: `next_sync_slice` consumes the flag and re-claims
/// `slice_in_flight` under the same `STATE` mutex, so the deferred window is handed out once and
/// two slices still cannot run at the same time.
/// An empty pool at login/startup must be retryable, not terminal.
fn defer_sync_slice_for_empty_pool(state: &mut ChatState, is_last: bool) {
    state.slice_in_flight = false;
    state.sync_slice_relay_wait = true;
    state.sync_slice_deferred_is_last = is_last;
}

/// True for a relay-pool error whose only defect is having no relays configured yet (nostr-sdk's
/// `NoRelaysSpecified`/"no relays specified" and `NoRelays`/"no relays") — the exact state a
/// fresh login or a startup race leaves the pool in before relay setup completes. Distinct from
/// a real per-relay failure (auth, network, protocol), which should still abandon the slice via
/// `abandon_sync_slice` rather than retry indefinitely.
fn is_empty_relay_pool_error(message: &str) -> bool {
    message.to_lowercase().contains("no relays")
}

#[cfg(test)]
mod intake_boundary_tests {
    use super::{
        abandon_sync_slice, bounded_intake, clear_giftwrap_timeout_count, note_giftwrap_timeout,
        ChatState, IntakeOutcome, SyncMode, GIFTWRAP_TIMEOUT_DISCARD_AFTER,
    };
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

#[tauri::command]
async fn handle_event(event: Event, is_new: bool) -> bool {
    // Get the wrapper (giftwrap) event ID for duplicate detection
    let wrapper_event_id = event.id.to_hex();

    // For historical sync events (is_new = false), use the wrapper_id cache for fast duplicate detection
    // For real-time new events (is_new = true), skip cache checks - they're guaranteed to be new
    if !is_new {
        // Check in-memory cache first (O(1) lookup, no SQL overhead)
        // This cache is only populated during init and cleared after sync finishes
        {
            let cache = WRAPPER_ID_CACHE.lock().await;
            if cache.contains(&wrapper_event_id) {
                // Already processed this giftwrap, skip (cache hit)
                return false;
            }
        }

        // Cache miss - check database as fallback (for events older than cache window)
        if let Some(handle) = TAURI_APP.get() {
            if let Ok(exists) = db::wrapper_event_exists(handle, &wrapper_event_id).await {
                if exists {
                    // Already processed this giftwrap, skip (DB hit)
                    return false;
                }
            }
        }
    }

    // Missing client or signer is a transient local condition, not a bad payload: return
    // without a verdict so the wrapper stays retryable instead of unwinding into the
    // intake boundary, which would record it as permanently discarded.
    let Ok(client) = get_nostr_client() else {
        eprintln!(
            "[Intake] Nostr client not initialized; leaving gift wrap {} retryable",
            wrapper_event_id
        );
        return false;
    };
    let Ok(signer) = client.signer().await else {
        eprintln!(
            "[Intake] No signer available; leaving gift wrap {} retryable",
            wrapper_event_id
        );
        return false;
    };
    let Ok(my_public_key) = signer.get_public_key().await else {
        eprintln!(
            "[Intake] Signer has no public key; leaving gift wrap {} retryable",
            wrapper_event_id
        );
        return false;
    };

    // Unwrap the gift wrap
    match client.unwrap_gift_wrap(&event).await {
        Ok(UnwrappedGift { rumor, sender }) => {
            // Check if it's mine
            let is_mine = sender == my_public_key;

            // Attempt to get contact public key (bech32)
            let contact: String = if is_mine {
                // Try to get the first public key from tags
                match rumor.tags.public_keys().next() {
                    Some(pub_key) => match pub_key.to_bech32() {
                        Ok(p_tag_pubkey_bech32) => p_tag_pubkey_bech32,
                        Err(_) => {
                            eprintln!("Failed to convert public key to bech32");
                            // If conversion fails, fall back to sender
                            sender
                                .to_bech32()
                                .expect("Failed to convert sender's public key to bech32")
                        }
                    },
                    None => {
                        eprintln!("No public key tag found");
                        // If no public key found in tags, fall back to sender
                        sender
                            .to_bech32()
                            .expect("Failed to convert sender's public key to bech32")
                    }
                }
            } else {
                // If not is_mine, just use sender's bech32
                sender
                    .to_bech32()
                    .expect("Failed to convert sender's public key to bech32")
            };

            // Special handling for MLS Welcomes (not processed by rumor processor)
            if rumor.kind == Kind::MlsWelcome {
                // Convert rumor Event -> UnsignedEvent
                let unsigned_opt = nostr_sign::unsigned_event_from(&rumor).ok();

                if let Some(unsigned) = unsigned_opt {
                    // Outer giftwrap id is our wrapper id for dedup/logs
                    let wrapper_id = event.id;
                    let app_handle = TAURI_APP.get().cloned();

                    // Use blocking thread for non-Send MLS engine
                    let outcome = tokio::task::spawn_blocking(move || {
                        if app_handle.is_none() {
                            return WelcomeOutcome::TransientFailure;
                        }
                        let handle = app_handle.unwrap();
                        let svc = MlsService::new_persistent(&handle);
                        if let Ok(mls) = svc {
                            if let Ok(engine) = mls.engine() {
                                return match engine.process_welcome(&wrapper_id, &unsigned) {
                                    Ok(_) => WelcomeOutcome::Processed,
                                    Err(e) => {
                                        let msg = e.to_string();
                                        let outcome = classify_welcome_error(&msg);
                                        // Permanent replay errors carry no new information;
                                        // only log genuinely unexpected (transient) failures.
                                        if outcome == WelcomeOutcome::TransientFailure {
                                            eprintln!("[MLS] Failed to process welcome: {}", msg);
                                        }
                                        outcome
                                    }
                                };
                            }
                        }
                        WelcomeOutcome::TransientFailure
                    })
                    .await
                    .unwrap_or(WelcomeOutcome::TransientFailure);

                    // Mark this wrapper event as handled so historical resyncs (every login)
                    // don't re-unwrap and re-attempt it, but only once we have a permanent
                    // verdict (success or a known-permanent MDK replay error). Transient
                    // failures (init/engine/join errors) stay retryable on the next login.
                    if outcome.should_mark_handled() {
                        if let Some(handle) = TAURI_APP.get() {
                            let _ = db::record_discarded_giftwrap(handle, &wrapper_event_id).await;
                        }
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.clone());
                    }

                    if outcome == WelcomeOutcome::Processed {
                        // Only notify UI after initial sync is complete
                        // During initial sync, invites are processed but not emitted to avoid UI updates before chats are loaded
                        let should_emit = {
                            let state = STATE.lock().await;
                            state.sync_mode == SyncMode::Finished || !state.is_syncing
                        };

                        if should_emit {
                            if let Some(app) = TAURI_APP.get() {
                                let _ = app.emit(
                                    "mls_invite_received",
                                    serde_json::json!({
                                        "wrapper_event_id": wrapper_id.to_hex()
                                    }),
                                );
                            }
                        }
                        return true;
                    } else {
                        return false;
                    }
                } else {
                    eprintln!("[MLS] Failed to convert rumor to UnsignedEvent");
                    if let Some(handle) = TAURI_APP.get() {
                        let _ = db::record_discarded_giftwrap(handle, &wrapper_event_id).await;
                    }
                    {
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.clone());
                    }
                    return false;
                }
            }

            // Local block list: relays still deliver gift wraps; we discard decrypted payloads from this peer.
            if !is_mine {
                let peer_blocked = {
                    let state = STATE.lock().await;
                    state
                        .get_profile(&contact)
                        .map(|p| p.blocked)
                        .unwrap_or(false)
                };
                if peer_blocked {
                    if let Some(handle) = TAURI_APP.get() {
                        let _ = db::record_discarded_giftwrap(&handle, &wrapper_event_id).await;
                    }
                    {
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.clone());
                    }
                    return true;
                }
            }

            // DM delete cutoff: ignore wraps at or before the local deletion timestamp
            // (inbound and outbound) so relay replay cannot restore purged history.
            if contact.starts_with("npub1") {
                if let Some(handle) = TAURI_APP.get() {
                    if let Ok(Some(deleted_at)) = db::get_dm_deletion_cutoff(handle, &contact).await
                    {
                        if db::dm_created_at_at_or_before_cutoff(
                            rumor.created_at.as_u64(),
                            deleted_at,
                        ) {
                            let _ = db::record_discarded_giftwrap(handle, &wrapper_event_id).await;
                            {
                                let mut cache = WRAPPER_ID_CACHE.lock().await;
                                cache.insert(wrapper_event_id.clone());
                            }
                            return true;
                        }
                    }
                }
            }

            // Convert rumor to RumorEvent for protocol-agnostic processing
            let rumor_event = RumorEvent {
                id: rumor.id.unwrap(),
                kind: rumor.kind,
                content: rumor.content.clone(),
                tags: rumor.tags.clone(),
                created_at: rumor.created_at,
                pubkey: rumor.pubkey,
            };

            let rumor_context = RumorContext {
                sender,
                is_mine,
                conversation_id: contact.clone(),
                conversation_type: ConversationType::DirectMessage,
            };

            // Process the rumor using our protocol-agnostic processor
            match process_rumor(rumor_event, rumor_context).await {
                Ok(result) => {
                    match result {
                        RumorProcessingResult::TextMessage(mut msg) => {
                            // Set the wrapper event ID for database storage
                            msg.wrapper_event_id = Some(wrapper_event_id.clone());
                            if let Some(handle) = TAURI_APP.get() {
                                match crate::squad_bot::apply_key_share_from_content(
                                    handle,
                                    &msg.content,
                                )
                                .await
                                {
                                    Ok(true) => {
                                        // Bot key share consumed; do not persist nsec in the DM timeline.
                                        return true;
                                    }
                                    Ok(false) => {}
                                    Err(e) => {
                                        eprintln!("[squad_bot] key share rejected: {e}");
                                    }
                                }
                            }
                            handle_text_message(msg, &contact, is_mine, is_new, &wrapper_event_id)
                                .await
                        }
                        RumorProcessingResult::FileAttachment(mut msg) => {
                            // Set the wrapper event ID for database storage
                            msg.wrapper_event_id = Some(wrapper_event_id.clone());
                            handle_file_attachment(
                                msg,
                                &contact,
                                is_mine,
                                is_new,
                                &wrapper_event_id,
                            )
                            .await
                        }
                        RumorProcessingResult::Reaction(reaction) => {
                            handle_reaction(reaction, &contact).await
                        }
                        RumorProcessingResult::DashboardPollCreate(_)
                        | RumorProcessingResult::DashboardPollVoteIngested => false,
                        RumorProcessingResult::TypingIndicator { profile_id, until } => {
                            // Update the chat's typing participants
                            let active_typers = {
                                let mut state = STATE.lock().await;
                                // For DMs, the chat_id is the contact's npub
                                if let Some(chat) = state.get_chat_mut(&contact) {
                                    chat.update_typing_participant(profile_id.clone(), until);
                                    chat.get_active_typers()
                                } else {
                                    vec![]
                                }
                            };

                            // Emit typing update event to frontend
                            if let Some(handle) = TAURI_APP.get() {
                                let _ = handle.emit(
                                    "typing-update",
                                    serde_json::json!({
                                        "conversation_id": contact,
                                        "typers": active_typers,
                                    }),
                                );
                            }

                            true
                        }
                        RumorProcessingResult::UnknownEvent(mut event) => {
                            // Store unknown events for future compatibility
                            event.wrapper_event_id = Some(wrapper_event_id.clone());
                            handle_unknown_event(event, &contact).await
                        }
                        RumorProcessingResult::Ignored => false,
                        RumorProcessingResult::Edit {
                            message_id,
                            new_content,
                            edited_at,
                            mut event,
                        } => {
                            // Skip if this edit event was already processed (deduplication)
                            if let Some(handle) = TAURI_APP.get() {
                                if db::event_exists(handle, &event.id).unwrap_or(false) {
                                    return true; // Already processed, skip
                                }

                                // Save edit event to database with proper chat_id
                                if let Ok(chat_id) = db::get_chat_id_by_identifier(handle, &contact)
                                {
                                    event.chat_id = chat_id;
                                }
                                event.wrapper_event_id = Some(wrapper_event_id.clone());
                                let _ = db::save_event(handle, &event).await;
                            }

                            // Update message in state and emit to frontend
                            let mut state = STATE.lock().await;
                            if let Some(chat) = state.get_chat_mut(&contact) {
                                if let Some(msg) = chat.get_message_mut(&message_id) {
                                    msg.apply_edit(new_content, edited_at);

                                    // Emit update to frontend
                                    if let Some(handle) = TAURI_APP.get() {
                                        let _ = handle.emit(
                                            "message_update",
                                            serde_json::json!({
                                                "old_id": &message_id,
                                                "message": &msg,
                                                "chat_id": &contact
                                            }),
                                        );
                                    }
                                }
                            }
                            true
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to process rumor: {}", e);
                    false
                }
            }
        }
        Err(_) => false,
    }
}

/// Display name for a DM peer from in-memory profile cache (fallback: shortened npub).
fn dm_peer_display_name(state: &ChatState, npub: &str) -> String {
    match state.get_profile(npub) {
        Some(p) if !p.nickname.is_empty() => p.nickname.clone(),
        Some(p) if !p.name.is_empty() => p.name.clone(),
        Some(p) if !p.display_name.is_empty() => p.display_name.clone(),
        _ => {
            if npub.len() > 16 {
                format!("{}…{}", &npub[..8], &npub[npub.len() - 4..])
            } else {
                npub.to_string()
            }
        }
    }
}

/// If `content` is a `wallet_tx_announcement` JSON DM, return a role-specific OS notification body; otherwise `None`.
fn wallet_tx_hash_from_announcement_content(content: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("wallet_tx_announcement") {
        return None;
    }
    let h = v.get("tx_hash").and_then(|t| t.as_str())?;
    Some(h.to_lowercase())
}

fn dm_chat_has_wallet_tx_hash(state: &ChatState, peer_npub: &str, tx_hash_lower: &str) -> bool {
    for chat in &state.chats {
        if chat.chat_type != ChatType::DirectMessage || chat.id != peer_npub {
            continue;
        }
        for m in &chat.messages {
            if let Some(h) = wallet_tx_hash_from_announcement_content(&m.content) {
                if h == tx_hash_lower {
                    return true;
                }
            }
        }
        return false;
    }
    false
}

fn try_wallet_tx_announcement_notify_body(
    content: &str,
    is_mine: bool,
    peer_npub: &str,
    state: &ChatState,
) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("wallet_tx_announcement") {
        return None;
    }
    let amount = v.get("amount").and_then(|a| a.as_str())?;
    let asset = v.get("asset").and_then(|a| a.as_str())?;
    let peer_name = dm_peer_display_name(state, peer_npub);
    Some(if is_mine {
        format!("You transferred\n{} {}\nto {}", amount, asset, peer_name)
    } else {
        format!("{}\ntransferred\n{} {}\nto you", peer_name, amount, asset)
    })
}

/// Handle a processed text message
async fn handle_text_message(
    mut msg: Message,
    contact: &str,
    is_mine: bool,
    is_new: bool,
    wrapper_event_id: &str,
) -> bool {
    // Check if message already exists in database (important for sync with partial message loading)
    if let Some(handle) = TAURI_APP.get() {
        if let Ok(exists) = db::message_exists_in_db(&handle, &msg.id).await {
            if exists {
                // Message already in DB but we got here (wrapper check passed)
                // Try to backfill the wrapper_event_id for future fast lookups
                // If backfill fails (message already has a different wrapper), add this wrapper to cache
                // to prevent repeated processing of duplicate giftwraps
                if let Ok(updated) =
                    db::update_wrapper_event_id(&handle, &msg.id, wrapper_event_id).await
                {
                    if !updated {
                        // Message has a different wrapper_id - add this duplicate wrapper to cache
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.to_string());
                    }
                }
                return false;
            }
        }
    }

    // Shared: parse channel-in-* DM → check user in parent → get pending welcome → accept → emit.
    // Channel-in-squad: if this DM is a channel invite for a squad we're already in, auto-accept
    // on the backend and never show it as an invite (don't add to chat, don't emit message_new).
    if !is_mine {
        if let Some((announcements_group_id, channel_group_id, channel_name)) =
            parse_channel_in_squad_dm(&msg.content)
        {
            if let Some(handle) = TAURI_APP.get() {
                let handle = handle.clone();
                let in_squad = match db::load_mls_groups(&handle).await {
                    Ok(groups) => {
                        let aid = announcements_group_id.to_lowercase();
                        groups.iter().any(|g| {
                            g.group_id.to_lowercase() == aid
                                || g.engine_group_id.to_lowercase() == aid
                        })
                    }
                    Err(_) => false,
                };
                if in_squad {
                    spawn_accept_channel_welcome_and_emit(
                        announcements_group_id,
                        channel_group_id,
                        channel_name,
                    );
                    return true;
                }
            }
        }
    }

    // Populate reply context before emitting (for replies to old messages not in frontend cache)
    if !msg.replied_to.is_empty() {
        if let Some(handle) = TAURI_APP.get() {
            let _ = db::populate_reply_context(&handle, &mut msg).await;
        }
    }

    if let Some(tx_hash) = wallet_tx_hash_from_announcement_content(&msg.content) {
        let state = STATE.lock().await;
        if dm_chat_has_wallet_tx_hash(&state, contact, &tx_hash) {
            return false;
        }
    }

    // Add the message to the state and handle database save in one operation to avoid multiple locks
    let was_msg_added_to_state = {
        let mut state = STATE.lock().await;
        state.add_message_to_participant(contact, msg.clone())
    };

    // If accepted in-state: commit to the DB and emit to the frontend
    if was_msg_added_to_state {
        // Send it to the frontend
        if let Some(handle) = TAURI_APP.get() {
            handle
                .emit(
                    "message_new",
                    serde_json::json!({
                        "message": &msg,
                        "chat_id": contact
                    }),
                )
                .unwrap();
        }

        // Backfill reply context for any messages that arrived earlier and reference this one.
        // This fixes the race where a bot reply (which references the original message's rumor id)
        // is processed before the user's own outbound message has been persisted under its real id.
        let updated_replies = {
            let mut state = STATE.lock().await;
            if let Some(chat) = state.get_chat_mut(contact) {
                chat.update_replies_to_message(&msg, is_mine)
            } else {
                Vec::new()
            }
        };
        for reply in updated_replies {
            if let Some(handle) = TAURI_APP.get() {
                let reply_id = reply.id.clone();
                let _ = handle.emit(
                    "message_update",
                    serde_json::json!({
                        "old_id": reply_id,
                        "message": reply,
                        "chat_id": contact
                    }),
                );
            }
        }

        // OS notification: incoming DMs, and outgoing `wallet_tx_announcement` (transfer completed)
        if is_new {
            if !is_mine {
                let (level, blocked, single) = {
                    let state = STATE.lock().await;
                    let level = state
                        .get_chat(contact)
                        .map(|c| c.notification_level)
                        .unwrap_or_default();
                    match state.get_profile(contact) {
                        Some(profile) => {
                            let display_name = if !profile.nickname.is_empty() {
                                profile.nickname.clone()
                            } else if !profile.name.is_empty() {
                                profile.name.clone()
                            } else if !profile.display_name.is_empty() {
                                profile.display_name.clone()
                            } else {
                                String::from("New Message")
                            };
                            let body = try_wallet_tx_announcement_notify_body(
                                &msg.content,
                                false,
                                contact,
                                &state,
                            )
                            .unwrap_or_else(|| msg.content.clone());
                            (
                                level,
                                profile.blocked,
                                notification::SingleEventNotification {
                                    title: display_name,
                                    body,
                                },
                            )
                        }
                        None => {
                            let body = try_wallet_tx_announcement_notify_body(
                                &msg.content,
                                false,
                                contact,
                                &state,
                            )
                            .unwrap_or_else(|| msg.content.clone());
                            (
                                level,
                                false,
                                notification::SingleEventNotification {
                                    title: String::from("New Message"),
                                    body,
                                },
                            )
                        }
                    }
                };
                if !blocked {
                    if let Some(handle) = TAURI_APP.get() {
                        let chat_display_name = single.title.clone();
                        notification::emit(
                            handle,
                            notification::EventKind::DirectMessage,
                            level,
                            false,
                            false,
                            contact,
                            &chat_display_name,
                            single,
                        )
                        .await;
                        crate::catch_up::record_admitted_event_for_handle(
                            handle,
                            notification::EventKind::DirectMessage,
                            false,
                            false,
                            contact,
                            &msg.id,
                        )
                        .await;
                    }
                }
            } else if let Some(body) = {
                let state = STATE.lock().await;
                try_wallet_tx_announcement_notify_body(&msg.content, true, contact, &state)
            } {
                if let Some(handle) = TAURI_APP.get() {
                    let level = {
                        let state = STATE.lock().await;
                        state
                            .get_chat(contact)
                            .map(|c| c.notification_level)
                            .unwrap_or_default()
                    };
                    let single = notification::SingleEventNotification {
                        title: "Transfer sent".to_string(),
                        body,
                    };
                    notification::emit(
                        handle,
                        notification::EventKind::DirectMessage,
                        level,
                        false,
                        false,
                        contact,
                        "Transfer sent",
                        single,
                    )
                    .await;
                    crate::catch_up::record_admitted_event_for_handle(
                        handle,
                        notification::EventKind::DirectMessage,
                        false,
                        false,
                        contact,
                        &msg.id,
                    )
                    .await;
                }
            }
        }

        // Save the new message to DB (chat_id = contact npub for DMs)
        if let Some(handle) = TAURI_APP.get() {
            // Only save the single new message (efficient!)
            let _ = db::save_message(handle.clone(), contact, &msg).await;
        }
        // Ensure OS badge is updated immediately after accepting the message
        if let Some(handle) = TAURI_APP.get() {
            let _ = update_unread_counter(handle.clone()).await;
        }
    } else {
        // Message was not added to state (duplicate or filtered)
    }

    was_msg_added_to_state
}

/// Handle a processed file attachment
async fn handle_file_attachment(
    mut msg: Message,
    contact: &str,
    is_mine: bool,
    is_new: bool,
    wrapper_event_id: &str,
) -> bool {
    // Check if message already exists in database (important for sync with partial message loading)
    if let Some(handle) = TAURI_APP.get() {
        if let Ok(exists) = db::message_exists_in_db(&handle, &msg.id).await {
            if exists {
                // Message already in DB but we got here (wrapper check passed)
                // Try to backfill the wrapper_event_id for future fast lookups
                // If backfill fails (message already has a different wrapper), add this wrapper to cache
                // to prevent repeated processing of duplicate giftwraps
                if let Ok(updated) =
                    db::update_wrapper_event_id(&handle, &msg.id, wrapper_event_id).await
                {
                    if !updated {
                        // Message has a different wrapper_id - add this duplicate wrapper to cache
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.to_string());
                    }
                }
                return false;
            }
        }
    }

    // Populate reply context before emitting (for replies to old messages not in frontend cache)
    if !msg.replied_to.is_empty() {
        if let Some(handle) = TAURI_APP.get() {
            let _ = db::populate_reply_context(&handle, &mut msg).await;
        }
    }

    // Get file extension for notification
    let extension = msg
        .attachments
        .first()
        .map(|att| att.extension.clone())
        .unwrap_or_else(|| String::from("file"));

    // Add the message to the state and clear typing indicator for sender
    let (was_msg_added_to_state, _active_typers) = {
        let mut state = STATE.lock().await;
        let added = state.add_message_to_participant(contact, msg.clone());

        // Clear typing indicator for the sender (they just sent a message)
        let typers = if let Some(chat) = state.get_chat_mut(contact) {
            chat.update_typing_participant(contact.to_string(), 0); // 0 = clear immediately
            chat.get_active_typers()
        } else {
            Vec::new()
        };

        (added, typers)
    };

    // If accepted in-state: commit to the DB and emit to the frontend
    if was_msg_added_to_state {
        // Send it to the frontend
        if let Some(handle) = TAURI_APP.get() {
            handle
                .emit(
                    "message_new",
                    serde_json::json!({
                        "message": &msg,
                        "chat_id": contact
                    }),
                )
                .unwrap();
        }

        // Send OS notification for incoming files (only after confirming message is new)
        if !is_mine && is_new {
            let (level, blocked, single) = {
                let state = STATE.lock().await;
                let level = state
                    .get_chat(contact)
                    .map(|c| c.notification_level)
                    .unwrap_or_default();
                match state.get_profile(contact) {
                    Some(profile) => {
                        let display_name = if !profile.nickname.is_empty() {
                            profile.nickname.clone()
                        } else if !profile.name.is_empty() {
                            profile.name.clone()
                        } else {
                            String::from("New Message")
                        };
                        let file_description =
                            "Sent a ".to_string() + &get_file_type_description(&extension);
                        (
                            level,
                            profile.blocked,
                            notification::SingleEventNotification {
                                title: display_name,
                                body: file_description,
                            },
                        )
                    }
                    None => {
                        let file_description =
                            "Sent a ".to_string() + &get_file_type_description(&extension);
                        (
                            level,
                            false,
                            notification::SingleEventNotification {
                                title: String::from("New Message"),
                                body: file_description,
                            },
                        )
                    }
                }
            };
            if !blocked {
                if let Some(handle) = TAURI_APP.get() {
                    let chat_display_name = single.title.clone();
                    notification::emit(
                        handle,
                        notification::EventKind::DirectMessage,
                        level,
                        false,
                        false,
                        contact,
                        &chat_display_name,
                        single,
                    )
                    .await;
                    crate::catch_up::record_admitted_event_for_handle(
                        handle,
                        notification::EventKind::DirectMessage,
                        false,
                        false,
                        contact,
                        &msg.id,
                    )
                    .await;
                }
            }
        }

        // Save the new message to DB (chat_id = contact npub for DMs)
        if let Some(handle) = TAURI_APP.get() {
            // Only save the single new message (efficient!)
            let _ = db::save_message(handle.clone(), contact, &msg).await;
        }
        // Ensure OS badge is updated immediately after accepting the attachment
        if let Some(handle) = TAURI_APP.get() {
            let _ = update_unread_counter(handle.clone()).await;
        }
    }

    was_msg_added_to_state
}

/// Handle a processed reaction
async fn handle_reaction(reaction: Reaction, _contact: &str) -> bool {
    // Find the chat containing the referenced message and add the reaction
    // Use a single lock scope to avoid nested locks
    let (reaction_added, chat_id_for_save) = {
        let mut state = STATE.lock().await;
        let reaction_added = if let Some((chat_id, msg_mut)) =
            state.find_chat_and_message_mut(&reaction.reference_id)
        {
            msg_mut.add_reaction(reaction.clone(), Some(chat_id))
        } else {
            // Message not found in any chat - this can happen during sync
            // TODO: track these "ahead" reactions and re-apply them once sync has finished
            false
        };

        // If reaction was added, get the chat_id for saving
        let chat_id_for_save = if reaction_added {
            state
                .find_message(&reaction.reference_id)
                .map(|(chat, _)| chat.id().clone())
        } else {
            None
        };

        (reaction_added, chat_id_for_save)
    };

    // Save the updated message with the new reaction to our DB (outside of state lock)
    if let Some(chat_id) = chat_id_for_save {
        if let Some(handle) = TAURI_APP.get() {
            // Get only the message that was updated
            let updated_message = {
                let state = STATE.lock().await;
                state
                    .find_message(&reaction.reference_id)
                    .map(|(_, msg)| msg.clone())
            };

            if let Some(msg) = updated_message {
                let _ = db::save_message(handle.clone(), &chat_id, &msg).await;
            }
        }
    }

    reaction_added
}

/// Handle an unknown event type - store for future compatibility
async fn handle_unknown_event(mut event: StoredEvent, contact: &str) -> bool {
    // Get the chat_id for this contact
    if let Some(handle) = TAURI_APP.get() {
        match db::get_chat_id_by_identifier(&handle, contact) {
            Ok(chat_id) => {
                event.chat_id = chat_id;
                // Save the event to the database
                if let Err(e) = db::save_event(&handle, &event).await {
                    eprintln!("Failed to save unknown event: {}", e);
                    return false;
                }
                // Emit event to frontend (it can render as "Unknown Event" placeholder)
                let _ = handle.emit(
                    "event_new",
                    serde_json::json!({
                        "event": event,
                        "chat_id": contact
                    }),
                );
                true
            }
            Err(_) => {
                // Chat doesn't exist yet, skip this event
                eprintln!("Cannot save unknown event: chat not found for {}", contact);
                false
            }
        }
    } else {
        false
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

#[tauri::command]
async fn list_group_cursors() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            let cursors = mls.read_event_cursors().await.map_err(|e| e.to_string())?;
            serde_json::to_value(&cursors).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn notifs() -> Result<bool, String> {
    let client = get_nostr_client().expect("Nostr client not initialized");

    // Grab our pubkey
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pubkey = signer.get_public_key().await.map_err(|e| e.to_string())?;

    // A login/startup race can call this before relay setup completes (the same class of bug
    // as the account-wide sync in `fetch_messages`). Give the pool a
    // bounded chance to gain a relay before subscribing, so these live subscriptions don't fail
    // outright on "no relays specified" and never start listening.
    if client.relays().await.is_empty() {
        wait_for_populated_relay_pool(&client).await;
    }

    // Live GiftWraps to us (DMs, files, MLS welcomes)
    let giftwrap_filter = Filter::new().pubkey(pubkey).kind(Kind::GiftWrap).limit(0);

    // Live MLS group wrappers (Kind::MlsGroupMessage). Broad subscribe; we'll filter by membership in handler.
    let mls_msg_filter = Filter::new().kind(Kind::MlsGroupMessage).limit(0);

    // Subscribe to both filters
    let gift_sub_id = match client.subscribe(giftwrap_filter, None).await {
        Ok(id) => id.val,
        Err(e) => return Err(e.to_string()),
    };
    let mls_sub_id = match client.subscribe(mls_msg_filter, None).await {
        Ok(id) => id.val,
        Err(e) => return Err(e.to_string()),
    };

    // Begin watching for notifications from our subscriptions
    match client
        .handle_notifications(|notification| async {
            if let RelayPoolNotification::Message { relay_url, message: RelayMessage::Event { event, .. } } = &notification {
                // `RelayPoolNotification::Event` below is deduplicated pool-wide (fires only the
                // first time a given event is seen), which would undercount `events_received` for
                // every relay that isn't first to deliver a given event. `Message` fires once per
                // relay per delivery, so it's the correct source for per-relay receive counting.
                record_event_received(&relay_url.to_string(), event);
            }
            if let RelayPoolNotification::Event { event, subscription_id, .. } = notification {
                if subscription_id == gift_sub_id {
                    // Handle DMs/files/vector-specific + MLS welcomes inside giftwrap
                    handle_event_guarded(*event, true).await;
                } else if subscription_id == mls_sub_id {
                    // Handle live MLS group message wrappers
                    let ev = (*event).clone();

                    // Extract group wire id from 'h' tag
                    let group_wire_id_opt = nostr_tags::find_letter(&ev.tags, Alphabet::H)
                        .and_then(|t| t.content().map(|s| s.to_string()));

                    if let Some(group_wire_id) = group_wire_id_opt {
                        // Check if we are a member of this group (metadata check) without constructing MLS engine
                        let handle = TAURI_APP.get().unwrap().clone();
                        let is_member: bool = if let Ok(groups) = db::load_mls_groups(&handle).await {
                            groups.iter().any(|g| {
                                g.group_id == group_wire_id || g.engine_group_id == group_wire_id
                            })
                        } else { false };

                        // Not a member - ignore this group message
                        if !is_member {
                            return Ok(false);
                        }

                        // Resolve my pubkey for filtering and 'mine' flag
                        let (my_pubkey, my_pubkey_bech32) = {
                            let client = get_nostr_client().unwrap();
                            if let Ok(signer) = client.signer().await {
                                if let Ok(pk) = signer.get_public_key().await {
                                    (Some(pk), pk.to_bech32().unwrap())
                                } else {
                                    (None, String::new())
                                }
                            } else {
                                (None, String::new())
                            }
                        };

                        // Skip processing our own events - they're already processed locally when sent
                        if let Some(my_pk) = my_pubkey {
                            if ev.pubkey == my_pk {
                                return Ok(false);
                            }
                        }

                        // Process with non-Send MLS engine on a blocking thread (no awaits in scope)
                        let app_handle = TAURI_APP.get().unwrap().clone();
                        let my_npub_for_block = my_pubkey_bech32.clone();
                        let group_id_for_persist = group_wire_id.clone();
                        let group_id_for_emit = group_wire_id.clone();

                        // Process message and persist in one blocking operation to avoid Send issues
                        let emit_record = tokio::task::spawn_blocking(move || {
                            // Use runtime handle to drive async operations from blocking context
                            let rt = tokio::runtime::Handle::current();

                            // Create MLS service and process message
                            let svc = MlsService::new_persistent(&app_handle).ok()?;
                            let engine = svc.engine().ok()?;

                            match engine.process_message(&ev) {
                                Ok(res) => {
                                    // Use unified storage via process_rumor
                                    match res {
                                        mdk_core::prelude::MessageProcessingResult::ApplicationMessage(msg) => {
                                            // Convert to RumorEvent for protocol-agnostic processing
                                            let rumor_event = crate::rumor::RumorEvent {
                                                id: msg.id,
                                                kind: msg.kind,
                                                content: msg.content.clone(),
                                                tags: msg.tags.clone(),
                                                created_at: msg.created_at,
                                                pubkey: msg.pubkey,
                                            };

                                            let is_mine = !my_npub_for_block.is_empty() && msg.pubkey.to_bech32().unwrap() == my_npub_for_block;

                                            // Process through unified rumor processor
                                            let processed = rt.block_on(async {
                                                use crate::rumor::{process_rumor, RumorContext, ConversationType, RumorProcessingResult};

                                                let rumor_context = RumorContext {
                                                    sender: msg.pubkey,
                                                    is_mine,
                                                    conversation_id: group_id_for_persist.clone(),
                                                    conversation_type: ConversationType::MlsGroup,
                                                };

                                                match process_rumor(rumor_event, rumor_context).await {
                                                    Ok(result) => {
                                                        match result {
                                                            RumorProcessingResult::TextMessage(mut message) => {
                                                                // Populate reply context for old messages not in frontend cache
                                                                if !message.replied_to.is_empty() {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let _ = db::populate_reply_context(&handle, &mut message).await;
                                                                    }
                                                                }

                                                                // Clear typing indicator for this sender (they just sent a message)
                                                                let sender_npub = msg.pubkey.to_bech32().unwrap_or_default();

                                                                let (was_added, _active_typers, level) = {
                                                                    let mut state = crate::STATE.lock().await;

                                                                    // Add message to chat
                                                                    let added = state.add_message_to_chat(&group_id_for_persist, message.clone());

                                                                    let level = state.get_chat(&group_id_for_persist)
                                                                        .map(|c| c.notification_level)
                                                                        .unwrap_or_default();

                                                                    // Clear typing indicator for sender
                                                                    let typers = if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(sender_npub.clone(), 0); // 0 = clear immediately
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    };

                                                                    (added, typers, level)
                                                                };

                                                                // Route every group text message through the single tier-aware emit (KTD4).
                                                                if was_added {
                                                                    let (sender_name, group_name) = {
                                                                        let state = crate::STATE.lock().await;

                                                                        let sender = if let Some(profile) = state.get_profile(&sender_npub) {
                                                                            if !profile.nickname.is_empty() {
                                                                                profile.nickname.clone()
                                                                            } else if !profile.name.is_empty() {
                                                                                profile.name.clone()
                                                                            } else {
                                                                                "Someone".to_string()
                                                                            }
                                                                        } else {
                                                                            "Someone".to_string()
                                                                        };

                                                                        let group = if let Some(chat) = state.get_chat(&group_id_for_persist) {
                                                                            chat.metadata.get_name().unwrap_or("Group Chat").to_string()
                                                                        } else {
                                                                            "Group Chat".to_string()
                                                                        };

                                                                        (sender, group)
                                                                    };

                                                                    let mention_hit = crate::message::envelope_names_npub(&message.content, &my_npub_for_block);
                                                                    let single = notification::SingleEventNotification {
                                                                        title: format!("{} - {}", sender_name, group_name),
                                                                        body: extract_mention_notification_body(&message.content),
                                                                    };
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        notification::emit(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            level,
                                                                            message.mine,
                                                                            mention_hit,
                                                                            &group_id_for_persist,
                                                                            &group_name,
                                                                            single,
                                                                        ).await;
                                                                        crate::catch_up::record_admitted_event_for_handle(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            message.mine,
                                                                            mention_hit,
                                                                            &group_id_for_persist,
                                                                            &message.id,
                                                                        ).await;
                                                                    }
                                                                }

                                                                // Save to database if message was added
                                                                if was_added {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        // Get chat and save it
                                                                        let chat_to_save = {
                                                                            let state = crate::STATE.lock().await;
                                                                            state.get_chat(&group_id_for_persist).cloned()
                                                                        };

                                                                        if let Some(chat) = chat_to_save {
                                                                            use crate::db::{save_chat, save_chat_messages};
                                                                            let _ = save_chat(handle.clone(), &chat).await;
                                                                            let _ = save_chat_messages(handle.clone(), &group_id_for_persist, &chat.messages).await;
                                                                        }
                                                                    }
                                                                    Some(message)
                                                                } else {
                                                                    None
                                                                }
                                                            }
                                                            RumorProcessingResult::FileAttachment(mut message) => {
                                                                // Populate reply context for old messages not in frontend cache
                                                                if !message.replied_to.is_empty() {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let _ = db::populate_reply_context(&handle, &mut message).await;
                                                                    }
                                                                }

                                                                // Clear typing indicator for this sender (they just sent a message)
                                                                let sender_npub = msg.pubkey.to_bech32().unwrap_or_default();
                                                                let is_file = true;

                                                                let (was_added, _active_typers, level) = {
                                                                    let mut state = crate::STATE.lock().await;

                                                                    // Add message to chat
                                                                    let added = state.add_message_to_chat(&group_id_for_persist, message.clone());

                                                                    let level = state.get_chat(&group_id_for_persist)
                                                                        .map(|c| c.notification_level)
                                                                        .unwrap_or_default();

                                                                    // Clear typing indicator for sender
                                                                    let typers = if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(sender_npub.clone(), 0); // 0 = clear immediately
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    };

                                                                    (added, typers, level)
                                                                };

                                                                // Route every group file message through the single tier-aware emit (KTD4).
                                                                if was_added {
                                                                    let (sender_name, group_name) = {
                                                                        let state = crate::STATE.lock().await;

                                                                        let sender = if let Some(profile) = state.get_profile(&sender_npub) {
                                                                            if !profile.nickname.is_empty() {
                                                                                profile.nickname.clone()
                                                                            } else if !profile.name.is_empty() {
                                                                                profile.name.clone()
                                                                            } else {
                                                                                "Someone".to_string()
                                                                            }
                                                                        } else {
                                                                            "Someone".to_string()
                                                                        };

                                                                        let group = if let Some(chat) = state.get_chat(&group_id_for_persist) {
                                                                            chat.metadata.get_name().unwrap_or("Group Chat").to_string()
                                                                        } else {
                                                                            "Group Chat".to_string()
                                                                        };

                                                                        (sender, group)
                                                                    };

                                                                    let content = if is_file {
                                                                        let extension = message.attachments.first()
                                                                            .map(|att| att.extension.clone())
                                                                            .unwrap_or_else(|| String::from("file"));
                                                                        "Sent a ".to_string() + &get_file_type_description(&extension)
                                                                    } else {
                                                                        extract_mention_notification_body(&message.content)
                                                                    };
                                                                    let single = notification::SingleEventNotification {
                                                                        title: format!("{} - {}", sender_name, group_name),
                                                                        body: content,
                                                                    };
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        notification::emit(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            level,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &group_name,
                                                                            single,
                                                                        ).await;
                                                                        crate::catch_up::record_admitted_event_for_handle(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &message.id,
                                                                        ).await;
                                                                    }
                                                                }

                                                                // Save to database if message was added
                                                                if was_added {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        // Get chat and save it
                                                                        let chat_to_save = {
                                                                            let state = crate::STATE.lock().await;
                                                                            state.get_chat(&group_id_for_persist).cloned()
                                                                        };

                                                                        if let Some(chat) = chat_to_save {
                                                                            use crate::db::save_chat;
                                                                            let _ = save_chat(handle.clone(), &chat).await;
                                                                            let _ = db::save_message(handle.clone(), &group_id_for_persist, &message).await;
                                                                        }
                                                                    }
                                                                    Some(message)
                                                                } else {
                                                                    None
                                                                }
                                                            }
                                                            RumorProcessingResult::Reaction(reaction) => {
                                                                // Handle reactions in real-time
                                                                let (was_added, chat_id_for_save) = {
                                                                    let mut state = crate::STATE.lock().await;
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
                                                                                let state = crate::STATE.lock().await;
                                                                                state.find_message(&reaction.reference_id)
                                                                                    .map(|(_, msg)| msg.clone())
                                                                            };

                                                                            if let Some(msg) = updated_message {
                                                                                let _ = db::save_message(handle.clone(), &chat_id, &msg).await;
                                                                            }
                                                                        }
                                                                    }
                                                                }

                                                                None // Don't emit as message
                                                            }
                                                            RumorProcessingResult::DashboardPollCreate(mut message) => {
                                                                if !message.replied_to.is_empty() {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let _ = db::populate_reply_context(&handle, &mut message).await;
                                                                    }
                                                                }
                                                                let sender_npub = msg.pubkey.to_bech32().unwrap_or_default();
                                                                let (was_added, _active_typers, level) = {
                                                                    let mut state = crate::STATE.lock().await;
                                                                    let added = state.add_message_to_chat(&group_id_for_persist, message.clone());
                                                                    let level = state.get_chat(&group_id_for_persist)
                                                                        .map(|c| c.notification_level)
                                                                        .unwrap_or_default();
                                                                    let _typers = if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(sender_npub.clone(), 0);
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    };
                                                                    (added, _typers, level)
                                                                };
                                                                // A new poll needs every member's vote — routed as an action prompt (KTD4).
                                                                if was_added {
                                                                    let (sender_name, group_name) = {
                                                                        let state = crate::STATE.lock().await;
                                                                        let sender = if let Some(profile) = state.get_profile(&sender_npub) {
                                                                            if !profile.nickname.is_empty() {
                                                                                profile.nickname.clone()
                                                                            } else if !profile.name.is_empty() {
                                                                                profile.name.clone()
                                                                            } else {
                                                                                "Someone".to_string()
                                                                            }
                                                                        } else {
                                                                            "Someone".to_string()
                                                                        };
                                                                        let group = if let Some(chat) = state.get_chat(&group_id_for_persist) {
                                                                            chat.metadata.get_name().unwrap_or("Group Chat").to_string()
                                                                        } else {
                                                                            "Group Chat".to_string()
                                                                        };
                                                                        (sender, group)
                                                                    };
                                                                    let single = notification::SingleEventNotification {
                                                                        title: format!("{} - {}", sender_name, group_name),
                                                                        body: "New poll — vote in Dashboard → Polls.".to_string(),
                                                                    };
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        notification::emit(
                                                                            handle,
                                                                            notification::EventKind::ActionPrompt,
                                                                            level,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &group_name,
                                                                            single,
                                                                        ).await;
                                                                        crate::catch_up::record_admitted_event_for_handle(
                                                                            handle,
                                                                            notification::EventKind::ActionPrompt,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &message.id,
                                                                        ).await;
                                                                    }
                                                                }
                                                                if was_added {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let group_name = crate::db::load_mls_groups(handle).await
                                                                            .ok()
                                                                            .and_then(|groups| {
                                                                                groups.into_iter()
                                                                                    .find(|g| g.group_id == group_id_for_persist || g.engine_group_id == group_id_for_persist)
                                                                                    .map(|g| g.name)
                                                                            });
                                                                        let _ = handle.emit("mls_message_new", serde_json::json!({
                                                                            "group_id": group_id_for_persist,
                                                                            "message": &message,
                                                                            "group_name": group_name
                                                                        }));
                                                                        let chat_to_save = {
                                                                            let state = crate::STATE.lock().await;
                                                                            state.get_chat(&group_id_for_persist).cloned()
                                                                        };
                                                                        if let Some(chat) = chat_to_save {
                                                                            use crate::db::{save_chat, save_chat_messages};
                                                                            let _ = save_chat(handle.clone(), &chat).await;
                                                                            let _ = save_chat_messages(handle.clone(), &group_id_for_persist, &chat.messages).await;
                                                                        }
                                                                        schedule_debounced_unread_recompute(handle.clone());
                                                                    }
                                                                    Some(message)
                                                                } else {
                                                                    None
                                                                }
                                                            }
                                                            RumorProcessingResult::DashboardPollVoteIngested => None,
                                                            RumorProcessingResult::TypingIndicator { profile_id, until } => {
                                                                // Handle typing indicators in real-time
                                                                let active_typers = {
                                                                    let mut state = crate::STATE.lock().await;
                                                                    if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(profile_id.clone(), until);
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    }
                                                                };

                                                                // Emit typing update event
                                                                if let Some(handle) = TAURI_APP.get() {
                                                                    let _ = handle.emit("typing-update", serde_json::json!({
                                                                        "conversation_id": group_id_for_persist,
                                                                        "typers": active_typers
                                                                    }));
                                                                }

                                                                None // Don't emit as message
                                                            }
                                                            RumorProcessingResult::UnknownEvent(mut event) => {
                                                                // Store unknown events for future compatibility
                                                                // Get chat_id and save the event
                                                                if let Some(handle) = TAURI_APP.get() {
                                                                    if let Ok(chat_id) = db::get_chat_id_by_identifier(handle, &group_id_for_persist) {
                                                                        event.chat_id = chat_id;
                                                                        let _ = db::save_event(handle, &event).await;
                                                                    }
                                                                }
                                                                None // Don't emit as message
                                                            }
                                                            RumorProcessingResult::Ignored => None,
                                                            RumorProcessingResult::Edit { message_id, new_content, edited_at, event } => {
                                                                // Skip if this edit event was already processed (deduplication)
                                                                if let Some(handle) = TAURI_APP.get() {
                                                                    if db::event_exists(handle, &event.id).unwrap_or(false) {
                                                                        return None; // Already processed, skip
                                                                    }

                                                                    // Save edit event to database
                                                                    if let Ok(chat_id) = db::get_chat_id_by_identifier(handle, &group_id_for_persist) {
                                                                        let mut event_with_chat = event;
                                                                        event_with_chat.chat_id = chat_id;
                                                                        let _ = db::save_event(handle, &event_with_chat).await;
                                                                    }
                                                                }

                                                                // Update message in state and emit to frontend
                                                                let mut state = crate::STATE.lock().await;
                                                                if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                    if let Some(msg) = chat.get_message_mut(&message_id) {
                                                                        msg.apply_edit(new_content, edited_at);

                                                                        // Emit update to frontend
                                                                        if let Some(handle) = TAURI_APP.get() {
                                                                            let _ = handle.emit("message_update", serde_json::json!({
                                                                                "old_id": &message_id,
                                                                                "message": &msg,
                                                                                "chat_id": &group_id_for_persist
                                                                            }));
                                                                        }
                                                                    }
                                                                }
                                                                None // Don't emit as message
                                                            }
                                                        }
                                                    }
                                                    Err(e) => {
                                                        eprintln!("[MLS][live] Failed to process rumor: {}", e);
                                                        None
                                                    }
                                                }
                                            });

                                            processed
                                        }
                                        mdk_core::prelude::MessageProcessingResult::Commit { mls_group_id } => {
                                            // Commit processed - member list may have changed
                                            // Check if we're still a member of this group
                                            let my_pubkey_hex = my_npub_for_block.clone();

                                            // Only evict if we can POSITIVELY CONFIRM removal
                                            let membership_check = engine.get_members(&mls_group_id)
                                                .ok()
                                                .and_then(|members| {
                                                    nostr_sdk::PublicKey::from_bech32(&my_pubkey_hex)
                                                        .ok()
                                                        .map(|pk| members.contains(&pk))
                                                });

                                            match membership_check {
                                                Some(false) => {
                                                    // Successfully checked and confirmed NOT a member - evict!
                                                    eprintln!("[MLS] Eviction detected via Commit - group: {}", group_id_for_persist);

                                                    // Perform full cleanup using the helper method
                                                    rt.block_on(async {
                                                        if let Err(e) = svc.cleanup_evicted_group(&group_id_for_persist).await {
                                                            eprintln!("[MLS] Failed to cleanup evicted group: {}", e);
                                                        }
                                                    });
                                                }
                                                Some(true) => {
                                                    // Still a member, just update the UI
                                                    if let Some(handle) = TAURI_APP.get() {
                                                        handle.emit("mls_group_updated", serde_json::json!({
                                                            "group_id": group_id_for_persist
                                                        })).ok();
                                                    }
                                                }
                                                None => {
                                                    // Check failed - don't evict, just update UI
                                                    if let Some(handle) = TAURI_APP.get() {
                                                        handle.emit("mls_group_updated", serde_json::json!({
                                                            "group_id": group_id_for_persist
                                                        })).ok();
                                                    }
                                                }
                                            }
                                            None
                                        }
                                        mdk_core::prelude::MessageProcessingResult::Proposal(update) => {
                                            // MDK 0.8 SelfRemove auto-commit: publish + merge on the same
                                            // service that staged the commit (do not open a fresh MDK).
                                            let evolution = update.evolution_event;
                                            let mls_gid = update.mls_group_id;
                                            let leaver = ev.pubkey;
                                            let gid = group_id_for_persist.clone();
                                            drop(engine);
                                            rt.block_on(async {
                                                match svc
                                                    .publish_and_merge_auto_commit(
                                                        &gid,
                                                        &mls_gid,
                                                        &evolution,
                                                        Some(leaver),
                                                    )
                                                    .await
                                                {
                                                    Ok(()) => eprintln!(
                                                        "[MLS] Live: published and merged auto-commit leave for {} in {}",
                                                        leaver.to_hex(),
                                                        gid
                                                    ),
                                                    Err(e) => eprintln!(
                                                        "[MLS] Live: failed to publish/merge auto-commit leave for {} in {}: {}",
                                                        leaver.to_hex(),
                                                        gid,
                                                        e
                                                    ),
                                                }
                                            });
                                            None
                                        }
                                        mdk_core::prelude::MessageProcessingResult::Unprocessable { mls_group_id: _ } => {
                                            if let Some(reason) =
                                                crate::mls::mls_wrapper_failure_reason(ev.id.as_ref())
                                            {
                                                if reason.contains(crate::mls::MLS_LEAVE_PROPOSAL_FAILURE) {
                                                    let gid = group_id_for_persist.clone();
                                                    let leaver = ev.pubkey;
                                                    rt.block_on(async move {
                                                        if let Ok(svc) =
                                                            MlsService::new_persistent(&app_handle)
                                                        {
                                                            match svc
                                                                .finalize_voluntary_leave_as_admin(
                                                                    &gid, leaver,
                                                                )
                                                                .await
                                                            {
                                                                Ok(true) => eprintln!(
                                                                    "[MLS] Live: finalized voluntary leave for {} in {}",
                                                                    leaver.to_hex(),
                                                                    gid
                                                                ),
                                                                Ok(false) => {}
                                                                Err(e) => eprintln!(
                                                                    "[MLS] Live: failed to finalize voluntary leave for {} in {}: {}",
                                                                    leaver.to_hex(),
                                                                    gid,
                                                                    e
                                                                ),
                                                            }
                                                        }
                                                    });
                                                }
                                            }
                                            None
                                        }
                                        // Other message types (ExternalJoinProposal) are not persisted as chat messages
                                        _ => None,
                                    }
                                }
                                Err(e) => {
                                    let error_msg = e.to_string();

                                    // Check if this is an eviction error
                                    if error_msg.contains("evicted from it") ||
                                       error_msg.contains("after being evicted") ||
                                       error_msg.contains("own leaf not found") {
                                        eprintln!("[MLS] Eviction detected in live subscription - group: {}", group_id_for_persist);

                                        // Perform full cleanup using the helper method
                                        rt.block_on(async {
                                            if let Err(e) = svc.cleanup_evicted_group(&group_id_for_persist).await {
                                                eprintln!("[MLS] Failed to cleanup evicted group: {}", e);
                                            }
                                        });
                                    } else if !error_msg.contains("group not found") {
                                        eprintln!("[MLS] live process_message failed (id={}): {}", ev.id, error_msg);
                                    }
                                    None
                                }
                            }
                        })
                        .await
                        .unwrap_or(None);

                        if let Some(record) = emit_record {
                            // Emit UI event (include group_name so non-creators can update channel name from hash)
                            let group_name = db::load_mls_groups(&handle).await
                                .ok()
                                .and_then(|groups| {
                                    groups.into_iter()
                                        .find(|g| g.group_id == group_id_for_emit || g.engine_group_id == group_id_for_emit)
                                        .map(|g| g.name)
                                });
                            let _ = handle.emit("mls_message_new", serde_json::json!({
                                "group_id": group_id_for_emit,
                                "message": record,
                                "group_name": group_name
                            }));
                            db::apply_mls_virtual_bucket_side_effects(
                                &handle,
                                &group_id_for_emit,
                                record.virtual_bucket.as_deref(),
                                &record.content,
                                record.npub.as_deref(),
                            );
                            schedule_debounced_unread_recompute(handle.clone());
                        }
                    }
                }
            }
            Ok(false)
        })
        .await
    {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

/// Default relays that come pre-configured
pub(crate) const DEFAULT_RELAYS: &[&str] = &[
    "wss://jskitty.cat/nostr",        // also in the trusted relay set
    "wss://asia.vectorapp.io/nostr",  // also in the trusted relay set
    "wss://nostr.computingcache.com", // also in the trusted relay set
    "wss://relay.damus.io",           // Damus (popular)
    "wss://relay.primal.net",         // Primal (popular)
    "wss://nos.lol",                  // nos.lol (popular)
    "wss://relay.nostr.band",         // nostr.band (popular)
];

/// Check if a URL is a default relay
fn is_default_relay(url: &str) -> bool {
    let normalized = url.trim().trim_end_matches('/').to_lowercase();
    DEFAULT_RELAYS
        .iter()
        .any(|r| r.to_lowercase() == normalized)
}

// ============================================================================
// Relay Metrics & Logging
// ============================================================================

use once_cell::sync::Lazy;
use std::collections::{HashMap, VecDeque};
use std::sync::RwLock;

/// Metrics tracked per relay
#[derive(serde::Serialize, Clone, Debug)]
pub struct RelayMetrics {
    pub ping_ms: Option<u64>,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub last_check: Option<u64>, // Unix timestamp
    pub events_received: u64,
    pub events_sent: u64,
}

impl Default for RelayMetrics {
    fn default() -> Self {
        Self {
            ping_ms: None,
            bytes_up: 0,
            bytes_down: 0,
            last_check: None,
            events_received: 0,
            events_sent: 0,
        }
    }
}

/// A single log entry for a relay
#[derive(serde::Serialize, Clone, Debug)]
pub struct RelayLog {
    pub timestamp: u64, // Unix timestamp
    pub level: String,  // "info", "warn", "error"
    pub message: String,
}

/// Global storage for relay metrics
static RELAY_METRICS: Lazy<RwLock<HashMap<String, RelayMetrics>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Global storage for relay logs (max 10 per relay)
static RELAY_LOGS: Lazy<RwLock<HashMap<String, VecDeque<RelayLog>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Global storage for classified relay connection failures, cleared on reconnect, removal,
/// disable, and logout. Never shown for a relay whose live status reads connected -- see the
/// read-side gate in `get_relays`.
static RELAY_FAILURES: Lazy<RwLock<HashMap<String, RelayFailure>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Shared normalization for every diagnostic-static key: trim, strip a trailing slash, then
/// lowercase. `get_relays`'s pool-matching lowercases without stripping a trailing slash, so
/// that comparison must never be reused as a key source here.
fn normalize_relay_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_lowercase()
}

/// Serializes tests that clear a diagnostics static (`RELAY_FAILURES`, `RELAY_LOGS`,
/// `RELAY_METRICS`, `RELAY_CERTIFICATES`) so parallel `cargo test --lib` threads never race
/// clearing one another's fixtures. Test-only -- never touched by production code paths.
#[cfg(test)]
pub(crate) static DIAGNOSTICS_TEST_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Store a classified failure for `url`, guarded by the login generation captured when the
/// caller (a monitor task) spawned. A mismatch means a stale monitor loop left running for a
/// previous account is writing -- skip rather than attribute the failure to the current one
/// (KTD9).
fn store_relay_failure_if_current(url: &str, failure: RelayFailure, captured_generation: u64) {
    if captured_generation != current_login_generation() {
        return;
    }
    if let Ok(mut failures) = RELAY_FAILURES.write() {
        failures.insert(normalize_relay_url(url), failure);
    }
}

/// Clear any stored failure reason for `url`. Reconnect-to-Connected, relay removal, relay
/// disable, and logout all route through this.
fn clear_relay_failure(url: &str) {
    if let Ok(mut failures) = RELAY_FAILURES.write() {
        failures.remove(&normalize_relay_url(url));
    }
}

/// Generation-guarded clear used by monitor tasks. User-initiated remove/disable/logout
/// keep calling the unguarded [`clear_relay_failure`] so the operator's own action still
/// takes effect after a generation change.
fn clear_relay_failure_if_current(url: &str, captured_generation: u64) {
    if captured_generation != current_login_generation() {
        return;
    }
    clear_relay_failure(url);
}

#[cfg(test)]
mod relay_failure_diagnostics_tests {
    use super::{
        add_relay_log, add_relay_log_if_current, clear_nostr_client,
        clear_relay_diagnostics_on_logout, clear_relay_failure, clear_relay_failure_if_current,
        current_login_generation, normalize_relay_url, relay_failure_for,
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

/// Add a log entry for a relay. Monitor tasks must call [`add_relay_log_if_current`]
/// instead so a stale first-account loop cannot fill the current account's panel.
fn add_relay_log(url: &str, level: &str, message: &str) {
    let normalized = normalize_relay_url(url);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let log = RelayLog {
        timestamp,
        level: level.to_string(),
        message: message.to_string(),
    };

    if let Ok(mut logs) = RELAY_LOGS.write() {
        let relay_logs = logs.entry(normalized).or_insert_with(VecDeque::new);
        let is_repeat = relay_logs
            .front()
            .is_some_and(|last| last.level == log.level && last.message == log.message);
        if is_repeat {
            return;
        }
        relay_logs.push_front(log);
        // Keep only last 10 logs
        while relay_logs.len() > 10 {
            relay_logs.pop_back();
        }
    }
}

fn add_relay_log_if_current(url: &str, level: &str, message: &str, captured_generation: u64) {
    if captured_generation != current_login_generation() {
        return;
    }
    add_relay_log(url, level, message);
}

/// Update metrics for a relay. Monitor tasks must call [`update_relay_metrics_if_current`].
fn update_relay_metrics(url: &str, update_fn: impl FnOnce(&mut RelayMetrics)) {
    let normalized = normalize_relay_url(url);
    if let Ok(mut metrics) = RELAY_METRICS.write() {
        let relay_metrics = metrics
            .entry(normalized)
            .or_insert_with(RelayMetrics::default);
        update_fn(relay_metrics);
    }
}

fn update_relay_metrics_if_current(
    url: &str,
    captured_generation: u64,
    update_fn: impl FnOnce(&mut RelayMetrics),
) {
    if captured_generation != current_login_generation() {
        return;
    }
    update_relay_metrics(url, update_fn);
}

/// Approximate wire size of an event via its serialized JSON length.
fn event_size(event: &Event) -> u64 {
    nostr_sign::event_json(event).len() as u64
}

/// Record that a relay delivered an event: increments `events_received` and adds the
/// event's serialized size to `bytes_down`.
fn record_event_received(relay_url: &str, event: &Event) {
    let size = event_size(event);
    update_relay_metrics(relay_url, |m| {
        m.events_received += 1;
        m.bytes_down += size;
    });
}

/// Record the outcome of publishing an event: increments `events_sent`/`bytes_up` for each
/// accepted relay, and logs the rejection reason for each relay that rejected it. Called at
/// each `send_event`/`send_event_to` call site with the `Output` those calls already return —
/// not hooked into the notification stream, since sent events aren't tracked in the local DB.
pub(crate) fn record_send_outcome(event: &Event, output: &Output<EventId>) {
    let size = event_size(event);
    for relay_url in &output.success {
        let url = relay_url.to_string();
        update_relay_metrics(&url, |m| {
            m.events_sent += 1;
            m.bytes_up += size;
        });
    }
    for (relay_url, reason) in &output.failed {
        add_relay_log(&relay_url.to_string(), "warn", reason);
    }
}

// ============================================================================
// Relay Failure Classification
// ============================================================================

/// Stable, snake_case reason code for a failed relay connection attempt. Closed set so the
/// frontend owns all user-facing wording (KTD3) -- adding an outcome is a protocol change,
/// not a string tweak. `auth_required` and `not_a_relay` are produced by the probe's query
/// path (U3), never by this classifier.
#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RelayFailureCode {
    DnsFailed,
    ConnectionRefused,
    NetworkUnreachable,
    TimedOut,
    TlsFailed,
    ProtocolError,
    AuthRequired,
    NotARelay,
    InvalidUrl,
    Unknown,
}

/// A classified relay failure: a stable code plus an optional redacted, length-capped detail
/// string. The detail is diagnostic context only -- callers must never derive control flow
/// from it, only from `code`.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RelayFailure {
    pub code: RelayFailureCode,
    pub detail: Option<String>,
}

/// Cap on the redacted detail string stored alongside a `RelayFailure`. A failed WebSocket
/// upgrade can carry a full relay-controlled rejection body, so this is applied before
/// redaction, not just before display.
const RELAY_FAILURE_DETAIL_CAP: usize = 200;

/// Truncate to at most `cap` bytes on a UTF-8 boundary, then redact any embedded relay URL.
fn cap_and_redact_detail(raw: &str, cap: usize) -> String {
    let truncated = if raw.len() > cap {
        let mut end = cap;
        while end > 0 && !raw.is_char_boundary(end) {
            end -= 1;
        }
        &raw[..end]
    } else {
        raw
    };
    evm::wallet_security::redact_urls_in_text(truncated)
}

/// Map a `std::io::ErrorKind` shared by both `async_wsocket::Error::Io` and the `Io` variant
/// nested inside `tungstenite::Error` -- a mid-upgrade reset is a transport failure, not a
/// TLS one, so both paths go through this same mapping. Resolver failures never produce
/// `NotFound`, so it is deliberately left unmapped here and falls to `Unknown` (KTD2).
fn classify_io_kind(kind: std::io::ErrorKind) -> RelayFailureCode {
    use std::io::ErrorKind;
    match kind {
        ErrorKind::ConnectionRefused => RelayFailureCode::ConnectionRefused,
        // The only resolution-related kind async-wsocket produces; a bare DNS failure
        // surfaces as the unstable, non-matchable `Uncategorized` and is not reachable here.
        ErrorKind::AddrNotAvailable => RelayFailureCode::DnsFailed,
        ErrorKind::TimedOut => RelayFailureCode::TimedOut,
        ErrorKind::HostUnreachable | ErrorKind::NetworkUnreachable | ErrorKind::NetworkDown => {
            RelayFailureCode::NetworkUnreachable
        }
        _ => RelayFailureCode::Unknown,
    }
}

/// Map the `tungstenite::Error` nested inside `async_wsocket::Error::Ws`, matched on the
/// inner variant rather than the whole `Ws(_)` wrapper.
fn classify_tungstenite_error(err: &tungstenite::Error) -> RelayFailureCode {
    match err {
        tungstenite::Error::Tls(_) => RelayFailureCode::TlsFailed,
        // tokio-tungstenite's rustls backend never returns `tungstenite::Error::Tls` for a
        // failed client handshake -- `tokio-rustls` surfaces a rejected/expired/mismatched
        // certificate (and any other TLS record-processing failure) as
        // `io::Error::new(io::ErrorKind::InvalidData, rustls::Error)`, which
        // `client_async_tls` then wraps as `tungstenite::Error::Io`. Verified against the
        // vendored tokio-rustls 0.26 source (`common/mod.rs`) and a real loopback handshake
        // against an expired certificate (see the relay_cert containment regression test).
        tungstenite::Error::Io(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            RelayFailureCode::TlsFailed
        }
        tungstenite::Error::Io(e) => classify_io_kind(e.kind()),
        tungstenite::Error::Protocol(_)
        | tungstenite::Error::Capacity(_)
        | tungstenite::Error::Http(_)
        | tungstenite::Error::HttpFormat(_) => RelayFailureCode::ProtocolError,
        tungstenite::Error::Url(_) => RelayFailureCode::InvalidUrl,
        _ => RelayFailureCode::Unknown,
    }
}

/// Map the `async_wsocket::Error` reached by downcasting `TransportError::Backend`.
fn classify_async_wsocket_error(err: &async_wsocket::Error) -> RelayFailureCode {
    match err {
        async_wsocket::Error::Io(e) => classify_io_kind(e.kind()),
        async_wsocket::Error::Timeout => RelayFailureCode::TimedOut,
        async_wsocket::Error::Url(_) => RelayFailureCode::InvalidUrl,
        async_wsocket::Error::Ws(e) => classify_tungstenite_error(e),
        _ => RelayFailureCode::Unknown,
    }
}

/// Classify a relay connection failure into a stable code plus an optional redacted detail.
/// Never walks `source()` -- `async_wsocket::Error`'s `Error` impl is empty, so that walk
/// always yields `None`. The typed downcast through `TransportError::Backend` is the only
/// route that survives the async-wsocket crate boundary (KTD2).
pub(crate) fn classify_relay_error(err: &nostr_sdk::pool::relay::Error) -> RelayFailure {
    use nostr_sdk::pool::relay::Error as RelayError;
    use nostr_sdk::pool::transport::error::TransportError;

    let code = match err {
        RelayError::Transport(TransportError::Backend(b)) => b
            .downcast_ref::<async_wsocket::Error>()
            .map(classify_async_wsocket_error)
            .unwrap_or(RelayFailureCode::Unknown),
        _ => RelayFailureCode::Unknown,
    };
    let detail = Some(cap_and_redact_detail(
        &err.to_string(),
        RELAY_FAILURE_DETAIL_CAP,
    ));
    RelayFailure { code, detail }
}

#[cfg(test)]
mod relay_failure_classifier_tests {
    use super::{
        cap_and_redact_detail, classify_relay_error, RelayFailureCode, RELAY_FAILURE_DETAIL_CAP,
    };
    use nostr_sdk::pool::relay::Error as RelayError;
    use nostr_sdk::pool::transport::error::TransportError;
    use nostr_sdk::{RelayOptions, RelayPool};
    use std::io;
    use std::time::Duration;

    fn transport_err(inner: async_wsocket::Error) -> RelayError {
        RelayError::Transport(TransportError::backend(inner))
    }

    #[test]
    fn io_connection_refused_maps_to_connection_refused() {
        let err = transport_err(async_wsocket::Error::Io(io::Error::from(
            io::ErrorKind::ConnectionRefused,
        )));
        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::ConnectionRefused
        );
    }

    #[test]
    fn io_addr_not_available_maps_to_dns_failed() {
        let err = transport_err(async_wsocket::Error::Io(io::Error::from(
            io::ErrorKind::AddrNotAvailable,
        )));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::DnsFailed);
    }

    #[test]
    fn io_timed_out_maps_to_timed_out() {
        let err = transport_err(async_wsocket::Error::Io(io::Error::from(
            io::ErrorKind::TimedOut,
        )));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TimedOut);
    }

    #[test]
    fn io_unreachable_kinds_map_to_network_unreachable() {
        for kind in [
            io::ErrorKind::HostUnreachable,
            io::ErrorKind::NetworkUnreachable,
            io::ErrorKind::NetworkDown,
        ] {
            let err = transport_err(async_wsocket::Error::Io(io::Error::from(kind)));
            assert_eq!(
                classify_relay_error(&err).code,
                RelayFailureCode::NetworkUnreachable,
                "kind {kind:?} should map to network_unreachable"
            );
        }
    }

    #[test]
    fn async_wsocket_timeout_variant_maps_to_timed_out() {
        let err = transport_err(async_wsocket::Error::Timeout);
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TimedOut);
    }

    #[test]
    fn async_wsocket_url_variant_maps_to_invalid_url() {
        let err = transport_err(async_wsocket::Error::Url(url::ParseError::EmptyHost));
        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::InvalidUrl
        );
    }

    #[test]
    fn ws_tls_error_maps_to_tls_failed() {
        let ws_err = tungstenite::Error::Tls(tungstenite::error::TlsError::InvalidDnsName);
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TlsFailed);
    }

    #[test]
    fn ws_io_error_maps_to_kind_code_not_tls_failed() {
        let ws_err = tungstenite::Error::Io(io::Error::from(io::ErrorKind::ConnectionRefused));
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        let code = classify_relay_error(&err).code;
        assert_eq!(code, RelayFailureCode::ConnectionRefused);
        assert_ne!(code, RelayFailureCode::TlsFailed);
    }

    #[test]
    fn ws_invalid_data_io_error_maps_to_tls_failed() {
        // tokio-rustls surfaces a rejected/expired certificate as
        // `io::Error::new(io::ErrorKind::InvalidData, rustls::Error)`, not as
        // `tungstenite::Error::Tls`. Proven end-to-end by the relay_cert containment
        // regression test against a real expired-certificate loopback listener.
        let ws_err = tungstenite::Error::Io(io::Error::from(io::ErrorKind::InvalidData));
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TlsFailed);
    }

    #[test]
    fn ws_protocol_error_maps_to_protocol_error() {
        let ws_err =
            tungstenite::Error::Protocol(tungstenite::error::ProtocolError::WrongHttpMethod);
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::ProtocolError
        );
    }

    #[test]
    fn ws_unmatched_variant_maps_to_unknown_without_panicking() {
        let ws_err = tungstenite::Error::AlreadyClosed;
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::Unknown);
    }

    #[test]
    fn non_transport_variant_maps_to_unknown_without_panicking() {
        let err = RelayError::NotConnected;
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::Unknown);
    }

    #[test]
    fn detail_over_cap_is_truncated_before_storage() {
        let raw = "x".repeat(RELAY_FAILURE_DETAIL_CAP + 500);
        let capped = cap_and_redact_detail(&raw, RELAY_FAILURE_DETAIL_CAP);
        assert!(capped.len() <= RELAY_FAILURE_DETAIL_CAP);
    }

    #[test]
    fn detail_wss_url_with_non_allowlisted_param_is_redacted() {
        let raw = "rejected by wss://relay.example.com/?t=SECRET during upgrade";
        let capped = cap_and_redact_detail(raw, RELAY_FAILURE_DETAIL_CAP);
        assert!(!capped.contains("SECRET"));
    }

    /// The only test proving the typed downcast survives the async-wsocket crate boundary:
    /// a real `Relay::try_connect` against a closed loopback port, driven through the actual
    /// relay-pool connection path rather than a locally constructed error.
    #[tokio::test]
    async fn try_connect_against_closed_port_classifies_connection_refused() {
        // Bind then immediately drop so the OS guarantees the port refuses new connections,
        // unlike a bare unused ephemeral port which could collide with something else.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);

        let pool = RelayPool::new();
        let url = format!("ws://127.0.0.1:{port}");
        pool.add_relay(&url, RelayOptions::new().reconnect(false))
            .await
            .expect("add_relay");
        let relay = pool.relay(&url).await.expect("relay handle");

        let err = relay
            .try_connect(Duration::from_secs(5))
            .await
            .expect_err("connecting to a closed port must fail");

        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::ConnectionRefused
        );

        pool.shutdown().await;
    }
}

// ============================================================================
// Pre-add relay probe (U3): resolve, connect through a throwaway pool, and run
// one bounded read-only query before the operator ever saves the URL. Never
// touches `get_nostr_client()` or the operator's live pool (R6, KTD5).
// ============================================================================

/// Single deadline covering DNS resolution, connect, and the query round-trip
/// together (R13). This is the only bound an operator actually observes.
const PROBE_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// Deliberately far larger than `PROBE_DEADLINE`. The relay-pool crate's own
/// per-call timeout is not optional, so it is set here to a value that can
/// never legitimately win a race against the probe's own outer deadline --
/// otherwise a genuine end-of-stored-events response and true silence would
/// both surface as `Ok(Events::empty())` and become indistinguishable.
const PROBE_INNER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3600);

/// Result of a pre-add relay probe (F1). `round_trip_ms` is present only when
/// the candidate answered; a failure carries the classified reason and never a
/// round-trip measurement.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ProbeResult {
    Reachable { round_trip_ms: u64 },
    Unreachable { failure: RelayFailure },
}

impl ProbeResult {
    fn failure(code: RelayFailureCode) -> Self {
        ProbeResult::Unreachable {
            failure: RelayFailure { code, detail: None },
        }
    }
}

/// Classify a `pool::Error` surfaced by the throwaway probe pool: unwrap the
/// `Relay(..)` variant into U1's classifier, and map every other pool-level
/// variant (bad URL, pool shutdown, relay not found, ...) to `unknown` -- none
/// of them carry connectivity meaning (KTD2).
fn classify_probe_pool_error(err: &nostr_sdk::pool::pool::Error) -> RelayFailure {
    match err {
        nostr_sdk::pool::pool::Error::Relay(inner) => classify_relay_error(inner),
        other => RelayFailure {
            code: RelayFailureCode::Unknown,
            detail: Some(cap_and_redact_detail(
                &other.to_string(),
                RELAY_FAILURE_DETAIL_CAP,
            )),
        },
    }
}

/// Remove the candidate relay from the throwaway pool on every explicit exit
/// path (R6). The deadline-cancellation path relies on `RelayPool`'s own
/// `Drop` instead, since a cancelled future never reaches this call.
async fn teardown_probe_pool(pool: &RelayPool, url: &str) {
    let _ = pool.force_remove_relay(url).await;
}

/// Resolve, connect through a throwaway pool, and run one bounded read-only
/// query. Never touches `get_nostr_client()` and never writes to the
/// candidate. The caller wraps this in the probe's single deadline; on
/// success it returns the query's elapsed milliseconds.
async fn run_relay_probe(
    url: &str,
    handshake_done: &std::sync::atomic::AtomicBool,
) -> Result<u64, RelayFailure> {
    // Resolve the host explicitly -- the only typed route to `dns_failed`;
    // inside the monitor loops a resolver failure arrives as the unstable,
    // non-matchable `io::ErrorKind::Uncategorized` (KTD2).
    let parsed = url::Url::parse(url).map_err(|_| RelayFailure {
        code: RelayFailureCode::InvalidUrl,
        detail: None,
    })?;
    let host = parsed.host_str().ok_or(RelayFailure {
        code: RelayFailureCode::InvalidUrl,
        detail: None,
    })?;
    let port = parsed.port_or_known_default().unwrap_or(443);
    let mut addrs = match tokio::net::lookup_host((host, port)).await {
        Ok(addrs) => addrs,
        Err(_) => {
            return Err(RelayFailure {
                code: RelayFailureCode::DnsFailed,
                detail: None,
            })
        }
    };
    if addrs.next().is_none() {
        return Err(RelayFailure {
            code: RelayFailureCode::DnsFailed,
            detail: None,
        });
    }

    let pool = RelayPool::new();

    if let Err(e) = pool
        .add_relay(url, RelayOptions::new().reconnect(false))
        .await
    {
        let failure = classify_probe_pool_error(&e);
        teardown_probe_pool(&pool, url).await;
        return Err(failure);
    }

    if let Err(e) = pool.try_connect_relay(url, PROBE_INNER_TIMEOUT).await {
        let failure = classify_probe_pool_error(&e);
        teardown_probe_pool(&pool, url).await;
        return Err(failure);
    }
    handshake_done.store(true, std::sync::atomic::Ordering::SeqCst);

    let relay = match pool.relay(url).await {
        Ok(relay) => relay,
        Err(e) => {
            let failure = classify_probe_pool_error(&e);
            teardown_probe_pool(&pool, url).await;
            return Err(failure);
        }
    };

    // One bounded read-only query -- never a write. An end-of-stored-events
    // response confirms the relay; a close-with-reason answer is
    // `auth_required`; total silence is caught by the caller's outer deadline.
    let filter = Filter::new().kinds(vec![Kind::Metadata]).limit(1);
    let started = std::time::Instant::now();
    let query_result = relay
        .fetch_events(filter, PROBE_INNER_TIMEOUT, ReqExitPolicy::ExitOnEOSE)
        .await;
    let round_trip_ms = started.elapsed().as_millis() as u64;

    teardown_probe_pool(&pool, url).await;
    drop(pool);

    match query_result {
        Ok(_events) => Ok(round_trip_ms),
        Err(nostr_sdk::pool::relay::Error::RelayMessage(_))
        | Err(nostr_sdk::pool::relay::Error::AuthenticationFailed) => Err(RelayFailure {
            code: RelayFailureCode::AuthRequired,
            detail: None,
        }),
        Err(e) => Err(RelayFailure {
            code: RelayFailureCode::Unknown,
            detail: Some(cap_and_redact_detail(
                &e.to_string(),
                RELAY_FAILURE_DETAIL_CAP,
            )),
        }),
    }
}

/// Pre-add relay probe (Tauri command): validate, resolve, connect through a
/// throwaway pool, and run one read-only query round-trip, all under a single
/// 10-second deadline. Never joins the operator's live pool and writes
/// nothing to the candidate relay (R4, R5, R6, R7, R13).
#[tauri::command]
async fn probe_relay(url: String) -> Result<ProbeResult, String> {
    let normalized = match validate_relay_url(&url) {
        Ok(normalized) => normalized,
        Err(_) => return Ok(ProbeResult::failure(RelayFailureCode::InvalidUrl)),
    };

    let handshake_done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let handshake_done_for_probe = handshake_done.clone();
    match tokio::time::timeout(
        PROBE_DEADLINE,
        run_relay_probe(&normalized, &handshake_done_for_probe),
    )
    .await
    {
        Ok(Ok(round_trip_ms)) => Ok(ProbeResult::Reachable { round_trip_ms }),
        Ok(Err(failure)) => Ok(ProbeResult::Unreachable { failure }),
        // Silence after a completed handshake is `not_a_relay`. A deadline that
        // fires earlier -- DNS, TCP, TLS, or upgrade still in flight -- is
        // `timed_out`.
        Err(_) => {
            let code = if handshake_done.load(std::sync::atomic::Ordering::SeqCst) {
                RelayFailureCode::NotARelay
            } else {
                RelayFailureCode::TimedOut
            };
            Ok(ProbeResult::failure(code))
        }
    }
}

/// Certificate metadata plus a freshly computed expiry verdict for the wire.
/// The verdict is never cached alongside the certificate (`relay_cert`'s
/// cache holds only the time-invariant parse result) -- it is recomputed
/// against the current time on every call, so a certificate served from
/// cache still reports an up-to-date expiry state (KTD10).
#[derive(serde::Serialize)]
struct RelayCertificateView {
    #[serde(flatten)]
    certificate: relay_cert::RelayCertificate,
    expiry_verdict: relay_cert::ExpiryVerdict,
}

/// Fetches the certificate a `wss://` relay presents over an isolated TLS
/// handshake (`relay_cert`), never the app's own connection. `Ok(None)`
/// covers every case that isn't "here is a certificate" -- a `ws://` URL, an
/// unreachable host, and a stalled handshake past its deadline are all
/// indistinguishable to the panel, so none of them is surfaced as `Err`.
#[tauri::command]
async fn get_relay_certificate(url: String) -> Result<Option<RelayCertificateView>, String> {
    let Some(certificate) = relay_cert::fetch_certificate(&url).await else {
        return Ok(None);
    };
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let expiry_verdict = relay_cert::expiry_verdict(certificate.not_after, now_unix);
    Ok(Some(RelayCertificateView {
        certificate,
        expiry_verdict,
    }))
}

#[cfg(test)]
mod probe_relay_tests {
    use super::{probe_relay, ProbeResult, RelayFailureCode};

    #[tokio::test]
    async fn invalid_url_returns_immediately_with_no_network_attempt() {
        let started = std::time::Instant::now();
        let result = probe_relay("not a url".to_string()).await.unwrap();
        assert!(
            started.elapsed() < std::time::Duration::from_millis(500),
            "invalid_url must short-circuit before any connection attempt"
        );
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(failure.code, RelayFailureCode::InvalidUrl);
            }
            ProbeResult::Reachable { .. } => panic!("expected an invalid_url failure"),
        }
    }

    #[tokio::test]
    async fn public_ws_url_is_rejected_by_the_validator() {
        let result = probe_relay("ws://relay.example.com".to_string())
            .await
            .unwrap();
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(failure.code, RelayFailureCode::InvalidUrl);
            }
            ProbeResult::Reachable { .. } => panic!("a public ws:// URL must be rejected"),
        }
    }

    #[tokio::test]
    async fn unresolvable_hostname_returns_dns_failed() {
        let result = probe_relay("wss://this-definitely-does-not-resolve.invalid".to_string())
            .await
            .unwrap();
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(failure.code, RelayFailureCode::DnsFailed);
            }
            ProbeResult::Reachable { .. } => panic!("an unresolvable hostname must fail"),
        }
    }

    #[tokio::test]
    async fn closed_local_port_classifies_connection_refused() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);
        let url = format!("ws://127.0.0.1:{port}");

        // Run twice: if the throwaway pool or its connection ever leaked out
        // of `run_relay_probe`, a stale relay entry or hung socket would
        // either change the second call's classification or make it hang.
        for _ in 0..2 {
            let started = std::time::Instant::now();
            let result = probe_relay(url.clone()).await.unwrap();
            assert!(started.elapsed() < std::time::Duration::from_secs(5));
            match result {
                ProbeResult::Unreachable { failure } => {
                    assert_eq!(failure.code, RelayFailureCode::ConnectionRefused);
                }
                ProbeResult::Reachable { .. } => panic!("a closed port must fail to connect"),
            }
        }
    }

    /// Exercises the exact teardown call `run_relay_probe` uses on every exit
    /// path: after `force_remove_relay`, the pool holds no relay at all.
    #[tokio::test]
    async fn probe_pool_teardown_leaves_no_relay_registered() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);
        let url = format!("ws://127.0.0.1:{port}");

        let pool = nostr_sdk::RelayPool::new();
        pool.add_relay(&url, nostr_sdk::RelayOptions::new().reconnect(false))
            .await
            .expect("add_relay");
        let _ = pool
            .try_connect_relay(&url, std::time::Duration::from_secs(5))
            .await;
        let _ = pool.force_remove_relay(&url).await;

        assert_eq!(
            pool.relays().await.len(),
            0,
            "force_remove_relay must leave no relay registered"
        );
    }

    #[tokio::test]
    async fn each_failure_code_round_trips_through_the_dto_and_carries_no_round_trip_ms() {
        for code in [
            RelayFailureCode::DnsFailed,
            RelayFailureCode::ConnectionRefused,
            RelayFailureCode::NetworkUnreachable,
            RelayFailureCode::TimedOut,
            RelayFailureCode::TlsFailed,
            RelayFailureCode::ProtocolError,
            RelayFailureCode::AuthRequired,
            RelayFailureCode::NotARelay,
            RelayFailureCode::InvalidUrl,
            RelayFailureCode::Unknown,
        ] {
            let result = ProbeResult::failure(code);
            let json = serde_json::to_value(&result).unwrap();
            assert_eq!(json["outcome"], "unreachable");
            assert!(
                json.get("round_trip_ms").is_none(),
                "a failure DTO must never carry a round-trip measurement"
            );
            assert!(json["failure"]["code"].is_string());
        }

        let reachable =
            serde_json::to_value(&ProbeResult::Reachable { round_trip_ms: 42 }).unwrap();
        assert_eq!(reachable["outcome"], "reachable");
        assert_eq!(reachable["round_trip_ms"], 42);
    }

    #[tokio::test]
    async fn accept_then_stall_host_returns_within_the_deadline() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();

        // Accept and hold the connection open without ever completing a
        // WebSocket upgrade, so the probe genuinely has nothing to read.
        tokio::spawn(async move {
            if let Ok((_stream, _)) = listener.accept().await {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });

        let url = format!("ws://127.0.0.1:{port}");
        let started = std::time::Instant::now();
        let result = tokio::time::timeout(std::time::Duration::from_secs(12), probe_relay(url))
            .await
            .expect("probe_relay must return within its own 10s deadline")
            .unwrap();
        assert!(
            started.elapsed() < std::time::Duration::from_secs(12),
            "probe must honor its single 10-second deadline"
        );
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(
                    failure.code,
                    RelayFailureCode::TimedOut,
                    "a host that accepts TCP but never completes the handshake is timed_out, not not_a_relay"
                );
            }
            ProbeResult::Reachable { .. } => panic!("a stalling host must fail"),
        }
    }
}

#[cfg(test)]
mod relay_metrics_tests {
    use super::{
        get_relay_logs, get_relay_metrics, record_event_received, record_send_outcome,
        DIAGNOSTICS_TEST_LOCK,
    };
    use crate::nostr_sign;
    use nostr_sdk::prelude::{EventBuilder, Keys, Kind, Output, RelayUrl};
    use std::collections::{HashMap, HashSet};

    fn test_event(content: &str) -> nostr_sdk::Event {
        nostr_sign::sign_with(
            EventBuilder::new(Kind::TextNote, content),
            &Keys::generate(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn accepted_relays_get_events_sent_and_bytes_up() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let event = test_event("published");
        let accepted = RelayUrl::parse("wss://test-send-outcome-accepted.example").unwrap();
        let output = Output {
            val: event.id,
            success: HashSet::from([accepted.clone()]),
            failed: HashMap::new(),
        };
        record_send_outcome(&event, &output);

        let metrics = get_relay_metrics(accepted.to_string()).await.unwrap();
        assert_eq!(metrics.events_sent, 1);
        assert_eq!(
            metrics.bytes_up,
            nostr_sign::event_json(&event).len() as u64
        );
    }

    #[tokio::test]
    async fn rejected_relays_get_a_warn_log_and_no_sent_count() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let event = test_event("rejected");
        let rejected = RelayUrl::parse("wss://test-send-outcome-rejected.example").unwrap();
        let output = Output {
            val: event.id,
            success: HashSet::new(),
            failed: HashMap::from([(rejected.clone(), "rate-limited".to_string())]),
        };
        record_send_outcome(&event, &output);

        let metrics = get_relay_metrics(rejected.to_string()).await.unwrap();
        assert_eq!(metrics.events_sent, 0);
        assert_eq!(metrics.bytes_up, 0);

        let logs = get_relay_logs(rejected.to_string()).await.unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].level, "warn");
        assert_eq!(logs[0].message, "rate-limited");
    }

    #[tokio::test]
    async fn multiple_accepted_relays_each_get_their_own_counters() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let event = test_event("fanout");
        let relay_a = RelayUrl::parse("wss://test-send-outcome-fanout-a.example").unwrap();
        let relay_b = RelayUrl::parse("wss://test-send-outcome-fanout-b.example").unwrap();
        let output = Output {
            val: event.id,
            success: HashSet::from([relay_a.clone(), relay_b.clone()]),
            failed: HashMap::new(),
        };
        record_send_outcome(&event, &output);

        let metrics_a = get_relay_metrics(relay_a.to_string()).await.unwrap();
        let metrics_b = get_relay_metrics(relay_b.to_string()).await.unwrap();
        assert_eq!(metrics_a.events_sent, 1);
        assert_eq!(metrics_b.events_sent, 1);
    }

    #[tokio::test]
    async fn accumulates_events_received_and_bytes_down_for_same_relay() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let url = "wss://test-record-received-accumulate.example";
        let event_a = test_event("first");
        let event_b = test_event("second, a little longer");
        record_event_received(url, &event_a);
        record_event_received(url, &event_b);

        let metrics = get_relay_metrics(url.to_string()).await.unwrap();
        assert_eq!(metrics.events_received, 2);
        assert_eq!(
            metrics.bytes_down,
            (nostr_sign::event_json(&event_a).len() + nostr_sign::event_json(&event_b).len())
                as u64
        );
    }

    #[tokio::test]
    async fn normalizes_relay_url_without_leaking_across_distinct_relays() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let canonical = "wss://test-record-received-normalize.example";
        let variant = "WSS://Test-Record-Received-Normalize.example/";
        let other = "wss://test-record-received-other.example";
        record_event_received(canonical, &test_event("one"));
        record_event_received(variant, &test_event("two"));
        record_event_received(other, &test_event("three"));

        let canonical_metrics = get_relay_metrics(canonical.to_string()).await.unwrap();
        let other_metrics = get_relay_metrics(other.to_string()).await.unwrap();
        assert_eq!(canonical_metrics.events_received, 2);
        assert_eq!(other_metrics.events_received, 1);
    }

    #[tokio::test]
    async fn get_relay_metrics_reflects_recorded_events() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let url = "wss://test-record-received-readpath.example";
        record_event_received(url, &test_event("readable"));

        let metrics = get_relay_metrics(url.to_string()).await.unwrap();
        assert_eq!(metrics.events_received, 1);
        assert!(metrics.bytes_down > 0);
    }

    #[tokio::test]
    async fn repeated_identical_send_failures_collapse_into_one_log_entry() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let rejected = RelayUrl::parse("wss://test-send-outcome-repeated-failure.example").unwrap();
        for i in 0..3 {
            let event = test_event(&format!("retry {i}"));
            let output = Output {
                val: event.id,
                success: HashSet::new(),
                failed: HashMap::from([(rejected.clone(), "rate-limited".to_string())]),
            };
            record_send_outcome(&event, &output);
        }

        let logs = get_relay_logs(rejected.to_string()).await.unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, "rate-limited");
    }
}

/// Get metrics for a relay
#[tauri::command]
async fn get_relay_metrics(url: String) -> Result<RelayMetrics, String> {
    let normalized = url.trim().trim_end_matches('/').to_lowercase();
    let metrics = RELAY_METRICS
        .read()
        .map_err(|_| "Failed to read metrics")?
        .get(&normalized)
        .cloned()
        .unwrap_or_default();
    Ok(metrics)
}

/// Get logs for a relay
#[tauri::command]
async fn get_relay_logs(url: String) -> Result<Vec<RelayLog>, String> {
    let normalized = url.trim().trim_end_matches('/').to_lowercase();
    let logs = RELAY_LOGS
        .read()
        .map_err(|_| "Failed to read logs")?
        .get(&normalized)
        .map(|l| l.iter().cloned().collect())
        .unwrap_or_default();
    Ok(logs)
}

// ============================================================================

#[derive(serde::Serialize)]
struct RelayInfo {
    url: String,
    status: String,
    is_default: bool,
    is_custom: bool,
    enabled: bool,
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_reason: Option<RelayFailure>,
}

/// Read-side gate for R3: a stored failure reason is never surfaced for a relay whose live
/// status resolves to connected, regardless of how the write side raced the real transition
/// (KTD8). Looks up through the shared normalization so a trailing-slash mismatch between the
/// stored key and the caller's URL never misses.
fn relay_failure_for(url: &str, status: &str) -> Option<RelayFailure> {
    if status == "connected" {
        return None;
    }
    RELAY_FAILURES
        .read()
        .ok()
        .and_then(|failures| failures.get(&normalize_relay_url(url)).cloned())
}

/// Get all relays with their current status
#[tauri::command]
async fn get_relays<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<RelayInfo>, String> {
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Get custom relays from DB
    let custom_relays = get_custom_relays(handle.clone()).await.unwrap_or_default();
    let disabled_defaults = get_disabled_default_relays(&handle)
        .await
        .unwrap_or_default();

    // Get all connected relays from client pool
    let pool_relays = client.relays().await;

    let mut relay_infos: Vec<RelayInfo> = Vec::new();

    // First, add all default relays (even if disabled). Under a debug relay
    // override they are never connected, so listing them would misreport a
    // sandbox's real exposure.
    let listed_defaults: &[&str] = if crate::trusted_relays::is_overridden() {
        &[]
    } else {
        DEFAULT_RELAYS
    };
    for default_url in listed_defaults {
        let url_str = default_url.to_string();
        let is_disabled = disabled_defaults
            .iter()
            .any(|d| d.to_lowercase() == url_str.to_lowercase());

        // Check if this relay is in the pool
        let (status, mode) = if let Some((_, relay)) = pool_relays
            .iter()
            .find(|(u, _)| u.to_string().to_lowercase() == url_str.to_lowercase())
        {
            let status = match relay.status() {
                RelayStatus::Initialized => "initialized",
                RelayStatus::Pending => "pending",
                RelayStatus::Connecting => "connecting",
                RelayStatus::Connected => "connected",
                RelayStatus::Disconnected => "disconnected",
                RelayStatus::Terminated => "terminated",
                RelayStatus::Banned => "banned",
                RelayStatus::Sleeping => "sleeping",
            };
            (status.to_string(), "both".to_string())
        } else {
            ("disabled".to_string(), "both".to_string())
        };

        let failure_reason = relay_failure_for(&url_str, &status);
        relay_infos.push(RelayInfo {
            url: url_str,
            status,
            is_default: true,
            is_custom: false,
            enabled: !is_disabled,
            mode,
            failure_reason,
        });
    }

    // Then add custom relays
    for custom in &custom_relays {
        // Check if this relay is in the pool
        let status = if let Some((_, relay)) = pool_relays
            .iter()
            .find(|(u, _)| u.to_string().to_lowercase() == custom.url.to_lowercase())
        {
            match relay.status() {
                RelayStatus::Initialized => "initialized",
                RelayStatus::Pending => "pending",
                RelayStatus::Connecting => "connecting",
                RelayStatus::Connected => "connected",
                RelayStatus::Disconnected => "disconnected",
                RelayStatus::Terminated => "terminated",
                RelayStatus::Banned => "banned",
                RelayStatus::Sleeping => "sleeping",
            }
            .to_string()
        } else {
            "disabled".to_string()
        };

        let failure_reason = relay_failure_for(&custom.url, &status);
        relay_infos.push(RelayInfo {
            url: custom.url.clone(),
            status,
            is_default: false,
            is_custom: true,
            enabled: custom.enabled,
            mode: custom.mode.clone(),
            failure_reason,
        });
    }

    Ok(relay_infos)
}

/// Get the list of Blossom media servers (Tauri command)
#[tauri::command]
async fn get_media_servers() -> Vec<String> {
    get_blossom_media_servers()
}

// ============================================================================
// Custom Relay Management
// ============================================================================

/// Saved custom relay entry with optional metadata
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct CustomRelay {
    url: String,
    enabled: bool,
    #[serde(default = "default_relay_mode")]
    mode: String, // "read" | "write" | "both"
}

fn default_relay_mode() -> String {
    "both".to_string()
}

/// Validate a relay URL format. Secure WebSockets (`wss://`) are required for
/// public relays; insecure `ws://` is allowed only for local development hosts
/// so containers like the pacto dev-setup relay can be used without TLS.
fn validate_relay_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    let parsed = url::Url::parse(trimmed).map_err(|_| {
        "Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)".to_string()
    })?;

    let host = parsed
        .host_str()
        .ok_or_else(|| "Relay URL must include a host".to_string())?;

    match parsed.scheme() {
        "wss" => {}
        "ws" => {
            let is_localhost = host == "localhost";
            let is_loopback_with_port = host == "127.0.0.1" && parsed.port().is_some();
            if !is_localhost && !is_loopback_with_port {
                return Err("Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)".to_string());
            }
        }
        _ => {
            return Err("Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)".to_string());
        }
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Relay URL must not contain userinfo".to_string());
    }

    let normalized = trimmed.trim_end_matches('/');
    Ok(normalized.to_string())
}

#[cfg(test)]
mod validate_relay_url_tests {
    use super::validate_relay_url;

    #[test]
    fn accepts_wss_relay() {
        assert_eq!(
            validate_relay_url("wss://relay.example.com").unwrap(),
            "wss://relay.example.com"
        );
    }

    #[test]
    fn accepts_ws_localhost_with_port() {
        assert_eq!(
            validate_relay_url("ws://localhost:7000").unwrap(),
            "ws://localhost:7000"
        );
    }

    #[test]
    fn accepts_ws_127_0_0_1_with_port() {
        assert_eq!(
            validate_relay_url("ws://127.0.0.1:7000").unwrap(),
            "ws://127.0.0.1:7000"
        );
    }

    #[test]
    fn rejects_public_ws() {
        assert!(validate_relay_url("ws://relay.example.com").is_err());
    }

    #[test]
    fn rejects_ws_localhost_with_userinfo_bypass() {
        assert!(validate_relay_url("ws://localhost:7000@evil.com").is_err());
    }

    #[test]
    fn rejects_ws_userinfo_at_localhost() {
        assert!(validate_relay_url("ws://user@localhost:7000").is_err());
    }

    #[test]
    fn rejects_ws_127_0_0_1() {
        assert!(validate_relay_url("ws://127.0.0.1").is_err());
    }

    #[test]
    fn rejects_wss_missing_host() {
        assert!(validate_relay_url("wss://").is_err());
    }

    #[test]
    fn normalizes_trailing_slash() {
        assert_eq!(
            validate_relay_url("wss://relay.example.com/").unwrap(),
            "wss://relay.example.com"
        );
    }
}

/// Get the list of custom relays from settings
#[tauri::command]
async fn get_custom_relays<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<CustomRelay>, String> {
    // Check if an account is selected
    if crate::account_manager::get_current_account().is_err() {
        return Ok(vec![]);
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["custom_relays"],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);

    match result {
        Some(json_str) => serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse custom relays: {}", e)),
        None => Ok(vec![]),
    }
}

/// Save the list of custom relays to settings
async fn save_custom_relays<R: Runtime>(
    handle: &AppHandle<R>,
    relays: &[CustomRelay],
) -> Result<(), String> {
    if crate::account_manager::get_current_account().is_err() {
        return Err("No account selected".to_string());
    }

    let json_str =
        serde_json::to_string(relays).map_err(|e| format!("Failed to serialize relays: {}", e))?;

    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["custom_relays", json_str],
    )
    .map_err(|e| format!("Failed to save custom relays: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Get the list of disabled default relays from settings
async fn get_disabled_default_relays<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<String>, String> {
    if crate::account_manager::get_current_account().is_err() {
        return Ok(vec![]);
    }

    let conn = crate::account_manager::get_db_connection(handle)?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["disabled_default_relays"],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);

    match result {
        Some(json_str) => serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse disabled default relays: {}", e)),
        None => Ok(vec![]),
    }
}

/// Save the list of disabled default relays to settings
async fn save_disabled_default_relays<R: Runtime>(
    handle: &AppHandle<R>,
    relays: &[String],
) -> Result<(), String> {
    if crate::account_manager::get_current_account().is_err() {
        return Err("No account selected".to_string());
    }

    let json_str = serde_json::to_string(relays)
        .map_err(|e| format!("Failed to serialize disabled relays: {}", e))?;

    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["disabled_default_relays", json_str],
    )
    .map_err(|e| format!("Failed to save disabled default relays: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Toggle a default relay's enabled state
#[tauri::command]
async fn toggle_default_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    enabled: bool,
) -> Result<bool, String> {
    // Verify it's actually a default relay
    if !is_default_relay(&url) {
        return Err("Not a default relay".to_string());
    }

    let normalized_url = url.trim().trim_end_matches('/').to_string();
    let mut disabled = get_disabled_default_relays(&handle).await?;

    if enabled {
        // Remove from disabled list
        disabled.retain(|d| d.to_lowercase() != normalized_url.to_lowercase());
    } else {
        // Add to disabled list if not already there
        if !disabled
            .iter()
            .any(|d| d.to_lowercase() == normalized_url.to_lowercase())
        {
            disabled.push(normalized_url.clone());
        }
    }

    save_disabled_default_relays(&handle, &disabled).await?;

    // Update the relay pool
    if let Ok(client) = get_nostr_client() {
        if enabled {
            // Re-add the relay
            match client
                .pool()
                .add_relay(&normalized_url, RelayOptions::new().reconnect(false))
                .await
            {
                Ok(_) => {
                    let _ = client.pool().connect_relay(&normalized_url).await;
                    println!("[Relay] Enabled default relay: {}", normalized_url);
                }
                Err(e) => eprintln!("[Relay] Failed to enable default relay: {}", e),
            }
        } else {
            // Remove the relay from pool
            clear_relay_failure(&normalized_url);
            if let Err(e) = client.pool().remove_relay(&normalized_url).await {
                eprintln!(
                    "[Relay] Note: Could not disable default relay in pool: {}",
                    e
                );
            } else {
                println!("[Relay] Disabled default relay: {}", normalized_url);
            }
        }
    }

    Ok(true)
}

/// Helper to build RelayOptions based on mode
fn relay_options_for_mode(mode: &str) -> RelayOptions {
    let opts = RelayOptions::new().reconnect(false);
    match mode {
        "read" => opts.write(false),
        "write" => opts.read(false),
        _ => opts, // "both" - default read and write enabled
    }
}

/// Add a custom relay URL
#[tauri::command]
async fn add_custom_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    mode: Option<String>,
) -> Result<CustomRelay, String> {
    // Validate and normalize the URL
    let normalized_url = validate_relay_url(&url)?;

    // Validate mode
    let relay_mode = mode.unwrap_or_else(|| "both".to_string());
    if !["read", "write", "both"].contains(&relay_mode.as_str()) {
        return Err("Invalid mode. Must be 'read', 'write', or 'both'".to_string());
    }

    // Get existing relays
    let mut relays = get_custom_relays(handle.clone()).await?;

    // Check for duplicates (case-insensitive)
    let url_lower = normalized_url.to_lowercase();
    if relays.iter().any(|r| r.url.to_lowercase() == url_lower) {
        return Err("Relay already exists".to_string());
    }

    // Don't allow adding default relays as custom
    if is_default_relay(&normalized_url) {
        return Err("Cannot add default relay as custom relay".to_string());
    }

    // Create new relay entry
    let new_relay = CustomRelay {
        url: normalized_url,
        enabled: true,
        mode: relay_mode.clone(),
    };

    relays.push(new_relay.clone());

    // Save to settings
    save_custom_relays(&handle, &relays).await?;

    // If we're already connected, add this relay to the pool immediately
    if let Ok(client) = get_nostr_client() {
        if client.relays().await.len() > 0 {
            match client
                .pool()
                .add_relay(&new_relay.url, relay_options_for_mode(&relay_mode))
                .await
            {
                Ok(_) => {
                    println!(
                        "[Relay] Added custom relay to pool: {} (mode: {})",
                        new_relay.url, relay_mode
                    );
                    // Connect to the new relay
                    if let Err(e) = client.pool().connect_relay(&new_relay.url).await {
                        eprintln!("[Relay] Failed to connect to new relay: {}", e);
                    }
                }
                Err(e) => eprintln!("[Relay] Failed to add relay to pool: {}", e),
            }
        }
    }

    Ok(new_relay)
}

/// Remove a custom relay URL
#[tauri::command]
async fn remove_custom_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
) -> Result<bool, String> {
    let mut relays = get_custom_relays(handle.clone()).await?;

    let url_lower = url.to_lowercase();
    let original_len = relays.len();
    relays.retain(|r| r.url.to_lowercase() != url_lower);

    if relays.len() == original_len {
        return Ok(false); // Relay not found
    }

    // Save updated list
    save_custom_relays(&handle, &relays).await?;

    // Remove from active pool if connected
    if let Ok(client) = get_nostr_client() {
        if let Err(e) = client.pool().remove_relay(&url).await {
            // Log but don't fail - relay might not be in pool
            eprintln!("[Relay] Note: Could not remove relay from pool: {}", e);
        } else {
            println!("[Relay] Removed custom relay from pool: {}", url);
        }
    }

    clear_relay_failure(&url);

    Ok(true)
}

/// Toggle a custom relay's enabled state
#[tauri::command]
async fn toggle_custom_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut relays = get_custom_relays(handle.clone()).await?;

    let url_lower = url.to_lowercase();
    let mut found = false;
    let mut relay_mode = "both".to_string();

    for relay in relays.iter_mut() {
        if relay.url.to_lowercase() == url_lower {
            relay.enabled = enabled;
            relay_mode = relay.mode.clone();
            found = true;
            break;
        }
    }

    if !found {
        return Err("Relay not found".to_string());
    }

    // Save updated list
    save_custom_relays(&handle, &relays).await?;

    // Update the relay pool
    if let Ok(client) = get_nostr_client() {
        if enabled {
            // Add and connect with proper mode
            match client
                .pool()
                .add_relay(&url, relay_options_for_mode(&relay_mode))
                .await
            {
                Ok(_) => {
                    let _ = client.pool().connect_relay(&url).await;
                    println!(
                        "[Relay] Enabled custom relay: {} (mode: {})",
                        url, relay_mode
                    );
                }
                Err(e) => eprintln!("[Relay] Failed to enable relay: {}", e),
            }
        } else {
            // Disconnect and remove
            clear_relay_failure(&url);
            if let Err(e) = client.pool().remove_relay(&url).await {
                eprintln!("[Relay] Note: Could not disable relay in pool: {}", e);
            } else {
                println!("[Relay] Disabled custom relay: {}", url);
            }
        }
    }

    Ok(true)
}

/// Update a custom relay's mode (read/write/both)
#[tauri::command]
async fn update_relay_mode<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    mode: String,
) -> Result<bool, String> {
    // Validate mode
    if !["read", "write", "both"].contains(&mode.as_str()) {
        return Err("Invalid mode. Must be 'read', 'write', or 'both'".to_string());
    }

    let mut relays = get_custom_relays(handle.clone()).await?;

    let url_lower = url.to_lowercase();
    let mut found = false;
    let mut is_enabled = false;

    for relay in relays.iter_mut() {
        if relay.url.to_lowercase() == url_lower {
            relay.mode = mode.clone();
            is_enabled = relay.enabled;
            found = true;
            break;
        }
    }

    if !found {
        return Err("Relay not found".to_string());
    }

    // Save updated list
    save_custom_relays(&handle, &relays).await?;

    // If relay is currently enabled, reconnect with new mode
    if is_enabled {
        if let Ok(client) = get_nostr_client() {
            // Remove and re-add with new options
            let _ = client.pool().remove_relay(&url).await;
            match client
                .pool()
                .add_relay(&url, relay_options_for_mode(&mode))
                .await
            {
                Ok(_) => {
                    let _ = client.pool().connect_relay(&url).await;
                    println!("[Relay] Updated relay mode: {} -> {}", url, mode);
                }
                Err(e) => eprintln!("[Relay] Failed to update relay mode: {}", e),
            }
        }
    }

    Ok(true)
}

/// Validate a relay URL without saving it
#[tauri::command]
async fn validate_relay_url_cmd(url: String) -> Result<String, String> {
    validate_relay_url(&url)
}

// ============================================================================

/// Whether a relay's current status alone (not a probe outcome) warrants a
/// forced disconnect+reconnect from the health-check loop.
fn relay_needs_forced_reconnect(status: RelayStatus) -> bool {
    matches!(status, RelayStatus::Terminated | RelayStatus::Disconnected)
}

// Relay URLs with a reconnect fetch in flight (lazy_static items cannot take /// docs).
lazy_static! {
    static ref RELAY_FETCH_IN_FLIGHT: Mutex<std::collections::HashSet<String>> =
        Mutex::new(std::collections::HashSet::new());
}

/// Whether a relay is allowed to start a new single-relay reconnect fetch, given the set of
/// relay URLs that currently have one in flight.
fn relay_fetch_may_start(in_flight: &std::collections::HashSet<String>, url: &str) -> bool {
    !in_flight.contains(url)
}

/// Monitor relay pool connection status changes
#[tauri::command]
async fn monitor_relay_connections() -> Result<bool, String> {
    // Guard against multiple invocations (e.g., from hot-reloads in debug mode)
    static MONITOR_STARTED: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);
    if MONITOR_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        // Already running, return success without spawning duplicate tasks
        return Ok(false);
    }

    let client = get_nostr_client().expect("Nostr client not initialized");
    // Captured once, at spawn time, and reused by every task below. Compared against the
    // live generation on every diagnostic write (failure store/clear, log, metric) so a
    // stale monitor loop left running for a previous account cannot attribute diagnostics
    // to the current one.
    let login_generation = current_login_generation();
    let handle = TAURI_APP.get().unwrap().clone();

    // Get the monitor and subscribe to real-time notifications
    let monitor = client.monitor().ok_or("Failed to get monitor")?;
    let mut receiver = monitor.subscribe();

    // RAII guard releasing a relay's RELAY_FETCH_IN_FLIGHT slot on Drop, so a panicking or
    // erroring single-relay fetch can't strand the slot and permanently block that relay's
    // future reconnect fetches.
    struct InFlightGuard(String);
    impl Drop for InFlightGuard {
        fn drop(&mut self) {
            let url = std::mem::take(&mut self.0);
            tokio::spawn(async move {
                RELAY_FETCH_IN_FLIGHT.lock().await.remove(&url);
            });
        }
    }

    // Spawn a task to handle real-time relay status notifications
    let handle_clone = handle.clone();
    tokio::spawn(async move {
        while let Ok(notification) = receiver.recv().await {
            match notification {
                MonitorNotification::StatusChanged { relay_url, status } => {
                    let url_str = relay_url.to_string();
                    let status_str = match status {
                        RelayStatus::Initialized => "initialized",
                        RelayStatus::Pending => "pending",
                        RelayStatus::Connecting => "connecting",
                        RelayStatus::Connected => "connected",
                        RelayStatus::Disconnected => "disconnected",
                        RelayStatus::Terminated => "terminated",
                        RelayStatus::Banned => "banned",
                        RelayStatus::Sleeping => "sleeping",
                    };

                    // Log the status change
                    let log_level = match status {
                        RelayStatus::Connected => "info",
                        RelayStatus::Disconnected | RelayStatus::Terminated => "warn",
                        RelayStatus::Banned => "error",
                        _ => "info",
                    };
                    add_relay_log_if_current(
                        &url_str,
                        log_level,
                        &format!("Status changed to {}", status_str),
                        login_generation,
                    );

                    // Emit relay status update to frontend
                    handle_clone
                        .emit(
                            "relay_status_change",
                            serde_json::json!({
                                "url": url_str,
                                "status": status_str
                            }),
                        )
                        .unwrap();

                    // Handle reconnection logic
                    match status {
                        RelayStatus::Disconnected => {
                            // The aggressive health check system will handle reconnection
                            // No action needed here to avoid race conditions
                        }
                        RelayStatus::Terminated => {
                            // Relay connection terminated (hard disconnect)
                        }
                        RelayStatus::Connected => {
                            clear_relay_failure_if_current(&url_str, login_generation);
                            // When a relay reconnects, fetch its bounded catch-up window from just
                            // that relay — skip if a fetch for this relay is already in flight so
                            // rapid Connected/Disconnected flapping never overlaps fetches.
                            let handle_inner = handle_clone.clone();
                            let url_string = url_str.clone();
                            let guard = {
                                let mut in_flight = RELAY_FETCH_IN_FLIGHT.lock().await;
                                if relay_fetch_may_start(&in_flight, &url_string) {
                                    in_flight.insert(url_string.clone());
                                    Some(InFlightGuard(url_string.clone()))
                                } else {
                                    None
                                }
                            };
                            if let Some(guard) = guard {
                                tokio::spawn(async move {
                                    // fetch_messages handles both DM and MLS group syncing for single-relay reconnections.
                                    // `guard` is held across the await and dropped afterward, so a panic mid-fetch still
                                    // releases the RELAY_FETCH_IN_FLIGHT slot via unwind.
                                    fetch_messages(handle_inner, false, Some(url_string.clone()))
                                        .await;
                                    drop(guard);
                                });
                            } else {
                                add_relay_log_if_current(
                                    &url_str,
                                    "info",
                                    "Skipping single-relay reconnect fetch: already in flight",
                                    login_generation,
                                );
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    // Spawn conservative health check task: measures/logs Connected relays but
    // no longer force-disconnects them; only Terminated/Disconnected relays get
    // reconnected here (the 5s poller below independently retries Terminated
    // relays, but not Disconnected ones, so that case stays in this loop).
    let client_health = client.clone();
    let handle_health = handle.clone();
    tokio::spawn(async move {
        // Wait 60 seconds before starting health checks
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

        loop {
            // Get all relays
            let relays = client_health.relays().await;
            let mut unhealthy_relays = Vec::new();

            for (url, relay) in &relays {
                let status = relay.status();

                // Only test relays that claim to be connected
                if status == RelayStatus::Connected {
                    // Create a simple query to test connectivity
                    let test_filter = Filter::new().kinds(vec![Kind::Metadata]).limit(1);

                    // Try to fetch with short timeout
                    let start = std::time::Instant::now();
                    let result = tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        client_health.fetch_events_from(
                            vec![url.to_string()],
                            test_filter,
                            std::time::Duration::from_secs(2),
                        ),
                    )
                    .await;

                    let elapsed = start.elapsed();

                    let url_str = url.to_string();
                    let ping_ms = elapsed.as_millis() as u64;
                    let now_secs = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    match result {
                        Ok(Ok(events)) => {
                            // Any completed round-trip is useful ping data, even an
                            // empty/slow one — we no longer disconnect on this alone.
                            update_relay_metrics_if_current(&url_str, login_generation, |m| {
                                m.ping_ms = Some(ping_ms);
                                m.last_check = Some(now_secs);
                            });
                            if events.is_empty() && elapsed.as_secs() >= 2 {
                                add_relay_log_if_current(
                                    &url_str,
                                    "warn",
                                    "Health check: slow/empty response",
                                    login_generation,
                                );
                            }
                        }
                        Ok(Err(e)) => {
                            // Query failed but the relay responded (no timeout): record the
                            // probe attempt (R11), but don't force a reconnect — a slower-but-
                            // alive relay shouldn't be treated the same as one that never
                            // answers at all.
                            update_relay_metrics_if_current(&url_str, login_generation, |m| {
                                m.last_check = Some(now_secs);
                            });
                            add_relay_log_if_current(
                                &url_str,
                                "warn",
                                &format!("Health check failed: {}", e),
                                login_generation,
                            );
                        }
                        Err(_) => {
                            // Full probe timeout: a materially stronger "not there" signal
                            // than a slow-but-completed response. A Connected relay that never
                            // answers has no other recovery path — RelayStatus never
                            // transitions out of Connected on its own, so the reconnect-only-
                            // on-Terminated branch below never sees it. Queue it for the same
                            // forced disconnect+reconnect that branch already uses.
                            update_relay_metrics_if_current(&url_str, login_generation, |m| {
                                m.last_check = Some(now_secs);
                            });
                            add_relay_log_if_current(
                                &url_str,
                                "warn",
                                "Health check failed: timeout",
                                login_generation,
                            );
                            unhealthy_relays.push((url.clone(), relay.clone()));
                        }
                    }
                } else if relay_needs_forced_reconnect(status) {
                    // Already disconnected, add to reconnect list
                    unhealthy_relays.push((url.clone(), relay.clone()));
                }
            }

            // Force reconnect unhealthy relays
            for (url, relay) in unhealthy_relays {
                let url_str = url.to_string();
                // Force a disconnect first for any status `try_connect` can't act on -- the
                // SDK's `can_connect` only accepts Initialized | Terminated | Sleeping, so
                // anything else (Connected included) would otherwise make `try_connect`
                // return `Ok(())` without attempting anything and no cause would ever be
                // produced.
                if !matches!(
                    relay.status(),
                    RelayStatus::Initialized | RelayStatus::Terminated | RelayStatus::Sleeping
                ) {
                    let _ = relay.disconnect();
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }

                // Try to reconnect
                add_relay_log_if_current(
                    &url_str,
                    "info",
                    "Attempting reconnection...",
                    login_generation,
                );
                match relay.try_connect(std::time::Duration::from_secs(10)).await {
                    Ok(()) => {
                        // Cheap optimization only -- R3's real guarantee is the read-side gate
                        // in `get_relays` (KTD8), not this status re-check.
                        if relay.status() == RelayStatus::Connected {
                            clear_relay_failure_if_current(&url_str, login_generation);
                        }
                    }
                    Err(e) => {
                        let failure = classify_relay_error(&e);
                        store_relay_failure_if_current(&url_str, failure, login_generation);
                    }
                }

                // Emit status update
                handle_health
                    .emit(
                        "relay_health_check",
                        serde_json::json!({
                            "url": url_str,
                            "healthy": false,
                            "action": "force_reconnect"
                        }),
                    )
                    .unwrap();
            }

            // Wait 15 seconds before next health check round
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });

    // Keep the original periodic terminated relay check
    tokio::spawn(async move {
        // Wait 30 seconds before starting the polling loop
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;

        loop {
            // Check all relays every 5 seconds
            let relays = client.relays().await;

            for (url, relay) in relays {
                let status = relay.status();
                let url_str = url.to_string();

                // If relay is terminated, attempt to reconnect. `Terminated` is one of the
                // statuses `try_connect` can act on directly, so no forced disconnect first.
                if status == RelayStatus::Terminated {
                    match relay.try_connect(std::time::Duration::from_secs(5)).await {
                        Ok(()) => {
                            if relay.status() == RelayStatus::Connected {
                                clear_relay_failure_if_current(&url_str, login_generation);
                            }
                        }
                        Err(e) => {
                            let failure = classify_relay_error(&e);
                            store_relay_failure_if_current(&url_str, failure, login_generation);
                        }
                    }
                }
            }

            // Wait 5 seconds before next check
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });

    Ok(true)
}

#[cfg(test)]
mod relay_health_reconnect_tests {
    use super::{relay_fetch_may_start, relay_needs_forced_reconnect};
    use nostr_sdk::prelude::RelayStatus;

    #[test]
    fn terminated_and_disconnected_trigger_reconnect() {
        assert!(relay_needs_forced_reconnect(RelayStatus::Terminated));
        assert!(relay_needs_forced_reconnect(RelayStatus::Disconnected));
    }

    #[test]
    fn connected_and_other_statuses_do_not_trigger_reconnect() {
        assert!(!relay_needs_forced_reconnect(RelayStatus::Connected));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Initialized));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Pending));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Connecting));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Banned));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Sleeping));
    }

    #[test]
    fn same_relay_may_not_start_a_second_fetch_while_one_is_in_flight() {
        let mut in_flight = std::collections::HashSet::new();
        assert!(relay_fetch_may_start(&in_flight, "wss://relay.example.com"));
        in_flight.insert("wss://relay.example.com".to_string());
        assert!(!relay_fetch_may_start(
            &in_flight,
            "wss://relay.example.com"
        ));
    }

    #[test]
    fn different_relay_may_start_its_own_fetch_independently() {
        let mut in_flight = std::collections::HashSet::new();
        in_flight.insert("wss://relay-a.example.com".to_string());
        assert!(relay_fetch_may_start(
            &in_flight,
            "wss://relay-b.example.com"
        ));
    }

    #[test]
    fn relay_may_start_again_once_its_in_flight_slot_is_cleared() {
        let mut in_flight = std::collections::HashSet::new();
        in_flight.insert("wss://relay.example.com".to_string());
        assert!(!relay_fetch_may_start(
            &in_flight,
            "wss://relay.example.com"
        ));
        in_flight.remove("wss://relay.example.com");
        assert!(relay_fetch_may_start(&in_flight, "wss://relay.example.com"));
    }
}

/// Decrypts and saves an attachment to disk
///
/// Returns the path to the decrypted file if successful, or an error message if unsuccessful
async fn decrypt_and_save_attachment<R: tauri::Runtime>(
    handle: &AppHandle<R>,
    encrypted_data: &[u8],
    attachment: &Attachment,
) -> Result<std::path::PathBuf, String> {
    // Remote-plaintext marker (see `message::klipy_gif_message`): an empty
    // key/nonce means this attachment was never encrypted — it carries a
    // provider URL directly, e.g. a Klipy GIF. Attempting AES-GCM decryption
    // on an empty key would panic (`GenericArray::from_slice` asserts on
    // length), so refuse before ever calling into `crypto::decrypt_data`.
    if attachment.key.is_empty() || attachment.nonce.is_empty() {
        return Err(
            "This attachment has no decryption key and cannot be decrypted locally".to_string(),
        );
    }

    // Attempt to decrypt the attachment
    let decrypted_data = crypto::decrypt_data(encrypted_data, &attachment.key, &attachment.nonce)
        .map_err(|e| e.to_string())?;

    // Calculate the hash of the decrypted file
    let file_hash = calculate_file_hash(&decrypted_data);

    // Choose the appropriate base directory based on platform
    let base_directory = if cfg!(target_os = "ios") {
        tauri::path::BaseDirectory::Document
    } else {
        tauri::path::BaseDirectory::Download
    };

    // Resolve the directory path using the determined base directory
    let dir = handle.path().resolve("pacto", base_directory).unwrap();

    // Use hash-based filename
    let file_path = dir.join(format!("{}.{}", file_hash, attachment.extension));

    // Create the pacto directory if it doesn't exist
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    // Save the file to disk
    std::fs::write(&file_path, decrypted_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path)
}

#[cfg(test)]
mod remote_plaintext_attachment_tests {
    use super::*;

    fn test_handle() -> AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
            .handle()
            .clone()
    }

    /// Shape produced by `message::klipy_gif_message`: empty key/nonce marks
    /// "remote plaintext, do not decrypt" rather than a corrupted upload.
    fn remote_plaintext_attachment() -> Attachment {
        Attachment {
            id: "abc123slug".to_string(),
            extension: "gif".to_string(),
            url: "https://static.klipy.com/hd.gif".to_string(),
            downloaded: false,
            ..Attachment::default()
        }
    }

    #[tokio::test]
    async fn refuses_to_decrypt_an_attachment_with_no_decryption_key() {
        let handle = test_handle();
        let attachment = remote_plaintext_attachment();
        // Without the guard this reaches `crypto::decrypt_data` with an empty
        // key, which panics (`GenericArray::from_slice` on a length
        // mismatch) instead of returning this clean error.
        let result =
            decrypt_and_save_attachment(&handle, b"sixteen+ bytes of fake ciphertext", &attachment)
                .await;
        assert!(result.is_err());
    }
}

#[tauri::command]
async fn generate_blurhash_preview(npub: String, msg_id: String) -> Result<String, String> {
    // Get the first attachment from the message by searching through chats
    let img_meta = {
        let state = STATE.lock().await;

        // Search through all chats to find the message
        let mut found_attachment = None;

        for chat in &state.chats {
            // Check if this is the target chat (works for both DMs and group chats)
            let is_target_chat = match &chat.chat_type {
                ChatType::MlsGroup => chat.id == npub,
                ChatType::DirectMessage => chat.has_participant(&npub),
            };

            if is_target_chat {
                // Look for the message in this chat
                if let Some(message) = chat.messages.iter().find(|m| m.id == msg_id) {
                    // Get the first attachment
                    if let Some(attachment) = message.attachments.first() {
                        found_attachment = attachment.img_meta.clone();
                        break;
                    }
                }
            }
        }

        found_attachment.ok_or_else(|| "No image attachment found".to_string())?
    };

    // Generate the Base64 image using the decode_blurhash_to_base64 function
    let base64_image = util::decode_blurhash_to_base64(
        &img_meta.blurhash,
        img_meta.width,
        img_meta.height,
        1.0, // Default punch value
    );

    Ok(base64_image)
}

/// Generic blurhash decoder - converts a blurhash string to a base64 data URL
/// Used by the GIF picker for placeholder backgrounds
#[tauri::command]
fn decode_blurhash(blurhash: String, width: u32, height: u32) -> String {
    util::decode_blurhash_to_base64(&blurhash, width, height, 1.0)
}

#[tauri::command]
async fn download_attachment(npub: String, msg_id: String, attachment_id: String) -> bool {
    let handle = TAURI_APP.get().unwrap();

    // Grab the attachment's metadata by searching through chats
    let attachment = {
        let mut state = STATE.lock().await;

        // Find the message and attachment in chats
        let mut found_attachment = None;
        for chat in &mut state.chats {
            // For group chats, npub is the group_id; for DMs, it's a participant npub
            let is_target_chat = match &chat.chat_type {
                ChatType::MlsGroup => chat.id == npub,
                ChatType::DirectMessage => chat.has_participant(&npub),
            };

            if is_target_chat {
                if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                    if let Some(attachment) = message
                        .attachments
                        .iter_mut()
                        .find(|a| a.id == attachment_id)
                    {
                        // Check that we're not already downloading
                        if attachment.downloading {
                            return false;
                        }

                        // Check if file already exists on disk (downloaded but flag was wrong)
                        let base_directory = if cfg!(target_os = "ios") {
                            tauri::path::BaseDirectory::Document
                        } else {
                            tauri::path::BaseDirectory::Download
                        };

                        if let Ok(vector_dir) = handle.path().resolve("pacto", base_directory) {
                            let file_path = vector_dir
                                .join(format!("{}.{}", &attachment.id, &attachment.extension));
                            if file_path.exists() {
                                // File already exists! Update the state and return success
                                attachment.downloaded = true;
                                attachment.path = file_path.to_string_lossy().to_string();

                                // Emit success event
                                handle
                                    .emit(
                                        "attachment_download_result",
                                        serde_json::json!({
                                            "profile_id": npub,
                                            "msg_id": msg_id,
                                            "id": attachment_id,
                                            "success": true,
                                            "result": file_path.to_string_lossy().to_string()
                                        }),
                                    )
                                    .unwrap();

                                // Also update the database
                                let chat_id_for_db = chat.id().to_string();
                                let msg_id_clone = msg_id.clone();
                                let attachment_id_clone = attachment_id.clone();
                                let path_str = file_path.to_string_lossy().to_string();
                                drop(state); // Release lock before DB call

                                let _ = db::update_attachment_downloaded_status(
                                    handle,
                                    &chat_id_for_db,
                                    &msg_id_clone,
                                    &attachment_id_clone,
                                    true,
                                    &path_str,
                                );

                                return true;
                            }
                        }

                        // Enable the downloading flag to prevent re-calls
                        attachment.downloading = true;
                        found_attachment = Some(attachment.clone());
                        break;
                    }
                }
            }
        }

        if found_attachment.is_none() {
            eprintln!(
                "Attachment not found for download: {} in message {}",
                attachment_id, msg_id
            );
            return false;
        }

        found_attachment.unwrap()
    };

    // Remote-plaintext attachment (empty key/nonce, e.g. a Klipy GIF): never a
    // general-purpose fetch primitive. Rendering one goes through its own
    // allowlisted command (`klipy_fetch_media`); this generic path refuses
    // outright rather than fetching an attacker-supplied URL on the user's
    // behalf.
    if attachment.key.is_empty() || attachment.nonce.is_empty() {
        handle
            .emit(
                "attachment_download_result",
                serde_json::json!({
                    "profile_id": npub,
                    "msg_id": msg_id,
                    "id": attachment_id,
                    "success": false,
                    "result": "This attachment has no decryption key and cannot be downloaded here."
                }),
            )
            .unwrap();
        return false;
    }

    // Begin our download progress events
    handle
        .emit(
            "attachment_download_progress",
            serde_json::json!({
                "id": &attachment.id,
                "progress": 0
            }),
        )
        .unwrap();

    // Download the file - no timeout, allow large downloads to complete
    let encrypted_data = match net::download(&attachment.url, handle, &attachment.id, None).await {
        Ok(data) => data,
        Err(error) => {
            // Handle download error
            let mut state = STATE.lock().await;

            // Find and update the attachment status
            for chat in &mut state.chats {
                let is_target_chat = match &chat.chat_type {
                    ChatType::MlsGroup => chat.id == npub,
                    ChatType::DirectMessage => chat.has_participant(&npub),
                };

                if is_target_chat {
                    if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                        if let Some(attachment) = message
                            .attachments
                            .iter_mut()
                            .find(|a| a.id == attachment_id)
                        {
                            attachment.downloading = false;
                            attachment.downloaded = false;
                            break;
                        }
                    }
                }
            }

            // Emit the error
            handle
                .emit(
                    "attachment_download_result",
                    serde_json::json!({
                        "profile_id": npub,
                        "msg_id": msg_id,
                        "id": attachment_id,
                        "success": false,
                        "result": error
                    }),
                )
                .unwrap();
            return false;
        }
    };

    // Check if we got a reasonable amount of data
    if encrypted_data.len() < 16 {
        eprintln!(
            "Downloaded file too small: {} bytes for attachment {}",
            encrypted_data.len(),
            attachment_id
        );
        let mut state = STATE.lock().await;

        // Find and update the attachment status
        for chat in &mut state.chats {
            let is_target_chat = match &chat.chat_type {
                ChatType::MlsGroup => chat.id == npub,
                ChatType::DirectMessage => chat.has_participant(&npub),
            };

            if is_target_chat {
                if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                    if let Some(attachment) = message
                        .attachments
                        .iter_mut()
                        .find(|a| a.id == attachment_id)
                    {
                        attachment.downloading = false;
                        attachment.downloaded = false;
                        break;
                    }
                }
            }
        }

        // Emit a more helpful error
        let error_msg = format!(
            "Downloaded file too small ({} bytes). URL may be invalid or expired.",
            encrypted_data.len()
        );
        handle
            .emit(
                "attachment_download_result",
                serde_json::json!({
                    "profile_id": npub,
                    "msg_id": msg_id,
                    "id": attachment_id,
                    "success": false,
                    "result": error_msg
                }),
            )
            .unwrap();
        return false;
    }

    // Decrypt and save the file
    let result = decrypt_and_save_attachment(handle, &encrypted_data, &attachment).await;

    // Process the result
    match result {
        Err(error) => {
            // Check if this is a corrupted attachment (decryption failure)
            let is_decryption_error = error.contains("aead") || error.contains("decrypt");

            if is_decryption_error {
                eprintln!(
                    "Decryption failed for attachment {}: corrupted keys/data mismatch",
                    attachment_id
                );
            }

            // Handle decryption/saving error
            let mut state = STATE.lock().await;

            // Find and update the attachment status
            let mut should_remove = false;
            for chat in &mut state.chats {
                let is_target_chat = match &chat.chat_type {
                    ChatType::MlsGroup => chat.id == npub,
                    ChatType::DirectMessage => chat.has_participant(&npub),
                };

                if is_target_chat {
                    if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                        if let Some(attachment) = message
                            .attachments
                            .iter_mut()
                            .find(|a| a.id == attachment_id)
                        {
                            attachment.downloading = false;
                            attachment.downloaded = false;

                            // If it's a decryption error, mark for removal as it's corrupted
                            if is_decryption_error {
                                eprintln!(
                                    "Marking corrupted attachment for removal: {}",
                                    attachment_id
                                );
                                should_remove = true;
                            }
                            break;
                        }
                    }
                }
            }

            // Remove corrupted attachment if needed and save
            if should_remove {
                // Collect chat_id and messages to save
                let save_data: Option<(String, Vec<Message>)> = {
                    let mut result = None;
                    for chat in &mut state.chats {
                        let is_target_chat = match &chat.chat_type {
                            ChatType::MlsGroup => chat.id == npub,
                            ChatType::DirectMessage => chat.has_participant(&npub),
                        };

                        if is_target_chat {
                            let chat_id = chat.id().to_string();

                            if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id)
                            {
                                let original_count = message.attachments.len();
                                message.attachments.retain(|a| a.id != attachment_id);
                                if message.attachments.len() < original_count {
                                    result = Some((chat_id, vec![message.clone()]));
                                }
                                break;
                            }
                        }
                    }
                    result
                };

                // Drop state and save
                drop(state);
                if let Some((chat_id, messages)) = save_data {
                    let _ = save_chat_messages(handle.clone(), &chat_id, &messages).await;
                }
            }

            // Emit the error
            handle
                .emit(
                    "attachment_download_result",
                    serde_json::json!({
                        "profile_id": npub,
                        "msg_id": msg_id,
                        "id": attachment_id,
                        "success": false,
                        "result": if should_remove {
                            "Corrupted attachment removed. Please re-send the file.".to_string()
                        } else {
                            error
                        }
                    }),
                )
                .unwrap();
            return false;
        }
        Ok(hash_file_path) => {
            // Successfully decrypted and saved
            // Extract the hash from the filename (format: {hash}.{extension})
            let file_hash = hash_file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&attachment_id)
                .to_string();

            // Update state with successful download
            {
                let mut state = STATE.lock().await;

                // Find and update the attachment
                for chat in &mut state.chats {
                    let is_target_chat = match &chat.chat_type {
                        ChatType::MlsGroup => chat.id == npub,
                        ChatType::DirectMessage => chat.has_participant(&npub),
                    };

                    if is_target_chat {
                        if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                            if let Some(attachment_index) = message
                                .attachments
                                .iter()
                                .position(|a| a.id == attachment_id)
                            {
                                let attachment = &mut message.attachments[attachment_index];
                                attachment.id = file_hash.clone(); // Update ID from nonce to hash
                                attachment.downloading = false;
                                attachment.downloaded = true;
                                attachment.path = hash_file_path.to_string_lossy().to_string(); // Update to hash-based path
                                break;
                            }
                        }
                    }
                }

                // Emit the finished download with both old and new IDs
                handle
                    .emit(
                        "attachment_download_result",
                        serde_json::json!({
                            "profile_id": npub,
                            "msg_id": msg_id,
                            "old_id": attachment_id,
                            "id": file_hash,
                            "success": true,
                        }),
                    )
                    .unwrap();

                // Persist updated message/attachment metadata to the database
                if let Some(handle) = TAURI_APP.get() {
                    // Find and save only the updated message
                    let updated_chat = state.get_chat(&npub).unwrap();
                    let updated_message = {
                        updated_chat
                            .messages
                            .iter()
                            .find(|m| m.id == msg_id)
                            .cloned()
                    }
                    .unwrap();

                    // Update the frontend state
                    handle
                        .emit(
                            "message_update",
                            serde_json::json!({
                                "old_id": &updated_message.id,
                                "message": updated_message.clone(),
                                "chat_id": updated_chat.id()
                            }),
                        )
                        .unwrap();

                    // Drop the STATE lock before performing async I/O
                    drop(state);

                    let _ = db::save_message(handle.clone(), &npub, &updated_message).await;
                }
            }

            true
        }
    }
}

/// Downloads and decrypts an attachment if it is not already on disk, then opens a
/// native save dialog and copies the plaintext file to the chosen destination.
/// Returns the saved path, or an empty string if the user cancelled the dialog.
#[tauri::command]
async fn save_attachment_as(
    npub: String,
    msg_id: String,
    attachment_id: String,
) -> Result<String, String> {
    let handle = TAURI_APP.get().ok_or("App handle not available")?;

    // Locate the attachment the same way `download_attachment` does.
    let attachment = {
        let state = STATE.lock().await;
        state
            .chats
            .iter()
            .find(|chat| match &chat.chat_type {
                ChatType::MlsGroup => chat.id == npub,
                ChatType::DirectMessage => chat.has_participant(&npub),
            })
            .and_then(|chat| chat.messages.iter().find(|m| m.id == msg_id))
            .and_then(|message| message.attachments.iter().find(|a| a.id == attachment_id))
            .cloned()
    }
    .ok_or_else(|| {
        format!(
            "Attachment not found: {} in message {}",
            attachment_id, msg_id
        )
    })?;

    // Remote-plaintext attachment (empty key/nonce, e.g. a Klipy GIF): nothing
    // to decrypt, and "Save as…" is never offered for these — Klipy's terms
    // forbid retaining its media on disk. Refuse rather than fetch-and-write.
    if attachment.key.is_empty() || attachment.nonce.is_empty() {
        return Err("This attachment has no decryption key and cannot be saved".to_string());
    }

    // Choose the appropriate base directory based on platform (matches `download_attachment`).
    let base_directory = if cfg!(target_os = "ios") {
        tauri::path::BaseDirectory::Document
    } else {
        tauri::path::BaseDirectory::Download
    };
    let vector_dir = handle
        .path()
        .resolve("pacto", base_directory)
        .map_err(|e| format!("Failed to resolve download directory: {}", e))?;
    let expected_path = vector_dir.join(format!("{}.{}", &attachment.id, &attachment.extension));

    // Reuse the already-decrypted file on disk if present; otherwise fetch and decrypt it,
    // reusing the same download + decrypt helpers as `download_attachment`.
    let source_path = if expected_path.exists() {
        expected_path
    } else {
        let encrypted_data = net::download(&attachment.url, handle, &attachment.id, None)
            .await
            .map_err(|e| format!("Failed to download attachment: {}", e))?;

        if encrypted_data.len() < 16 {
            return Err(format!(
                "Downloaded file too small ({} bytes). URL may be invalid or expired.",
                encrypted_data.len()
            ));
        }

        let decrypted_path =
            decrypt_and_save_attachment(handle, &encrypted_data, &attachment).await?;

        // Bring shared state and the DB in sync so the app treats this attachment as downloaded,
        // matching the bookkeeping `download_attachment` performs on success.
        let file_hash = decrypted_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&attachment_id)
            .to_string();
        let updated_message = {
            let mut state = STATE.lock().await;
            let mut updated = None;
            for chat in &mut state.chats {
                let is_target_chat = match &chat.chat_type {
                    ChatType::MlsGroup => chat.id == npub,
                    ChatType::DirectMessage => chat.has_participant(&npub),
                };
                if is_target_chat {
                    if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                        if let Some(att) = message
                            .attachments
                            .iter_mut()
                            .find(|a| a.id == attachment_id)
                        {
                            att.id = file_hash.clone();
                            att.downloading = false;
                            att.downloaded = true;
                            att.path = decrypted_path.to_string_lossy().to_string();
                        }
                        updated = Some(message.clone());
                    }
                    break;
                }
            }
            updated
        };
        if let Some(message) = updated_message {
            handle
                .emit(
                    "message_update",
                    serde_json::json!({
                        "old_id": &message.id,
                        "message": &message,
                        "chat_id": &npub
                    }),
                )
                .ok();
            let _ = db::save_message(handle.clone(), &npub, &message).await;
        }

        decrypted_path
    };

    // Open a native save dialog on the Rust side — the destination path is never
    // trusted from the webview, closing off arbitrary-path writes via IPC.
    use tauri_plugin_dialog::DialogExt;
    let handle_clone = handle.clone();
    let default_name = format!("{}.{}", attachment.id, attachment.extension);
    let dialog_result = tokio::task::spawn_blocking(move || {
        handle_clone
            .dialog()
            .file()
            .set_file_name(&default_name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?;

    let dest = match dialog_result {
        Some(path) => path
            .as_path()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "Invalid destination path".to_string())?,
        None => return Ok(String::new()),
    };

    // Create the destination directory if needed, then copy the plaintext file there.
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination directory: {}", e))?;
        }
    }

    std::fs::copy(&source_path, &dest)
        .map_err(|e| format!("Failed to copy attachment to destination: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

#[derive(serde::Serialize, Clone)]
struct LoginKeyPair {
    public: String,
    private: String,
    /// EVM private key (hex with 0x), derived from Nostr secret. Present for new/imported accounts.
    #[serde(skip_serializing_if = "Option::is_none")]
    evm_private_key: Option<String>,
    /// EVM address (0x + 40 hex chars). Present when evm_private_key is set.
    #[serde(skip_serializing_if = "Option::is_none")]
    evm_address: Option<String>,
}

/// # Debug Hot-Reload State Sync
///
/// This command ONLY compiles in debug builds and provides a fast-path for
/// frontend hot-reloads during development. When the frontend hot-reloads,
/// the backend retains all state, so we can skip the entire login/decrypt
/// flow and just bulk-send the existing state back to the frontend.
///
/// Returns:
/// - `Ok(json)` with full state if backend is already initialized
/// - `Err(...)` if backend is not initialized (frontend should do normal login)
#[cfg(debug_assertions)]
#[tauri::command]
async fn debug_hot_reload_sync() -> Result<serde_json::Value, String> {
    // Check if we have an active Nostr client (meaning we're already logged in)
    let client = get_nostr_client()
        .map_err(|_| "Backend not initialized - perform normal login".to_string())?;

    // Get the current user's public key
    let signer = client
        .signer()
        .await
        .map_err(|e| format!("Signer error: {}", e))?;
    let my_npub = signer
        .get_public_key()
        .await
        .map_err(|e| format!("Public key error: {}", e))?
        .to_bech32()
        .map_err(|e| format!("Bech32 error: {}", e))?;

    // Get the full state
    let state = STATE.lock().await;

    // Verify we have meaningful state (not just an empty initialized state)
    if state.profiles.is_empty() && state.chats.is_empty() {
        return Err("Backend state is empty - perform normal login".to_string());
    }

    // Return the full state for the frontend to hydrate
    println!(
        "[Debug Hot-Reload] Sending cached state to frontend ({} profiles, {} chats)",
        state.profiles.len(),
        state.chats.len()
    );

    Ok(serde_json::json!({
        "success": true,
        "npub": my_npub,
        "profiles": &state.profiles,
        "chats": &state.chats,
        "is_syncing": state.is_syncing,
        "sync_mode": format!("{:?}", state.sync_mode)
    }))
}

/// Build client and profile state after keys are resolved (mnemonic- or nsec-derived).
async fn complete_login_from_keys(keys: Keys) -> Result<LoginKeyPair, String> {
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

    Ok(LoginKeyPair {
        public: npub,
        private: keys.secret_key().to_bech32().map_err(|e| e.to_string())?,
        evm_private_key,
        evm_address,
    })
}

/// Import a new profile from a BIP-39 recovery phrase only (`login` remains nsec for unlock).
#[tauri::command]
async fn login_with_recovery_phrase(mnemonic: String) -> Result<LoginKeyPair, String> {
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
async fn login(import_key: String) -> Result<LoginKeyPair, String> {
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

/// Returns `true` if the client has connected, `false` if it was already connected
#[tauri::command]
async fn connect<R: Runtime>(handle: AppHandle<R>) -> bool {
    let client = get_nostr_client().expect("Nostr client not initialized");

    // Check which relays are already in the pool
    let existing_relays = client.relays().await;

    // Get disabled default relays
    let disabled_defaults = get_disabled_default_relays(&handle)
        .await
        .unwrap_or_default();

    // Add default relays (unless disabled or already present). A debug relay
    // override means "route all traffic here", so seeding the public defaults
    // beside it would put sandbox traffic on production relays.
    let seeded_defaults: &[&str] = if crate::trusted_relays::is_overridden() {
        &[]
    } else {
        DEFAULT_RELAYS
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
                .add_relay(*default_url, RelayOptions::new().reconnect(false))
                .await
            {
                Ok(_) => {
                    println!("[Relay] Added default relay: {}", default_url);
                    add_relay_log(default_url, "info", "Added to relay pool");
                }
                Err(e) => {
                    eprintln!("[Relay] Failed to add default relay {}: {}", default_url, e);
                    add_relay_log(default_url, "error", &format!("Failed to add: {}", e));
                }
            }
        } else {
            add_relay_log(default_url, "info", "Skipped (disabled by user)");
        }
    }

    // Add user's custom relays (if any)
    match get_custom_relays(handle.clone()).await {
        Ok(custom_relays) => {
            for relay in custom_relays {
                if relay.enabled {
                    match client
                        .pool()
                        .add_relay(&relay.url, relay_options_for_mode(&relay.mode))
                        .await
                    {
                        Ok(_) => {
                            println!(
                                "[Relay] Added custom relay: {} (mode: {})",
                                relay.url, relay.mode
                            );
                            add_relay_log(
                                &relay.url,
                                "info",
                                &format!("Added to relay pool (mode: {})", relay.mode),
                            );
                        }
                        Err(e) => {
                            eprintln!("[Relay] Failed to add custom relay {}: {}", relay.url, e);
                            add_relay_log(&relay.url, "error", &format!("Failed to add: {}", e));
                        }
                    }
                }
            }
        }
        Err(e) => eprintln!("[Relay] Failed to load custom relays: {}", e),
    }

    // Connect to all relays in the pool
    client.connect().await;

    // If the account-wide sync deferred a slice waiting on relays (see
    // `defer_sync_slice_for_empty_pool`), this call just populated the pool
    // it was waiting on — retry now instead of leaving it deferred until some unrelated trigger
    // (wake/reconnect) happens to fire `fetch_messages(false)` again.
    if STATE.lock().await.sync_slice_relay_wait {
        let handle_retry = handle.clone();
        tokio::spawn(async move {
            fetch_messages(handle_retry, false, None).await;
        });
    }

    true
}

// Tauri command that uses the crypto module
#[tauri::command]
async fn encrypt<R: Runtime>(
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
                                record_send_outcome(&event, &output);
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
        match regenerate_device_keypackage(true).await {
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
async fn decrypt<R: Runtime>(
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
        match regenerate_device_keypackage(true).await {
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

#[tauri::command]
async fn start_recording() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        // Check if we already have permission
        if !android::permissions::check_audio_permission().unwrap() {
            // This will block until the user responds to the permission dialog
            let granted = android::permissions::request_audio_permission_blocking()?;

            if !granted {
                return Err("Audio permission denied by user".to_string());
            }
        }
    }

    AudioRecorder::global().start()
}

#[tauri::command]
async fn stop_recording() -> Result<Vec<u8>, String> {
    AudioRecorder::global().stop()
}

#[tauri::command]
async fn deep_rescan<R: Runtime>(handle: AppHandle<R>) -> Result<bool, String> {
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
    fetch_messages(handle, false, None).await;

    Ok(true)
}

#[tauri::command]
async fn is_scanning() -> bool {
    let state = STATE.lock().await;
    state.is_syncing
}

#[tauri::command]
async fn logout<R: Runtime>(handle: AppHandle<R>) {
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
fn clear_relay_diagnostics_on_logout() {
    if let Ok(mut failures) = RELAY_FAILURES.write() {
        failures.clear();
    }
    if let Ok(mut logs) = RELAY_LOGS.write() {
        logs.clear();
    }
    if let Ok(mut metrics) = RELAY_METRICS.write() {
        metrics.clear();
    }
    // `state` guard dropped here
}

/// Creates a new Nostr keypair derived from a BIP39 Seed Phrase
#[tauri::command]
async fn create_account() -> Result<LoginKeyPair, String> {
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

/// Sign a 32-byte Ethereum hash (hex string) with the stored EVM key.
/// Returns a 65-byte signature as 0x-prefixed hex (r || s || v) where v is 27 or 28.
#[tauri::command]
async fn sign_evm_hash<R: Runtime>(
    handle: AppHandle<R>,
    hash_hex: String,
) -> Result<String, String> {
    session::heartbeat();
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    // Decode hash (32 bytes).
    let trimmed = hash_hex.trim();
    let s = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if s.len() != 64 {
        return Err("Hash must be 32 bytes (64 hex chars)".to_string());
    }
    let hash_bytes = hex::decode(s).map_err(|e| format!("Invalid hash hex: {}", e))?;
    if hash_bytes.len() != 32 {
        return Err("Hash must be exactly 32 bytes".to_string());
    }

    let evm_private_key =
        evm::evm_accounts::decrypt_active_evm_private_key_plaintext(handle.clone())
            .await
            .map_err(|_| "Failed to resolve EVM signing key".to_string())?;

    let key_hex = evm_private_key
        .trim()
        .strip_prefix("0x")
        .unwrap_or(&evm_private_key);
    let key_bytes = hex::decode(key_hex).map_err(|e| format!("Invalid EVM key hex: {}", e))?;

    use secp256k1::{ecdsa::RecoverableSignature, Message, Secp256k1, SecretKey};

    let sk = SecretKey::from_slice(&key_bytes).map_err(|_| "Invalid EVM secret key".to_string())?;
    let msg = Message::from_digest_slice(&hash_bytes)
        .map_err(|_| "Hash must be a 32-byte message".to_string())?;
    let secp = Secp256k1::new();
    let sig: RecoverableSignature = secp.sign_ecdsa_recoverable(&msg, &sk);

    let (rec_id, compact) = sig.serialize_compact();
    let rec: i32 = rec_id.to_i32();
    if rec != 0 && rec != 1 {
        return Err("Unexpected recovery id".to_string());
    }
    let v: u8 = 27 + (rec as u8); // 27 or 28

    let mut out = [0u8; 65];
    out[..64].copy_from_slice(&compact[..]);
    out[64] = v;

    Ok(format!("0x{}", hex::encode(out)))
}

/// Updates the OS taskbar badge with the count of unread messages
/// Platform feature list structure
#[derive(serde::Serialize, Clone)]
struct PlatformFeatures {
    transcription: bool,
    notification_sounds: bool,
    os: String,
    is_mobile: bool,
    debug_mode: bool,
}

/// Returns a list of platform-specific features available
#[tauri::command]
async fn get_platform_features() -> PlatformFeatures {
    let os = if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };

    let is_mobile = cfg!(target_os = "android") || cfg!(target_os = "ios");

    PlatformFeatures {
        transcription: cfg!(all(not(target_os = "android"), feature = "whisper")),
        notification_sounds: cfg!(desktop),
        os: os.to_string(),
        is_mobile,
        debug_mode: cfg!(debug_assertions),
    }
}

/// Run periodic maintenance tasks to keep memory usage low
/// Called every ~45s from the JS profile sync loop
///
/// Current tasks:
/// - Purge expired notification sound cache (10 min TTL, desktop only)
/// - Cleanup stale in-progress download tracking entries
///
/// Future tasks could include:
/// - Image cache cleanup
/// - Temporary file cleanup
/// - Memory pressure responses
#[tauri::command]
async fn run_maintenance() {
    // Audio: purge expired notification sound cache (desktop only)
    #[cfg(desktop)]
    audio::check_cache_ttl();

    // Cleanup stale download tracking entries
    image_cache::cleanup_stale_downloads().await;
}

/// Restart the app from the Rust side after an updater install.
///
/// Going through `tauri::process::restart` directly (instead of the JS
/// `plugin-process` relaunch API) avoids a known race on macOS where the
/// event loop can exit before the new process is spawned, leaving the app
/// closed after a successful update.
#[cfg(desktop)]
#[tauri::command]
fn relaunch_app(app_handle: AppHandle) {
    app_handle.cleanup_before_exit();
    tauri::process::restart(&app_handle.env());
}

/// Last per-chat counts emitted to the frontend, so `update_unread_counter`
/// can emit only the chats whose count actually changed (R14's single
/// authority, without re-sending every chat on every recompute).
static LAST_UNREAD_COUNTS: std::sync::LazyLock<Mutex<std::collections::HashMap<String, u32>>> =
    std::sync::LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// Guards against scheduling more than one pending debounced recompute at
/// once (KTD9): a burst of MLS messages spawns a single delayed task, not
/// one per message.
static UNREAD_RECOMPUTE_PENDING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Debounce window for the MLS-arrival recompute path. The DM arrival path
/// and explicit actions (mark-as-read, a level change) call
/// `update_unread_counter` directly instead, so they are never delayed by
/// this window (R17's "moves badges in the same interaction").
const UNREAD_RECOMPUTE_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(500);

/// Returns the entries in `current` that differ from `last` (added, or a
/// changed value) plus a zero entry for every id in `last` no longer in
/// `current`. Pure and STATE-independent so the "only changed chats" and
/// "removed chats zero out" contracts are unit-testable without a database
/// or app handle.
fn diff_unread_counts(
    last: &std::collections::HashMap<String, u32>,
    current: &std::collections::HashMap<String, u32>,
) -> std::collections::HashMap<String, u32> {
    let mut changed: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for (chat_id, count) in current {
        if last.get(chat_id) != Some(count) {
            changed.insert(chat_id.clone(), *count);
        }
    }
    for chat_id in last.keys() {
        if !current.contains_key(chat_id) {
            changed.insert(chat_id.clone(), 0);
        }
    }
    changed
}

/// Immediate (non-debounced) recompute: updates the OS dock badge with the
/// total and emits `unread_counts_changed` with only the per-chat entries
/// whose count changed since the last emission. Every explicit caller
/// (mark-as-read, a notification-level change) wants this path; the MLS
/// arrival handler instead goes through `schedule_debounced_unread_recompute`.
#[tauri::command]
async fn update_unread_counter<R: Runtime>(handle: AppHandle<R>) -> u32 {
    // Get the count of unread messages from the state
    let (unread_count, counts_by_chat) = {
        let state = STATE.lock().await;
        let counts_by_chat = state.unread_counts_by_chat();
        let unread_count: u32 = counts_by_chat.values().sum();
        (unread_count, counts_by_chat)
    };

    // Emit only the chats whose count changed (added, removed, or a
    // different value) since the last emission.
    {
        let mut last = LAST_UNREAD_COUNTS.lock().await;
        let changed = diff_unread_counts(&last, &counts_by_chat);
        if !changed.is_empty() {
            let _ = handle.emit("unread_counts_changed", &changed);
        }
        *last = counts_by_chat;
    }

    // Get the main window
    if let Some(window) = handle.get_webview_window("main") {
        if unread_count > 0 {
            // Platform-specific badge/overlay handling
            #[cfg(target_os = "windows")]
            {
                // On Windows, use overlay icon instead of badge
                let icon = tauri::include_image!("./icons/icon_badge_notification.png");
                let _ = window.set_overlay_icon(Some(icon));
            }

            #[cfg(not(any(target_os = "windows", target_os = "ios", target_os = "android")))]
            {
                // On macOS, Linux, etc. use the badge if available
                let _ = window.set_badge_count(Some(unread_count as i64));
            }
        } else {
            // Clear badge/overlay when no unread messages
            #[cfg(target_os = "windows")]
            {
                // Remove the overlay icon on Windows
                let _ = window.set_overlay_icon(None);
            }

            #[cfg(not(any(target_os = "windows", target_os = "ios", target_os = "android")))]
            {
                // Clear the badge on other platforms
                let _ = window.set_badge_count(None);
            }
        }
    }

    unread_count
}

/// Debounced recompute for the MLS arrival path (R18, KTD9): the walk
/// contends with the rumor loop for the same global lock, and squad
/// traffic is far heavier than DM traffic, so a recompute per message would
/// put contention on a hot path. A burst inside the window collapses into
/// one recompute at its end.
fn schedule_debounced_unread_recompute<R: Runtime>(handle: AppHandle<R>) {
    if UNREAD_RECOMPUTE_PENDING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // already scheduled
    }
    tokio::spawn(async move {
        tokio::time::sleep(UNREAD_RECOMPUTE_DEBOUNCE).await;
        UNREAD_RECOMPUTE_PENDING.store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = update_unread_counter(handle).await;
    });
}

/// Full per-chat unread map, for the frontend's single hydrate call (R14) —
/// no `startsWith('npub1')` filter, no client-side counting.
#[tauri::command]
async fn get_unread_counts() -> std::collections::HashMap<String, u32> {
    let state = STATE.lock().await;
    state.unread_counts_by_chat()
}

#[cfg(test)]
mod unread_diff_and_debounce_tests {
    use super::*;
    use std::collections::HashMap;

    fn map(pairs: &[(&str, u32)]) -> HashMap<String, u32> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn diff_reports_only_added_and_changed_entries() {
        let last = map(&[("a", 1), ("b", 2)]);
        let current = map(&[("a", 1), ("b", 3), ("c", 5)]);
        let changed = diff_unread_counts(&last, &current);
        assert_eq!(changed, map(&[("b", 3), ("c", 5)]));
    }

    #[test]
    fn diff_zeroes_out_entries_removed_from_current() {
        let last = map(&[("a", 1), ("b", 2)]);
        let current = map(&[("a", 1)]);
        let changed = diff_unread_counts(&last, &current);
        assert_eq!(changed, map(&[("b", 0)]));
    }

    #[test]
    fn diff_is_empty_when_nothing_changed() {
        let last = map(&[("a", 1), ("b", 2)]);
        let current = map(&[("a", 1), ("b", 2)]);
        assert!(diff_unread_counts(&last, &current).is_empty());
    }

    fn test_handle() -> AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
            .handle()
            .clone()
    }

    #[tokio::test]
    async fn burst_of_calls_collapses_into_one_pending_recompute() {
        UNREAD_RECOMPUTE_PENDING.store(false, std::sync::atomic::Ordering::SeqCst);
        let handle = test_handle();

        schedule_debounced_unread_recompute(handle.clone());
        assert!(UNREAD_RECOMPUTE_PENDING.load(std::sync::atomic::Ordering::SeqCst));

        // A second call while one is already pending must not schedule another.
        schedule_debounced_unread_recompute(handle.clone());
        assert!(UNREAD_RECOMPUTE_PENDING.load(std::sync::atomic::Ordering::SeqCst));

        // Once the debounce window elapses and the recompute runs, the guard clears.
        tokio::time::sleep(UNREAD_RECOMPUTE_DEBOUNCE + std::time::Duration::from_millis(300)).await;
        assert!(!UNREAD_RECOMPUTE_PENDING.load(std::sync::atomic::Ordering::SeqCst));
    }
}

#[cfg(all(not(target_os = "android"), feature = "whisper"))]
#[tauri::command]
async fn transcribe<R: Runtime>(
    handle: AppHandle<R>,
    file_path: String,
    model_name: String,
    translate: bool,
) -> Result<whisper::TranscriptionResult, String> {
    // Convert the file path to a Path
    let path = std::path::Path::new(&file_path);

    // Check if the file exists
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    // Decode and resample to 16kHz for Whisper
    match audio::decode_and_resample(path, 16000) {
        Ok(audio_data) => {
            // Pass the resampled audio to the whisper transcribe function
            match whisper::transcribe(&handle, &model_name, translate, audio_data).await {
                Ok(result) => Ok(result),
                Err(e) => Err(format!("Transcription error: {}", e.to_string())),
            }
        }
        Err(e) => Err(format!("Audio processing error: {}", e.to_string())),
    }
}

#[cfg(any(target_os = "android", not(feature = "whisper")))]
#[tauri::command]
async fn transcribe<R: Runtime>(
    _handle: AppHandle<R>,
    _file_path: String,
    _model_name: String,
    _translate: bool,
) -> Result<String, String> {
    Err("Whisper transcription is not supported on this platform".to_string())
}

#[cfg(all(not(target_os = "android"), feature = "whisper"))]
#[tauri::command]
async fn download_whisper_model<R: Runtime>(
    handle: AppHandle<R>,
    model_name: String,
) -> Result<String, String> {
    // Download (or simply return the cached path of) a Whisper Model
    match whisper::download_whisper_model(&handle, &model_name).await {
        Ok(path) => Ok(path),
        Err(e) => Err(format!("Model Download error: {}", e.to_string())),
    }
}

#[cfg(any(target_os = "android", not(feature = "whisper")))]
#[tauri::command]
async fn download_whisper_model<R: Runtime>(
    _handle: AppHandle<R>,
    _model_name: String,
) -> Result<String, String> {
    Err("Whisper model download is not supported on this platform".to_string())
}

/// Generate a random alphanumeric invite code
fn generate_invite_code() -> String {
    thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect::<String>()
        .to_uppercase()
}

/// Generate or retrieve existing invite code for the current user
#[tauri::command]
async fn get_or_create_invite_code() -> Result<String, String> {
    session::heartbeat();
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?;

    // Check if we already have a stored invite code
    if let Ok(Some(existing_code)) = db::get_sql_setting(handle.clone(), "invite_code".to_string())
    {
        return Ok(existing_code);
    }

    // No local code found, check the network
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Get our public key
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let my_public_key = signer.get_public_key().await.map_err(|e| e.to_string())?;

    // Check if we've already published an invite on the network
    let filter = Filter::new()
        .author(my_public_key)
        .kind(Kind::ApplicationSpecificData)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::D), "vector")
        .limit(100);

    let mut events = client
        .stream_events(filter, std::time::Duration::from_secs(10))
        .await
        .map_err(|e| e.to_string())?;

    // Look for existing invite events
    while let Some(event) = events.next().await {
        if event.content == "vector_invite" {
            // Extract the r tag (invite code)
            if let Some(r_tag) = nostr_tags::find_custom(&event.tags, "r") {
                if let Some(code) = r_tag.content() {
                    // Store it locally
                    db::set_sql_setting(
                        handle.clone(),
                        "invite_code".to_string(),
                        code.to_string(),
                    )
                    .map_err(|e| e.to_string())?;
                    return Ok(code.to_string());
                }
            }
        }
    }

    // No existing invite found anywhere, generate a new one
    let new_code = generate_invite_code();

    // Create and publish the invite event
    let event_builder = EventBuilder::new(Kind::ApplicationSpecificData, "vector_invite")
        .tag(nostr_tags::d_tag(vec!["vector"]))
        .tag(nostr_tags::custom_tag("r", vec![new_code.as_str()]));

    // Build the event
    let event = client
        .sign_event_builder(event_builder)
        .await
        .map_err(|e| e.to_string())?;

    // Send only to trusted relays
    let send_output = client
        .send_event_to(trusted_relays::trusted_relays().iter().cloned(), &event)
        .await
        .map_err(|e| e.to_string())?;
    record_send_outcome(&event, &send_output);

    // Store locally
    db::set_sql_setting(handle.clone(), "invite_code".to_string(), new_code.clone())
        .map_err(|e| e.to_string())?;

    Ok(new_code)
}

/// Accept an invite code from another user (deferred until after encryption setup)
#[tauri::command]
async fn accept_invite_code(invite_code: String) -> Result<String, String> {
    session::heartbeat();
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Validate invite code format (8 alphanumeric characters)
    if invite_code.len() != 8 || !invite_code.chars().all(|c| c.is_alphanumeric()) {
        return Err("Invalid invite code format".to_string());
    }

    // Search for the invite event
    let filter = Filter::new()
        .kind(Kind::ApplicationSpecificData)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::D), "vector")
        .custom_tag(SingleLetterTag::lowercase(Alphabet::R), &invite_code)
        .limit(1);

    // Find the invite event
    let mut events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(10),
        )
        .await
        .map_err(|e| e.to_string())?;

    let invite_event = {
        let mut found: Option<nostr_sdk::Event> = None;
        while let Some(event) = events.next().await {
            if event.content == "vector_invite" {
                found = Some(event);
                break;
            }
        }
        found.ok_or("Invite code not found")?
    };

    // Get the inviter's public key
    let inviter_pubkey = invite_event.pubkey;
    let inviter_npub = inviter_pubkey.to_bech32().map_err(|e| e.to_string())?;

    // Get our public key
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let my_public_key = signer.get_public_key().await.map_err(|e| e.to_string())?;

    // Check if we're trying to accept our own invite
    if inviter_pubkey == my_public_key {
        return Err("Cannot accept your own invite code".to_string());
    }

    // Store the pending invite acceptance (will be broadcast after encryption setup)
    let pending_invite = PendingInviteAcceptance {
        invite_code: invite_code.clone(),
        inviter_pubkey: inviter_pubkey.clone(),
    };

    // Try to set the pending invite, ignore if already set
    let _ = PENDING_INVITE.set(pending_invite);

    // Return the inviter's npub so the frontend can initiate a chat
    Ok(inviter_npub)
}

/// Get storage information for the Vector directory
#[tauri::command]
async fn get_storage_info() -> Result<serde_json::Value, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?;

    // Determine the base directory (Downloads on most platforms, Documents on iOS)
    let base_directory = if cfg!(target_os = "ios") {
        tauri::path::BaseDirectory::Document
    } else {
        tauri::path::BaseDirectory::Download
    };

    // Resolve the pacto directory path
    let vector_dir = handle
        .path()
        .resolve("pacto", base_directory)
        .map_err(|e| format!("Failed to resolve pacto directory: {}", e))?;

    // Check if directory exists
    if !vector_dir.exists() {
        return Ok(serde_json::json!({
            "path": vector_dir.to_string_lossy().to_string(),
            "total_bytes": 0,
            "file_count": 0,
            "type_distribution": {}
        }));
    }

    // Calculate total size and file count
    let mut total_bytes = 0;
    let mut file_count = 0;

    // Track file type distribution by size
    let mut type_distribution = std::collections::HashMap::new();

    // Walk through all files in the directory
    if let Ok(entries) = std::fs::read_dir(&vector_dir) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    let file_size = metadata.len();
                    total_bytes += file_size;
                    file_count += 1;

                    // Get file extension
                    if let Some(extension) = entry.file_name().to_string_lossy().split('.').last() {
                        let extension = extension.to_lowercase();
                        *type_distribution.entry(extension).or_insert(0) += file_size;
                    }
                }
            }
        }
    }

    // Calculate Whisper models size if whisper feature is enabled
    #[cfg(all(not(target_os = "android"), feature = "whisper"))]
    {
        // Calculate total size of downloaded Whisper models
        let mut ai_models_size = 0;
        for model in whisper::MODELS {
            if whisper::is_model_downloaded(&handle, model.name) {
                // Convert MB to bytes (model sizes are in MB)
                ai_models_size += (model.size as u64) * 1024 * 1024;
            }
        }

        if ai_models_size > 0 {
            // Add AI models to type distribution
            *type_distribution
                .entry("ai_models".to_string())
                .or_insert(0) += ai_models_size;
            total_bytes += ai_models_size;
        }
    }

    // Calculate image cache size (avatars, banners)
    // Cache is global (not per-account) for deduplication across accounts
    if let Ok(cache_size) = image_cache::get_cache_size(handle) {
        if cache_size > 0 {
            *type_distribution.entry("cache".to_string()).or_insert(0) += cache_size;
            total_bytes += cache_size;
        }
    }

    // Return storage information with type distribution
    Ok(serde_json::json!({
        "path": vector_dir.to_string_lossy().to_string(),
        "total_bytes": total_bytes,
        "file_count": file_count,
        "total_formatted": format_bytes(total_bytes),
        "type_distribution": type_distribution
    }))
}

/// Clear all downloaded attachments from messages and return freed storage space
#[tauri::command]
async fn clear_storage() -> Result<serde_json::Value, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?;

    // First, get the total storage size before clearing
    let storage_info_before = get_storage_info()
        .await
        .map_err(|e| format!("Failed to get storage info before clearing: {}", e))?;
    let total_bytes_before = storage_info_before["total_bytes"].as_u64().unwrap_or(0);

    // Lock the state to access all chats and messages
    let mut state = STATE.lock().await;

    // Track which chats have been updated to avoid duplicate saves
    let mut updated_chats = std::collections::HashSet::new();

    // Process each chat to clear attachment metadata in messages
    for chat in &mut state.chats {
        let mut messages_to_update = Vec::new();

        // Iterate through all messages in this chat
        for message in &mut chat.messages {
            let mut attachment_updated = false;

            // Iterate through all attachments and reset their properties
            for attachment in &mut message.attachments {
                if attachment.downloaded || !attachment.path.is_empty() {
                    // Delete the file, if it exists
                    if std::fs::exists(&attachment.path).unwrap_or(false) {
                        let _ = std::fs::remove_file(&attachment.path);
                    }
                    // Reset attachment properties
                    attachment.downloaded = false;
                    attachment.downloading = false;
                    attachment.path = String::new();
                    attachment_updated = true;
                }
            }

            // If any attachment was updated, add to messages to update
            if attachment_updated {
                messages_to_update.push(message.clone());
            }
        }

        // If we have messages to update, save them to the database
        if !messages_to_update.is_empty() {
            // Save updated messages to database
            db::save_chat_messages(handle.clone(), chat.id(), &messages_to_update)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to save updated messages for chat {}: {}",
                        chat.id(),
                        e
                    )
                })?;

            // Emit message_update events for each updated message
            for message in &messages_to_update {
                handle
                    .emit(
                        "message_update",
                        serde_json::json!({
                            "old_id": &message.id,
                            "message": message,
                            "chat_id": chat.id()
                        }),
                    )
                    .map_err(|e| {
                        format!(
                            "Failed to emit message_update for chat {}: {}",
                            chat.id(),
                            e
                        )
                    })?;
            }

            updated_chats.insert(chat.id().to_string());
        }
    }

    // Clear all disk caches (images, sounds, etc.) by nuking the cache directory
    let cache_dir = crate::test_sandbox::test_data_dir(handle)?.join("cache");
    if cache_dir.exists() {
        let _ = std::fs::remove_dir_all(&cache_dir);
    }

    // Clear in-memory notification sound cache (desktop only)
    #[cfg(desktop)]
    audio::purge_sound_cache();

    // Clear cached paths from all profiles in state and database
    for profile in &mut state.profiles {
        if !profile.avatar_cached.is_empty() || !profile.banner_cached.is_empty() {
            profile.avatar_cached = String::new();
            profile.banner_cached = String::new();
            db::set_profile(handle.clone(), profile.clone()).await.ok();
        }
    }

    // Get storage info after clearing to calculate freed space
    // Need to drop the state lock first since get_storage_info needs it
    drop(state);
    let storage_info_after = get_storage_info()
        .await
        .map_err(|e| format!("Failed to get storage info after clearing: {}", e))?;
    let total_bytes_after = storage_info_after["total_bytes"].as_u64().unwrap_or(0);

    // Calculate freed space
    let freed_bytes = total_bytes_before.saturating_sub(total_bytes_after);

    // Return the freed storage information
    Ok(serde_json::json!({
        "freed_bytes": freed_bytes,
        "freed_formatted": format_bytes(freed_bytes),
        "updated_chats": updated_chats.len()
    }))
}

/// Get the count of unique users who accepted invites from a given npub
#[tauri::command]
async fn get_invited_users(npub: String) -> Result<u32, String> {
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Convert npub to PublicKey
    let inviter_pubkey = PublicKey::from_bech32(&npub).map_err(|e| e.to_string())?;

    // First, get the inviter's invite code from the trusted relays
    let filter = Filter::new()
        .author(inviter_pubkey)
        .kind(Kind::ApplicationSpecificData)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::D), "vector")
        .limit(100);

    let mut events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(10),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Find the invite event and extract the invite code
    let mut invite_code_opt = None;
    while let Some(event) = events.next().await {
        if event.content == "vector_invite" {
            if let Some(tag) = nostr_tags::find_custom(&event.tags, "r") {
                if let Some(content) = tag.content() {
                    invite_code_opt = Some(content.to_string());
                    break;
                }
            }
        }
    }
    let invite_code = invite_code_opt.ok_or("No invite code found for this user")?;

    // Now fetch all acceptance events for this invite code from the trusted relays
    let acceptance_filter = Filter::new()
        .kind(Kind::ApplicationSpecificData)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::D), invite_code)
        .limit(1000); // Allow fetching many acceptances

    let mut acceptance_events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            acceptance_filter,
            std::time::Duration::from_secs(10),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Filter for acceptance events that reference our inviter and collect unique acceptors
    let mut unique_acceptors = std::collections::HashSet::new();

    while let Some(event) = acceptance_events.next().await {
        if event.content == "vector_invite_accepted" {
            // Check if this acceptance references our inviter
            let references_inviter = event
                .tags
                .iter()
                .any(|tag| nostr_tags::public_key_of(tag) == Some(inviter_pubkey));

            if references_inviter {
                unique_acceptors.insert(event.pubkey);
            }
        }
    }

    Ok(unique_acceptors.len() as u32)
}

// Guy Fawkes Day 2025 - V for Vector Badge (Event Ended)
const FAWKES_DAY_START: u64 = 1762300800; // 2025-11-05 00:00:00 UTC
const FAWKES_DAY_END: u64 = 1762387200; // 2025-11-06 00:00:00 UTC

/// Check if a user has the Guy Fawkes Day badge
/// Verifies they have a valid badge claim event from the November 5, 2025 event
#[tauri::command]
async fn check_fawkes_badge(npub: String) -> Result<bool, String> {
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Convert npub to PublicKey
    let user_pubkey = PublicKey::from_bech32(&npub).map_err(|e| e.to_string())?;

    // Fetch the user's badge claim event
    let filter = Filter::new()
        .author(user_pubkey)
        .kind(Kind::ApplicationSpecificData)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::D), "fawkes_2025")
        .limit(10);

    let mut events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(10),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Check if they have a valid badge claim from the event period
    while let Some(event) = events.next().await {
        if event.content == "fawkes_badge_claimed" {
            let timestamp = event.created_at.as_secs();
            // Verify the timestamp is within the valid event window
            if timestamp >= FAWKES_DAY_START && timestamp < FAWKES_DAY_END {
                return Ok(true);
            }
        }
    }

    Ok(false)
}
// MLS Tauri Commands

/// Regenerate this device's MLS KeyPackage. If `cache` is true, attempt to reuse an existing
/// cached KeyPackage if it exists on the relay; otherwise always generate a fresh one.
/// Load MLS device ID for the current account
#[tauri::command]
async fn load_mls_device_id() -> Result<Option<String>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    match db::load_mls_device_id(&handle).await {
        Ok(Some(id)) => Ok(Some(id)),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Load MLS keypackages for the current account
#[tauri::command]
async fn load_mls_keypackages() -> Result<Vec<serde_json::Value>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    db::load_mls_keypackages(&handle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn regenerate_device_keypackage(cache: bool) -> Result<serde_json::Value, String> {
    // Access handle and client
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Ensure a persistent device_id exists
    let device_id: String = match db::load_mls_device_id(&handle).await {
        Ok(Some(id)) => id,
        _ => {
            let id: String = thread_rng()
                .sample_iter(&Alphanumeric)
                .take(12)
                .map(char::from)
                .collect::<String>()
                .to_lowercase();
            let _ = db::save_mls_device_id(handle.clone(), &id).await;
            id
        }
    };

    // Resolve my pubkey (awaits before any MLS engine is created)
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let my_pubkey = signer.get_public_key().await.map_err(|e| e.to_string())?;
    let owner_pubkey_b32 = my_pubkey.to_bech32().map_err(|e| e.to_string())?;

    // Opening the service runs legacy-store detection before cache lookup. A reset
    // invalidates the private init key behind the previously published KeyPackage,
    // so cached relay state must not short-circuit fresh publication.
    drop(MlsService::new_persistent_for_keypackage_refresh(&handle).map_err(|e| e.to_string())?);
    let force_refresh = mls_store_reset_state::keypackage_refresh_required(&handle)?;
    let cache = cache && !force_refresh;

    // Ensure we're connected to the trusted relay set (needed for both cache verification and publishing)
    for relay_url in trusted_relays::trusted_relays().iter() {
        // Check if relay is in the pool
        if !client.relays().await.contains_key(relay_url) {
            println!(
                "[MLS][KeyPackage] Adding trusted relay to pool: {}",
                relay_url
            );
            client
                .add_relay(relay_url.clone())
                .await
                .map_err(|e| e.to_string())?;
        }

        // Connect with timeout if not already connected
        match client.relay(relay_url.clone()).await {
            Ok(relay_instance) => {
                if !relay_instance.is_connected() {
                    println!(
                        "[MLS][KeyPackage] Connecting to trusted relay: {}",
                        relay_url
                    );
                    let _ = client.connect_relay(relay_url.clone()).await;
                    // Give it time to connect
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                }
            }
            Err(_) => {
                // Relay not in pool, add and connect
                println!(
                    "[MLS][KeyPackage] Adding and connecting to trusted relay: {}",
                    relay_url
                );
                let _ = client.add_relay(relay_url.clone()).await;
                let _ = client.connect_relay(relay_url.clone()).await;
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            }
        }
    }

    // If caching is requested, attempt to load and verify an existing KeyPackage
    if cache {
        // Load existing keypackage index and verify it exists on relay before returning cached
        let cached_kp_ref: Option<String> = {
            let index = db::load_mls_keypackages(&handle).await.unwrap_or_default();

            index
                .iter()
                .find(|entry| {
                    entry.get("owner_pubkey").and_then(|v| v.as_str())
                        == Some(owner_pubkey_b32.as_str())
                        && entry.get("device_id").and_then(|v| v.as_str())
                            == Some(device_id.as_str())
                })
                .and_then(|existing| {
                    existing
                        .get("keypackage_ref")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
        };

        // If we have a cached reference, verify it exists on the relay
        if let Some(ref_id) = cached_kp_ref {
            println!(
                "[MLS][KeyPackage] Found cached reference {}, verifying on relay...",
                ref_id
            );

            // Try to fetch the event from the relay to verify it exists
            if let Ok(event_id) = nostr_sdk::EventId::from_hex(&ref_id) {
                let filter = Filter::new()
                    .id(event_id)
                    .kind(Kind::MlsKeyPackage)
                    .limit(1);

                match client
                    .stream_events_from(
                        trusted_relays::trusted_relays().to_vec(),
                        filter,
                        std::time::Duration::from_secs(5),
                    )
                    .await
                {
                    Ok(mut events) => {
                        // Check if we got any events - if so, the cached KeyPackage exists on relay
                        if events.next().await.is_some() {
                            return Ok(serde_json::json!({
                                "device_id": device_id,
                                "owner_pubkey": owner_pubkey_b32,
                                "keypackage_ref": ref_id,
                                "cached": true
                            }));
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Create device KeyPackage using persistent MLS engine inside a no-await scope
    let kp_data = {
        let mls_service = MlsService::new_persistent_for_keypackage_refresh(&handle)
            .map_err(|e| e.to_string())?;
        let engine = mls_service.engine().map_err(|e| e.to_string())?;
        let relay_urls: Vec<nostr_sdk::RelayUrl> = trusted_relays::trusted_relays().to_vec();
        engine
            .create_key_package_for_event(&my_pubkey, relay_urls)
            .map_err(|e| e.to_string())?
    }; // engine and mls_service dropped here before any await

    // Build and sign event with nostr client
    let kp_event = client
        // `Kind::MlsKeyPackage` is 443, so the tag set without the `d` tag is the right one.
        .sign_event_builder(
            EventBuilder::new(Kind::MlsKeyPackage, kp_data.content).tags(kp_data.tags_443),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Publish to the trusted relay set
    let send_output = client
        .send_event_to(trusted_relays::trusted_relays().iter().cloned(), &kp_event)
        .await
        .map_err(|e| e.to_string())?;
    record_send_outcome(&kp_event, &send_output);

    // Upsert into mls_keypackage_index
    {
        let mut index = db::load_mls_keypackages(&handle).await.unwrap_or_default();
        index.retain(|entry| {
            entry.get("owner_pubkey").and_then(|value| value.as_str())
                != Some(owner_pubkey_b32.as_str())
                || entry.get("device_id").and_then(|value| value.as_str())
                    != Some(device_id.as_str())
        });
        let now = Timestamp::now().as_secs();
        index.push(serde_json::json!({
            "owner_pubkey": owner_pubkey_b32,
            "device_id": device_id,
            "keypackage_ref": kp_event.id.to_hex(),
            "fetched_at": now,
            "expires_at": 0u64
        }));
        let _ = db::save_mls_keypackages(handle.clone(), &index).await;
    }

    if force_refresh {
        mls_store_reset_state::mark_keypackage_refreshed(&handle)?;
    }
    if let Err(e) = replay_reset_pending_welcomes(&handle).await {
        // Keep the durable wrapper-id queue for the next login when a relay or
        // the MLS engine is temporarily unavailable.
        eprintln!(
            "[MLS] Pending welcome replay after store reset deferred: {}",
            e
        );
    }

    Ok(serde_json::json!({
        "device_id": device_id,
        "owner_pubkey": owner_pubkey_b32,
        "keypackage_ref": kp_event.id.to_hex(),
        "cached": false
    }))
}

/// Re-fetch pending pre-reset welcomes by id. Forward sync is time-windowed,
/// so clearing `discarded_giftwraps` alone cannot recover an old invitation.
async fn replay_reset_pending_welcomes<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let ids = mls_store_reset_state::pending_wrapper_ids(handle)?;
    if ids.is_empty() {
        return Ok(());
    }

    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;
    let mut remaining = Vec::new();
    for wrapper_id in ids {
        let Ok(event_id) = EventId::from_hex(&wrapper_id) else {
            eprintln!(
                "[MLS] Dropping malformed reset welcome wrapper id: {}",
                wrapper_id
            );
            continue;
        };
        let filter = Filter::new().id(event_id).kind(Kind::GiftWrap).limit(1);
        let event = match client
            .stream_events_from(
                trusted_relays::trusted_relays().to_vec(),
                filter,
                std::time::Duration::from_secs(10),
            )
            .await
        {
            Ok(mut events) => events.next().await,
            Err(e) => {
                eprintln!(
                    "[MLS] Exact welcome re-fetch failed for {}: {}",
                    wrapper_id, e
                );
                None
            }
        };

        let Some(event) = event else {
            remaining.push(wrapper_id);
            continue;
        };
        let _ = handle_event_guarded(event, true).await;
        if !db::wrapper_event_exists(handle, &wrapper_id)
            .await
            .unwrap_or(false)
        {
            remaining.push(wrapper_id);
        }
    }
    mls_store_reset_state::retain_pending_wrapper_ids(handle, &remaining)
}

/// Create a new MLS group with initial member devices
#[tauri::command]
async fn create_mls_group(
    name: String,
    avatar_ref: Option<String>,
    initial_member_devices: Vec<(String, String)>,
) -> Result<String, String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Use tokio::task::spawn_blocking to run the non-Send MlsService in a blocking context
    tokio::task::spawn_blocking(move || {
        // Get handle in blocking context
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();

        // Use tokio runtime to run async code from blocking context
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.create_group(&name, avatar_ref.as_deref(), &initial_member_devices)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Create an MLS group from a group name + member npubs (multi-device aware)
/// - Validates non-empty group name (channel name; squad display name is a separate
///   field validated in `squad_catalog::upsert_squad`) and at least one member
/// - For each member npub, refreshes their latest device keypackage(s)
/// - If any member fails refresh or has zero keypackages, aborts with a clear error
/// - Creates the MLS group and persists metadata so it's immediately discoverable
///
/// Note on device selection policy:
/// - refresh_keypackages_for_contact(npub) returns Vec<(device_id, keypackage_ref)>
/// - For now we choose the first returned device as the member's device to add
///   This can be evolved to pick "newest" by fetched_at if exposed; UI can later allow device selection.
///
/// Frontend will invoke this command via: invoke('create_group_chat', { groupName, memberIds })
#[tauri::command]
async fn create_group_chat(group_name: String, member_ids: Vec<String>) -> Result<String, String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Input validation
    /*
    Error mapping for UI (Create Group)
    - "Group name must not be empty": validation error. Frontend disables Create until non-empty; if surfaced, show inline status.
    - "Select at least one member to create a group": validation error. Frontend disables Create until at least one contact is selected; if surfaced, show inline status.
    - "Failed to refresh device keypackage for {npub}: {error}": hard failure for a specific member during preflight refresh. Abort creation and show this exact string in popup/toast and inline status.
    - Members with zero device keypackages after refresh are skipped (they are not added to the group). If *all* selected members are missing keypackages, creation aborts with:
      "No device keypackages found for any selected member: [npub1..., npub1...]".
    - Any error bubbled from create_mls_group(...): engine/storage/network issues are propagated as user-facing strings. Surface them verbatim in the UI.

    Success path
    - Returns group_id (wire id used for relay 'h' tag filtering).
    - Backend also emits "mls_group_initial_sync" so the list view updates without restart.
    */
    let name = group_name.trim();
    if name.is_empty() {
        return Err("Group name must not be empty".to_string());
    }
    if name.len() > crate::app_config::CHANNEL_NAME_MAX_LENGTH {
        return Err(format!(
            "Channel name must be at most {} characters",
            crate::app_config::CHANNEL_NAME_MAX_LENGTH
        ));
    }
    if member_ids.is_empty() {
        return Err("Select at least one member to create a group".to_string());
    }

    // For each member id (npub), refresh keypackages and pick one device to add
    let mut initial_member_devices: Vec<(String, String)> = Vec::with_capacity(member_ids.len());
    let mut skipped_missing_keypackages: Vec<String> = Vec::new();

    for npub in member_ids {
        // Attempt to refresh and fetch device keypackages for this contact
        // If this fails for any reason, abort group creation with actionable error text
        let devices = refresh_keypackages_for_contact(npub.clone())
            .await
            .map_err(|e| format!("Failed to refresh device keypackage for {}: {}", npub, e))?;

        // Choose a device. Currently: first entry. Future: prefer newest by fetched_at if available.
        let maybe_first = devices.into_iter().next();
        if let Some((device_id, _kp_ref)) = maybe_first {
            // Shape required by create_mls_group: (member_npub, device_id)
            initial_member_devices.push((npub, device_id));
        } else {
            // No keypackages for this member → skip them but keep going
            eprintln!(
                "[MLS][create_group_chat] Skipping member with no device keypackages: {}",
                npub
            );
            skipped_missing_keypackages.push(npub);
        }
    }

    // If everyone was skipped, abort with a clear error
    if initial_member_devices.is_empty() {
        let list = if skipped_missing_keypackages.is_empty() {
            "none".to_string()
        } else {
            format!("[{}]", skipped_missing_keypackages.join(", "))
        };
        return Err(format!(
            "No device keypackages found for any selected member: {}",
            list
        ));
    }

    // Log any partially skipped members for troubleshooting
    if !skipped_missing_keypackages.is_empty() {
        eprintln!(
            "[MLS][create_group_chat] Proceeding without members missing keypackages: [{}]",
            skipped_missing_keypackages.join(", ")
        );
    }

    // Delegate to existing helper that persists metadata, publishes welcomes and emits UI events
    // avatar_ref: None for now (out of scope for this subtask)
    let result = create_mls_group(name.to_string(), None, initial_member_devices).await;

    if result.is_ok() {
        tokio::spawn(async {
            if let Err(err) = regenerate_device_keypackage(false).await {
                eprintln!(
                    "[MLS] Failed to regenerate device KeyPackage after group creation: {}",
                    err
                );
            }
        });
    }

    result
}

/// Add a member device to an MLS group
#[tauri::command]
async fn add_mls_member_device(
    group_id: String,
    member_npub: String,
    device_id: String,
) -> Result<(), String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Run non-Send MLS engine work on a blocking thread; drive async via current runtime
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.add_member_device(&group_id, &member_npub, &device_id)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Invite a new member to an existing MLS group
/// Similar to create_group_chat, this refreshes the member's keypackages and adds them to the group
#[tauri::command]
async fn invite_member_to_group(group_id: String, member_npub: String) -> Result<(), String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Refresh keypackages for the new member
    let devices = refresh_keypackages_for_contact(member_npub.clone())
        .await
        .map_err(|e| {
            format!(
                "Failed to refresh device keypackage for {}: {}",
                member_npub, e
            )
        })?;

    // Choose the first device (same policy as group creation)
    let (device_id, _kp_ref) = devices
        .into_iter()
        .next()
        .ok_or_else(|| format!("No device keypackages found for {}", member_npub))?;

    // Run non-Send MLS engine work on a blocking thread
    let group_id_clone = group_id.clone();
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.add_member_device(&group_id_clone, &member_npub, &device_id)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Sync participants array after adding member
    sync_mls_group_participants(group_id).await?;

    Ok(())
}

/// Remove a member device from an MLS group
#[tauri::command]
async fn remove_mls_member_device(
    group_id: String,
    member_npub: String,
    device_id: String,
) -> Result<(), String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Run non-Send MLS engine work on a blocking thread; drive async via current runtime
    let group_id_clone = group_id.clone();
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.remove_member_device(&group_id_clone, &member_npub, &device_id)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Sync participants array after removing member
    sync_mls_group_participants(group_id).await?;

    Ok(())
}

/// Sync MLS groups with the network
/// If group_id is provided, sync only that group
/// If None, sync all groups (placeholder for now)
#[tauri::command]
async fn sync_mls_groups_now(group_id: Option<String>) -> Result<(u32, u32), String> {
    session::heartbeat();
    // Run non-Send MLS engine work on blocking thread; drive async via current runtime
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;

            if let Some(id) = group_id {
                // Sync specific group since last cursor
                mls.sync_group_since_cursor(&id)
                    .await
                    .map_err(|e| e.to_string())
            } else {
                // Multi-group sync: load MLS groups from SQL and sync each
                let group_ids: Vec<String> = match db::load_mls_groups(&handle).await {
                    Ok(groups) => {
                        groups
                            .into_iter()
                            .filter(|g| !g.evicted) // Skip evicted groups
                            .map(|g| g.group_id)
                            .collect()
                    }
                    Err(e) => {
                        eprintln!("Failed to load MLS groups: {}", e);
                        Vec::new()
                    }
                };

                let mut total_processed: u32 = 0;
                let mut total_new: u32 = 0;

                for gid in group_ids {
                    match mls.sync_group_since_cursor(&gid).await {
                        Ok((processed, new_msgs)) => {
                            total_processed = total_processed.saturating_add(processed);
                            total_new = total_new.saturating_add(new_msgs);
                        }
                        Err(e) => {
                            eprintln!("[MLS] sync_group_since_cursor failed for {}: {}", gid, e);
                        }
                    }

                    // Sync participants array to ensure it matches actual group members
                    if let Err(e) = sync_mls_group_participants(gid.clone()).await {
                        eprintln!("[MLS] Failed to sync participants for group {}: {}", gid, e);
                    }
                }

                Ok((total_processed, total_new))
            }
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Simplified representation of a pending MLS Welcome for UI
#[derive(serde::Serialize)]
struct SimpleWelcome {
    // Welcome event id (rumor id) hex
    id: String,
    // Wrapper id carrying the welcome (giftwrap id) hex
    wrapper_event_id: String,
    // Group metadata
    nostr_group_id: String,
    group_name: String,
    group_description: Option<String>,
    group_image_url: Option<String>,
    // Admins (npub strings if possible are not available here; expose hex pubkeys)
    group_admin_pubkeys: Vec<String>,
    // Relay URLs
    group_relays: Vec<String>,
    // Welcomer (hex)
    welcomer: String,
    member_count: u32,
}

/// Shared flow: get pending welcome for channel_group_id, accept it, emit `channel_added_to_squad`.
fn spawn_accept_channel_welcome_and_emit(
    announcements_group_id: String,
    channel_group_id: String,
    channel_name: String,
) {
    tokio::spawn(async move {
        for _ in 0..10 {
            let handle = match TAURI_APP.get() {
                Some(h) => h.clone(),
                None => break,
            };
            let cid = channel_group_id.clone();
            let welcome_id = tokio::task::spawn_blocking(move || {
                get_pending_welcome_id_for_group_sync(&handle, &cid)
            })
            .await
            .ok()
            .and_then(|o| o);
            if let Some(wid) = welcome_id {
                let handle = match TAURI_APP.get() {
                    Some(h) => h.clone(),
                    None => break,
                };
                let accepted = tokio::task::spawn_blocking(move || {
                    let rt = tokio::runtime::Handle::current();
                    rt.block_on(do_accept_mls_welcome(handle, wid))
                })
                .await
                .ok()
                .and_then(|r| r.ok())
                .unwrap_or(false);
                if accepted {
                    if let Some(app) = TAURI_APP.get() {
                        let payload = serde_json::json!({
                            "announcements_group_id": announcements_group_id,
                            "channel_group_id": channel_group_id,
                            "channel_name": channel_name,
                        });
                        let _ = app.emit("channel_added_to_squad", payload);
                    }
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}

/// Parse DM content as channel_in_squad payload; returns (announcements_group_id, channel_group_id, channel_name) if valid.
fn parse_channel_in_squad_dm(content: &str) -> Option<(String, String, String)> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    let obj = v.as_object()?;
    if obj.get("type").and_then(|t| t.as_str()) != Some("channel_in_squad") {
        return None;
    }
    let announcements = obj.get("announcementsGroupId").and_then(|s| s.as_str())?;
    let channel = obj.get("channelGroupId").and_then(|s| s.as_str())?;
    let name = obj.get("channelName").and_then(|s| s.as_str())?;
    Some((
        announcements.to_string(),
        channel.to_string(),
        name.to_string(),
    ))
}

/// Get the welcome event id (hex) for a pending MLS welcome that matches the given channel group id.
/// Must be called from a blocking context (uses MLS engine).
fn get_pending_welcome_id_for_group_sync<R: Runtime>(
    handle: &AppHandle<R>,
    channel_group_id: &str,
) -> Option<String> {
    let mls = MlsService::new_persistent(handle).ok()?;
    let engine = mls.engine().ok()?;
    let pending = engine.get_pending_welcomes(None).ok()?;
    let cid_lower = channel_group_id.to_lowercase();
    let w = pending
        .into_iter()
        .find(|w| hex::encode(&w.nostr_group_id).to_lowercase() == cid_lower)?;
    Some(w.id.to_hex())
}

/// List pending MLS welcomes (invites)
#[tauri::command]
async fn list_pending_mls_welcomes() -> Result<Vec<SimpleWelcome>, String> {
    // Run non-Send MLS engine work on blocking thread; drive async via current runtime
    let welcomes: Vec<SimpleWelcome> = tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            let engine = mls.engine().map_err(|e| e.to_string())?;

            let pending = engine
                .get_pending_welcomes(None)
                .map_err(|e| e.to_string())?;

            let mut out: Vec<SimpleWelcome> = Vec::with_capacity(pending.len());
            for w in pending {
                out.push(SimpleWelcome {
                    id: w.id.to_hex(),
                    wrapper_event_id: w.wrapper_event_id.to_hex(),
                    nostr_group_id: hex::encode(w.nostr_group_id),
                    group_name: w.group_name.clone(),
                    group_description: Some(w.group_description.clone()),
                    group_image_url: None, // MDK uses group_image_hash/key/nonce instead of URL
                    group_admin_pubkeys: w
                        .group_admin_pubkeys
                        .iter()
                        .filter_map(|pk| pk.to_bech32().ok())
                        .collect(),
                    group_relays: w.group_relays.iter().map(|r| r.to_string()).collect(),
                    welcomer: w.welcomer.to_bech32().map_err(|e| e.to_string())?,
                    member_count: w.member_count,
                });
            }

            Ok::<Vec<SimpleWelcome>, String>(out)
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Send notifications for new welcomes (outside blocking task)
    // Only notify for welcomes we haven't notified about before
    for welcome in &welcomes {
        if let Some(handle) = TAURI_APP.get() {
            // DB-backed dedup (R13): a `welcome`-kind entry already existing
            // for this wrapper_event_id means already notified, and it holds
            // across a restart because the row is in SQLite, not process memory.
            let is_new = crate::catch_up::record_welcome_for_handle(
                handle,
                &welcome.nostr_group_id,
                &welcome.wrapper_event_id,
            )
            .await;
            if !is_new {
                continue;
            }

            // Get inviter's display name
            let inviter_name = {
                let state = STATE.lock().await;
                if let Some(profile) = state.get_profile(&welcome.welcomer) {
                    if !profile.nickname.is_empty() {
                        profile.nickname.clone()
                    } else if !profile.name.is_empty() {
                        profile.name.clone()
                    } else {
                        "Someone".to_string()
                    }
                } else {
                    "Someone".to_string()
                }
            };

            // No chat exists yet for a not-yet-accepted welcome, so there is
            // no per-chat level to read; default (Mentions) always
            // interrupts for an ActionPrompt, matching the prior
            // unconditional-notify behavior. Keyed by wrapper_event_id
            // rather than a chat id — each invite is distinct, so
            // per-chat coalescing does not apply here.
            let single = notification::SingleEventNotification {
                title: format!("Group Invite: {}", welcome.group_name),
                body: format!("Invited by {}", inviter_name),
            };
            notification::emit(
                handle,
                notification::EventKind::ActionPrompt,
                NotificationLevel::default(),
                false,
                false,
                &welcome.wrapper_event_id,
                &welcome.group_name,
                single,
            )
            .await;
        }
    }

    Ok(welcomes)
}

/// Core logic for accepting an MLS welcome. Used by the tauri command and by channel-in-squad auto-accept.
/// Must be run from a blocking context (e.g. rt.block_on) because it uses the MLS engine.
async fn do_accept_mls_welcome<R: Runtime>(
    handle: AppHandle<R>,
    welcome_event_id_hex: String,
) -> Result<bool, String> {
    let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;

    let (nostr_group_id, engine_group_id, group_name, welcomer_hex, wrapper_event_id_hex) = {
        let engine = mls.engine().map_err(|e| e.to_string())?;
        let id = nostr_sdk::EventId::from_hex(&welcome_event_id_hex).map_err(|e| e.to_string())?;
        let welcome_opt = engine.get_welcome(&id).map_err(|e| e.to_string())?;
        let welcome = welcome_opt.ok_or_else(|| "Welcome not found".to_string())?;
        let nostr_group_id_bytes = welcome.nostr_group_id.clone();
        let group_name = welcome.group_name.clone();
        let welcomer_hex = welcome.welcomer.to_hex();
        let wrapper_event_id_hex = welcome.wrapper_event_id.to_hex();
        engine.accept_welcome(&welcome).map_err(|e| e.to_string())?;
        let nostr_group_id = hex::encode(&nostr_group_id_bytes);
        let engine_group_id = {
            let groups = engine
                .get_groups()
                .map_err(|e| format!("Failed to get groups after accepting welcome: {}", e))?;
            let matching_group = groups
                .iter()
                .find(|g| hex::encode(&g.nostr_group_id) == nostr_group_id);
            if let Some(group) = matching_group {
                hex::encode(group.mls_group_id.as_slice())
            } else {
                nostr_group_id.clone()
            }
        };
        (
            nostr_group_id,
            engine_group_id,
            group_name,
            welcomer_hex,
            wrapper_event_id_hex,
        )
    };

    let mut groups = mls.read_groups().await.map_err(|e| e.to_string())?;
    let existing_index = groups.iter().position(|g| g.group_id == nostr_group_id);

    if let Some(idx) = existing_index {
        if groups[idx].evicted {
            groups[idx].evicted = false;
            groups[idx].updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_secs();
            crate::db::save_mls_group(handle.clone(), &groups[idx])
                .await
                .map_err(|e| e.to_string())?;
            mls::emit_group_metadata_event(&groups[idx]);
        }
    } else {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let metadata = mls::MlsGroupMetadata {
            group_id: nostr_group_id.clone(),
            engine_group_id: engine_group_id.clone(),
            creator_pubkey: welcomer_hex,
            name: group_name,
            avatar_ref: None,
            created_at: now_secs,
            updated_at: now_secs,
            evicted: false,
        };
        crate::db::save_mls_group(handle.clone(), &metadata)
            .await
            .map_err(|e| e.to_string())?;
        mls::emit_group_metadata_event(&metadata);
        let mut state = STATE.lock().await;
        let chat_id = state.create_or_get_mls_group_chat(&nostr_group_id, vec![]);
        if let Some(chat) = state.get_chat_mut(&chat_id) {
            chat.metadata.set_name(metadata.name.clone());
        }
        if let Some(chat) = state.get_chat(&chat_id) {
            let _ = db::save_chat(handle.clone(), chat).await;
        }
    }

    crate::catch_up::resolve_welcome_for_handle(&handle, &wrapper_event_id_hex).await;
    mls_store_reset_state::mark_group_restored(&handle, &nostr_group_id)?;
    mls_store_reset_state::emit_reset_state(&handle)?;

    if let Some(app) = TAURI_APP.get() {
        let _ = app.emit(
            "mls_welcome_accepted",
            serde_json::json!({
                "welcome_event_id": welcome_event_id_hex,
                "group_id": nostr_group_id
            }),
        );
    }

    if let Err(e) = sync_mls_group_participants(nostr_group_id.clone()).await {
        eprintln!(
            "[MLS] Failed to sync participants after welcome accept: {}",
            e
        );
    }

    if let Err(e) = mls.sync_group_since_cursor(&nostr_group_id).await {
        eprintln!(
            "[MLS] Post-accept initial sync failed for group {}: {}",
            nostr_group_id, e
        );
    } else if let Some(app) = TAURI_APP.get() {
        let _ = app.emit(
            "mls_group_initial_sync",
            serde_json::json!({ "group_id": nostr_group_id }),
        );
    }

    Ok(true)
}

/// Accept an MLS welcome by its welcome (rumor) event id hex
#[tauri::command]
async fn accept_mls_welcome(welcome_event_id_hex: String) -> Result<bool, String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    let accepted = tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(do_accept_mls_welcome(handle, welcome_event_id_hex))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    if accepted {
        tokio::spawn(async {
            if let Err(err) = regenerate_device_keypackage(false).await {
                eprintln!(
                    "[MLS] Failed to regenerate device KeyPackage after accepting welcome: {}",
                    err
                );
            }
        });
    }

    Ok(accepted)
}

#[tauri::command]
async fn list_mls_groups() -> Result<Vec<String>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    match db::load_mls_groups(&handle).await {
        Ok(groups) => {
            let ids = groups.into_iter().map(|g| g.group_id).collect();
            Ok(ids)
        }
        Err(e) => Err(format!("Failed to load MLS groups: {}", e)),
    }
}

#[tauri::command]
async fn get_mls_group_metadata() -> Result<Vec<serde_json::Value>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    let groups = db::load_mls_groups(&handle)
        .await
        .map_err(|e| format!("Failed to load MLS group metadata: {}", e))?;

    Ok(groups
        .iter()
        .filter(|meta| !meta.evicted)
        .map(|meta| mls::metadata_to_frontend(meta))
        .collect())
}

#[tauri::command]
fn get_mls_store_reset_state() -> Result<Vec<mls_store_reset_state::MlsStoreResetGroupState>, String>
{
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?;
    mls_store_reset_state::reset_group_states(handle)
}

#[derive(serde::Serialize, Clone)]
struct GroupMembers {
    group_id: String,
    members: Vec<String>, // npubs
    admins: Vec<String>,  // admin npubs
}

/// Sync the participants array for an MLS group chat with the actual members from the engine
/// This ensures chat.participants is always up-to-date
pub(crate) async fn sync_mls_group_participants(group_id: String) -> Result<(), String> {
    if let Some(handle) = TAURI_APP.get() {
        if mls_store_reset_state::is_group_state_lost(handle, &group_id)? {
            // The fresh engine has no membership yet. Keep the app DB's former
            // participant list until a welcome restores this group.
            return Ok(());
        }
    }
    // Get actual members from the engine
    let group_members = get_mls_group_members(group_id.clone()).await?;

    // Update the chat's participants array
    let mut state = STATE.lock().await;
    if let Some(chat) = state.get_chat_mut(&group_id) {
        let old_count = chat.participants.len();
        chat.participants = group_members.members.clone();
        let new_count = chat.participants.len();

        if old_count != new_count {
            eprintln!(
                "[MLS] Synced participants for group {}: {} -> {} members",
                &group_id[..8.min(group_id.len())],
                old_count,
                new_count
            );
            if let Some(app) = TAURI_APP.get() {
                let _ = app.emit(
                    "mls_group_updated",
                    serde_json::json!({ "group_id": group_id.clone() }),
                );
            }
        }

        // Save updated chat to disk
        let chat_clone = chat.clone();
        drop(state);

        if let Some(handle) = TAURI_APP.get() {
            if let Err(e) = db::save_chat(handle.clone(), &chat_clone).await {
                eprintln!(
                    "[MLS] Failed to save chat after syncing participants: {}",
                    e
                );
            }
        }
    } else {
        drop(state);
        eprintln!(
            "[MLS] Chat not found when syncing participants: {}",
            group_id
        );
    }

    Ok(())
}

/// Get members (npubs) of an MLS group from the persistent engine (on-demand).
/// When the group is in MLS store-reset "lost" state the fresh engine has no
/// membership — fall back to the preserved chat.participants roster so UI paths
/// like sole-admin recreate can still invite former members.
#[tauri::command]
async fn get_mls_group_members(group_id: String) -> Result<GroupMembers, String> {
    // Run engine operations on a blocking thread so the outer future is Send
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            // Initialise persistent MLS
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            // Map wire-id/engine-id using encrypted metadata
            let meta_groups = mls.read_groups().await.unwrap_or_default();
            let (wire_id, engine_id) = if let Some(m) = meta_groups.iter().find(|g| {
                g.group_id == group_id
                    || (!g.engine_group_id.is_empty() && g.engine_group_id == group_id)
            }) {
                (
                    m.group_id.clone(),
                    if !m.engine_group_id.is_empty() {
                        m.engine_group_id.clone()
                    } else {
                        m.group_id.clone()
                    },
                )
            } else {
                (group_id.clone(), group_id.clone())
            };

            // Acquire non-Send engine; all calls below must be non-await while engine is in scope
            let engine = mls.engine().map_err(|e| e.to_string())?;
            use mdk_core::prelude::GroupId;

            let mut members: Vec<String> = Vec::new();
            let mut admins: Vec<String> = Vec::new();
            if let Ok(gid_bytes) = hex::decode(&engine_id) {
                // Decode engine id to GroupId
                let gid = GroupId::from_slice(&gid_bytes);

                // Get members via engine API
                if let Ok(pk_list) = engine.get_members(&gid) {
                    members = pk_list
                        .into_iter()
                        .filter_map(|pk| pk.to_bech32().ok())
                        .collect();
                }

                // Get admins from the group
                if let Ok(groups) = engine.get_groups() {
                    for g in groups {
                        let gid_hex = hex::encode(g.mls_group_id.as_slice());
                        if gid_hex == engine_id {
                            admins = g
                                .admin_pubkeys
                                .iter()
                                .filter_map(|pk| pk.to_bech32().ok())
                                .collect();
                            break;
                        }
                    }
                }
            }
            drop(engine);

            let lost = mls_store_reset_state::is_group_state_lost(&handle, &wire_id)
                .or_else(|_| mls_store_reset_state::is_group_state_lost(&handle, &group_id))
                .unwrap_or(false);
            if lost && members.is_empty() {
                let preserved = {
                    let state = STATE.lock().await;
                    state
                        .get_chat(&wire_id)
                        .or_else(|| state.get_chat(&group_id))
                        .map(|chat| chat.participants.clone())
                        .unwrap_or_default()
                };
                if !preserved.is_empty() {
                    members = preserved;
                }
                if admins.is_empty() {
                    if let Ok(states) = mls_store_reset_state::reset_group_states(&handle) {
                        if let Some(s) = states
                            .into_iter()
                            .find(|s| s.group_id == wire_id || s.group_id == group_id)
                        {
                            admins = s.admin_npubs;
                        }
                    }
                }
            }

            Ok(GroupMembers {
                group_id: wire_id,
                members,
                admins,
            })
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Leave an MLS group (publishes SelfRemove proposal, then local cleanup).
#[tauri::command]
async fn leave_mls_group(group_id: String) -> Result<(), String> {
    require_key_derivation_version_2()?;
    // Run non-Send MLS engine work on a blocking thread
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.leave_group(&group_id).await.map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

//// Refresh keypackages for a contact from the trusted relay set
//// Fetches Kind::MlsKeyPackage from the contact, updates local index, and returns (device_id, keypackage_ref)
#[tauri::command]
async fn refresh_keypackages_for_contact(npub: String) -> Result<Vec<(String, String)>, String> {
    // Resolve contact pubkey
    let contact_pubkey = PublicKey::from_bech32(&npub).map_err(|e| e.to_string())?;

    // Access client
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Build filter: author(contact) + MlsKeyPackage
    let filter = Filter::new()
        .author(contact_pubkey)
        .kind(Kind::MlsKeyPackage)
        // Only need the newest KeyPackage
        .limit(1);

    // Fetch from the trusted relay set with a short timeout
    let mut events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(10),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Prepare results and index entries
    let owner_pubkey_b32 = contact_pubkey.to_bech32().map_err(|e| e.to_string())?;
    let mut results: Vec<(String, String)> = Vec::new();
    let mut new_entries: Vec<serde_json::Value> = Vec::new();

    while let Some(e) = events.next().await {
        // Use event id as synthetic device_id when not explicitly provided by remote
        let device_id = e.id.to_hex();
        let keypackage_ref = e.id.to_hex();

        results.push((device_id.clone(), keypackage_ref.clone()));

        new_entries.push(serde_json::json!({
            "owner_pubkey": owner_pubkey_b32,
            "device_id": device_id,
            "keypackage_ref": keypackage_ref,
            "fetched_at": Timestamp::now().as_secs(),
            "expires_at": 0u64
        }));
    }

    // Update local plaintext index after network await
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();

    // Load existing index
    let mut index = db::load_mls_keypackages(&handle).await.unwrap_or_default();

    // Remove any existing entries for this owner+device_id to avoid duplicates
    for new_entry in &new_entries {
        let owner = new_entry
            .get("owner_pubkey")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let device = new_entry
            .get("device_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        index.retain(|entry| {
            let same_owner = entry.get("owner_pubkey").and_then(|v| v.as_str()) == Some(owner);
            let same_device = entry.get("device_id").and_then(|v| v.as_str()) == Some(device);
            !(same_owner && same_device)
        });
    }

    // Append new entries and persist
    index.extend(new_entries.into_iter());
    let _ = db::save_mls_keypackages(handle.clone(), &index).await;

    Ok(results)
}

/// Check MLS group health and identify groups that need re-syncing

/// Remove orphaned MLS groups from metadata that are not in engine state

#[tauri::command]
async fn queue_profile_sync(
    npub: String,
    priority: String,
    force_refresh: bool,
) -> Result<(), String> {
    let sync_priority = match priority.as_str() {
        "critical" => profile_sync::SyncPriority::Critical,
        "high" => profile_sync::SyncPriority::High,
        "medium" => profile_sync::SyncPriority::Medium,
        "low" => profile_sync::SyncPriority::Low,
        _ => return Err(format!("Invalid priority: {}", priority)),
    };

    profile_sync::queue_profile_sync(npub, sync_priority, force_refresh).await;
    Ok(())
}

#[tauri::command]
async fn queue_chat_profiles_sync(chat_id: String, is_opening: bool) -> Result<(), String> {
    profile_sync::queue_chat_profiles(chat_id, is_opening).await;
    Ok(())
}

#[tauri::command]
async fn refresh_profile_now(npub: String) -> Result<(), String> {
    profile_sync::refresh_profile_now(npub).await;
    Ok(())
}

#[tauri::command]
async fn sync_all_profiles() -> Result<(), String> {
    profile_sync::sync_all_profiles().await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    operator_env::load_operator_env();

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
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
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
        .plugin(tauri_plugin_deep_link::init());

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
            squad_bot::squad_bot_init,
            squad_bot::squad_bot_get_state,
            squad_bot::squad_bot_add_holder,
            squad_bot::squad_bot_remove_holder,
            squad_bot::squad_bot_rotate_key,
            squad_bot::squad_bot_sync_join_dms,
            squad_bot::squad_bot_send_join_response,
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
            fetch_messages,
            deep_rescan,
            is_scanning,
            get_chat_messages_paginated,
            get_message_views,
            replay_mls_automation_side_effects,
            get_messages_around_id,
            get_chat_message_count,
            delete_dm_chat,
            get_file_hash_index,
            evict_chat_messages,
            generate_blurhash_preview,
            decode_blurhash,
            download_attachment,
            save_attachment_as,
            login,
            login_with_recovery_phrase,
            #[cfg(debug_assertions)]
            debug_hot_reload_sync,
            #[cfg(debug_assertions)]
            dev_login::dev_login,
            notifs,
            get_relays,
            get_media_servers,
            // Custom relay management
            get_custom_relays,
            add_custom_relay,
            remove_custom_relay,
            toggle_custom_relay,
            toggle_default_relay,
            update_relay_mode,
            validate_relay_url_cmd,
            get_relay_metrics,
            get_relay_logs,
            monitor_relay_connections,
            probe_relay,
            get_relay_certificate,
            start_typing,
            connect,
            encrypt,
            decrypt,
            start_recording,
            stop_recording,
            update_unread_counter,
            get_unread_counts,
            logout,
            create_account,
            get_platform_features,
            transcribe,
            download_whisper_model,
            get_or_create_invite_code,
            accept_invite_code,
            get_invited_users,
            check_fawkes_badge,
            get_storage_info,
            clear_storage,
            load_mls_device_id,
            load_mls_keypackages,
            sign_evm_hash,
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
            evm::squad_sponsor_deploy::deploy_squad_sponsor_for_parent,
            evm::squad_sponsor_deploy::deploy_squad_sponsor_hats_for_parent,
            evm::squad_sponsor_deposit::deposit_squad_sponsor,
            evm::squad_sponsor_withdraw::withdraw_squad_sponsor,
            evm::squad_sponsor_withdraw::get_squad_sponsor_withdrawable,
            evm::squad_sponsor_read::get_squad_sponsor_summary,
            evm::sponsor_userop::get_bundler_status,
            evm::sponsor_userop::set_pimlico_api_key,
            evm::sponsor_userop::clear_pimlico_api_key,
            evm::squad_sponsor_ext::get_squad_sponsor_ext_status,
            evm::squad_sponsor_ext::squad_sponsor_set_permitted_address,
            evm::squad_admin_deploy::deploy_squad_admin_for_parent,
            evm::squad_admin_write::squad_admin_create_role,
            evm::squad_admin_write::squad_admin_enable_executor,
            evm::squad_admin_write::squad_admin_enable_full_permission,
            evm::nave_pirata_read::get_nave_pirata_deployment,
            evm::treasury_authority_write::treasury_authority_propose,
            evm::treasury_authority_write::treasury_authority_crew_vote,
            evm::treasury_authority_write::treasury_authority_captain_vote,
            evm::treasury_authority_write::treasury_authority_execute,
            evm::treasury_proposals_read::list_treasury_proposals,
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
            evm::hats_read::get_hats_tree,
            evm::member_governance_read::get_member_hat_wearers,
            evm::member_governance_read::get_squad_admin_executor_roles,
            evm::access_control::get_squad_capabilities,
            regenerate_device_keypackage,
            // MLS core commands
            create_group_chat,
            create_mls_group,
            sync_mls_groups_now,
            list_mls_groups,
            get_mls_group_metadata,
            get_mls_store_reset_state,
            // MLS welcome/invite commands
            list_pending_mls_welcomes,
            accept_mls_welcome,
            // MLS advanced helpers
            add_mls_member_device,
            invite_member_to_group,
            remove_mls_member_device,
            get_mls_group_members,
            leave_mls_group,
            list_group_cursors,
            refresh_keypackages_for_contact,
            // Profile sync commands
            queue_profile_sync,
            queue_chat_profiles_sync,
            refresh_profile_now,
            sync_all_profiles,
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
            run_maintenance,
            relaunch_app,
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
