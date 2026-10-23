use nostr_sdk::prelude::*;
use tauri::Emitter;

use crate::db;
use crate::image_cache::{self, CacheResult};
use crate::message::AttachmentFile;
use crate::nostr_tags;
use crate::{current_login_generation, get_nostr_client, STATE, TAURI_APP};

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub nickname: String,
    pub lud06: String,
    pub lud16: String,
    pub banner: String,
    pub avatar: String,
    pub about: String,
    pub website: String,
    pub nip05: String,
    pub status: Status,
    pub last_updated: u64,
    pub mine: bool,
    /// Local-only: discard incoming DMs from this npub after unwrap (relays still deliver wraps).
    #[serde(default)]
    pub blocked: bool,
    pub bot: bool,
    /// Local cached path for avatar image (for offline support)
    pub avatar_cached: String,
    /// Local cached path for banner image (for offline support)
    pub banner_cached: String,
}

impl Default for Profile {
    fn default() -> Self {
        Self::new()
    }
}

impl Profile {
    pub fn new() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            display_name: String::new(),
            nickname: String::new(),
            lud06: String::new(),
            lud16: String::new(),
            banner: String::new(),
            avatar: String::new(),
            about: String::new(),
            website: String::new(),
            nip05: String::new(),
            status: Status::new(),
            last_updated: 0,
            mine: false,
            blocked: false,
            bot: false,
            avatar_cached: String::new(),
            banner_cached: String::new(),
        }
    }

    /// True when Kind 0 name, display_name, or avatar is present.
    pub fn has_public_metadata(&self) -> bool {
        !self.name.is_empty() || !self.display_name.is_empty() || !self.avatar.is_empty()
    }

    /// Merge Nostr Metadata with this Vector Profile
    ///
    /// Returns `true` if any fields were updated, `false`` otherwise
    pub fn from_metadata(&mut self, meta: Metadata) -> bool {
        let mut changed = false;

        // Name
        if let Some(name) = meta.name {
            if self.name != name {
                self.name = name;
                changed = true;
            }
        }

        // Display Name
        if let Some(name) = meta.display_name {
            if self.display_name != name {
                self.display_name = name;
                changed = true;
            }
        }

        // lud06 (LNURL)
        if let Some(lud06) = meta.lud06 {
            if self.lud06 != lud06 {
                self.lud06 = lud06;
                changed = true;
            }
        }

        // lud16 (Lightning Address)
        if let Some(lud16) = meta.lud16 {
            if self.lud16 != lud16 {
                self.lud16 = lud16;
                changed = true;
            }
        }

        // Banner
        if let Some(banner) = meta.banner {
            if self.banner != banner {
                self.banner = banner;
                self.banner_cached = String::new(); // Clear stale cache when URL changes
                changed = true;
            }
        }

        // Picture (Vector Avatar)
        if let Some(picture) = meta.picture {
            if self.avatar != picture {
                self.avatar = picture;
                self.avatar_cached = String::new(); // Clear stale cache when URL changes
                changed = true;
            }
        }

        // About (Vector Bio)
        if let Some(about) = meta.about {
            if self.about != about {
                self.about = about;
                changed = true;
            }
        }

        // Website
        if let Some(website) = meta.website {
            if self.website != website {
                self.website = website;
                changed = true;
            }
        }

        // NIP-05
        if let Some(nip05) = meta.nip05 {
            if self.nip05 != nip05 {
                self.nip05 = nip05;
                changed = true;
            }
        }

        // Bot (custom metadata field)
        if let Some(custom) = meta.custom.get("bot") {
            // Parse the bot value - it could be a boolean or a string "true"/"false"
            let bot_value = match custom.as_bool() {
                Some(b) => b,
                None => {
                    // Try parsing as string
                    custom
                        .as_str()
                        .map(|s| s.to_lowercase() == "true")
                        .unwrap_or(false)
                }
            };

            if self.bot != bot_value {
                self.bot = bot_value;
                changed = true;
            }
        }

        changed
    }

    /// Apply Kind 0 as a full replacement: absent fields are cleared.
    /// Local-only fields (nickname, blocked, mine, cached paths for unchanged URLs) stay.
    pub fn apply_kind0_replacement(&mut self, meta: &Metadata) -> bool {
        let mut changed = false;

        let name = meta.name.clone().unwrap_or_default();
        if self.name != name {
            self.name = name;
            changed = true;
        }
        let display_name = meta.display_name.clone().unwrap_or_default();
        if self.display_name != display_name {
            self.display_name = display_name;
            changed = true;
        }
        let lud06 = meta.lud06.clone().unwrap_or_default();
        if self.lud06 != lud06 {
            self.lud06 = lud06;
            changed = true;
        }
        let lud16 = meta.lud16.clone().unwrap_or_default();
        if self.lud16 != lud16 {
            self.lud16 = lud16;
            changed = true;
        }
        let banner = meta.banner.clone().unwrap_or_default();
        if self.banner != banner {
            self.banner = banner;
            self.banner_cached.clear();
            changed = true;
        }
        let avatar = meta.picture.clone().unwrap_or_default();
        if self.avatar != avatar {
            self.avatar = avatar;
            self.avatar_cached.clear();
            changed = true;
        }
        let about = meta.about.clone().unwrap_or_default();
        if self.about != about {
            self.about = about;
            changed = true;
        }
        let website = meta.website.clone().unwrap_or_default();
        if self.website != website {
            self.website = website;
            changed = true;
        }
        let nip05 = meta.nip05.clone().unwrap_or_default();
        if self.nip05 != nip05 {
            self.nip05 = nip05;
            changed = true;
        }

        let bot_value = meta.custom.get("bot").map(|custom| {
            custom.as_bool().unwrap_or_else(|| {
                custom
                    .as_str()
                    .map(|s| s.to_lowercase() == "true")
                    .unwrap_or(false)
            })
        });
        let bot = bot_value.unwrap_or(false);
        if self.bot != bot {
            self.bot = bot;
            changed = true;
        }

        changed
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Status {
    pub title: String,
    pub purpose: String,
    pub url: String,
}

impl Status {
    pub fn new() -> Self {
        Self {
            title: String::new(),
            purpose: String::new(),
            url: String::new(),
        }
    }
}

/// Cache profile images (avatar and banner) in the background
///
/// This downloads and caches the avatar/banner images for offline access.
/// Cache is stored globally (not per-account) for deduplication across accounts.
pub async fn cache_profile_images(npub: &str, avatar_url: &str, banner_url: &str) {
    let handle = match TAURI_APP.get() {
        Some(h) => h,
        None => return,
    };

    let mut avatar_cached = String::new();
    let mut banner_cached = String::new();

    // Cache avatar if URL exists
    if !avatar_url.is_empty() {
        match image_cache::cache_avatar(handle, avatar_url).await {
            CacheResult::Cached(path) | CacheResult::AlreadyCached(path) => {
                avatar_cached = path;
            }
            CacheResult::Failed(e) => {
                log::warn!("[Profile] Failed to cache avatar for {}: {}", npub, e);
            }
        }
    }

    // Cache banner if URL exists
    if !banner_url.is_empty() {
        match image_cache::cache_banner(handle, banner_url).await {
            CacheResult::Cached(path) | CacheResult::AlreadyCached(path) => {
                banner_cached = path;
            }
            CacheResult::Failed(e) => {
                log::warn!("[Profile] Failed to cache banner for {}: {}", npub, e);
            }
        }
    }

    // Update the profile with cached paths if we got any
    if !avatar_cached.is_empty() || !banner_cached.is_empty() {
        let mut state = STATE.lock().await;
        if let Some(profile) = state.get_profile_mut(npub) {
            let mut updated = false;

            if !avatar_cached.is_empty() && profile.avatar_cached != avatar_cached {
                profile.avatar_cached = avatar_cached;
                updated = true;
            }

            if !banner_cached.is_empty() && profile.banner_cached != banner_cached {
                profile.banner_cached = banner_cached;
                updated = true;
            }

            if updated {
                // Emit update to frontend with cached paths
                handle.emit("profile_update", &profile).ok();

                // Save to database
                let profile_clone = profile.clone();
                drop(state); // Release lock before async DB operation
                db::set_profile(handle.clone(), profile_clone).await.ok();
            }
        }
    }
}

/// Cache images for all profiles that have avatar/banner URLs but no cached paths
/// Called on startup to populate the cache for existing profiles
/// Cache is stored globally (not per-account) for deduplication across accounts.
pub async fn cache_all_profile_images() {
    let handle = match TAURI_APP.get() {
        Some(h) => h,
        None => return,
    };

    // Get all profiles that need caching
    let profiles_to_cache: Vec<(String, String, String)> = {
        let state = STATE.lock().await;
        state
            .profiles
            .iter()
            .filter(|p| {
                // Cache if has avatar URL but no cached path
                (!p.avatar.is_empty() && p.avatar_cached.is_empty()) ||
                // Or has banner URL but no cached path
                (!p.banner.is_empty() && p.banner_cached.is_empty())
            })
            .map(|p| (p.id.clone(), p.avatar.clone(), p.banner.clone()))
            .collect()
    };

    if profiles_to_cache.is_empty() {
        return;
    }

    log::info!(
        "[Profile] Caching images for {} profiles",
        profiles_to_cache.len()
    );

    // Spawn caching tasks for each profile (they run concurrently with semaphore limiting)
    for (npub, avatar_url, banner_url) in profiles_to_cache {
        let handle = handle.clone();
        tokio::spawn(async move {
            // Cache avatar if needed
            if !avatar_url.is_empty() {
                if let CacheResult::Cached(path) | CacheResult::AlreadyCached(path) =
                    image_cache::cache_avatar(&handle, &avatar_url).await
                {
                    // Update profile
                    let mut state = STATE.lock().await;
                    if let Some(profile) = state.get_profile_mut(&npub) {
                        if profile.avatar_cached.is_empty() {
                            profile.avatar_cached = path;
                            handle.emit("profile_update", &profile).ok();
                            let profile_clone = profile.clone();
                            drop(state);
                            db::set_profile(handle.clone(), profile_clone).await.ok();
                        }
                    }
                }
            }

            // Cache banner if needed
            if !banner_url.is_empty() {
                if let CacheResult::Cached(path) | CacheResult::AlreadyCached(path) =
                    image_cache::cache_banner(&handle, &banner_url).await
                {
                    let mut state = STATE.lock().await;
                    if let Some(profile) = state.get_profile_mut(&npub) {
                        if profile.banner_cached.is_empty() {
                            profile.banner_cached = path;
                            handle.emit("profile_update", &profile).ok();
                            let profile_clone = profile.clone();
                            drop(state);
                            db::set_profile(handle.clone(), profile_clone).await.ok();
                        }
                    }
                }
            }
        });
    }
}

/// One acknowledgement when fewer than two write relays are connected, otherwise two.
pub(crate) fn required_kind0_acks(connected_write_count: usize) -> usize {
    if connected_write_count < 2 {
        1
    } else {
        2
    }
}

fn kind0_echoes_local(meta: &Metadata, name: &str, avatar: &str) -> bool {
    let name_ok = name.is_empty() || meta.name.as_deref() == Some(name);
    let avatar_ok = avatar.is_empty() || meta.picture.as_deref() == Some(avatar);
    name_ok && avatar_ok && (!name.is_empty() || !avatar.is_empty())
}

pub(crate) struct Kind0ScanHit {
    pub created_at: u64,
    pub event_id: String,
    pub metadata: Metadata,
}

/// NIP-01 replacement: newest created_at, then highest event id.
pub(crate) fn nip01_kind0_winner(hits: &[Kind0ScanHit]) -> Option<&Kind0ScanHit> {
    hits.iter()
        .max_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.event_id.cmp(&b.event_id)))
}

