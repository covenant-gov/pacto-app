//! NIP-28 public channels. Kind 40 creates the room. Kind 42 is a plaintext message.
//! Membership is not published. Ingest drops authors who are not on the local squad roster.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{stream, StreamExt};
use nostr_sdk::prelude::*;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Runtime};

use crate::get_nostr_client;
use crate::nostr_tags::e_tag;
use crate::squad_catalog::SquadRow;
use crate::Message;

const KIND_CHANNEL_CREATE: u16 = 40;
const KIND_CHANNEL_MESSAGE: u16 = 42;
const FETCH_LIMIT: usize = 100;
const ROSTER_TTL: Duration = Duration::from_secs(30);
const BACKFILL_PAGES: usize = 3;
const BACKFILL_CONCURRENCY: usize = 4;

#[derive(Default)]
struct LiveSubscription {
    id: Option<SubscriptionId>,
    channels: BTreeSet<String>,
}

static WATCHED: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static ROSTERS: Lazy<Mutex<HashMap<String, (Instant, Arc<HashSet<String>>)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static LIVE: Lazy<Mutex<LiveSubscription>> = Lazy::new(|| Mutex::new(LiveSubscription::default()));
static WATCH_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

pub fn clear_watched() {
    if let Ok(mut watched) = WATCHED.lock() {
        watched.clear();
    }
    if let Ok(mut rosters) = ROSTERS.lock() {
        rosters.clear();
    }
    if let Ok(mut live) = LIVE.lock() {
        *live = LiveSubscription::default();
    }
}

/// True for the `#e`-filtered kind 42 subscription opened by `watch_public_channels`.
pub fn is_live_subscription(id: &SubscriptionId) -> bool {
    LIVE.lock()
        .map(|live| live.id.as_ref() == Some(id))
        .unwrap_or(false)
}

fn watch_one(channel_id: &str) {
    if let Ok(mut watched) = WATCHED.lock() {
        watched.insert(channel_id.to_string());
    }
}

fn is_watched(channel_id: &str) -> bool {
    WATCHED
        .lock()
        .map(|watched| watched.contains(channel_id))
        .unwrap_or(false)
}

fn set_watched(ids: impl IntoIterator<Item = String>) {
    if let Ok(mut watched) = WATCHED.lock() {
        watched.clear();
        watched.extend(ids);
    }
}

fn relay_hint() -> String {
    crate::trusted_relays::trusted_relays()
        .first()
        .map(|url| url.to_string())
        .unwrap_or_default()
}

fn trusted_relay_urls() -> Vec<String> {
    crate::trusted_relays::trusted_relays()
        .iter()
        .map(|url| url.to_string())
        .collect()
}

#[derive(Serialize)]
struct ChannelCreateBody<'a> {
    name: &'a str,
    relays: &'a [String],
}

pub fn channel_create_builder(name: &str, relays: &[String]) -> Result<EventBuilder, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Channel name must not be empty".to_string());
    }
    if name.len() > crate::app_config::CHANNEL_NAME_MAX_LENGTH {
        return Err(format!(
            "Channel name must be at most {} characters",
            crate::app_config::CHANNEL_NAME_MAX_LENGTH
        ));
    }
    let content = serde_json::to_string(&ChannelCreateBody { name, relays })
        .map_err(|e| e.to_string())?;
    Ok(EventBuilder::new(Kind::from_u16(KIND_CHANNEL_CREATE), content))
}

pub fn channel_message_builder(
    channel_id: &str,
    relay: &str,
    content: &str,
    replied_to: &str,
) -> Result<EventBuilder, String> {
    let channel_id = channel_id.trim();
    EventId::from_hex(channel_id).map_err(|_| "Invalid channel id".to_string())?;
    let content = content.trim();
    if content.is_empty() {
        return Err("Message is empty".to_string());
    }
    let mut builder = EventBuilder::new(Kind::from_u16(KIND_CHANNEL_MESSAGE), content)
        .tag(e_tag([channel_id, relay, "root"]));
    let replied_to = replied_to.trim();
    if !replied_to.is_empty() {
        EventId::from_hex(replied_to).map_err(|_| "Invalid reply id".to_string())?;
        builder = builder.tag(e_tag([replied_to, relay, "reply"]));
    }
    Ok(builder)
}

