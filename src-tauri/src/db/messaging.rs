use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

use super::ids::{
    get_chat_id_by_identifier, get_or_create_chat_id, get_or_create_user_id,
    resolve_chat_id_for_message_load, CHAT_ID_CACHE,
};
use crate::crypto::{internal_decrypt, internal_encrypt};
use crate::message::EditEntry;
use crate::net::SiteMetadata;
use crate::stored_event::{event_kind, StoredEvent};
use crate::{chat::NotificationLevel, Attachment, Chat, ChatType, Message, Reaction};
use nostr_sdk::ToBech32;

/// Slim version of Chat for database storage
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SlimChatDB {
    pub id: String, // The semantic ID (npub or group_id) - used in code
    pub chat_type: ChatType,
    pub participants: Vec<String>,
    pub last_read: String,
    pub created_at: u64,
    pub metadata: crate::ChatMetadata,
    pub notification_level: NotificationLevel,
}

impl From<&Chat> for SlimChatDB {
    fn from(chat: &Chat) -> Self {
        SlimChatDB {
            id: chat.id().clone(),
            chat_type: chat.chat_type().clone(),
            participants: chat.participants().clone(),
            last_read: chat.last_read().clone(),
            created_at: chat.created_at(),
            metadata: chat.metadata().clone(),
            notification_level: chat.notification_level(),
        }
    }
}

impl SlimChatDB {
    // Convert back to full Chat (messages will be loaded separately)
    pub fn to_chat(&self) -> Chat {
        let mut chat = Chat::new(
            self.id.clone(),
            self.chat_type.clone(),
            self.participants.clone(),
        );
        chat.last_read = self.last_read.clone();
        chat.created_at = self.created_at;
        chat.metadata = self.metadata.clone();
        chat.notification_level = self.notification_level;
        chat
    }
}

/// Get all chats from the database
pub async fn get_all_chats<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<SlimChatDB>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn.prepare("SELECT chat_identifier, chat_type, participants, last_read, created_at, metadata, notification_level FROM chats ORDER BY created_at DESC")
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let participants_json: String = row.get(2)?;
            let participants: Vec<String> =
                serde_json::from_str(&participants_json).unwrap_or_default();

            let metadata_json: String = row.get(5)?;
            let metadata: crate::ChatMetadata =
                serde_json::from_str(&metadata_json).unwrap_or_default();

            let chat_type_int: i32 = row.get(1)?;
            let chat_type = crate::ChatType::from_i32(chat_type_int);

            Ok(SlimChatDB {
                id: row.get(0)?, // chat_identifier (the semantic ID)
                chat_type,
                participants,
                last_read: row.get(3)?,
                created_at: row.get::<_, i64>(4)? as u64,
                metadata,
                notification_level: NotificationLevel::from_db_str(&row.get::<_, String>(6)?),
            })
        })
        .map_err(|e| format!("Failed to query chats: {}", e))?;

    let chats: Vec<SlimChatDB> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect chats: {}", e))?;

    drop(stmt); // Explicitly drop stmt before returning connection
    crate::account_manager::return_db_connection(conn);
    Ok(chats)
}

/// Save a single chat to the database
pub async fn save_chat<R: Runtime>(handle: AppHandle<R>, chat: &Chat) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    let slim_chat = SlimChatDB::from(chat);
    let chat_identifier = &slim_chat.id;

    let chat_type_int = slim_chat.chat_type.to_i32();
    let participants_json =
        serde_json::to_string(&slim_chat.participants).unwrap_or_else(|_| "[]".to_string());
    let metadata_json =
        serde_json::to_string(&slim_chat.metadata).unwrap_or_else(|_| "{}".to_string());

    // Use INSERT ... ON CONFLICT DO UPDATE to avoid triggering CASCADE delete
    conn.execute(
        "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata, notification_level)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(chat_identifier) DO UPDATE SET
            chat_type = excluded.chat_type,
            participants = excluded.participants,
            last_read = excluded.last_read,
            metadata = excluded.metadata,
            notification_level = excluded.notification_level",
        rusqlite::params![
            chat_identifier,
            chat_type_int,
            participants_json,
            slim_chat.last_read,
            slim_chat.created_at as i64,
            metadata_json,
            slim_chat.notification_level.as_db_str(),
        ],
    ).map_err(|e| format!("Failed to upsert chat: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Delete events (and legacy messages) then the chat row. FK CASCADE is not relied on
/// because account connections do not enable `PRAGMA foreign_keys`.
pub(crate) fn delete_chat_conn(
    conn: &rusqlite::Connection,
    chat_identifier: &str,
) -> Result<(), String> {
    let chat_int_id: i64 = conn
        .query_row(
            "SELECT id FROM chats WHERE chat_identifier = ?1",
            rusqlite::params![chat_identifier],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("Chat not found: {}", chat_identifier)
            }
            other => format!("Failed to look up chat {}: {}", chat_identifier, other),
        })?;

    conn.execute(
        "DELETE FROM events WHERE chat_id = ?1",
        rusqlite::params![chat_int_id],
    )
    .map_err(|e| format!("Failed to delete events: {}", e))?;

    // Legacy messages table may still exist on older accounts.
    let _ = conn.execute(
        "DELETE FROM messages WHERE chat_id = ?1",
        rusqlite::params![chat_int_id],
    );

    conn.execute(
        "DELETE FROM chats WHERE id = ?1",
        rusqlite::params![chat_int_id],
    )
    .map_err(|e| format!("Failed to delete chat: {}", e))?;

    {
        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.remove(chat_identifier);
    }

    println!(
        "[DB] Deleted chat and messages: {} (id {})",
        chat_identifier, chat_int_id
    );

    if let Err(e) = crate::catch_up::delete_entries_for_chat(conn, chat_identifier) {
        eprintln!(
            "[CatchUp] Failed to delete entries for chat {}: {}",
            chat_identifier, e
        );
    }

    Ok(())
}

/// Delete a chat and all its messages from the database.
/// `chat_identifier` is the npub for DMs or group_id for MLS.
pub async fn delete_chat<R: Runtime>(
    handle: AppHandle<R>,
    chat_identifier: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let result = delete_chat_conn(&conn, chat_identifier);
    crate::account_manager::return_db_connection(conn);
    result
}

/// True when a DM rumor's `created_at` is at or before a deletion cutoff.
pub fn dm_created_at_at_or_before_cutoff(created_at_secs: u64, deleted_at_secs: i64) -> bool {
    created_at_secs <= deleted_at_secs as u64
}

pub(crate) fn upsert_dm_deletion_cutoff_conn(
    conn: &rusqlite::Connection,
    peer_npub: &str,
    deleted_at: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO dm_deletion_cutoffs (peer_npub, deleted_at) VALUES (?1, ?2)
         ON CONFLICT(peer_npub) DO UPDATE SET deleted_at = excluded.deleted_at",
        rusqlite::params![peer_npub, deleted_at],
    )
    .map_err(|e| format!("Failed to upsert dm deletion cutoff: {}", e))?;
    Ok(())
}

pub(crate) fn get_dm_deletion_cutoff_conn(
    conn: &rusqlite::Connection,
    peer_npub: &str,
) -> Result<Option<i64>, String> {
    let result = conn.query_row(
        "SELECT deleted_at FROM dm_deletion_cutoffs WHERE peer_npub = ?1",
        rusqlite::params![peer_npub],
        |row| row.get::<_, i64>(0),
    );
    match result {
        Ok(ts) => Ok(Some(ts)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read dm deletion cutoff: {}", e)),
    }
}

pub async fn upsert_dm_deletion_cutoff<R: Runtime>(
    handle: &AppHandle<R>,
    peer_npub: &str,
    deleted_at: i64,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = upsert_dm_deletion_cutoff_conn(&conn, peer_npub, deleted_at);
    crate::account_manager::return_db_connection(conn);
    result
}

pub async fn get_dm_deletion_cutoff<R: Runtime>(
    handle: &AppHandle<R>,
    peer_npub: &str,
) -> Result<Option<i64>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = get_dm_deletion_cutoff_conn(&conn, peer_npub);
    crate::account_manager::return_db_connection(conn);
    result
}

/// Save a single message to the database (efficient for incremental updates)
///
/// This function saves to the `events` table using the flat event architecture.
/// The old `messages` table is no longer written to - it only exists for
/// backward compatibility with migrated data (read-only fallback).
pub async fn save_message<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: &str,
    message: &Message,
) -> Result<(), String> {
    // Get or create integer chat ID
    let chat_int_id = get_or_create_chat_id(&handle, chat_id)?;

    // Get or create integer user ID from npub
    let user_int_id = if let Some(ref npub_str) = message.npub {
        get_or_create_user_id(&handle, npub_str)?
    } else {
        None
    };

    // Save to events table (flat event architecture)
    let event = message_to_stored_event(message, chat_int_id, user_int_id);
    save_event(&handle, &event).await?;

    // Also save any reactions as separate kind=7 events
    for reaction in &message.reactions {
        // Check if reaction event already exists to avoid duplicates
        if !event_exists(&handle, &reaction.id)? {
            let user_id = get_or_create_user_id(&handle, &reaction.author_id)?;
            let is_mine = if let Ok(current_npub) = crate::account_manager::get_current_account() {
                reaction.author_id == current_npub
            } else {
                false
            };
            save_reaction_event(&handle, reaction, chat_int_id, user_id, is_mine).await?;
        }
    }

    Ok(())
}

/// Convert a Message to a StoredEvent for the flat event architecture
fn message_to_stored_event(message: &Message, chat_id: i64, user_id: Option<i64>) -> StoredEvent {
    // Determine event kind based on whether message has attachments
    let kind = if let Some(k) = message.rumor_kind {
        k
    } else if !message.attachments.is_empty() {
        event_kind::FILE_ATTACHMENT
    } else {
        event_kind::PRIVATE_DIRECT_MESSAGE
    };

    // Build tags array
    let mut tags: Vec<Vec<String>> = Vec::new();

    // Add millisecond precision tag
    let ms = message.at % 1000;
    if ms > 0 {
        tags.push(vec!["ms".to_string(), ms.to_string()]);
    }

    // Add reply reference tag if present
    if !message.replied_to.is_empty() {
        tags.push(vec![
            "e".to_string(),
            message.replied_to.clone(),
            "".to_string(),
            "reply".to_string(),
        ]);
    }

    // Add attachments as JSON tag for file messages
    if !message.attachments.is_empty() {
        if let Ok(attachments_json) = serde_json::to_string(&message.attachments) {
            tags.push(vec!["attachments".to_string(), attachments_json]);
        }
    }

    // Add link preview metadata as JSON tag, if present (see also save_link_preview_metadata,
    // which UPDATEs this tag after an async fetch since the event row already exists by then)
    if let Some(preview) = &message.preview_metadata {
        if let Ok(preview_json) = serde_json::to_string(preview) {
            tags.push(vec!["link_preview".to_string(), preview_json]);
        }
    }

    let virtual_bucket = message.virtual_bucket.clone().or_else(|| {
        crate::virtual_channel_bucket::normalize_virtual_bucket_for_message(
            kind,
            &message.content,
            &tags,
        )
    });

    StoredEvent {
        id: message.id.clone(),
        kind,
        chat_id,
        user_id,
        content: message.content.clone(),
        tags,
        reference_id: None,
        created_at: message.at / 1000, // Convert ms to seconds
        received_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        mine: message.mine,
        pending: message.pending,
        failed: message.failed,
        wrapper_event_id: message.wrapper_event_id.clone(),
        npub: message.npub.clone(),
        virtual_bucket,
    }
}