pub(crate) fn kind0_verified_quorum_met(verified_count: usize, required: usize) -> bool {
    verified_count >= required
}

const KIND0_REPAIR_SUCCESS_INTERVAL_SECS: u64 = 30 * 60;
const KIND0_REPAIR_FAILURE_BACKOFF_SECS: u64 = 5 * 60;
const KIND0_REPAIR_LAST_SUCCESS_KEY: &str = "kind0_repair_last_success_at";
const KIND0_REPAIR_LAST_FAILURE_KEY: &str = "kind0_repair_last_failure_at";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind0RepairDecision {
    Skip,
    Reconcile,
    Publish,
}

pub(crate) fn decide_kind0_repair(
    session_matches: bool,
    receipt_event_id: Option<&str>,
    winner: Option<&Kind0ScanHit>,
    local_name: &str,
    local_avatar: &str,
    now_secs: u64,
    last_success_at: Option<u64>,
    last_failure_at: Option<u64>,
) -> Kind0RepairDecision {
    if !session_matches {
        return Kind0RepairDecision::Skip;
    }
    if let Some(hit) = winner {
        if !kind0_echoes_local(&hit.metadata, local_name, local_avatar) {
            return Kind0RepairDecision::Reconcile;
        }
        return Kind0RepairDecision::Skip;
    }
    if receipt_event_id.is_none() {
        return Kind0RepairDecision::Skip;
    }
    if last_success_at.is_some_and(|at| now_secs.saturating_sub(at) < KIND0_REPAIR_SUCCESS_INTERVAL_SECS)
    {
        return Kind0RepairDecision::Skip;
    }
    if last_failure_at.is_some_and(|at| now_secs.saturating_sub(at) < KIND0_REPAIR_FAILURE_BACKOFF_SECS)
    {
        return Kind0RepairDecision::Skip;
    }
    Kind0RepairDecision::Publish
}