/// Kind 42 channel id: the `root` e tag, otherwise the first e tag.
pub fn root_channel_id(event: &Event) -> Option<String> {
    let mut fallback = None;
    for tag in event.tags.iter() {
        let Some(TagStandard::Event {
            event_id, marker, ..
        }) = tag.as_standardized()
        else {
            continue;
        };
        let id = event_id.to_hex();
        if matches!(marker, Some(Marker::Root)) {
            return Some(id);
        }
        if fallback.is_none() {
            fallback = Some(id);
        }
    }
    fallback
}

/// Kind 42 reply target: the `reply` marked e tag, empty when absent.
pub fn reply_to_id(event: &Event) -> String {
    event
        .tags
        .iter()
        .find_map(|tag| match tag.as_standardized() {
            Some(TagStandard::Event {
                event_id,
                marker: Some(Marker::Reply),
                ..
            }) => Some(event_id.to_hex()),
            _ => None,
        })
        .unwrap_or_default()
}

fn has_pubkey_list_tag(event: &Event) -> bool {
    event.tags.iter().any(|tag| tag.kind() == TagKind::p())
}

async fn publish(event: &Event) -> Result<(), String> {
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    let output = client
        .send_event_to(
            crate::trusted_relays::trusted_relays().iter().cloned(),
            event,
        )
        .await
        .map_err(|e| e.to_string())?;
    crate::cmds::relays::record_send_outcome(event, &output);
    if output.success.is_empty() {
        return Err("No trusted relay accepted the event".to_string());
    }
    Ok(())
}

async fn sign_with_client(builder: EventBuilder) -> Result<Event, String> {
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    client
        .sign_event_builder(builder)
        .await
        .map_err(|e| e.to_string())
}

/// Own posts always pass. Anyone else must be on the squad roster.
fn author_allowed(author: &str, me: Option<&str>, roster: &HashSet<String>) -> bool {
    me == Some(author) || roster.contains(author)
}

fn squad_id_for_channel(rows: &[SquadRow], channel_id: &str) -> Option<String> {
    rows.iter()
        .find(|row| {
            row.channels.iter().any(|ch| {
                ch.access.as_deref() == Some("public")
                    && ch.group_id.trim().eq_ignore_ascii_case(channel_id)
            })
        })
        .map(|row| row.id.clone())
}

/// Squad members from the announcements MLS group. Empty means unknown; callers fail closed.
async fn roster_for_channel<R: Runtime>(
    handle: &AppHandle<R>,
    channel_id: &str,
) -> Result<Arc<HashSet<String>>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let rows = crate::squad_catalog::list_squads_inner(&conn);
    crate::account_manager::return_db_connection(conn);
    let Some(squad_id) = squad_id_for_channel(&rows?, channel_id) else {
        return Ok(Arc::new(HashSet::new()));
    };

    if let Ok(cache) = ROSTERS.lock() {
        if let Some((at, roster)) = cache.get(&squad_id) {
            if at.elapsed() < ROSTER_TTL {
                return Ok(roster.clone());
            }
        }
    }
    let members = crate::cmds::mls_groups::get_mls_group_members(squad_id.clone())
        .await?
        .members;
    let roster: Arc<HashSet<String>> = Arc::new(members.into_iter().collect());
    if !roster.is_empty() {
        if let Ok(mut cache) = ROSTERS.lock() {
            cache.insert(squad_id, (Instant::now(), roster.clone()));
        }
    }
    Ok(roster)
}

struct IngestCandidate {
    channel_id: String,
    author: String,
    mine: bool,
}

/// Kind 42 for a watched channel. `None` when the kind is wrong, there is no root tag, or the channel is not watched.
fn ingest_candidate(
    event: &Event,
    me: Option<&str>,
    is_watched: impl Fn(&str) -> bool,
) -> Result<Option<IngestCandidate>, String> {
    if event.kind != Kind::from_u16(KIND_CHANNEL_MESSAGE) {
        return Ok(None);
    }
    let Some(channel_id) = root_channel_id(event) else {
        return Ok(None);
    };
    if !is_watched(&channel_id) {
        return Ok(None);
    }
    let author = event.pubkey.to_bech32().map_err(|e| e.to_string())?;
    let mine = me == Some(author.as_str());
    Ok(Some(IngestCandidate {
        channel_id,
        author,
        mine,
    }))
}

fn candidate_message(event: &Event, candidate: &IngestCandidate) -> Message {
    Message {
        id: event.id.to_hex(),
        content: event.content.clone(),
        replied_to: reply_to_id(event),
        at: event.created_at.as_secs().saturating_mul(1000),
        mine: candidate.mine,
        npub: Some(candidate.author.clone()),
        ..Message::default()
    }
}