/// Save multiple messages for a specific chat (batch operation)
///
/// This uses the flat event architecture - each message is stored as an event.
/// Reactions are stored as separate kind=7 events.
pub async fn save_chat_messages<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: &str,
    messages: &[Message],
) -> Result<(), String> {
    // Skip if no messages to save
    if messages.is_empty() {
        return Ok(());
    }

    // Save each message using the event-based save_message function
    for message in messages {
        if let Err(e) = save_message(handle.clone(), chat_id, message).await {
            eprintln!(
                "Failed to save message {}: {}",
                &message.id[..8.min(message.id.len())],
                e
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod dm_deletion_cutoff_tests {
    use super::*;

    fn in_memory_app_conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    #[test]
    fn upsert_and_get_dm_deletion_cutoff_round_trip() {
        let conn = in_memory_app_conn();
        let peer = "npub1peerdeletioncutoffxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        assert!(get_dm_deletion_cutoff_conn(&conn, peer).unwrap().is_none());

        upsert_dm_deletion_cutoff_conn(&conn, peer, 1_700_000_000).unwrap();
        assert_eq!(
            get_dm_deletion_cutoff_conn(&conn, peer).unwrap(),
            Some(1_700_000_000)
        );

        upsert_dm_deletion_cutoff_conn(&conn, peer, 1_700_000_100).unwrap();
        assert_eq!(
            get_dm_deletion_cutoff_conn(&conn, peer).unwrap(),
            Some(1_700_000_100)
        );
    }

    #[test]
    fn dm_created_at_gate_compares_inclusive() {
        assert!(dm_created_at_at_or_before_cutoff(100, 100));
        assert!(dm_created_at_at_or_before_cutoff(99, 100));
        assert!(!dm_created_at_at_or_before_cutoff(101, 100));
    }

    #[test]
    fn delete_chat_conn_removes_events_and_chat_row() {
        let conn = in_memory_app_conn();
        let peer = "npub1deleterpurgepeerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at)
             VALUES (?1, 0, '[]', 1000)",
            rusqlite::params![peer],
        )
        .unwrap();
        let chat_id: i64 = conn
            .query_row(
                "SELECT id FROM chats WHERE chat_identifier = ?1",
                rusqlite::params![peer],
                |row| row.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO events (id, chat_id, kind, content, tags, created_at, received_at, mine)
             VALUES ('evt1', ?1, 14, 'hi', '[]', 1000, 1000, 1)",
            rusqlite::params![chat_id],
        )
        .unwrap();

        upsert_dm_deletion_cutoff_conn(&conn, peer, 2000).unwrap();
        delete_chat_conn(&conn, peer).unwrap();

        let chats: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM chats WHERE chat_identifier = ?1",
                rusqlite::params![peer],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(chats, 0);
        let events: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE chat_id = ?1",
                rusqlite::params![chat_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(events, 0);
        assert_eq!(
            get_dm_deletion_cutoff_conn(&conn, peer).unwrap(),
            Some(2000),
            "cutoff survives chat purge"
        );
    }

    #[test]
    fn delete_chat_conn_missing_chat_is_not_found() {
        let conn = in_memory_app_conn();
        let peer = "npub1missingchatpeerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        upsert_dm_deletion_cutoff_conn(&conn, peer, 2000).unwrap();
        let err = delete_chat_conn(&conn, peer).unwrap_err();
        assert!(
            err.starts_with("Chat not found:"),
            "expected Chat not found, got: {}",
            err
        );
        assert_eq!(
            get_dm_deletion_cutoff_conn(&conn, peer).unwrap(),
            Some(2000),
            "cutoff remains when chat row was already absent"
        );
    }
}

/// Lightweight attachment reference for file deduplication
/// Contains only the data needed to reuse an existing upload
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AttachmentRef {
    /// The SHA256 hash of the original file (used as ID)
    pub hash: String,
    /// The message ID containing this attachment
    pub message_id: String,
    /// The chat ID containing this message
    pub chat_id: String,
    /// The encrypted file URL on the server
    pub url: String,
    /// The encryption key
    pub key: String,
    /// The encryption nonce
    pub nonce: String,
    /// The file extension
    pub extension: String,
    /// The encrypted file size
    pub size: u64,
}

/// Build a file hash index from all attachments in the database
/// This is used for file deduplication without loading full message content
/// Returns a HashMap of file_hash -> AttachmentRef
pub async fn build_file_hash_index<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<HashMap<String, AttachmentRef>, String> {
    use crate::stored_event::event_kind;

    let mut index: HashMap<String, AttachmentRef> = HashMap::new();

    let conn = crate::account_manager::get_db_connection(handle)?;

    // Query file attachment events (kind=15) from the events table
    // Attachments are stored in the tags field as JSON
    let attachment_data: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT e.id, c.chat_identifier, e.tags
             FROM events e
             JOIN chats c ON e.chat_id = c.id
             WHERE e.kind = ?1",
            )
            .map_err(|e| format!("Failed to prepare attachment query: {}", e))?;

        let rows = stmt
            .query_map(rusqlite::params![event_kind::FILE_ATTACHMENT], |row| {
                Ok((
                    row.get::<_, String>(0)?, // event_id (message_id)
                    row.get::<_, String>(1)?, // chat_identifier
                    row.get::<_, String>(2)?, // tags JSON
                ))
            })
            .map_err(|e| format!("Failed to query attachments: {}", e))?;

        // Collect immediately to consume the iterator while stmt is still alive
        let result: Result<Vec<_>, _> = rows.collect();
        result.map_err(|e| format!("Failed to collect attachment rows: {}", e))?
    }; // stmt is dropped here

    // Return connection to pool before processing
    crate::account_manager::return_db_connection(conn);

    // Process the collected data
    const EMPTY_FILE_HASH: &str =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    for (message_id, chat_id, tags_json) in attachment_data {
        // Parse tags to find the "attachments" tag
        let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

        // Find the attachments tag: ["attachments", "<json>"]
        let attachments_json = tags
            .iter()
            .find(|tag| tag.first().map(|s| s.as_str()) == Some("attachments"))
            .and_then(|tag| tag.get(1))
            .map(|s| s.as_str())
            .unwrap_or("[]");

        // Parse the attachments JSON
        let attachments: Vec<crate::Attachment> =
            serde_json::from_str(attachments_json).unwrap_or_default();

        // Add each attachment to the index (skip empty hashes and empty URLs)
        for attachment in attachments {
            if !attachment.id.is_empty()
                && attachment.id != EMPTY_FILE_HASH
                && !attachment.url.is_empty()
            {
                index.insert(
                    attachment.id.clone(),
                    AttachmentRef {
                        hash: attachment.id,
                        message_id: message_id.clone(),
                        chat_id: chat_id.clone(),
                        url: attachment.url,
                        key: attachment.key,
                        nonce: attachment.nonce,
                        extension: attachment.extension,
                        size: attachment.size,
                    },
                );
            }
        }
    }

    Ok(index)
}

/// Get paginated messages for a chat (newest first, with offset)
/// This allows loading messages on-demand instead of all at once
///
/// Parameters:
/// - chat_id: The chat identifier (npub for DMs, group_id for groups)
/// - limit: Maximum number of messages to return
/// - offset: Number of messages to skip from the newest
///
/// Returns messages in chronological order (oldest first within the batch)
/// NOTE: This now uses the events table via get_message_views
pub async fn get_chat_messages_paginated<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<Message>, String> {
    // Get integer chat ID
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    // Use the events-based message views
    get_message_views(handle, chat_int_id, limit, offset, None).await
}

/// Get the total message count for a chat
/// This is useful for the frontend to know how many messages exist without loading them all
pub async fn get_chat_message_count<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
) -> Result<usize, String> {
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Count message events (kind 14 = DM, kind 15 = file) from events table
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE chat_id = ?1 AND kind IN (14, 15, 30078)",
            rusqlite::params![chat_int_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count messages: {}", e))?;

    crate::account_manager::return_db_connection(conn);

    Ok(count as usize)
}

/// Get the last N messages for a chat (for preview purposes)
/// This is optimized for getting just the most recent messages without loading the full history
pub async fn get_chat_last_messages<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    count: usize,
) -> Result<Vec<Message>, String> {
    // Get integer chat ID
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;
    // Use the events-based message views
    get_message_views(handle, chat_int_id, count, 0, None).await
}

/// For DM chats: whether there is at least one message from us and one from them.
/// Used by init_finished so the frontend can show Friends vs Requests vs Pending correctly
/// even when only the last message is loaded for preview.
pub fn get_dm_sent_received<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<(bool, bool), String> {
    let chat_int_id = get_chat_id_by_identifier(handle, chat_identifier)?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    let has_from_me: i32 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE chat_id = ?1 AND kind IN (14, 15) AND mine = 1)",
        rusqlite::params![chat_int_id],
        |row| row.get(0),
    ).map_err(|e| format!("get_dm_sent_received (from_me): {}", e))?;
    let has_from_them: i32 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE chat_id = ?1 AND kind IN (14, 15) AND mine = 0)",
        rusqlite::params![chat_int_id],
        |row| row.get(0),
    ).map_err(|e| format!("get_dm_sent_received (from_them): {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok((has_from_me != 0, has_from_them != 0))
}

/// Get messages around a specific message ID
/// Returns messages from (target - context_before) to the most recent
/// This is used for scrolling to old replied-to messages
pub async fn get_messages_around_id<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    target_message_id: &str,
    context_before: usize,
) -> Result<Vec<Message>, String> {
    let chat_int_id = resolve_chat_id_for_message_load(handle, chat_id)?;

    // First, find the timestamp of the target message (don't require chat_id match in case of edge cases)
    let target_timestamp: i64 = {
        let conn = crate::account_manager::get_db_connection(handle)?;
        // Try to find in the specified chat first
        let ts_result = conn.query_row(
            "SELECT created_at FROM events WHERE id = ?1 AND chat_id = ?2",
            rusqlite::params![target_message_id, chat_int_id],
            |row| row.get(0),
        );

        let ts = match ts_result {
            Ok(t) => t,
            Err(_) => {
                // Message not found in specified chat, try finding it anywhere
                conn.query_row(
                    "SELECT created_at FROM events WHERE id = ?1",
                    rusqlite::params![target_message_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Target message not found in any chat: {}", e))?
            }
        };
        crate::account_manager::return_db_connection(conn);
        ts
    };

    // Count how many messages are older than the target in this chat
    let older_count: i64 = {
        let conn = crate::account_manager::get_db_connection(handle)?;
        let count = conn.query_row(
            "SELECT COUNT(*) FROM events WHERE chat_id = ?1 AND kind IN (14, 15, 30078) AND created_at < ?2",
            rusqlite::params![chat_int_id, target_timestamp],
            |row| row.get(0)
        ).map_err(|e| format!("Failed to count older messages: {}", e))?;
        crate::account_manager::return_db_connection(conn);
        count
    };

    // Get total message count for this chat
    let total_count = get_chat_message_count(handle, chat_id).await?;

    // Calculate the starting position (from oldest = 0)
    // We want messages from (target - context_before) to the newest
    let start_position = (older_count as usize).saturating_sub(context_before);

    // get_message_views uses ORDER BY created_at DESC, so:
    // - offset 0 = newest message
    // - To get messages from position P to newest with DESC ordering, use offset=0, limit=(total - P)
    let limit = total_count.saturating_sub(start_position);

    // offset = 0 to start from the newest and get all messages back to start_position
    get_message_views(handle, chat_int_id, limit, 0, None).await
}

/// Check if a message/event exists in the database by its ID
/// This is used to prevent duplicate processing during sync
pub async fn message_exists_in_db<R: Runtime>(
    handle: &AppHandle<R>,
    message_id: &str,
) -> Result<bool, String> {
    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(false), // No DB, let in-memory check handle it
    };

    // Check in events table (unified storage)
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
            rusqlite::params![message_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check event existence: {}", e))?;

    crate::account_manager::return_db_connection(conn);

    Ok(exists)
}

/// Check if a wrapper (giftwrap) event ID exists in the database
/// This allows skipping the expensive unwrap operation for already-processed events
pub async fn wrapper_event_exists<R: Runtime>(
    handle: &AppHandle<R>,
    wrapper_event_id: &str,
) -> Result<bool, String> {
    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(false), // No DB, can't check
    };

    // Check in events table (unified storage)
    let in_events: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE wrapper_event_id = ?1)",
            rusqlite::params![wrapper_event_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check wrapper event existence: {}", e))?;

    let in_discarded: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM discarded_giftwraps WHERE wrapper_id = ?1)",
            rusqlite::params![wrapper_event_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    crate::account_manager::return_db_connection(conn);

    Ok(in_events || in_discarded)
}

/// Remember a gift-wrap id we intentionally did not store (e.g. blocked DM peer) so historic sync skips re-decrypt.
pub async fn record_discarded_giftwrap<R: Runtime>(
    handle: &AppHandle<R>,
    wrapper_id: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO discarded_giftwraps (wrapper_id) VALUES (?1)",
        [wrapper_id],
    )
    .map_err(|e| format!("Failed to record discarded giftwrap: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Update the wrapper event ID for an existing event
/// This is called when we process an event that was previously stored without its wrapper ID
/// Returns: Ok(true) if updated, Ok(false) if event already had a wrapper_id (duplicate giftwrap)
pub async fn update_wrapper_event_id<R: Runtime>(
    handle: &AppHandle<R>,
    event_id: &str,
    wrapper_event_id: &str,
) -> Result<bool, String> {
    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(false), // No DB, nothing to update
    };

    // Update in events table (unified storage)
    let rows_updated = match conn.execute(
        "UPDATE events SET wrapper_event_id = ?1 WHERE id = ?2 AND (wrapper_event_id IS NULL OR wrapper_event_id = '')",
        rusqlite::params![wrapper_event_id, event_id],
    ) {
        Ok(n) => n,
        Err(e) => {
            crate::account_manager::return_db_connection(conn);
            return Err(format!("Failed to update wrapper event ID: {}", e));
        }
    };

    crate::account_manager::return_db_connection(conn);

    // Returns true if backfill succeeded, false if event already has a wrapper_id (duplicate giftwrap)
    Ok(rows_updated > 0)
}

/// Load recent wrapper_event_ids into a HashSet for fast duplicate detection
/// This preloads wrapper_ids from the last N days to avoid SQL queries during sync
pub async fn load_recent_wrapper_ids<R: Runtime>(
    handle: &AppHandle<R>,
    days: u64,
) -> Result<std::collections::HashSet<String>, String> {
    let mut wrapper_ids = std::collections::HashSet::new();

    // Try to get a database connection - if it fails, we're not using DB mode
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(_) => return Ok(wrapper_ids), // No DB, return empty set
    };

    // Calculate timestamp for N days ago (in seconds, matching events.created_at)
    let cutoff_secs = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs())
    .saturating_sub(days * 24 * 60 * 60);

    // Query all wrapper_event_ids from recent events
    let result: Result<Vec<String>, _> = {
        let mut stmt = conn
            .prepare(
                "SELECT wrapper_event_id FROM events
             WHERE wrapper_event_id IS NOT NULL
             AND wrapper_event_id != ''
             AND created_at >= ?1",
            )
            .map_err(|e| format!("Failed to prepare wrapper_id query: {}", e))?;

        let rows = stmt
            .query_map(rusqlite::params![cutoff_secs as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| format!("Failed to query wrapper_ids: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect wrapper_ids: {}", e))
    };

    crate::account_manager::return_db_connection(conn);

    match result {
        Ok(ids) => {
            for id in ids {
                wrapper_ids.insert(id);
            }
            Ok(wrapper_ids)
        }
        Err(_) => {
            Ok(wrapper_ids) // Return empty set on error, will fall back to DB queries
        }
    }
}

/// Update the downloaded status of an attachment in the database
pub fn update_attachment_downloaded_status<R: Runtime>(
    handle: &AppHandle<R>,
    _chat_id: &str, // No longer needed - we query by event ID directly
    msg_id: &str,
    attachment_id: &str,
    downloaded: bool,
    path: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Get the current tags JSON from the events table
    let tags_json: String = conn
        .query_row(
            "SELECT tags FROM events WHERE id = ?1",
            rusqlite::params![msg_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Event not found: {}", e))?;

    // Parse the tags
    let mut tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

    // Find the "attachments" tag
    let attachments_tag_idx = tags
        .iter()
        .position(|tag| tag.first().map(|s| s.as_str()) == Some("attachments"));

    let attachments_json = attachments_tag_idx
        .and_then(|idx| tags.get(idx))
        .and_then(|tag| tag.get(1))
        .map(|s| s.as_str())
        .unwrap_or("[]");

    // Parse and update the attachment
    let mut attachments: Vec<Attachment> =
        serde_json::from_str(attachments_json).unwrap_or_default();

    if let Some(att) = attachments.iter_mut().find(|a| a.id == attachment_id) {
        att.downloaded = downloaded;
        att.downloading = false;
        att.path = path.to_string();
    } else {
        crate::account_manager::return_db_connection(conn);
        return Err("Attachment not found in event".to_string());
    }

    // Serialize the updated attachments back to JSON
    let updated_attachments_json = serde_json::to_string(&attachments)
        .map_err(|e| format!("Failed to serialize attachments: {}", e))?;

    // Update the tags array - either update existing "attachments" tag or add new one
    if let Some(idx) = attachments_tag_idx {
        tags[idx] = vec!["attachments".to_string(), updated_attachments_json];
    } else {
        tags.push(vec!["attachments".to_string(), updated_attachments_json]);
    }

    // Serialize the tags back to JSON
    let updated_tags_json =
        serde_json::to_string(&tags).map_err(|e| format!("Failed to serialize tags: {}", e))?;

    // Update the event in the database
    conn.execute(
        "UPDATE events SET tags = ?1 WHERE id = ?2",
        rusqlite::params![updated_tags_json, msg_id],
    )
    .map_err(|e| format!("Failed to update event: {}", e))?;

    crate::account_manager::return_db_connection(conn);

    Ok(())
}

/// Persist link-preview metadata fetched asynchronously after a message was already saved.
///
/// The initial `save_message` call happens before the OpenGraph fetch resolves, so the event
/// row already exists and a second `save_message` is a silent no-op (`INSERT OR IGNORE`).
/// This updates the existing row's `tags` in place so the preview survives app restarts.
pub fn save_link_preview_metadata<R: Runtime>(
    handle: &AppHandle<R>,
    msg_id: &str,
    metadata: &SiteMetadata,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let tags_json: String = conn
        .query_row(
            "SELECT tags FROM events WHERE id = ?1",
            rusqlite::params![msg_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Event not found: {}", e))?;

    let mut tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

    let metadata_json = serde_json::to_string(metadata)
        .map_err(|e| format!("Failed to serialize link preview: {}", e))?;

    let link_preview_tag_idx = tags
        .iter()
        .position(|tag| tag.first().map(|s| s.as_str()) == Some("link_preview"));

    if let Some(idx) = link_preview_tag_idx {
        tags[idx] = vec!["link_preview".to_string(), metadata_json];
    } else {
        tags.push(vec!["link_preview".to_string(), metadata_json]);
    }

    let updated_tags_json =
        serde_json::to_string(&tags).map_err(|e| format!("Failed to serialize tags: {}", e))?;

    conn.execute(
        "UPDATE events SET tags = ?1 WHERE id = ?2",
        rusqlite::params![updated_tags_json, msg_id],
    )
    .map_err(|e| format!("Failed to update event: {}", e))?;

    crate::account_manager::return_db_connection(conn);

    Ok(())
}

#[cfg(test)]
mod link_preview_persistence_tests {
    use super::*;
    use crate::net::SiteMetadata;

    /// Regression test: an OpenGraph preview fetched after the message was already saved
    /// must still be there after a fresh load from the DB (simulating an app restart),
    /// not just in the in-memory STATE.
    #[tokio::test]
    async fn link_preview_survives_reload_from_db() {
        let test_npub = "npub1linkpreviewreloadtest";
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();

        let app = tauri::test::mock_app();

        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);

        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);

        crate::set_encryption_key([9u8; 32]);

        let chat_id = "npub1linkpreviewreloadpeer";
        let message = Message {
            id: "link-preview-reload-test-msg".to_string(),
            content: "check https://example.com out".to_string(),
            mine: true,
            at: 1_700_000_000_000,
            ..Default::default()
        };
        save_message(app.handle().clone(), chat_id, &message)
            .await
            .unwrap();

        let metadata = SiteMetadata {
            domain: "example.com".to_string(),
            og_title: Some("Example title".to_string()),
            og_description: Some("Example description".to_string()),
            og_image: Some("https://example.com/img.png".to_string()),
            og_url: None,
            og_type: None,
            title: None,
            description: None,
            favicon: None,
            og_image_cached: None,
            favicon_cached: None,
        };
        save_link_preview_metadata(app.handle(), &message.id, &metadata).unwrap();

        // Simulate an app restart: reload purely from the DB, bypassing in-memory STATE.
        let chat_int_id = get_or_create_chat_id(app.handle(), chat_id).unwrap();
        let loaded = get_message_views(app.handle(), chat_int_id, 10, 0, None)
            .await
            .unwrap();
        let loaded_msg = loaded
            .iter()
            .find(|m| m.id == message.id)
            .expect("message should be loaded from DB");

        assert_eq!(loaded_msg.preview_metadata.as_ref(), Some(&metadata));

        crate::clear_encryption_key();
        crate::account_manager::close_db_connection();
    }
}

/// Vacuum the database to reclaim space and optimize performance
pub fn vacuum_database<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute_batch("VACUUM;")
        .map_err(|e| format!("Failed to vacuum database: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    println!("[DB] Database vacuumed successfully");
    Ok(())
}

/// Check if vacuum is needed and perform it if so
/// Vacuums if it hasn't been done in the last 7 days
pub async fn check_and_vacuum_if_needed<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Check when last vacuum was performed
    let last_vacuum: Option<i64> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'last_vacuum'",
            [],
            |row| row.get(0),
        )
        .ok()
        .and_then(|s: String| s.parse().ok());

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let seven_days_secs = 7 * 24 * 60 * 60;

    let should_vacuum = match last_vacuum {
        Some(last) => now - last > seven_days_secs,
        None => true, // Never vacuumed
    };

    crate::account_manager::return_db_connection(conn);

    if should_vacuum {
        vacuum_database(handle)?;

        // Update last vacuum timestamp
        let conn = crate::account_manager::get_db_connection(handle)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_vacuum', ?1)",
            rusqlite::params![now.to_string()],
        )
        .map_err(|e| format!("Failed to update last_vacuum: {}", e))?;
        crate::account_manager::return_db_connection(conn);
    }

    Ok(())
}

// ============================================================================
// Event Storage Functions (Flat Event-Based Architecture)
// ============================================================================

/// Save a StoredEvent to the events table
///
/// This is the primary storage function for the flat event architecture.
/// All events (messages, reactions, attachments, etc.) are stored as flat rows.
pub async fn save_event<R: Runtime>(
    handle: &AppHandle<R>,
    event: &StoredEvent,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Serialize tags to JSON
    let tags_json = serde_json::to_string(&event.tags).unwrap_or_else(|_| "[]".to_string());

    // For message and edit events, encrypt the content
    let content = if event.kind == event_kind::PRIVATE_DIRECT_MESSAGE
        || event.kind == event_kind::MESSAGE_EDIT
    {
        internal_encrypt(event.content.clone()).await
    } else {
        event.content.clone()
    };

    // Use INSERT OR IGNORE to skip if event already exists (deduplication)
    conn.execute(
        r#"
        INSERT OR IGNORE INTO events (
            id, kind, chat_id, user_id, content, tags, reference_id,
            created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        "#,
        rusqlite::params![
            event.id,
            event.kind as i32,
            event.chat_id,
            event.user_id,
            content,
            tags_json,
            event.reference_id,
            event.created_at as i64,
            event.received_at as i64,
            event.mine as i32,
            event.pending as i32,
            event.failed as i32,
            event.wrapper_event_id,
            event.npub,
            event.virtual_bucket,
        ],
    )
    .map_err(|e| format!("Failed to save event: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Save a reaction as a kind=7 event in the events table
///
/// Reactions are stored as separate events referencing the message they react to.
/// This is the Nostr-standard way to store reactions (NIP-25).
pub async fn save_reaction_event<R: Runtime>(
    handle: &AppHandle<R>,
    reaction: &Reaction,
    chat_id: i64,
    user_id: Option<i64>,
    mine: bool,
) -> Result<(), String> {
    let event = StoredEvent {
        id: reaction.id.clone(),
        kind: event_kind::REACTION,
        chat_id,
        user_id,
        content: reaction.emoji.clone(),
        tags: vec![vec!["e".to_string(), reaction.reference_id.clone()]],
        reference_id: Some(reaction.reference_id.clone()),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        received_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        mine,
        pending: false,
        failed: false,
        wrapper_event_id: None,
        npub: Some(reaction.author_id.clone()),
        virtual_bucket: None,
    };

    save_event(handle, &event).await
}

/// Check if an event exists in the events table
pub fn event_exists<R: Runtime>(handle: &AppHandle<R>, event_id: &str) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
            rusqlite::params![event_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check event existence: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(exists)
}

/// Get events for a chat with pagination
///
/// Returns events ordered by created_at descending (newest first).
/// Optionally filter by event kinds and/or persisted `virtual_bucket`
/// (`announcements` | `inbox` | `polls` | `join_requests`) so LIMIT/OFFSET apply to the filtered set.
pub async fn get_events<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: i64,
    kinds: Option<&[u16]>,
    limit: usize,
    offset: usize,
    virtual_bucket_filter: Option<&str>,
) -> Result<Vec<StoredEvent>, String> {
    let bucket = virtual_bucket_filter
        .map(str::trim)
        .filter(|w| matches!(*w, "announcements" | "inbox" | "polls" | "join_requests"));

    // Do all SQLite work synchronously in a block to avoid Send issues
    let events: Vec<StoredEvent> = {
        let conn = crate::account_manager::get_db_connection(handle)?;

        let events = if let Some(k) = kinds {
            let kind_placeholders: String = (0..k.len())
                .map(|i| format!("?{}", i + 2))
                .collect::<Vec<_>>()
                .join(",");
            let mut next = k.len() + 2;
            let bucket_clause = if bucket.is_some() {
                let clause = format!(" AND virtual_bucket = ?{next}");
                next += 1;
                clause
            } else {
                String::new()
            };
            let limit_param = next;
            let offset_param = next + 1;

            let sql = format!(
                r#"
                SELECT id, kind, chat_id, user_id, content, tags, reference_id,
                       created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
                FROM events
                WHERE chat_id = ?1 AND kind IN ({kind_placeholders}){bucket_clause}
                ORDER BY created_at DESC
                LIMIT ?{limit_param} OFFSET ?{offset_param}
                "#
            );

            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("Failed to prepare events query: {}", e))?;

            let result: Vec<StoredEvent> = match (k.len(), bucket) {
                (1, None) => {
                    let rows = stmt
                        .query_map(
                            rusqlite::params![chat_id, k[0] as i32, limit as i64, offset as i64],
                            parse_event_row,
                        )
                        .map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                }
                (2, None) => {
                    let rows = stmt
                        .query_map(
                            rusqlite::params![
                                chat_id,
                                k[0] as i32,
                                k[1] as i32,
                                limit as i64,
                                offset as i64
                            ],
                            parse_event_row,
                        )
                        .map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                }
                (3, None) => {
                    let rows = stmt
                        .query_map(
                            rusqlite::params![
                                chat_id,
                                k[0] as i32,
                                k[1] as i32,
                                k[2] as i32,
                                limit as i64,
                                offset as i64
                            ],
                            parse_event_row,
                        )
                        .map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                }
                (1, Some(b)) => {
                    let rows = stmt
                        .query_map(
                            rusqlite::params![chat_id, k[0] as i32, b, limit as i64, offset as i64],
                            parse_event_row,
                        )
                        .map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                }
                (2, Some(b)) => {
                    let rows = stmt
                        .query_map(
                            rusqlite::params![
                                chat_id,
                                k[0] as i32,
                                k[1] as i32,
                                b,
                                limit as i64,
                                offset as i64
                            ],
                            parse_event_row,
                        )
                        .map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                }
                (3, Some(b)) => {
                    let rows = stmt
                        .query_map(
                            rusqlite::params![
                                chat_id,
                                k[0] as i32,
                                k[1] as i32,
                                k[2] as i32,
                                b,
                                limit as i64,
                                offset as i64
                            ],
                            parse_event_row,
                        )
                        .map_err(|e| format!("Failed to query events: {}", e))?;
                    rows.filter_map(|r| r.ok()).collect()
                }
                _ => {
                    drop(stmt);
                    crate::account_manager::return_db_connection(conn);
                    return Err("Unsupported number of kinds".to_string());
                }
            };

            drop(stmt);
            result
        } else if let Some(b) = bucket {
            let sql = r#"
                SELECT id, kind, chat_id, user_id, content, tags, reference_id,
                       created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
                FROM events
                WHERE chat_id = ?1 AND virtual_bucket = ?2
                ORDER BY created_at DESC
                LIMIT ?3 OFFSET ?4
            "#;

            let mut stmt = conn
                .prepare(sql)
                .map_err(|e| format!("Failed to prepare events query: {}", e))?;

            let rows = stmt
                .query_map(
                    rusqlite::params![chat_id, b, limit as i64, offset as i64],
                    parse_event_row,
                )
                .map_err(|e| format!("Failed to query events: {}", e))?;
            let result: Vec<StoredEvent> = rows.filter_map(|r| r.ok()).collect();

            drop(stmt);
            result
        } else {
            let sql = r#"
                SELECT id, kind, chat_id, user_id, content, tags, reference_id,
                       created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
                FROM events
                WHERE chat_id = ?1
                ORDER BY created_at DESC
                LIMIT ?2 OFFSET ?3
            "#;

            let mut stmt = conn
                .prepare(sql)
                .map_err(|e| format!("Failed to prepare events query: {}", e))?;

            let rows = stmt
                .query_map(
                    rusqlite::params![chat_id, limit as i64, offset as i64],
                    parse_event_row,
                )
                .map_err(|e| format!("Failed to query events: {}", e))?;
            let result: Vec<StoredEvent> = rows.filter_map(|r| r.ok()).collect();

            drop(stmt);
            result
        };

        crate::account_manager::return_db_connection(conn);
        events
    };

    // Decrypt message content for text messages (this is the async part)
    let mut decrypted_events = Vec::with_capacity(events.len());
    for mut event in events {
        if event.kind == event_kind::PRIVATE_DIRECT_MESSAGE {
            event.content = internal_decrypt(event.content)
                .await
                .unwrap_or_else(|_| "[Decryption failed]".to_string());
        }
        decrypted_events.push(event);
    }

    Ok(decrypted_events)
}

/// Helper function to parse a row into a StoredEvent
fn parse_event_row(row: &rusqlite::Row) -> rusqlite::Result<StoredEvent> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

    Ok(StoredEvent {
        id: row.get(0)?,
        kind: row.get::<_, i32>(1)? as u16,
        chat_id: row.get(2)?,
        user_id: row.get(3)?,
        content: row.get(4)?,
        tags,
        reference_id: row.get(6)?,
        created_at: row.get::<_, i64>(7)? as u64,
        received_at: row.get::<_, i64>(8)? as u64,
        mine: row.get::<_, i32>(9)? != 0,
        pending: row.get::<_, i32>(10)? != 0,
        failed: row.get::<_, i32>(11)? != 0,
        wrapper_event_id: row.get(12)?,
        npub: row.get(13)?,
        virtual_bucket: row.get(14)?,
    })
}

/// Get events that reference specific message IDs
///
/// Used to fetch reactions and attachments for a set of messages.
/// This is the core function for building materialized views.
pub async fn get_related_events<R: Runtime>(
    handle: &AppHandle<R>,
    reference_ids: &[String],
) -> Result<Vec<StoredEvent>, String> {
    if reference_ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = crate::account_manager::get_db_connection(handle)?;

    let placeholders: String = reference_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        r#"
        SELECT id, kind, chat_id, user_id, content, tags, reference_id,
               created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
        FROM events
        WHERE reference_id IN ({})
        ORDER BY created_at ASC, rowid ASC
        "#,
        placeholders
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare related events query: {}", e))?;

    let params: Vec<&dyn rusqlite::ToSql> = reference_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let events: Vec<StoredEvent> = stmt
        .query_map(params.as_slice(), |row| {
            let tags_json: String = row.get(5)?;
            let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();

            Ok(StoredEvent {
                id: row.get(0)?,
                kind: row.get::<_, i32>(1)? as u16,
                chat_id: row.get(2)?,
                user_id: row.get(3)?,
                content: row.get(4)?,
                tags,
                reference_id: row.get(6)?,
                created_at: row.get::<_, i64>(7)? as u64,
                received_at: row.get::<_, i64>(8)? as u64,
                mine: row.get::<_, i32>(9)? != 0,
                pending: row.get::<_, i32>(10)? != 0,
                failed: row.get::<_, i32>(11)? != 0,
                wrapper_event_id: row.get(12)?,
                npub: row.get(13)?,
                virtual_bucket: row.get(14)?,
            })
        })
        .map_err(|e| format!("Failed to query related events: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Drop statement to release borrow on conn
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(events)
}

/// Context data for a replied-to message
struct ReplyContext {
    content: String,
    npub: Option<String>,
    has_attachment: bool,
}

/// Shared persisted author/chat/signed-time/first-receipt checks for live edits
/// and reply previews. Keep aligned with `stored_edit_is_authorized`.
fn authorized_edits_from_sql() -> String {
    format!(
        r#"
        FROM events e
        JOIN events m ON m.id = e.reference_id
        JOIN chats c ON c.id = m.chat_id
        WHERE e.kind = {edit_kind}
          AND m.kind = {text_kind}
          AND NOT EXISTS (SELECT 1 FROM messages legacy WHERE legacy.id = m.id)
          AND e.chat_id = m.chat_id
          AND CASE
                WHEN m.mine = 1 THEN e.mine = 1
                ELSE e.mine = 0 AND e.npub = COALESCE(
                  m.npub,
                  CASE WHEN c.chat_type = {dm_type} THEN c.chat_identifier END
                )
              END
          AND e.created_at BETWEEN m.created_at AND m.created_at + {window}
          AND m.received_at > 0 AND e.received_at > 0
          AND e.received_at - m.received_at <= {receipt_window}
        "#,
        edit_kind = event_kind::MESSAGE_EDIT,
        text_kind = event_kind::PRIVATE_DIRECT_MESSAGE,
        dm_type = crate::chat::ChatType::DirectMessage.to_i32(),
        window = crate::message::EDIT_WINDOW_SECS,
        receipt_window = crate::message::EDIT_WINDOW_SECS * 1000,
    )
}

fn latest_authorized_edits_sql(placeholders: &str) -> String {
    format!(
        "SELECT e.reference_id, e.content, e.created_at, e.tags {} AND e.reference_id IN ({placeholders}) ORDER BY e.created_at DESC, e.rowid DESC",
        authorized_edits_from_sql(),
    )
}

fn saved_edit_is_authorized_conn(
    conn: &rusqlite::Connection,
    edit_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 {} AND e.id = ?1)",
            authorized_edits_from_sql()
        ),
        [edit_id],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to authorize saved edit: {e}"))
}

/// Authorize using the saved edit and original, so reloads and replays cannot
/// reset the deadline. Missing rows or receipt evidence fail closed.
pub fn saved_edit_is_authorized<R: Runtime>(
    handle: &AppHandle<R>,
    edit_id: &str,
) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = saved_edit_is_authorized_conn(&conn, edit_id);
    crate::account_manager::return_db_connection(conn);
    result
}

/// Saved, authorized edits used to reconcile live state when either side arrives first.
pub(crate) async fn get_authorized_message_edits<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    message_id: &str,
) -> Result<Vec<StoredEvent>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = (|| {
        let sql = format!(
            "SELECT e.id, e.kind, e.chat_id, e.user_id, e.content, e.tags, e.reference_id,
                    e.created_at, e.received_at, e.mine, e.pending, e.failed,
                    e.wrapper_event_id, e.npub, e.virtual_bucket
             {} AND m.id = ?1 AND c.chat_identifier = ?2
             ORDER BY e.created_at ASC, e.rowid ASC",
            authorized_edits_from_sql(),
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([message_id, chat_id], parse_event_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })();
    crate::account_manager::return_db_connection(conn);
    let mut edits = result?;
    for edit in &mut edits {
        edit.content = internal_decrypt(edit.content.clone())
            .await
            .map_err(|_| "Failed to decrypt saved edit".to_string())?;
    }
    Ok(edits)
}

/// Check a locally built edit before publishing, using its captured first-seen
/// time and the persisted original. V7's retained message rows lack receipt evidence.
fn edit_is_authorized_before_save_conn(
    conn: &rusqlite::Connection,
    edit: &StoredEvent,
) -> Result<bool, String> {
    if edit.kind != event_kind::MESSAGE_EDIT {
        return Ok(false);
    }
    let Some(reference_id) = edit.reference_id.as_deref() else {
        return Ok(false);
    };
    let original = conn.query_row(
        "SELECT id, kind, chat_id, user_id, content, tags, reference_id,
                created_at, received_at, mine, pending, failed, wrapper_event_id, npub, virtual_bucket
         FROM events m WHERE id = ?1
           AND NOT EXISTS (SELECT 1 FROM messages legacy WHERE legacy.id = m.id)",
        [reference_id],
        parse_event_row,
    ).optional().map_err(|e| format!("Failed to load edit original: {e}"))?;
    Ok(original.is_some_and(|original| {
        stored_edit_is_authorized(
            &original,
            edit,
            dm_peer_for_chat(conn, original.chat_id).as_deref(),
            edit.timestamp_ms(),
        )
    }))
}

pub fn edit_is_authorized_before_save<R: Runtime>(
    handle: &AppHandle<R>,
    edit: &StoredEvent,
) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = edit_is_authorized_before_save_conn(&conn, edit);
    crate::account_manager::return_db_connection(conn);
    result
}