async fn connected_relay_urls(client: &Client, write: bool) -> Vec<RelayUrl> {
    let relays = client.relays().await;
    relays
        .into_iter()
        .filter(|(_, relay)| {
            relay.status() == RelayStatus::Connected
                && if write {
                    relay.flags().has_write()
                } else {
                    relay.flags().has_read()
                }
        })
        .map(|(url, _)| url)
        .collect()
}

/// One Kind 0 REQ per connected read relay. Newest event with a name or picture wins.
pub(crate) async fn fetch_kind0_per_relay(client: &Client, pubkey: PublicKey) -> Vec<Kind0ScanHit> {
    let urls = connected_relay_urls(client, false).await;
    let mut tasks = Vec::with_capacity(urls.len());
    for url in urls {
        let client = client.clone();
        tasks.push(tokio::spawn(async move {
            let url_str = url.to_string();
            let filter = Filter::new()
                .author(pubkey)
                .kind(Kind::Metadata)
                .limit(1);
            match client
                .fetch_events_from([url], filter, std::time::Duration::from_secs(8))
                .await
            {
                Ok(events) => match events.first() {
                    Some(event) => {
                        println!("[kind0] {url_str}: event {}", event.id);
                        match Metadata::from_json(&event.content) {
                            Ok(metadata) => Some(Kind0ScanHit {
                                created_at: event.created_at.as_secs(),
                                event_id: event.id.to_hex(),
                                metadata,
                            }),
                            Err(e) => {
                                println!("[kind0] {url_str}: error {e}");
                                None
                            }
                        }
                    }
                    None => {
                        println!("[kind0] {url_str}: empty");
                        None
                    }
                },
                Err(e) => {
                    println!("[kind0] {url_str}: error {e}");
                    None
                }
            }
        }));
    }

    let mut hits = Vec::new();
    for task in tasks {
        if let Ok(Some(hit)) = task.await {
            hits.push(hit);
        }
    }
    hits
}

