//! NIP-28 public channels. Kind 40 creates the room. Kind 42 is a plaintext message.
//! Membership is not published. The client hides authors who are not on the local squad roster.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use nostr_sdk::prelude::*;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Runtime};

use crate::chat::{Chat, ChatType};
use crate::get_nostr_client;
use crate::nostr_sign;
use crate::nostr_tags::e_tag;
use crate::Message;

const KIND_CHANNEL_CREATE: u16 = 40;
const KIND_CHANNEL_MESSAGE: u16 = 42;
const FETCH_LIMIT: usize = 100;

static WATCHED: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

pub fn clear_watched() {
    if let Ok(mut watched) = WATCHED.lock() {
        watched.clear();
    }
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

pub async fn ingest_message_event<R: Runtime>(
    handle: &AppHandle<R>,
    event: &Event,
) -> Result<bool, String> {
    if event.kind != Kind::from_u16(KIND_CHANNEL_MESSAGE) {
        return Ok(false);
    }
    let Some(channel_id) = root_channel_id(event) else {
        return Ok(false);
    };
    if !is_watched(&channel_id) {
        return Ok(false);
    }
    let author = event.pubkey.to_bech32().map_err(|e| e.to_string())?;
    let mine = crate::account_manager::get_current_account().ok().as_deref() == Some(author.as_str());
    let message = Message {
        id: event.id.to_hex(),
        content: event.content.clone(),
        at: event.created_at.as_secs().saturating_mul(1000),
        mine,
        npub: Some(author),
        ..Message::default()
    };
    let chat = Chat::new(channel_id.clone(), ChatType::PublicChannel, vec![]);
    crate::db::save_chat(handle.clone(), &chat).await?;
    crate::db::save_message(handle.clone(), &channel_id, &message).await?;
    let _ = handle.emit(
        "mls_message_new",
        json!({
            "group_id": channel_id,
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
    for channel_id in ids {
        let filter = Filter::new()
            .kind(Kind::from_u16(KIND_CHANNEL_MESSAGE))
            .custom_tag(SingleLetterTag::lowercase(Alphabet::E), &channel_id)
            .limit(FETCH_LIMIT);
        match client.fetch_events(filter, Duration::from_secs(15)).await {
            Ok(events) => {
                for event in events {
                    let _ = ingest_message_event(&handle, &event).await;
                }
            }
            Err(e) => eprintln!("[public-channel] fetch {channel_id} failed: {e}"),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn empty_name_and_empty_message_are_rejected() {
        assert!(channel_create_builder("  ", &[]).is_err());
        let channel_id = "11".repeat(32);
        assert!(channel_message_builder(&channel_id, "", "  ", "").is_err());
    }
}