/// The peer npub when `chat_id` is a DM (DM chats are keyed by it), `None` otherwise.
fn dm_peer_for_chat(conn: &rusqlite::Connection, chat_id: i64) -> Option<String> {
    conn.query_row(
        "SELECT chat_identifier FROM chats WHERE id = ?1 AND chat_type = ?2",
        rusqlite::params![chat_id, crate::chat::ChatType::DirectMessage.to_i32()],
        |row| row.get(0),
    )
    .ok()
}

#[cfg(test)]
mod edit_authorization_sql_tests {
    use super::*;
    use crate::stored_event::StoredEventBuilder;

    const T: i64 = 1_700_000_000;

    fn insert(
        conn: &rusqlite::Connection,
        id: &str,
        kind: u16,
        chat_id: i64,
        reference_id: Option<&str>,
        content: &str,
        created_at: i64,
        mine: bool,
        npub: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO events (id, kind, chat_id, content, reference_id, created_at, received_at, mine, npub)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6 * 1000, ?7, ?8)",
            rusqlite::params![id, kind, chat_id, content, reference_id, created_at, mine as i32, npub],
        )
        .expect("insert");
    }

    fn latest_edits(conn: &rusqlite::Connection, ids: &[&str]) -> Vec<(String, String)> {
        let placeholders = (1..=ids.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(",");
        let mut stmt = conn
            .prepare(&latest_authorized_edits_sql(&placeholders))
            .expect("prepare");
        stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .expect("query")
        .filter_map(|r| r.ok())
        .collect()
    }

    #[test]
    fn keeps_only_author_edits_inside_window_and_chat() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        for chat in ["chat-1", "chat-2"] {
            conn.execute(
                "INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES (?1, 0, '[]', 0)",
                [chat],
            )
            .expect("chat");
        }
        let text = event_kind::PRIVATE_DIRECT_MESSAGE;
        let edit = event_kind::MESSAGE_EDIT;

        insert(
            &conn,
            "alice-msg",
            text,
            1,
            None,
            "hi",
            T,
            false,
            Some("npub1alice"),
        );
        insert(
            &conn,
            "e-ok",
            edit,
            1,
            Some("alice-msg"),
            "hello",
            T + 10,
            false,
            Some("npub1alice"),
        );
        insert(
            &conn,
            "e-other",
            edit,
            1,
            Some("alice-msg"),
            "pwned",
            T + 20,
            false,
            Some("npub1mallory"),
        );
        insert(
            &conn,
            "e-me",
            edit,
            1,
            Some("alice-msg"),
            "mine",
            T + 20,
            true,
            None,
        );
        insert(
            &conn,
            "e-chat",
            edit,
            2,
            Some("alice-msg"),
            "elsewhere",
            T + 20,
            false,
            Some("npub1alice"),
        );
        insert(
            &conn,
            "e-late",
            edit,
            1,
            Some("alice-msg"),
            "late",
            T + 61,
            false,
            Some("npub1alice"),
        );
        insert(
            &conn,
            "e-early",
            edit,
            1,
            Some("alice-msg"),
            "predated",
            T - 1,
            false,
            Some("npub1alice"),
        );

        insert(&conn, "my-msg", text, 1, None, "draft", T, true, None);
        insert(
            &conn,
            "e-mine",
            edit,
            1,
            Some("my-msg"),
            "final",
            T + 60,
            true,
            None,
        );

        let mut rows = latest_edits(&conn, &["alice-msg", "my-msg"]);
        rows.sort();
        assert_eq!(
            rows,
            vec![
                ("alice-msg".to_string(), "hello".to_string()),
                ("my-msg".to_string(), "final".to_string()),
            ]
        );
    }

    #[test]
    fn null_author_fallback_applies_only_to_the_dm_peer() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES ('npub1peer', 0, '[\"npub1peer\"]', 0)",
            [],
        )
        .expect("dm");
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES ('abcdef01', 1, '[]', 0)",
            [],
        )
        .expect("group");
        let text = event_kind::PRIVATE_DIRECT_MESSAGE;
        let edit = event_kind::MESSAGE_EDIT;

        // DM row with no stored sender: only the peer may edit it.
        insert(&conn, "dm-msg", text, 1, None, "hi", T, false, None);
        insert(
            &conn,
            "dm-peer",
            edit,
            1,
            Some("dm-msg"),
            "hello",
            T + 5,
            false,
            Some("npub1peer"),
        );
        insert(
            &conn,
            "dm-other",
            edit,
            1,
            Some("dm-msg"),
            "pwned",
            T + 10,
            false,
            Some("npub1mallory"),
        );

        // Group row with no stored sender: no member can prove authorship.
        insert(&conn, "grp-msg", text, 2, None, "hi", T, false, None);
        insert(
            &conn,
            "grp-other",
            edit,
            2,
            Some("grp-msg"),
            "pwned",
            T + 5,
            false,
            Some("npub1mallory"),
        );

        assert_eq!(dm_peer_for_chat(&conn, 1).as_deref(), Some("npub1peer"));
        assert_eq!(dm_peer_for_chat(&conn, 2), None);

        let mut rows = latest_edits(&conn, &["dm-msg", "grp-msg"]);
        rows.sort();
        assert_eq!(rows, vec![("dm-msg".to_string(), "hello".to_string())]);
    }

    #[test]
    fn receipt_deadline_matches_reconstruction_and_reply_preview() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES ('npub1alice', 0, '[]', 0)",
            [],
        ).unwrap();
        let receipt = T as u64 * 1000;
        let mut original = StoredEventBuilder::new()
            .id("original".to_string())
            .kind(event_kind::PRIVATE_DIRECT_MESSAGE)
            .created_at(T as u64)
            .npub(Some("npub1alice".to_string()))
            .build();
        original.chat_id = 1;
        original.received_at = receipt;
        insert(
            &conn,
            &original.id,
            original.kind,
            1,
            None,
            "original",
            T,
            false,
            Some("npub1alice"),
        );

        for (id, signed_at, received_at, expected) in [
            ("boundary", T + 1, receipt + 60_000, true),
            // Backdating the signed event does not extend the local deadline.
            ("backdated-late", T + 1, receipt + 60_001, false),
            ("predated", T - 1, receipt + 1_000, false),
            ("signed-late", T + 61, receipt + 1_000, false),
            // Relay order can put a valid edit before its original.
            ("out-of-order", T + 1, receipt - 1_000, true),
            ("missing-receipt", T + 1, 0, false),
        ] {
            let mut edit = StoredEventBuilder::new()
                .id(id.to_string())
                .kind(event_kind::MESSAGE_EDIT)
                .reference_id(Some(original.id.clone()))
                .created_at(signed_at as u64)
                .npub(Some("npub1alice".to_string()))
                .build();
            edit.chat_id = 1;
            edit.received_at = received_at;
            insert(
                &conn,
                id,
                edit.kind,
                1,
                Some(&original.id),
                id,
                signed_at,
                false,
                Some("npub1alice"),
            );
            conn.execute(
                "UPDATE events SET received_at = ?1 WHERE id = ?2",
                rusqlite::params![received_at as i64, id],
            )
            .unwrap();
            assert_eq!(
                stored_edit_is_authorized(
                    &original,
                    &edit,
                    Some("npub1alice"),
                    edit.timestamp_ms()
                ),
                expected,
                "reconstruction: {id}",
            );
            assert_eq!(
                edit_is_authorized_before_save_conn(&conn, &edit).unwrap(),
                expected,
                "preflight: {id}"
            );
            assert_eq!(
                saved_edit_is_authorized_conn(&conn, id).unwrap(),
                expected,
                "live gate: {id}"
            );
            assert_eq!(
                latest_edits(&conn, &[&original.id])
                    .iter()
                    .any(|(_, content)| content == id),
                expected,
                "reply preview: {id}",
            );
        }

        original.received_at = 0;
        let mut edit = original.clone();
        edit.kind = event_kind::MESSAGE_EDIT;
        edit.received_at = receipt;
        assert!(!stored_edit_is_authorized(
            &original,
            &edit,
            Some("npub1alice"),
            edit.timestamp_ms()
        ));
        conn.execute(
            "UPDATE events SET received_at = 0 WHERE id = 'original'",
            [],
        )
        .unwrap();
        assert!(latest_edits(&conn, &[&original.id]).is_empty());
        assert!(!saved_edit_is_authorized_conn(&conn, "boundary").unwrap());
        assert!(!saved_edit_is_authorized_conn(&conn, "absent").unwrap());
        conn.execute("DELETE FROM events WHERE id = 'original'", [])
            .unwrap();
        assert!(!saved_edit_is_authorized_conn(&conn, "boundary").unwrap());
    }

    #[test]
    fn local_edit_preflight_uses_captured_first_seen_and_rejects_legacy_receipts() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        conn.execute("INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES ('npub1peer', 0, '[]', 0)", []).unwrap();
        insert(
            &conn,
            "own-original",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            1,
            None,
            "original",
            T,
            true,
            None,
        );
        let mut edit = StoredEventBuilder::new()
            .id("own-edit".to_string())
            .kind(event_kind::MESSAGE_EDIT)
            .reference_id(Some("own-original".to_string()))
            .created_at(T as u64 + 60)
            .mine(true)
            .build();
        edit.chat_id = 1;
        edit.received_at = T as u64 * 1000 + 60_000;
        assert!(edit_is_authorized_before_save_conn(&conn, &edit).unwrap());
        edit.received_at += 1;
        assert!(!edit_is_authorized_before_save_conn(&conn, &edit).unwrap());
        edit.received_at -= 1;
        insert(
            &conn,
            &edit.id,
            edit.kind,
            1,
            edit.reference_id.as_deref(),
            "edit",
            T + 60,
            true,
            None,
        );
        assert!(saved_edit_is_authorized_conn(&conn, &edit.id).unwrap());

        // V7 copied sender time into received_at; the retained source row proves
        // this is not a locally observed first receipt even at the boundary.
        conn.execute("INSERT INTO messages (id, chat_id, content_encrypted, at, mine) VALUES ('own-original', 1, 'original', ?1, 1)", [T * 1000]).unwrap();
        assert!(!edit_is_authorized_before_save_conn(&conn, &edit).unwrap());
        assert!(!saved_edit_is_authorized_conn(&conn, &edit.id).unwrap());
        assert!(latest_edits(&conn, &["own-original"]).is_empty());
    }

    #[test]
    fn stored_edit_check_matches_sql_rules() {
        let stored = |npub: Option<&str>| {
            StoredEventBuilder::new()
                .id("m".to_string())
                .kind(event_kind::PRIVATE_DIRECT_MESSAGE)
                .created_at(T as u64)
                .mine(false)
                .npub(npub.map(str::to_string))
                .build()
        };
        let original = stored(Some("npub1alice"));
        let edit = |npub: &str, chat_id: i64| {
            let mut e = StoredEventBuilder::new()
                .id("e".to_string())
                .kind(event_kind::MESSAGE_EDIT)
                .created_at(T as u64 + 5)
                .mine(false)
                .npub(Some(npub.to_string()))
                .build();
            e.chat_id = chat_id;
            e
        };
        let chat = original.chat_id;
        let at = (T as u64 + 5) * 1000;
        assert!(stored_edit_is_authorized(
            &original,
            &edit("npub1alice", chat),
            None,
            at
        ));
        assert!(!stored_edit_is_authorized(
            &original,
            &edit("npub1mallory", chat),
            None,
            at
        ));
        assert!(!stored_edit_is_authorized(
            &original,
            &edit("npub1alice", chat + 1),
            None,
            at
        ));
        assert!(!stored_edit_is_authorized(
            &original,
            &edit("npub1alice", chat),
            None,
            (T as u64 + 61) * 1000
        ));
        assert!(!stored_edit_is_authorized(
            &original,
            &edit("npub1alice", chat),
            None,
            (T as u64 - 1) * 1000
        ));

        let legacy = stored(None);
        assert!(stored_edit_is_authorized(
            &legacy,
            &edit("npub1alice", chat),
            Some("npub1alice"),
            at
        ));
        assert!(!stored_edit_is_authorized(
            &legacy,
            &edit("npub1mallory", chat),
            Some("npub1alice"),
            at
        ));
        assert!(!stored_edit_is_authorized(
            &legacy,
            &edit("npub1mallory", chat),
            None,
            at
        ));
    }
}