/// Stores and emits a roster-authored kind 42 for a watched channel. `Ok(false)` when dropped or already stored.
pub async fn ingest_message_event<R: Runtime>(
    handle: &AppHandle<R>,
    event: &Event,
) -> Result<bool, String> {
    let me = crate::account_manager::get_current_account().ok();
    let Some(candidate) = ingest_candidate(event, me.as_deref(), is_watched)? else {
        return Ok(false);
    };
    let channel_id = candidate.channel_id.as_str();
    if !candidate.mine {
        let roster = roster_for_channel(handle, channel_id).await?;
        if !author_allowed(&candidate.author, me.as_deref(), &roster) {
            return Ok(false);
        }
    }
    if crate::db::event_exists(handle, &event.id.to_hex())? {
        return Ok(false);
    }
    let mut message = candidate_message(event, &candidate);
    crate::db::ensure_public_channel_chat(handle, channel_id)?;
    crate::db::save_message(handle.clone(), channel_id, &message).await?;
    let _ = crate::db::populate_reply_context(handle, &mut message).await;
    let _ = handle.emit(
        "public_channel_message_new",
        json!({
            "channel_id": channel_id,
            "message": message,
        }),
    );
    Ok(true)
}

pub async fn ingest_live_message(event: &Event) {
    let Some(handle) = crate::TAURI_APP.get() else {
        return;
    };
    if let Err(e) = ingest_message_event(handle, event).await {
        eprintln!("[public-channel] ingest failed: {e}");
    }
}

#[tauri::command]
pub async fn create_public_channel(name: String) -> Result<String, String> {
    let relays = trusted_relay_urls();
    let builder = channel_create_builder(&name, &relays)?;
    let event = sign_with_client(builder).await?;
    if has_pubkey_list_tag(&event) {
        return Err("Public channel create must not list pubkeys".to_string());
    }
    publish(&event).await?;
    let id = event.id.to_hex();
    watch_one(&id);
    Ok(id)
}

#[tauri::command]
pub async fn send_public_channel_message(
    channel_id: String,
    content: String,
    replied_to: Option<String>,
) -> Result<bool, String> {
    let channel_id = channel_id.trim().to_string();
    watch_one(&channel_id);
    let builder = channel_message_builder(
        &channel_id,
        &relay_hint(),
        &content,
        replied_to.as_deref().unwrap_or(""),
    )?;
    let event = sign_with_client(builder).await?;
    if has_pubkey_list_tag(&event) {
        return Err("Public channel message must not list pubkeys".to_string());
    }
    publish(&event).await?;
    if let Some(handle) = crate::TAURI_APP.get() {
        let _ = ingest_message_event(handle, &event).await;
    }
    Ok(true)
}

#[tauri::command]
pub async fn watch_public_channels(channel_ids: Vec<String>) -> Result<(), String> {
    let ids: Vec<String> = channel_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && !id.starts_with("creating-"))
        .filter(|id| EventId::from_hex(id).is_ok())
        .collect();
    set_watched(ids.iter().cloned());
    let Some(handle) = crate::TAURI_APP.get().cloned() else {
        return Ok(());
    };
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;

    let _serial = WATCH_LOCK.lock().await;
    let wanted: BTreeSet<String> = ids.into_iter().collect();
    let (previous_sub, previous_channels) = {
        let live = LIVE.lock().map_err(|_| "Public channel state poisoned".to_string())?;
        (live.id.clone(), live.channels.clone())
    };
    if wanted == previous_channels {
        return Ok(());
    }

    let new_sub = if wanted.is_empty() {
        None
    } else {
        let pool = client.relays().await;
        let relays = crate::trusted_relays::trusted_relays_in_pool(&pool);
        if relays.is_empty() {
            return Err("No trusted relay connected".to_string());
        }
        let filter = Filter::new()
            .kind(Kind::from_u16(KIND_CHANNEL_MESSAGE))
            .custom_tags(SingleLetterTag::lowercase(Alphabet::E), wanted.iter().cloned())
            .limit(0);
        let output = client
            .subscribe_to(relays, filter, None)
            .await
            .map_err(|e| e.to_string())?;
        Some(output.val)
    };
    if let Some(previous) = previous_sub {
        client.unsubscribe(&previous).await;
    }
    if let Ok(mut live) = LIVE.lock() {
        live.id = new_sub;
        live.channels = wanted.clone();
    }

    let added: Vec<String> = wanted.difference(&previous_channels).cloned().collect();
    stream::iter(added)
        .for_each_concurrent(BACKFILL_CONCURRENCY, |channel_id| {
            let handle = handle.clone();
            let client = client.clone();
            async move { backfill_channel(&handle, &client, &channel_id).await }
        })
        .await;
    Ok(())
}