/// `connect()` only starts handshakes. Kind 0 REQ against an empty pool returns none.
async fn wait_for_connected_relay(client: &Client) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let relays = client.relays().await;
        if relays
            .values()
            .any(|relay| relay.status() == RelayStatus::Connected)
        {
            return;
        }
        if std::time::Instant::now() >= deadline {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

/// Kind 0 is applied and emitted as soon as it arrives; the status update finishes in
/// the background so a slow status REQ never holds the caller.
#[tauri::command]
pub async fn load_profile(npub: String) -> bool {
    let (loaded, status) = load_profile_metadata(&npub).await;
    if let Some(status) = status {
        tokio::spawn(apply_fetched_status(npub, status));
    }
    loaded
}

/// Like `load_profile`, but also waits for the status update. The profile sync queue
/// uses this so its per-profile pacing still covers both REQs.
pub async fn load_profile_and_status(npub: String) -> bool {
    let (loaded, status) = load_profile_metadata(&npub).await;
    if let Some(status) = status {
        apply_fetched_status(npub, status).await;
    }
    loaded
}

/// Fetches and applies Kind 0. Returns the still-running status fetch alongside the result.
async fn load_profile_metadata(
    npub: &str,
) -> (bool, Option<tokio::task::JoinHandle<Option<Status>>>) {
    let client = match get_nostr_client() {
        Ok(c) => c,
        Err(_) => return (false, None),
    };

    // Convert the Bech32 String in to a PublicKey
    let profile_pubkey = match PublicKey::from_bech32(npub) {
        Ok(pk) => pk,
        Err(_) => return (false, None),
    };

    // Grab our pubkey to check for profiles belonging to us
    let signer = match client.signer().await {
        Ok(s) => s,
        Err(_) => return (false, None),
    };
    let my_public_key = match signer.get_public_key().await {
        Ok(pk) => pk,
        Err(_) => return (false, None),
    };

    // Check whether we already hold metadata (or, quickly generate a new profile to pass to the fetching logic)
    let lacks_metadata: bool;
    {
        let mut state = STATE.lock().await;
        match state.get_profile(npub) {
            Some(p) => {
                lacks_metadata = !p.has_public_metadata();
            }
            None => {
                let mut new_profile = Profile::new();
                new_profile.id = npub.to_string();
                state.profiles.push(new_profile);
                lacks_metadata = true;
            }
        }
    }

    wait_for_connected_relay(&client).await;

    // Status runs alongside Kind 0 but is applied only after it, so it never delays name/avatar.
    let status_client = client.clone();
    let status_fetch = tokio::spawn(async move {
        let status_filter = Filter::new()
            .author(profile_pubkey)
            .kind(Kind::from_u16(30315))
            .limit(1);
        status_client
            .fetch_events(status_filter, std::time::Duration::from_secs(15))
            .await
            .ok()
            .and_then(|events| events.first().map(status_from_event))
    });

    // Empty profiles get a per-relay Kind 0 scan. Profiles that already have
    // a name or avatar keep the single pooled refresh.
    let fetch_result = if lacks_metadata {
        let hits = fetch_kind0_per_relay(&client, profile_pubkey).await;
        Ok(nip01_kind0_winner(&hits).map(|hit| hit.metadata.clone()))
    } else {
        client
            .fetch_metadata(profile_pubkey, std::time::Duration::from_secs(15))
            .await
            .map_err(|e| e.to_string())
    };

    let loaded = match fetch_result {
        Ok(Some(meta)) => {
            let (metadata_changed, profile_clone, avatar_url, banner_url) = {
                let mut state = STATE.lock().await;
                let profile_mutable = state.get_profile_mut(npub).unwrap();
                profile_mutable.mine = my_public_key == profile_pubkey;

                let metadata_changed = profile_mutable.apply_kind0_replacement(&meta);

                profile_mutable.last_updated = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();

                (
                    metadata_changed,
                    profile_mutable.clone(),
                    profile_mutable.avatar.clone(),
                    profile_mutable.banner.clone(),
                )
            };

            if metadata_changed {
                let handle = TAURI_APP.get().unwrap();
                handle.emit("profile_update", &profile_clone).unwrap();

                db::set_profile(handle.clone(), profile_clone)
                    .await
                    .unwrap();

                let npub_clone = npub.to_string();
                tokio::spawn(async move {
                    cache_profile_images(&npub_clone, &avatar_url, &banner_url).await;
                });
            }
            true
        }
        Ok(None) => {
            // No Kind 0 on relays this attempt. Do not stamp last_updated while
            // the profile is still empty — that would demote Critical retries
            // (e.g. own profile after reinstall before metadata is visible).
            let mut state = STATE.lock().await;
            if let Some(profile) = state.get_profile_mut(npub) {
                if profile.has_public_metadata() {
                    profile.last_updated = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();
                }
            }
            true
        }
        // Network/relay error - this is a genuine failure
        Err(_) => false,
    };

    (loaded, Some(status_fetch))
}

/// Simple status recognition: last, general-only, no URLs, Metadata or Expiry considered
// TODO: comply with expiries, accept more "d" types, allow URLs
fn status_from_event(event: &Event) -> Status {
    Status {
        title: event.content.clone(),
        purpose: event
            .tags
            .first()
            .and_then(|tag| tag.content())
            .unwrap_or_default()
            .to_string(),
        url: String::new(),
    }
}

/// Applies a fetched status to a profile that has Kind 0 metadata. A missing status
/// keeps the previous one.
async fn apply_fetched_status(npub: String, status_fetch: tokio::task::JoinHandle<Option<Status>>) {
    let Ok(Some(status)) = status_fetch.await else {
        return;
    };

    let profile_clone = {
        let mut state = STATE.lock().await;
        let Some(profile) = state.get_profile_mut(&npub) else {
            return;
        };
        if !profile.has_public_metadata() || profile.status == status {
            return;
        }
        profile.status = status;
        profile.clone()
    };

    let handle = TAURI_APP.get().unwrap();
    handle.emit("profile_update", &profile_clone).unwrap();
    db::set_profile(handle.clone(), profile_clone)
        .await
        .unwrap();
}

/// Serialize Kind 0 metadata and strip any `evm_address` (not published on relays).
fn kind0_metadata_json_without_evm(meta: &Metadata) -> Result<String, serde_json::Error> {
    let mut v = serde_json::to_value(meta)?;
    if let serde_json::Value::Object(ref mut m) = v {
        m.remove("evm_address");
    }
    serde_json::to_string(&v)
}

fn build_metadata_from_vector_profile(
    profile: &Profile,
    name: &str,
    avatar: &str,
    banner: &str,
    about: &str,
) -> Metadata {
    let mut meta = Metadata::new().name(if name.is_empty() {
        profile.name.as_str()
    } else {
        name
    });

    let avatar_url_str = if avatar.is_empty() {
        profile.avatar.as_str()
    } else {
        avatar
    };
    if !avatar_url_str.is_empty() {
        if let Ok(url) = Url::parse(avatar_url_str) {
            meta = meta.picture(url);
        }
    }

    let banner_url_str = if banner.is_empty() {
        profile.banner.as_str()
    } else {
        banner
    };
    if !banner_url_str.is_empty() {
        if let Ok(url) = Url::parse(banner_url_str) {
            meta = meta.banner(url);
        }
    }

    if !profile.display_name.is_empty() {
        meta = meta.display_name(&profile.display_name);
    }

    meta = meta.about(if about.is_empty() {
        profile.about.as_str()
    } else {
        about
    });

    if !profile.website.is_empty() {
        if let Ok(url) = Url::parse(&profile.website) {
            meta = meta.website(url);
        }
    }

    if !profile.nip05.is_empty() {
        meta = meta.nip05(&profile.nip05);
    }

    if !profile.lud06.is_empty() {
        meta = meta.lud06(&profile.lud06);
    }

    if !profile.lud16.is_empty() {
        meta = meta.lud16(&profile.lud16);
    }

    meta
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Kind0PublishReceipt {
    pub event_id: String,
    pub success_count: usize,
    pub verified_count: usize,
    pub connected_write_count: usize,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Kind0RelayFailure {
    url: String,
    error: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Kind0PublishReceiptStored {
    event_id: String,
    success: Vec<String>,
    verified: Vec<String>,
    failed: Vec<Kind0RelayFailure>,
    at: u64,
}

const KIND0_PUBLISH_RECEIPT_KEY: &str = "kind0_publish_receipt";

static KIND0_PUBLISH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn publish_vector_profile_kind0(
    name: String,
    avatar: String,
    banner: String,
    about: String,
) -> Result<Kind0PublishReceipt, String> {
    let _guard = KIND0_PUBLISH_LOCK.lock().await;
    publish_vector_profile_kind0_inner(name, avatar, banner, about).await
}

async fn publish_vector_profile_kind0_inner(
    name: String,
    avatar: String,
    banner: String,
    about: String,
) -> Result<Kind0PublishReceipt, String> {
    let handle = TAURI_APP
        .get()
        .cloned()
        .ok_or_else(|| "App handle not initialized".to_string())?;
    let client = get_nostr_client()?;

    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let my_public_key = signer.get_public_key().await.map_err(|e| e.to_string())?;
    let npub = my_public_key.to_bech32().map_err(|e| e.to_string())?;

    let meta = {
        let state = STATE.lock().await;
        let profile = state
            .get_profile(&npub)
            .ok_or_else(|| "Profile not found".to_string())?;
        build_metadata_from_vector_profile(&profile, &name, &avatar, &banner, &about)
    };

    let metadata_json = kind0_metadata_json_without_evm(&meta).map_err(|e| e.to_string())?;

    let metadata_event = EventBuilder::new(Kind::Metadata, metadata_json.clone())
        .tag(nostr_tags::custom_tag("client", vec!["vector"]));

    let event = client
        .sign_event_builder(metadata_event)
        .await
        .map_err(|e| e.to_string())?;
    let connected_write_count = connected_relay_urls(&client, true).await.len();
    let required = required_kind0_acks(connected_write_count);
    let output = client.send_event(&event).await.map_err(|e| e.to_string())?;
    let success_count = output.success.len();
    let first_failure = output.failed.values().next().cloned().unwrap_or_default();
    if success_count < required {
        return Err(format!(
            "Kind 0 stored on {success_count} of {connected_write_count} relays: {first_failure}"
        ));
    }

    let mut verified_urls = Vec::new();
    for url in output.success.iter().cloned() {
        let url_str = url.to_string();
        let readback = client
            .fetch_events_from(
                [url],
                Filter::new()
                    .author(my_public_key)
                    .kind(Kind::Metadata)
                    .id(event.id)
                    .limit(1),
                std::time::Duration::from_secs(8),
            )
            .await;
        if readback
            .ok()
            .and_then(|events| events.first().cloned())
            .is_some_and(|found| found.id == event.id)
        {
            verified_urls.push(url_str);
        }
    }
    let verified_count = verified_urls.len();
    if !kind0_verified_quorum_met(verified_count, required) {
        return Err(format!(
            "Kind 0 acknowledged by {success_count} of {connected_write_count} relays but verified on {verified_count}"
        ));
    }

    let stored = Kind0PublishReceiptStored {
        event_id: event.id.to_hex(),
        success: output.success.iter().map(|url| url.to_string()).collect(),
        verified: verified_urls,
        failed: output
            .failed
            .iter()
            .map(|(url, error)| Kind0RelayFailure {
                url: url.to_string(),
                error: error.clone(),
            })
            .collect(),
        at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    };
    let receipt_json =
        serde_json::to_string(&stored).map_err(|e| format!("Failed to serialize kind0 receipt: {e}"))?;

    let meta_published = serde_json::from_str::<Metadata>(&metadata_json).unwrap_or(meta);
    let receipt = Kind0PublishReceipt {
        event_id: event.id.to_hex(),
        success_count,
        verified_count,
        connected_write_count,
    };

    let profile_to_save = {
        let state = STATE.lock().await;
        let mut profile = state
            .get_profile(&npub)
            .ok_or_else(|| "Profile not found".to_string())?
            .clone();
        profile.apply_kind0_replacement(&meta_published);
        profile.last_updated = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        profile
    };

    db::persist_kind0_publish(handle.clone(), &profile_to_save, receipt_json)?;

    {
        let mut state = STATE.lock().await;
        if let Some(profile_mutable) = state.get_profile_mut(&npub) {
            *profile_mutable = profile_to_save.clone();
        }
        handle
            .emit("profile_update", &profile_to_save)
            .map_err(|e| e.to_string())?;
    }

    let npub_clone = npub.clone();
    let avatar_url = profile_to_save.avatar.clone();
    let banner_url = profile_to_save.banner.clone();
    tokio::spawn(async move {
        cache_profile_images(&npub_clone, &avatar_url, &banner_url).await;
    });

    Ok(receipt)
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn setting_u64(handle: tauri::AppHandle, key: &str) -> Option<u64> {
    db::get_sql_setting(handle, key.to_string())
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
}

fn write_repair_timestamp(handle: tauri::AppHandle, key: &str) {
    let _ = db::set_sql_setting(handle, key.to_string(), unix_now_secs().to_string());
}

/// Republish own Kind 0 only when a local receipt's event has disappeared.
pub(crate) async fn maybe_republish_own_kind0(
    client: Client,
    expected_npub: String,
    login_generation: u64,
) {
    if current_login_generation() != login_generation {
        return;
    }
    let Ok(signer) = client.signer().await else {
        return;
    };
    let Ok(pubkey) = signer.get_public_key().await else {
        return;
    };
    if pubkey.to_bech32().unwrap() != expected_npub {
        return;
    }

    let _guard = KIND0_PUBLISH_LOCK.lock().await;
    if current_login_generation() != login_generation {
        return;
    }
    let Ok(signer) = client.signer().await else {
        return;
    };
    let Ok(pubkey) = signer.get_public_key().await else {
        return;
    };
    if pubkey.to_bech32().unwrap() != expected_npub {
        return;
    }

    let Some(handle) = TAURI_APP.get().cloned() else {
        return;
    };

    let (name, avatar, banner, about) = {
        let state = STATE.lock().await;
        match state.profiles.iter().find(|p| p.mine && p.id == expected_npub) {
            Some(p) if p.has_public_metadata() => (
                p.name.clone(),
                p.avatar.clone(),
                p.banner.clone(),
                p.about.clone(),
            ),
            _ => return,
        }
    };

    let receipt: Option<Kind0PublishReceiptStored> =
        db::get_sql_setting(handle.clone(), KIND0_PUBLISH_RECEIPT_KEY.to_string())
            .ok()
            .flatten()
            .and_then(|json| serde_json::from_str(&json).ok());
    let last_success_at = setting_u64(handle.clone(), KIND0_REPAIR_LAST_SUCCESS_KEY);
    let last_failure_at = setting_u64(handle.clone(), KIND0_REPAIR_LAST_FAILURE_KEY);

    let hits = fetch_kind0_per_relay(&client, pubkey).await;
    let winner = nip01_kind0_winner(&hits);
    let decision = decide_kind0_repair(
        true,
        receipt.as_ref().map(|r| r.event_id.as_str()),
        winner,
        &name,
        &avatar,
        unix_now_secs(),
        last_success_at,
        last_failure_at,
    );

    match decision {
        Kind0RepairDecision::Skip => {}
        Kind0RepairDecision::Reconcile => {
            if let Some(hit) = winner {
                let profile_to_save = {
                    let state = STATE.lock().await;
                    let Some(profile) = state.get_profile(&expected_npub) else {
                        return;
                    };
                    let mut profile = profile.clone();
                    profile.apply_kind0_replacement(&hit.metadata);
                    profile.last_updated = unix_now_secs();
                    profile
                };
                if db::set_profile(handle.clone(), profile_to_save.clone())
                    .await
                    .is_ok()
                {
                    let mut state = STATE.lock().await;
                    if let Some(profile) = state.get_profile_mut(&expected_npub) {
                        *profile = profile_to_save.clone();
                    }
                    let _ = handle.emit("profile_update", &profile_to_save);
                }
            }
        }
        Kind0RepairDecision::Publish => {
            match publish_vector_profile_kind0_inner(name, avatar, banner, about).await {
                Ok(_) => write_repair_timestamp(handle, KIND0_REPAIR_LAST_SUCCESS_KEY),
                Err(e) => {
                    eprintln!("[kind0] repair publish failed: {e}");
                    write_repair_timestamp(handle, KIND0_REPAIR_LAST_FAILURE_KEY);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn update_profile(
    name: String,
    avatar: String,
    banner: String,
    about: String,
) -> Result<Kind0PublishReceipt, String> {
    publish_vector_profile_kind0(name, avatar, banner, about).await
}

#[tauri::command]
pub async fn update_status(status: String) -> bool {
    let client = get_nostr_client().expect("Nostr client not initialized");

    // Grab our pubkey
    let signer = client.signer().await.unwrap();
    let my_public_key = signer.get_public_key().await.unwrap();

    // Build and broadcast the status
    let status_builder = EventBuilder::new(Kind::from_u16(30315), status.as_str())
        .tag(nostr_tags::d_tag(vec!["general"]));
    match client.send_event_builder(status_builder).await {
        Ok(_) => {
            // Add the status to our profile
            let mut state = STATE.lock().await;
            let profile = state
                .get_profile_mut(&my_public_key.to_bech32().unwrap())
                .unwrap();
            profile.status.purpose = String::from("general");
            profile.status.title = status;

            // Update the frontend
            let handle = TAURI_APP.get().unwrap();
            handle.emit("profile_update", &profile).unwrap();
            true
        }
        Err(_) => false,
    }
}
/// Validates decoded avatar bytes before upload: size cap, then dimensions via a
/// bounded decoder (guards against decompression bombs — a small file whose header
/// declares an oversized image can't force a huge pixel-buffer allocation before the
/// declared dimensions are checked), then format, then an explicit dimension re-check.
fn validate_avatar_bytes(bytes: &[u8]) -> Result<(), String> {
    const MAX_AVATAR_BYTES: usize = 500_000;
    const MAX_AVATAR_DIMENSION: u32 = 512;

    if bytes.len() > MAX_AVATAR_BYTES {
        return Err("Avatar image exceeds the 500KB size limit".to_string());
    }

    let mut limits = ::image::Limits::default();
    limits.max_image_width = Some(MAX_AVATAR_DIMENSION);
    limits.max_image_height = Some(MAX_AVATAR_DIMENSION);

    let mut reader = ::image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "Could not read avatar image data".to_string())?;
    reader.limits(limits);

    let img = reader
        .decode()
        .map_err(|e| format!("Failed to decode avatar image: {}", e))?;

    if !matches!(::image::guess_format(bytes), Ok(::image::ImageFormat::Jpeg)) {
        return Err("Avatar image must be a JPEG".to_string());
    }

    let (width, height) = (img.width(), img.height());
    if width > MAX_AVATAR_DIMENSION || height > MAX_AVATAR_DIMENSION {
        return Err(format!(
            "Avatar image dimensions {}x{} exceed the {}x{} limit",
            width, height, MAX_AVATAR_DIMENSION, MAX_AVATAR_DIMENSION
        ));
    }

    Ok(())
}

/// Uploads an avatar or banner image with progress reporting.
/// `bytes` is base64-encoded image data (JPEG for avatars). `upload_type` should be
/// "avatar" or "banner" to specify which is being uploaded.
#[tauri::command]
pub async fn upload_avatar(bytes: String, upload_type: Option<String>) -> Result<String, String> {
    use base64::Engine;

    let handle = TAURI_APP.get().unwrap();
    let upload_type = upload_type.unwrap_or_else(|| "avatar".to_string());

    let decoded_bytes = base64::engine::general_purpose::STANDARD
        .decode(&bytes)
        .map_err(|_| "Invalid base64 image data".to_string())?;

    if upload_type == "avatar" {
        validate_avatar_bytes(&decoded_bytes)?;
    }

    let attachment_file = AttachmentFile {
        bytes: decoded_bytes,
        img_meta: None,
        extension: "jpg".to_string(),
        file_name: None,
    };

    // Format a Mime Type from the file extension (always "jpg" -> "image/jpeg" for avatars)
    let mime_type = crate::util::mime_from_extension_safe(&attachment_file.extension, true)
        .map_err(|_| "File type is not allowed for avatars (only images are permitted)")?;

    // Upload the file to the server using Blossom with automatic failover and progress
    let client = get_nostr_client().expect("Nostr client not initialized");
    let signer = client.signer().await.unwrap();
    let servers = crate::get_blossom_media_servers();

    // Create progress callback that emits events to frontend
    let handle_clone = handle.clone();
    let upload_type_clone = upload_type.clone();
    let progress_callback: crate::blossom::ProgressCallback =
        std::sync::Arc::new(move |percentage, bytes_uploaded| {
            let payload = serde_json::json!({
                "type": upload_type_clone,
                "progress": percentage.unwrap_or(0),
                "bytes": bytes_uploaded.unwrap_or(0)
            });
            handle_clone
                .emit("profile_upload_progress", payload)
                .map_err(|_| "Failed to emit progress event".to_string())
        });

    // Keep a copy of bytes for pre-caching
    let bytes_for_cache = attachment_file.bytes.clone();

    // Upload using Blossom with progress tracking and failover
    let upload_url = crate::blossom::upload_blob_with_progress_and_failover(
        signer.clone(),
        servers,
        attachment_file.bytes,
        Some(mime_type.as_str()),
        progress_callback,
        None, // No retries per server
        None, // Default retry spacing
    )
    .await?;

    // Pre-cache the uploaded image so it displays immediately without re-downloading
    let image_type = if upload_type == "banner" {
        image_cache::ImageType::Banner
    } else {
        image_cache::ImageType::Avatar
    };
    image_cache::precache_image_bytes(&handle, &upload_url, &bytes_for_cache, image_type);

    Ok(upload_url)
}

/// Toggles blocked status (local DM block; incoming decrypted content is dropped).
#[tauri::command]
pub async fn toggle_blocked(npub: String) -> bool {
    let handle = TAURI_APP.get().unwrap();

    let (updated, new_blocked) = {
        let mut st = STATE.lock().await;
        if st.get_profile_mut(&npub).is_none() {
            let mut profile = Profile::new();
            profile.id = npub.clone();
            profile.mine = false;
            st.profiles.push(profile);
        }
        match st.get_profile_mut(&npub) {
            Some(profile) => {
                profile.blocked = !profile.blocked;
                (profile.clone(), profile.blocked)
            }
            None => return false,
        }
    };

    let _ = handle.emit("profile_update", &updated);
    db::set_profile(handle.clone(), updated).await.unwrap();
    let _ = crate::cmds::chat::update_unread_counter(handle.clone()).await;
    new_blocked
}

/// Sets a nickname for a profile
#[tauri::command]
pub async fn set_nickname(npub: String, nickname: String) -> bool {
    let handle = TAURI_APP.get().unwrap();
    let mut state = STATE.lock().await;

    match state.get_profile_mut(&npub) {
        Some(profile) => {
            profile.nickname = nickname;

            // Update the frontend
            handle
                .emit(
                    "profile_nick_changed",
                    serde_json::json!({
                        "profile_id": &profile.id,
                        "value": &profile.nickname
                    }),
                )
                .unwrap();

            // Save to DB
            db::set_profile(handle.clone(), profile.clone())
                .await
                .unwrap();

            true
        }
        None => false,
    }
}

/// Gets a profile from the cache
#[tauri::command]
pub async fn get_profile(npub: String) -> Result<Profile, String> {
    let state = STATE.lock().await;

    match state.get_profile(&npub) {
        Some(profile) => Ok(profile.clone()),
        None => Err(format!("Profile not found: {}", npub)),
    }
}

#[cfg(test)]
mod kind0_relay_proof_tests {
    use super::{
        decide_kind0_repair, kind0_echoes_local, kind0_verified_quorum_met, nip01_kind0_winner,
        required_kind0_acks, Kind0RepairDecision, Kind0ScanHit, Profile,
    };
    use nostr_sdk::prelude::*;

    fn hit(created_at: u64, event_id: &str, metadata: Metadata) -> Kind0ScanHit {
        Kind0ScanHit {
            created_at,
            event_id: event_id.to_string(),
            metadata,
        }
    }

    #[test]
    fn required_acks_is_one_below_two_relays_and_two_after() {
        assert_eq!(required_kind0_acks(0), 1);
        assert_eq!(required_kind0_acks(1), 1);
        assert_eq!(required_kind0_acks(7), 2);
    }

    #[test]
    fn verified_quorum_requires_configured_count() {
        assert!(kind0_verified_quorum_met(1, 1));
        assert!(!kind0_verified_quorum_met(1, 2));
        assert!(kind0_verified_quorum_met(2, 2));
    }

    #[test]
    fn nip01_winner_prefers_newer_empty_over_older_named() {
        let older = hit(10, "aa", Metadata::new().name("Iso"));
        let newer_empty = hit(20, "bb", Metadata::new());
        let hits = [older, newer_empty];
        let picked = nip01_kind0_winner(&hits).unwrap();
        assert!(picked.metadata.name.is_none());
        assert_eq!(picked.created_at, 20);
    }

    #[test]
    fn nip01_winner_prefers_newer_about_only() {
        let older = hit(10, "aa", Metadata::new().name("Iso"));
        let newer_about = hit(20, "bb", Metadata::new().about("bio"));
        let hits = [older, newer_about];
        let picked = nip01_kind0_winner(&hits).unwrap();
        assert_eq!(picked.metadata.about.as_deref(), Some("bio"));
        assert!(picked.metadata.name.is_none());
    }

    #[test]
    fn nip01_winner_equal_timestamp_uses_higher_event_id() {
        let low = hit(10, "aa", Metadata::new().name("Low"));
        let high = hit(10, "ff", Metadata::new().name("High"));
        let hits = [low, high];
        let picked = nip01_kind0_winner(&hits).unwrap();
        assert_eq!(picked.metadata.name.as_deref(), Some("High"));
        assert_eq!(picked.event_id, "ff");
    }

    #[test]
    fn apply_kind0_replacement_clears_absent_fields() {
        let mut profile = Profile::new();
        profile.name = "Iso".into();
        profile.avatar = "https://example.com/a.png".into();
        profile.nickname = "local".into();
        let changed = profile.apply_kind0_replacement(&Metadata::new().about("only"));
        assert!(changed);
        assert!(profile.name.is_empty());
        assert!(profile.avatar.is_empty());
        assert_eq!(profile.about, "only");
        assert_eq!(profile.nickname, "local");
    }

    #[test]
    fn echo_requires_local_name_and_avatar() {
        let meta = Metadata::new()
            .name("Iso")
            .picture(Url::parse("https://example.com/a.png").unwrap());
        assert!(kind0_echoes_local(
            &meta,
            "Iso",
            "https://example.com/a.png"
        ));
        assert!(!kind0_echoes_local(
            &meta,
            "Iso",
            "https://example.com/other.png"
        ));
        assert!(!kind0_echoes_local(&Metadata::new(), "", ""));
    }

    #[test]
    fn repair_skips_when_session_mismatched() {
        let decision = decide_kind0_repair(
            false,
            Some("evt"),
            None,
            "Iso",
            "https://example.com/a.png",
            1_000,
            None,
            None,
        );
        assert_eq!(decision, Kind0RepairDecision::Skip);
    }

    #[test]
    fn repair_skips_without_receipt() {
        let decision = decide_kind0_repair(
            true,
            None,
            None,
            "Iso",
            "https://example.com/a.png",
            1_000,
            None,
            None,
        );
        assert_eq!(decision, Kind0RepairDecision::Skip);
    }

    #[test]
    fn repair_reconciles_remote_newer_instead_of_publishing() {
        let remote = hit(50, "newer", Metadata::new().name("Other"));
        let decision = decide_kind0_repair(
            true,
            Some("old-receipt"),
            Some(&remote),
            "Iso",
            "https://example.com/a.png",
            1_000,
            None,
            None,
        );
        assert_eq!(decision, Kind0RepairDecision::Reconcile);
    }

    #[test]
    fn repair_publishes_when_receipt_event_is_gone() {
        let decision = decide_kind0_repair(
            true,
            Some("evt"),
            None,
            "Iso",
            "https://example.com/a.png",
            1_000,
            None,
            None,
        );
        assert_eq!(decision, Kind0RepairDecision::Publish);
    }

    #[test]
    fn repair_skips_during_success_cooldown() {
        let decision = decide_kind0_repair(
            true,
            Some("evt"),
            None,
            "Iso",
            "https://example.com/a.png",
            1_800,
            Some(1_000),
            None,
        );
        assert_eq!(decision, Kind0RepairDecision::Skip);
    }

    #[test]
    fn repair_retries_after_failure_backoff() {
        let blocked = decide_kind0_repair(
            true,
            Some("evt"),
            None,
            "Iso",
            "https://example.com/a.png",
            1_200,
            None,
            Some(1_000),
        );
        assert_eq!(blocked, Kind0RepairDecision::Skip);
        let allowed = decide_kind0_repair(
            true,
            Some("evt"),
            None,
            "Iso",
            "https://example.com/a.png",
            1_000 + 5 * 60,
            None,
            Some(1_000),
        );
        assert_eq!(allowed, Kind0RepairDecision::Publish);
    }
}

#[cfg(test)]
mod public_metadata_tests {
    use super::Profile;

    #[test]
    fn empty_shell_has_no_public_metadata() {
        let p = Profile::new();
        assert!(!p.has_public_metadata());
    }

    #[test]
    fn any_of_name_display_or_avatar_counts() {
        let mut p = Profile::new();
        p.name = "Iso".into();
        assert!(p.has_public_metadata());

        let mut p = Profile::new();
        p.display_name = "Iso".into();
        assert!(p.has_public_metadata());

        let mut p = Profile::new();
        p.avatar = "https://example.com/a.png".into();
        assert!(p.has_public_metadata());
    }
}

#[cfg(test)]
mod kind0_evm_tests {
    use super::kind0_metadata_json_without_evm;
    use nostr_sdk::prelude::*;

    #[test]
    fn kind0_json_strips_evm_address_field() {
        let meta = Metadata::new().name("alice");
        let mut v = serde_json::to_value(&meta).unwrap();
        if let serde_json::Value::Object(ref mut m) = v {
            m.insert(
                "evm_address".to_string(),
                serde_json::Value::String("0x1111111111111111111111111111111111111111".to_string()),
            );
        }
        let contaminated: Metadata = serde_json::from_value(v).unwrap();
        let json = kind0_metadata_json_without_evm(&contaminated).unwrap();
        assert!(!json.contains("evm_address"));
        assert!(json.contains("alice"));
    }
}

#[cfg(test)]
mod status_event_tests {
    use super::status_from_event;
    use crate::nostr_tags;
    use nostr_sdk::prelude::*;

    #[test]
    fn reads_title_and_purpose_from_status_event() {
        let keys = Keys::generate();
        let event = EventBuilder::new(Kind::from_u16(30315), "in a meeting")
            .tag(nostr_tags::d_tag(vec!["general"]))
            .sign_with_keys(&keys)
            .unwrap();
        let status = status_from_event(&event);
        assert_eq!(status.title, "in a meeting");
        assert_eq!(status.purpose, "general");
        assert_eq!(status.url, "");
    }

    #[test]
    fn untagged_status_event_does_not_panic() {
        let keys = Keys::generate();
        let event = EventBuilder::new(Kind::from_u16(30315), "hi")
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(status_from_event(&event).purpose, "");
    }
}

#[cfg(test)]
mod avatar_validation_tests {
    use super::validate_avatar_bytes;
    use ::image::ImageEncoder;
    use base64::Engine;

    /// Encodes a solid-color square RGB image to JPEG bytes at the given dimension.
    fn jpeg_bytes(dimension: u32) -> Vec<u8> {
        let img = ::image::RgbImage::from_pixel(dimension, dimension, ::image::Rgb([128, 64, 200]));
        let mut data = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut data);
        let encoder = ::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 85);
        encoder
            .write_image(
                img.as_raw(),
                dimension,
                dimension,
                ::image::ExtendedColorType::Rgb8,
            )
            .unwrap();
        data
    }

    /// Encodes a solid-color square RGB image to PNG bytes at the given dimension.
    fn png_bytes(dimension: u32) -> Vec<u8> {
        let img = ::image::RgbImage::from_pixel(dimension, dimension, ::image::Rgb([10, 200, 40]));
        let mut data = Vec::new();
        ::image::DynamicImage::ImageRgb8(img)
            .write_to(
                &mut std::io::Cursor::new(&mut data),
                ::image::ImageFormat::Png,
            )
            .unwrap();
        data
    }

    #[test]
    fn accepts_valid_small_jpeg() {
        let bytes = jpeg_bytes(512);
        assert!(bytes.len() < 500_000);
        assert!(validate_avatar_bytes(&bytes).is_ok());
    }

    #[test]
    fn rejects_oversized_dimensions() {
        let bytes = jpeg_bytes(600);
        assert!(validate_avatar_bytes(&bytes).is_err());
    }

    #[test]
    fn rejects_oversized_byte_count_before_decode() {
        // Valid dimensions, but padded past the 500KB cap; the size check runs
        // before any decode attempt, so the padding need not stay valid JPEG.
        let mut bytes = jpeg_bytes(512);
        assert!(bytes.len() < 500_000);
        let pad = 500_001 - bytes.len();
        bytes.extend(std::iter::repeat(0u8).take(pad));
        assert!(bytes.len() > 500_000);
        let err = validate_avatar_bytes(&bytes).unwrap_err();
        assert!(err.contains("500KB"));
    }

    #[test]
    fn rejects_malformed_bytes_without_panicking() {
        let bytes = b"this is not an image".to_vec();
        let err = validate_avatar_bytes(&bytes).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn rejects_non_jpeg_format() {
        let bytes = png_bytes(256);
        let err = validate_avatar_bytes(&bytes).unwrap_err();
        assert!(err.contains("JPEG"));
    }

    #[test]
    fn rejects_declared_oversized_dimensions_without_full_decode() {
        // Patch a small real JPEG's SOF0 header to claim ~50000x50000 dimensions.
        // Header/marker parsing is cheap and unaffected by the fake dimensions;
        // the bounded decode must reject on the declared size before allocating a
        // full-resolution pixel buffer, so this returns an error quickly instead
        // of hanging or exhausting memory.
        let mut bytes = jpeg_bytes(8);
        let sof0 = bytes
            .windows(2)
            .position(|w| w == [0xFF, 0xC0])
            .expect("encoded JPEG should contain a baseline SOF0 marker");
        // After the marker: 2-byte segment length, 1-byte precision, then
        // 2-byte height and 2-byte width fields.
        let height_offset = sof0 + 5;
        let width_offset = height_offset + 2;
        let fake_dim: u16 = 50_000;
        bytes[height_offset..height_offset + 2].copy_from_slice(&fake_dim.to_be_bytes());
        bytes[width_offset..width_offset + 2].copy_from_slice(&fake_dim.to_be_bytes());

        assert!(bytes.len() < 500_000);
        let err = validate_avatar_bytes(&bytes).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn base64_decode_rejects_malformed_input() {
        // Exercises the same decode step `upload_avatar` runs before validation;
        // malformed base64 must error, not panic.
        let result = base64::engine::general_purpose::STANDARD.decode("not-valid-base64!!!");
        assert!(result.is_err());
    }
}