/// Fetch reply context for a list of message IDs
/// Returns a HashMap of message_id -> ReplyContext
async fn get_reply_contexts<R: Runtime>(
    handle: &AppHandle<R>,
    message_ids: &[String],
) -> Result<HashMap<String, ReplyContext>, String> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Do all SQLite work synchronously in a block to avoid Send issues
    let (events, edits): (
        Vec<(String, i32, String, Option<String>, i32)>,
        Vec<(String, String, u64)>,
    ) = {
        let conn = crate::account_manager::get_db_connection(handle)?;

        // Build placeholders for IN clause
        let placeholders: String = (0..message_ids.len())
            .map(|i| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");

        // Query original messages
        let sql = format!(
            r#"
            SELECT id, kind, content, npub, mine
            FROM events
            WHERE id IN ({})
            "#,
            placeholders
        );

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare reply context query: {}", e))?;

        // Build params as String refs for the query
        let params: Vec<&str> = message_ids.iter().map(|s| s.as_str()).collect();
        let params_dyn: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

        let rows = stmt
            .query_map(params_dyn.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,         // id
                    row.get::<_, i32>(1)?,            // kind
                    row.get::<_, String>(2)?,         // content
                    row.get::<_, Option<String>>(3)?, // npub
                    row.get::<_, i32>(4)?,            // mine
                ))
            })
            .map_err(|e| format!("Failed to query reply contexts: {}", e))?;

        let events_result: Vec<(String, i32, String, Option<String>, i32)> =
            rows.filter_map(|r| r.ok()).collect();
        drop(stmt);

        let edit_sql = latest_authorized_edits_sql(&placeholders);

        let mut edit_stmt = conn
            .prepare(&edit_sql)
            .map_err(|e| format!("Failed to prepare edit query: {}", e))?;

        let edit_rows = edit_stmt
            .query_map(params_dyn.as_slice(), |row| {
                let tags: Vec<Vec<String>> =
                    serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default();
                Ok((
                    row.get::<_, String>(0)?, // reference_id (original message id)
                    row.get::<_, String>(1)?, // content (edited content)
                    crate::stored_event::timestamp_ms_from_tags(
                        row.get::<_, i64>(2)? as u64,
                        &tags,
                    ),
                ))
            })
            .map_err(|e| format!("Failed to query edits: {}", e))?;

        let mut edits_result: Vec<(String, String, u64)> =
            edit_rows.filter_map(|r| r.ok()).collect();
        // Stable sort retains rowid DESC for edits with identical timestamps.
        edits_result.sort_by_key(|(_, _, at)| std::cmp::Reverse(*at));
        drop(edit_stmt);

        crate::account_manager::return_db_connection(conn);
        (events_result, edits_result)
    };

    // Build a map of message_id -> latest edit content (first one since ordered DESC)
    let mut latest_edits: HashMap<String, String> = HashMap::new();
    for (ref_id, content, _) in edits {
        // Only keep the first (most recent) edit for each message
        latest_edits.entry(ref_id).or_insert(content);
    }

    // Process events and decrypt content (async part)
    let mut contexts = HashMap::new();
    for (id, kind, original_content, npub, mine) in events {
        let has_attachment = kind == event_kind::FILE_ATTACHMENT as i32;

        // DM messages don't store the sender npub directly. For our own outbound DMs
        // the npub column is NULL, so derive it from the current account so reply
        // bars can render "You" instead of "Unknown".
        let npub = if mine != 0 && npub.is_none() {
            crate::account_manager::get_current_account().ok()
        } else {
            npub
        };

        // Use latest edit content if available, otherwise use original
        let content_to_decrypt = latest_edits.get(&id).cloned().unwrap_or(original_content);

        // Decrypt content for text messages
        let decrypted_content = if kind == event_kind::PRIVATE_DIRECT_MESSAGE as i32 {
            internal_decrypt(content_to_decrypt)
                .await
                .unwrap_or_else(|_| "[Decryption failed]".to_string())
        } else {
            // File attachments don't have displayable content
            String::new()
        };

        contexts.insert(
            id,
            ReplyContext {
                content: decrypted_content,
                npub,
                has_attachment,
            },
        );
    }

    Ok(contexts)
}