/// Newest-first pages of kind 42s for one channel, trusted relays only.
async fn backfill_channel<R: Runtime>(handle: &AppHandle<R>, client: &Client, channel_id: &str) {
    let mut until: Option<Timestamp> = None;
    for _ in 0..BACKFILL_PAGES {
        let mut filter = Filter::new()
            .kind(Kind::from_u16(KIND_CHANNEL_MESSAGE))
            .custom_tag(SingleLetterTag::lowercase(Alphabet::E), channel_id)
            .limit(FETCH_LIMIT);
        if let Some(until) = until {
            filter = filter.until(until);
        }
        let events = match client
            .fetch_events_from(
                crate::trusted_relays::trusted_relays().to_vec(),
                filter,
                Duration::from_secs(15),
            )
            .await
        {
            Ok(events) => events,
            Err(e) => {
                eprintln!("[public-channel] fetch {channel_id} failed: {e}");
                return;
            }
        };
        let count = events.len();
        let oldest = events.iter().map(|event| event.created_at).min();
        for event in events {
            let _ = ingest_message_event(handle, &event).await;
        }
        match oldest {
            Some(oldest) if count >= FETCH_LIMIT => until = Some(oldest),
            _ => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nostr_sign;

    fn signed(builder: EventBuilder) -> Event {
        let keys = Keys::generate();
        nostr_sign::sign_with(builder, &keys).expect("sign")
    }

    #[test]
    fn kind_40_carries_name_and_no_pubkey_list() {
        let relays = vec!["wss://example.invalid".to_string()];
        let event = signed(channel_create_builder("general", &relays).unwrap());
        assert_eq!(event.kind, Kind::from_u16(KIND_CHANNEL_CREATE));
        let body: serde_json::Value = serde_json::from_str(&event.content).unwrap();
        assert_eq!(body["name"], "general");
        assert_eq!(body["relays"][0], "wss://example.invalid");
        assert!(body.get("pubkeys").is_none());
        assert!(!has_pubkey_list_tag(&event));
    }

    #[test]
    fn kind_42_root_tag_is_the_channel() {
        let channel_id = "ab".repeat(32);
        let event = signed(
            channel_message_builder(&channel_id, "wss://example.invalid", "hello", "").unwrap(),
        );
        assert_eq!(event.kind, Kind::from_u16(KIND_CHANNEL_MESSAGE));
        assert_eq!(event.content, "hello");
        assert_eq!(root_channel_id(&event).as_deref(), Some(channel_id.as_str()));
        assert!(!has_pubkey_list_tag(&event));
    }

    #[test]
    fn reply_tag_does_not_replace_the_channel_root() {
        let channel_id = "cd".repeat(32);
        let reply_id = "ef".repeat(32);
        let event = signed(
            channel_message_builder(&channel_id, "", "reply", &reply_id).unwrap(),
        );
        assert_eq!(root_channel_id(&event).as_deref(), Some(channel_id.as_str()));
    }

    #[test]
    fn author_allowed_covers_member_self_stranger_and_empty_roster() {
        let roster: HashSet<String> = ["npub-a".to_string()].into_iter().collect();
        assert!(author_allowed("npub-a", Some("npub-me"), &roster));
        assert!(author_allowed("npub-me", Some("npub-me"), &roster));
        assert!(!author_allowed("npub-stranger", Some("npub-me"), &roster));
        assert!(!author_allowed("npub-a", Some("npub-me"), &HashSet::new()));
        assert!(!author_allowed("npub-a", None, &HashSet::new()));
    }

    #[test]
    fn squad_lookup_matches_public_channel_rows_only() {
        use crate::squad_catalog::SquadChannelRow;
        let channel = "ab".repeat(32);
        let row = |access: Option<&str>| SquadRow {
            id: "ann".to_string(),
            name: "s".to_string(),
            icon_url: None,
            channels: vec![SquadChannelRow {
                name: "room".to_string(),
                group_id: channel.clone(),
                order: 1,
                access: access.map(str::to_string),
            }],
            kind: "squad".to_string(),
            paired_squads: None,
            visibility: "private".to_string(),
            commons_tags: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        assert_eq!(
            squad_id_for_channel(&[row(Some("public"))], &channel).as_deref(),
            Some("ann")
        );
        assert_eq!(squad_id_for_channel(&[row(Some("open"))], &channel), None);
        assert_eq!(squad_id_for_channel(&[row(Some("public"))], "other"), None);
    }

    fn watching(id: &str) -> impl Fn(&str) -> bool + '_ {
        move |candidate| candidate == id
    }

    #[test]
    fn ingest_candidate_rejects_wrong_kind_missing_root_and_unwatched() {
        let channel_id = "ab".repeat(32);
        let created = signed(channel_create_builder("general", &[]).unwrap());
        assert!(ingest_candidate(&created, None, watching(&channel_id))
            .unwrap()
            .is_none());

        let no_root = signed(EventBuilder::new(Kind::from_u16(KIND_CHANNEL_MESSAGE), "hi"));
        assert!(ingest_candidate(&no_root, None, |_| true).unwrap().is_none());

        let message = signed(channel_message_builder(&channel_id, "", "hi", "").unwrap());
        assert!(ingest_candidate(&message, None, watching(&"cd".repeat(32)))
            .unwrap()
            .is_none());
    }

    #[test]
    fn ingest_candidate_returns_channel_and_author_for_watched_channel() {
        let channel_id = "ab".repeat(32);
        let event = signed(channel_message_builder(&channel_id, "", "hi", "").unwrap());
        let candidate = ingest_candidate(&event, None, watching(&channel_id))
            .unwrap()
            .expect("candidate");
        assert_eq!(candidate.channel_id, channel_id);
        assert_eq!(candidate.author, event.pubkey.to_bech32().unwrap());
    }

    #[test]
    fn ingest_candidate_mine_only_when_me_is_the_author() {
        let channel_id = "ab".repeat(32);
        let event = signed(channel_message_builder(&channel_id, "", "hi", "").unwrap());
        let author = event.pubkey.to_bech32().unwrap();
        let mine = |me: Option<&str>| {
            ingest_candidate(&event, me, watching(&channel_id))
                .unwrap()
                .expect("candidate")
                .mine
        };
        assert!(mine(Some(author.as_str())));
        assert!(!mine(Some("npub-other")));
        assert!(!mine(None));
    }

    #[test]
    fn candidate_message_carries_event_fields() {
        let channel_id = "ab".repeat(32);
        let reply_id = "ef".repeat(32);
        let event = signed(channel_message_builder(&channel_id, "", "hello", &reply_id).unwrap());
        let candidate = ingest_candidate(&event, None, watching(&channel_id))
            .unwrap()
            .expect("candidate");
        let message = candidate_message(&event, &candidate);
        assert_eq!(message.id, event.id.to_hex());
        assert_eq!(message.content, "hello");
        assert_eq!(message.npub.as_deref(), Some(candidate.author.as_str()));
        assert!(!message.mine);
        assert_eq!(message.at, event.created_at.as_secs() * 1000);
        assert_eq!(message.replied_to, reply_id);
    }

    #[test]
    fn candidate_message_plain_event_has_no_reply_and_keeps_mine() {
        let channel_id = "ab".repeat(32);
        let event = signed(channel_message_builder(&channel_id, "", "hi", "").unwrap());
        let author = event.pubkey.to_bech32().unwrap();
        let candidate = ingest_candidate(&event, Some(author.as_str()), watching(&channel_id))
            .unwrap()
            .expect("candidate");
        let message = candidate_message(&event, &candidate);
        assert!(message.mine);
        assert_eq!(message.replied_to, "");
    }

    #[test]
    fn reply_to_id_reads_the_reply_marker_only() {
        let channel_id = "cd".repeat(32);
        let reply_id = "ef".repeat(32);
        let replied = signed(channel_message_builder(&channel_id, "", "re", &reply_id).unwrap());
        assert_eq!(reply_to_id(&replied), reply_id);
        let plain = signed(channel_message_builder(&channel_id, "", "hi", "").unwrap());
        assert_eq!(reply_to_id(&plain), "");
    }

    #[test]
    fn empty_name_and_empty_message_are_rejected() {
        assert!(channel_create_builder("  ", &[]).is_err());
        let channel_id = "11".repeat(32);
        assert!(channel_message_builder(&channel_id, "", "  ", "").is_err());
    }
}