/// Populate reply context for a single message before emitting to frontend
/// This is used for real-time messages that don't go through get_message_views
pub async fn populate_reply_context<R: Runtime>(
    handle: &AppHandle<R>,
    message: &mut Message,
) -> Result<(), String> {
    if message.replied_to.is_empty() {
        return Ok(());
    }

    let contexts = get_reply_contexts(handle, &[message.replied_to.clone()]).await?;

    if let Some(ctx) = contexts.get(&message.replied_to) {
        message.replied_to_content = Some(ctx.content.clone());
        message.replied_to_npub = ctx.npub.clone();
        message.replied_to_has_attachment = Some(ctx.has_attachment);
    }

    Ok(())
}

/// One-time repair for reaction rows persisted before the author_id hex/bech32 fix
/// (pacto-app-rmq.2): `react_to_message`/`process_reaction` used to store the
/// reactor's raw hex pubkey in the `npub` column instead of a bech32 npub, which
/// breaks reactor identity resolution (profile lookup, "own reaction" detection,
/// the reactor tooltip). Hex pubkeys are always 64 hex chars; bech32 npubs are 63
/// chars (`npub1` + data + checksum), so the length alone reliably distinguishes
/// them. Idempotent and cheap to call on every connection open: the scan matches
/// nothing once a database has been repaired once.
pub fn repair_legacy_hex_reaction_npubs(conn: &rusqlite::Connection) -> Result<(), String> {
    let rows: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, npub FROM events WHERE kind = ?1 AND npub IS NOT NULL AND length(npub) = 64")
            .map_err(|e| format!("Failed to prepare legacy reaction npub scan: {}", e))?;
        let result: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![event_kind::REACTION], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to scan legacy reaction npubs: {}", e))?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    for (id, hex_npub) in rows {
        let Ok(pubkey) = nostr_sdk::PublicKey::from_hex(&hex_npub) else {
            continue;
        };
        let bech32 = pubkey
            .to_bech32()
            .expect("PublicKey::to_bech32 is infallible");
        conn.execute(
            "UPDATE events SET npub = ?1 WHERE id = ?2",
            rusqlite::params![bech32, id],
        )
        .map_err(|e| format!("Failed to repair legacy reaction npub for {}: {}", id, e))?;
    }

    Ok(())
}

#[cfg(test)]
mod legacy_reaction_npub_repair_tests {
    use super::*;

    fn insert_reaction_event(conn: &rusqlite::Connection, id: &str, npub: &str) {
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata, notification_level)
             VALUES ('chat-1', 0, '[]', '', 1000, '{}', 'mentions')",
            [],
        )
        .expect("chat");
        conn.execute(
            "INSERT INTO events (id, kind, chat_id, content, tags, created_at, received_at, mine, npub)
             VALUES (?1, ?2, 1, '👍', '[]', 1000, 1000, 0, ?3)",
            rusqlite::params![id, event_kind::REACTION, npub],
        )
        .expect("event");
    }

    #[test]
    fn converts_hex_reaction_npub_to_bech32() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        let keys = nostr_sdk::Keys::generate();
        let hex = keys.public_key().to_hex();
        let bech32 = keys.public_key().to_bech32().unwrap();
        insert_reaction_event(&conn, "reaction-1", &hex);

        repair_legacy_hex_reaction_npubs(&conn).expect("repair");

        let stored: String = conn
            .query_row(
                "SELECT npub FROM events WHERE id = 'reaction-1'",
                [],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(stored, bech32);
    }

    #[test]
    fn leaves_already_bech32_reaction_npub_untouched() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        let keys = nostr_sdk::Keys::generate();
        let bech32 = keys.public_key().to_bech32().unwrap();
        insert_reaction_event(&conn, "reaction-2", &bech32);

        repair_legacy_hex_reaction_npubs(&conn).expect("repair");

        let stored: String = conn
            .query_row(
                "SELECT npub FROM events WHERE id = 'reaction-2'",
                [],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(stored, bech32);
    }

    #[test]
    fn ignores_hex_npub_on_non_reaction_events() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata, notification_level)
             VALUES ('chat-1', 0, '[]', '', 1000, '{}', 'mentions')",
            [],
        )
        .expect("chat");
        let keys = nostr_sdk::Keys::generate();
        let hex = keys.public_key().to_hex();
        conn.execute(
            "INSERT INTO events (id, kind, chat_id, content, tags, created_at, received_at, mine, npub)
             VALUES ('msg-1', ?1, 1, 'hi', '[]', 1000, 1000, 1, ?2)",
            rusqlite::params![event_kind::PRIVATE_DIRECT_MESSAGE, hex],
        )
        .expect("event");

        repair_legacy_hex_reaction_npubs(&conn).expect("repair");

        let stored: String = conn
            .query_row("SELECT npub FROM events WHERE id = 'msg-1'", [], |row| {
                row.get(0)
            })
            .expect("row");
        assert_eq!(
            stored, hex,
            "non-reaction rows must be left untouched even if npub happens to be hex-shaped"
        );
    }
}

#[cfg(test)]
mod chat_notification_level_schema_tests {
    use super::*;

    fn column_exists(conn: &rusqlite::Connection, table: &str, column: &str) -> bool {
        conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1",
                table
            ),
            rusqlite::params![column],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false)
    }

    #[test]
    fn migrated_schema_has_notification_level_and_no_muted() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        assert!(
            column_exists(&conn, "chats", "notification_level"),
            "chats.notification_level should exist"
        );
        assert!(
            !column_exists(&conn, "chats", "muted"),
            "chats.muted should be dropped"
        );
        assert!(
            !column_exists(&conn, "profiles", "muted"),
            "profiles.muted should be dropped"
        );
    }

    #[test]
    fn a_newly_created_chat_row_defaults_to_mentions() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata)
             VALUES ('chat-1', 0, '[]', '', 1000, '{}')",
            [],
        )
        .expect("insert chat without specifying a level");

        let level: String = conn
            .query_row(
                "SELECT notification_level FROM chats WHERE chat_identifier = 'chat-1'",
                [],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(
            level, "mentions",
            "the column default alone must deliver Mentions (R10)"
        );
    }

    #[test]
    fn notification_level_round_trips_for_all_three_values() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        for (i, level) in [
            NotificationLevel::All,
            NotificationLevel::Mentions,
            NotificationLevel::Nothing,
        ]
        .iter()
        .enumerate()
        {
            let identifier = format!("chat-{}", i);
            conn.execute(
                "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata, notification_level)
                 VALUES (?1, 0, '[]', '', 1000, '{}', ?2)",
                rusqlite::params![identifier, level.as_db_str()],
            )
            .expect("insert chat");

            let stored: String = conn
                .query_row(
                    "SELECT notification_level FROM chats WHERE chat_identifier = ?1",
                    rusqlite::params![identifier],
                    |row| row.get(0),
                )
                .expect("row");
            assert_eq!(NotificationLevel::from_db_str(&stored), *level);
        }
    }

    #[test]
    fn slim_chat_payload_carries_no_muted_key() {
        let slim_chat = SlimChatDB {
            id: "chat-1".to_string(),
            chat_type: ChatType::MlsGroup,
            participants: vec![],
            last_read: String::new(),
            created_at: 0,
            metadata: crate::ChatMetadata::default(),
            notification_level: NotificationLevel::Mentions,
        };
        let json = serde_json::to_value(&slim_chat).expect("serialize");
        let obj = json.as_object().expect("object");
        assert!(
            !obj.contains_key("muted"),
            "serialized chat payload must not carry a muted key"
        );
        assert!(obj.contains_key("notification_level"));
    }
}

#[cfg(test)]
mod reply_context_fallback_tests {
    use super::*;

    /// Regression test for pacto-app-rmq.1: `message::message()`'s in-memory
    /// optimistic reply-context lookup only searches `STATE.chats[].messages`
    /// and can miss the original message entirely (e.g. it was loaded into the
    /// frontend via pagination/history but was never pushed into that
    /// in-memory vec). `message()` now falls back to `populate_reply_context`
    /// (this function) in that case, so the sender's own optimistic echo still
    /// gets a real reply preview instead of staying permanently empty. This
    /// test exercises that fallback directly against a message that exists
    /// ONLY in the DB, mirroring the actual gap.
    #[tokio::test]
    async fn populate_reply_context_fills_fields_for_text_reply_not_in_memory_state() {
        let test_npub = "npub1replycontextfallbacktext";
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();

        let app = tauri::test::mock_app();

        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);

        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);

        crate::set_encryption_key([7u8; 32]);

        // Persist the original message directly to the DB, simulating a message
        // that is not present in the backend's in-memory `STATE.chats` (the gap
        // that made the sender's own reply preview stay empty).
        let chat_id = "npub1replycontextfallbackpeer";
        let original = Message {
            id: "reply-context-fallback-original".to_string(),
            content: "the original quoted message".to_string(),
            mine: false,
            npub: Some(chat_id.to_string()),
            at: 1_700_000_000_000,
            ..Default::default()
        };
        save_message(app.handle().clone(), chat_id, &original)
            .await
            .unwrap();

        let mut reply = Message {
            id: "reply-context-fallback-reply".to_string(),
            content: "replying".to_string(),
            replied_to: original.id.clone(),
            mine: true,
            ..Default::default()
        };

        populate_reply_context(app.handle(), &mut reply)
            .await
            .unwrap();

        assert_eq!(
            reply.replied_to_content.as_deref(),
            Some("the original quoted message")
        );
        assert_eq!(reply.replied_to_npub.as_deref(), Some(chat_id));
        assert_eq!(reply.replied_to_has_attachment, Some(false));

        crate::clear_encryption_key();
        crate::account_manager::close_db_connection();
    }

    /// Same DB-only-original scenario, but the original message is a file
    /// attachment: the reply preview must flag `replied_to_has_attachment`
    /// instead of leaving content blank.
    #[tokio::test]
    async fn populate_reply_context_flags_attachment_for_file_reply_not_in_memory_state() {
        let test_npub = "npub1replycontextfallbackfile";
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();

        let app = tauri::test::mock_app();

        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);

        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);

        crate::set_encryption_key([7u8; 32]);

        let chat_id = "npub1replycontextfallbackfilepeer";
        let original = Message {
            id: "reply-context-fallback-file-original".to_string(),
            content: String::new(),
            mine: false,
            npub: Some(chat_id.to_string()),
            at: 1_700_000_000_000,
            attachments: vec![Attachment {
                extension: "png".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        };
        save_message(app.handle().clone(), chat_id, &original)
            .await
            .unwrap();

        let mut reply = Message {
            id: "reply-context-fallback-file-reply".to_string(),
            content: "replying to the file".to_string(),
            replied_to: original.id.clone(),
            mine: true,
            ..Default::default()
        };

        populate_reply_context(app.handle(), &mut reply)
            .await
            .unwrap();

        assert_eq!(reply.replied_to_has_attachment, Some(true));
        assert_eq!(reply.replied_to_npub.as_deref(), Some(chat_id));

        crate::clear_encryption_key();
        crate::account_manager::close_db_connection();
    }
}

/// Whether a stored edit may replace `original`: a text message in the same chat,
/// edited by its author inside the edit window. `dm_peer` is set when the chat is a DM.
fn stored_edit_is_authorized(
    original: &StoredEvent,
    edit: &StoredEvent,
    dm_peer: Option<&str>,
    edited_at_ms: u64,
) -> bool {
    use crate::message::{edit_is_authorized, EditAuthor};
    original.kind == event_kind::PRIVATE_DIRECT_MESSAGE
        && original.chat_id == edit.chat_id
        && crate::message::edit_received_in_time(original.received_at, edit.received_at)
        && edit_is_authorized(
            EditAuthor::of_original(original.mine, original.npub.as_deref(), dm_peer),
            original.timestamp_ms(),
            EditAuthor::of_edit(edit.mine, edit.npub.as_deref()),
            edited_at_ms,
        )
}

#[cfg(test)]
mod edit_reconstruction_tests {
    use super::*;
    use crate::stored_event::StoredEventBuilder;

    const T: u64 = 1_700_000_000;

    async fn save_edit<R: Runtime>(
        handle: &AppHandle<R>,
        chat_id: i64,
        id: &str,
        target: &str,
        npub: &str,
        content: &str,
        created_at: u64,
    ) -> StoredEvent {
        let mut edit = StoredEventBuilder::new()
            .id(id.to_string())
            .kind(event_kind::MESSAGE_EDIT)
            .content(content.to_string())
            .reference_id(Some(target.to_string()))
            .created_at(created_at)
            .mine(false)
            .npub(Some(npub.to_string()))
            .build();
        edit.chat_id = chat_id;
        edit.received_at = T * 1000 + 5_000;
        save_event(handle, &edit).await.unwrap();
        edit
    }

    /// Rebuilds history from SQLite: a null-author group row ignores every member's
    /// edit, a null-author DM row takes only the peer's, and predated or late edits
    /// are dropped, in both the timeline and reply previews.
    #[tokio::test]
    async fn stored_edits_obey_author_and_window_rules() {
        let test_npub = "npub1editreconstructionaccount";
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();
        let app = tauri::test::mock_app();
        let handle = app.handle();
        let profile_dir = crate::account_manager::get_profile_directory(handle, test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);
        let db_path = crate::account_manager::get_database_path(handle, test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);
        crate::set_encryption_key([7u8; 32]);

        let original = |id: &str| Message {
            id: id.to_string(),
            content: "original".to_string(),
            at: T * 1000,
            ..Default::default()
        };

        let group = "0e4d7c1f00ed17ec0457";
        save_message(handle.clone(), group, &original("grp-msg"))
            .await
            .unwrap();
        let group_id = get_chat_id_by_identifier(handle, group).unwrap();
        save_edit(
            handle,
            group_id,
            "grp-e1",
            "grp-msg",
            "npub1mallory",
            "pwned",
            T + 5,
        )
        .await;

        let peer = "npub1editreconstructionpeer";
        save_message(handle.clone(), peer, &original("dm-msg"))
            .await
            .unwrap();
        let dm_id = get_chat_id_by_identifier(handle, peer).unwrap();
        save_message(
            handle.clone(),
            peer,
            &Message {
                npub: Some(peer.to_string()),
                ..original("legacy-msg")
            },
        )
        .await
        .unwrap();
        save_edit(
            handle,
            dm_id,
            "legacy-e1",
            "legacy-msg",
            peer,
            "untrusted receipt",
            T + 5,
        )
        .await;
        save_edit(handle, dm_id, "dm-e1", "dm-msg", peer, "fixed", T + 5).await;
        save_edit(
            handle,
            dm_id,
            "dm-e2",
            "dm-msg",
            "npub1mallory",
            "pwned",
            T + 6,
        )
        .await;
        save_edit(handle, dm_id, "dm-e3", "dm-msg", peer, "predated", T - 5).await;
        save_edit(handle, dm_id, "dm-e4", "dm-msg", peer, "late", T + 61).await;
        save_edit(handle, dm_id, "dm-e5", "dm-msg", peer, "fixed again", T + 5).await;
        save_edit(
            handle,
            dm_id,
            "dm-e6",
            "dm-msg",
            peer,
            "final same second",
            T + 5,
        )
        .await;
        let mut backdated = save_edit(
            handle,
            dm_id,
            "dm-e7",
            "dm-msg",
            peer,
            "backdated late",
            T + 5,
        )
        .await;

        save_edit(handle, dm_id, "dm-e8", "dm-msg", peer, "middle ms", T + 5).await;
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        conn.execute("INSERT INTO messages (id, chat_id, content_encrypted, at, mine) VALUES ('legacy-msg', ?1, 'original', ?2, 0)", rusqlite::params![dm_id, T as i64 * 1000]).unwrap();
        for (id, ms) in [("dm-e5", 100), ("dm-e6", 900), ("dm-e8", 500)] {
            conn.execute("UPDATE events SET tags = json_insert(tags, '$[#]', json_array('ms', ?1)) WHERE id = ?2", rusqlite::params![ms.to_string(), id]).unwrap();
        }
        conn.execute(
            "UPDATE events SET received_at = ?1 WHERE id IN ('grp-msg', 'dm-msg', 'legacy-msg')",
            [T as i64 * 1000],
        )
        .unwrap();
        conn.execute(
            "UPDATE events SET received_at = ?1 WHERE id = 'dm-e6'",
            [T as i64 * 1000 + 60_000],
        )
        .unwrap();
        conn.execute(
            "UPDATE events SET received_at = ?1 WHERE id = 'dm-e7'",
            [T as i64 * 1000 + 60_001],
        )
        .unwrap();
        crate::account_manager::return_db_connection(conn);

        // A duplicate with a timely receipt cannot replace the late first receipt.
        backdated.received_at = T * 1000 + 1;
        save_event(handle, &backdated).await.unwrap();
        // Re-saving an original must not give existing or future edits a fresh window.
        save_message(handle.clone(), peer, &original("dm-msg"))
            .await
            .unwrap();
        crate::account_manager::close_db_connection();
        assert!(saved_edit_is_authorized(handle, "dm-e6").unwrap());
        assert!(!saved_edit_is_authorized(handle, "dm-e7").unwrap());
        assert!(!saved_edit_is_authorized(handle, "legacy-e1").unwrap());
        let persisted = get_related_events(handle, &["dm-msg".to_string()])
            .await
            .unwrap();
        assert_eq!(
            persisted
                .iter()
                .find(|e| e.id == "dm-e6")
                .unwrap()
                .received_at,
            T * 1000 + 60_000
        );
        assert_eq!(
            persisted
                .iter()
                .find(|e| e.id == "dm-e7")
                .unwrap()
                .received_at,
            T * 1000 + 60_001
        );

        let group_view = get_message_views(handle, group_id, 50, 0, None)
            .await
            .unwrap();
        assert_eq!(group_view.len(), 1);
        assert_eq!(group_view[0].content, "original");
        assert!(!group_view[0].edited);

        let dm_view = get_message_views(handle, dm_id, 50, 0, None).await.unwrap();
        assert_eq!(dm_view.len(), 2);
        let legacy_view = dm_view.iter().find(|m| m.id == "legacy-msg").unwrap();
        assert_eq!(legacy_view.content, "original");
        assert!(!legacy_view.edited);
        let edited_view = dm_view.iter().find(|m| m.id == "dm-msg").unwrap();
        assert_eq!(edited_view.content, "final same second");
        let history: Vec<&str> = edited_view
            .edit_history
            .as_ref()
            .unwrap()
            .iter()
            .map(|e| e.content.as_str())
            .collect();
        assert_eq!(
            history,
            vec![
                "original",
                "fixed",
                "fixed again",
                "middle ms",
                "final same second"
            ]
        );

        for (target, expected) in [
            ("grp-msg", "original"),
            ("legacy-msg", "original"),
            ("dm-msg", "final same second"),
        ] {
            let mut reply = Message {
                id: format!("reply-{target}"),
                replied_to: target.to_string(),
                mine: true,
                ..Default::default()
            };
            populate_reply_context(handle, &mut reply).await.unwrap();
            assert_eq!(reply.replied_to_content.as_deref(), Some(expected));
        }

        // Saving after a slow publish retains the own event's preflight receipt,
        // rather than assigning the current (much later) wall clock at ACK time.
        let own_peer = "npub1owneditfirstreceiptpeer";
        save_message(
            handle.clone(),
            own_peer,
            &Message {
                mine: true,
                ..original("own-msg")
            },
        )
        .await
        .unwrap();
        let own_chat_id = get_chat_id_by_identifier(handle, own_peer).unwrap();
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        conn.execute(
            "UPDATE events SET received_at = ?1 WHERE id = 'own-msg'",
            [T as i64 * 1000],
        )
        .unwrap();
        crate::account_manager::return_db_connection(conn);
        let mut own_edit = StoredEventBuilder::new()
            .id("own-edit".to_string())
            .kind(event_kind::MESSAGE_EDIT)
            .reference_id(Some("own-msg".to_string()))
            .content("own fixed".to_string())
            .created_at(T + 60)
            .mine(true)
            .build();
        own_edit.chat_id = own_chat_id;
        own_edit.received_at = T * 1000 + 60_000;
        assert!(edit_is_authorized_before_save(handle, &own_edit).unwrap());
        save_event(handle, &own_edit).await.unwrap();
        crate::account_manager::close_db_connection();
        assert!(saved_edit_is_authorized(handle, "own-edit").unwrap());
        let own_events = get_related_events(handle, &["own-msg".to_string()])
            .await
            .unwrap();
        assert_eq!(own_events[0].received_at, own_edit.received_at);
        let own_view = get_message_views(handle, own_chat_id, 50, 0, None)
            .await
            .unwrap();
        assert_eq!(own_view[0].content, "own fixed");

        crate::clear_encryption_key();
        crate::account_manager::close_db_connection();
    }
}

/// Get message events with their reactions composed (materialized view)
///
/// This function performs a single efficient query to get messages and their
/// related events, then composes them into Message structs for the frontend.
pub async fn get_message_views<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: i64,
    limit: usize,
    offset: usize,
    virtual_bucket_filter: Option<String>,
) -> Result<Vec<Message>, String> {
    // Step 1: Timeline rows (text, file attachment, dashboard poll create)
    let message_kinds = [
        event_kind::PRIVATE_DIRECT_MESSAGE,
        event_kind::FILE_ATTACHMENT,
        event_kind::APPLICATION_SPECIFIC,
    ];
    let message_events = get_events(
        handle,
        chat_id,
        Some(&message_kinds),
        limit,
        offset,
        virtual_bucket_filter.as_deref(),
    )
    .await?;

    let message_events: Vec<StoredEvent> = message_events
        .into_iter()
        .filter(|e| {
            if e.kind != event_kind::APPLICATION_SPECIFIC {
                return true;
            }
            crate::dashboard_poll::try_parse_vote(e.content.trim()).is_none()
        })
        .collect();

    if message_events.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: Get related events (reactions, edits) for these messages
    let message_ids: Vec<String> = message_events.iter().map(|e| e.id.clone()).collect();
    let related_events = get_related_events(handle, &message_ids).await?;
    let authorized_edit_ids: std::collections::HashSet<String> = {
        let conn = crate::account_manager::get_db_connection(handle)?;
        let placeholders = message_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT e.id {} AND e.reference_id IN ({placeholders})",
            authorized_edits_from_sql(),
        );
        let ids = {
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(message_ids.iter()), |row| {
                    row.get(0)
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        crate::account_manager::return_db_connection(conn);
        ids
    };

    // Group reactions and edits by message ID
    let mut reactions_by_msg: HashMap<String, Vec<Reaction>> = HashMap::new();
    let mut edits_by_msg: HashMap<String, Vec<EditEntry>> = HashMap::new();

    for event in related_events {
        if let Some(ref_id) = &event.reference_id {
            match event.kind {
                k if k == event_kind::REACTION => {
                    let reaction = Reaction {
                        id: event.id.clone(),
                        reference_id: ref_id.clone(),
                        author_id: event.npub.clone().unwrap_or_default(),
                        emoji: event.content.clone(),
                    };
                    reactions_by_msg
                        .entry(ref_id.clone())
                        .or_default()
                        .push(reaction);
                }
                k if k == event_kind::MESSAGE_EDIT => {
                    if !authorized_edit_ids.contains(&event.id) {
                        continue;
                    }
                    let timestamp_ms = event.timestamp_ms();
                    // Edit content is encrypted, decrypt it here
                    let decrypted_content = internal_decrypt(event.content.clone())
                        .await
                        .unwrap_or_else(|_| event.content.clone());
                    edits_by_msg
                        .entry(ref_id.clone())
                        .or_default()
                        .push(EditEntry {
                            event_id: event.id,
                            edited_at: timestamp_ms,
                            content: decrypted_content,
                        });
                }
                _ => {}
            }
        }
    }

    // Sort edits by timestamp (chronologically)
    for edits in edits_by_msg.values_mut() {
        edits.sort_by_key(|edit| edit.edited_at);
    }

    // Step 3: Parse attachments from event tags OR fall back to messages table
    // New events have attachments in tags, old migrated events need messages table lookup
    let mut attachments_by_msg: HashMap<String, Vec<Attachment>> = HashMap::new();
    let mut events_needing_legacy_lookup: Vec<String> = Vec::new();

    for event in &message_events {
        if event.kind != event_kind::FILE_ATTACHMENT {
            continue;
        }

        // Try to parse attachments from the "attachments" tag (new events)
        if let Some(attachments_json) = event.get_tag("attachments") {
            if let Ok(attachments) = serde_json::from_str::<Vec<Attachment>>(attachments_json) {
                attachments_by_msg.insert(event.id.clone(), attachments);
                continue;
            }
        }

        // No attachments tag found - this is an old migrated event, need legacy lookup
        events_needing_legacy_lookup.push(event.id.clone());
    }

    // Fall back to messages table for old migrated events without attachments tag
    // NOTE: This is a legacy fallback - the messages table may have been dropped
    if !events_needing_legacy_lookup.is_empty() {
        let conn = crate::account_manager::get_db_connection(handle)?;

        // Check if messages table exists before querying it
        let has_messages_table: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='messages'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|count| count > 0)
            .unwrap_or(false);

        if has_messages_table {
            for msg_id in &events_needing_legacy_lookup {
                if let Ok(attachments_json) = conn.query_row::<String, _, _>(
                    "SELECT attachments FROM messages WHERE id = ?1",
                    rusqlite::params![msg_id],
                    |row| row.get(0),
                ) {
                    if let Ok(attachments) =
                        serde_json::from_str::<Vec<Attachment>>(&attachments_json)
                    {
                        attachments_by_msg.insert(msg_id.to_string(), attachments);
                    }
                }
            }
        }
        crate::account_manager::return_db_connection(conn);
    }

    // Step 4: Compose Message structs (with decryption and edit application)
    let mut messages = Vec::with_capacity(message_events.len());
    for event in message_events {
        // Calculate derived values before moving ownership
        let replied_to = event.get_reply_reference().unwrap_or("").to_string();
        let preview_metadata = event
            .get_tag("link_preview")
            .and_then(|json| serde_json::from_str::<SiteMetadata>(json).ok());
        let at = event.timestamp_ms();
        let reactions = reactions_by_msg.remove(&event.id).unwrap_or_default();

        // Get attachments from the lookup map (for kind=15 file messages)
        let attachments = attachments_by_msg.remove(&event.id).unwrap_or_default();

        // Get original content (already decrypted by get_events() where applicable)
        let original_content = if event.kind == event_kind::FILE_ATTACHMENT {
            // File attachment content is just an encrypted hash - don't display
            String::new()
        } else {
            event.content.clone()
        };

        let virtual_bucket = event.virtual_bucket.clone().or_else(|| {
            crate::virtual_channel_bucket::normalize_virtual_bucket_for_message(
                event.kind,
                &original_content,
                &event.tags,
            )
        });

        // Check for edits and build edit history
        let (content, edited, edit_history) = if let Some(edits) = edits_by_msg.remove(&event.id) {
            // Build edit history: original + all edits
            let mut history = Vec::with_capacity(edits.len() + 1);

            // Add original as first entry
            history.push(EditEntry {
                event_id: event.id.clone(),
                content: original_content.clone(),
                edited_at: at,
            });

            // Add all edits
            history.extend(edits.iter().cloned());

            // Use the latest edit's content
            let latest_content = edits
                .last()
                .map(|edit| edit.content.clone())
                .unwrap_or(original_content);

            (latest_content, true, Some(history))
        } else {
            (original_content, false, None)
        };

        let message = Message {
            id: event.id,
            content,
            replied_to,
            replied_to_content: None,        // Populated below
            replied_to_npub: None,           // Populated below
            replied_to_has_attachment: None, // Populated below
            preview_metadata,
            attachments,
            reactions,
            at,
            pending: event.pending,
            failed: event.failed,
            mine: event.mine,
            npub: event.npub,
            wrapper_event_id: event.wrapper_event_id,
            edited,
            edit_history,
            rumor_kind: match event.kind {
                k if k == event_kind::APPLICATION_SPECIFIC => Some(k),
                _ => None,
            },
            virtual_bucket,
        };
        messages.push(message);
    }

    // Step 5: Fetch reply context for messages that have replies
    // Collect all replied_to IDs that are non-empty
    let reply_ids: Vec<String> = messages
        .iter()
        .filter(|m| !m.replied_to.is_empty())
        .map(|m| m.replied_to.clone())
        .collect();

    if !reply_ids.is_empty() {
        // Fetch the replied-to events from the database
        let reply_contexts = get_reply_contexts(handle, &reply_ids).await?;

        // Populate reply context for each message
        for message in &mut messages {
            if !message.replied_to.is_empty() {
                if let Some(ctx) = reply_contexts.get(&message.replied_to) {
                    message.replied_to_content = Some(ctx.content.clone());
                    message.replied_to_npub = ctx.npub.clone();
                    message.replied_to_has_attachment = Some(ctx.has_attachment);
                }
            }
        }
    }

    Ok(messages)
}
