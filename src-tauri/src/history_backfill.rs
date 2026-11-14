//! Export the last window of human chat for one MLS group.
//! Wire rules: `docs/mls/CHANNEL_HISTORY_BACKFILL.md`.

use crate::chat::ChatType;
use crate::crypto::{decrypt_with_key, encrypt_with_key};
use crate::message::{Attachment, Message, Reaction};
use crate::stored_event::event_kind;
use rusqlite::{params, Connection};
use tauri::Emitter;

const MENTION_ENVELOPE_KIND: &str = "pacto.mentions.envelope.v1";

/// `Announcements` keeps that virtual bucket. `Unfiltered` is a custom channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryExportBucket {
    Announcements,
    Unfiltered,
}

/// One exportable `events` row. Local ids and flags stay on this device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryExportMessage {
    pub id: String,
    pub kind: u16,
    pub created_at: u64,
    pub author_npub: String,
    pub content: String,
    pub tags: Vec<Vec<String>>,
    pub reference_id: Option<String>,
}

/// Human chat, matching `isStructuredProductContent`.
pub(crate) fn is_structured_product_content(content: &str) -> bool {
    let trimmed = content.trim();
    if !trimmed.starts_with('{') {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return false;
    };
    let Some(obj) = value.as_object() else {
        return false;
    };
    if obj.get("kind").and_then(|v| v.as_str()) == Some(MENTION_ENVELOPE_KIND) {
        return false;
    }
    obj.get("schema").and_then(|v| v.as_str()).is_some()
        || obj.get("type").and_then(|v| v.as_str()).is_some()
}

/// Rows for `group_id` with `created_at >= since_unix_secs`, ordered by time then id.
///
/// Kinds 14 and 15 are decrypted with `key` before the human-chat check.
/// The latest authorized edit is folded into that row. Kind 16 is omitted.
/// A row that fails decryption is skipped.
pub fn export_channel_history(
    conn: &Connection,
    group_id: &str,
    bucket: HistoryExportBucket,
    since_unix_secs: u64,
    key: &[u8; 32],
) -> Result<Vec<HistoryExportMessage>, String> {
    let group_id = group_id.trim().to_lowercase();
    if group_id.is_empty() {
        return Ok(Vec::new());
    }
    let since = i64::try_from(since_unix_secs).map_err(|_| "since timestamp is out of range")?;

    let bucket_clause = match bucket {
        HistoryExportBucket::Announcements => " AND e.virtual_bucket = 'announcements'",
        HistoryExportBucket::Unfiltered => "",
    };
    let sql = format!(
        r#"
        SELECT e.id, e.kind, e.content, e.tags, e.reference_id, e.created_at, e.npub
        FROM events e
        JOIN chats c ON c.id = e.chat_id
        WHERE lower(c.chat_identifier) = ?1
          AND c.chat_type = ?6
          AND e.kind IN (?2, ?3, ?4)
          AND e.pending = 0
          AND e.failed = 0
          AND e.created_at >= ?5
          {bucket_clause}
        ORDER BY e.created_at ASC, e.id ASC
        "#
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![
                group_id,
                event_kind::PRIVATE_DIRECT_MESSAGE,
                event_kind::FILE_ATTACHMENT,
                event_kind::REACTION,
                since,
                ChatType::MlsGroup.to_i32(),
            ],
            |row| {
                Ok(RawEvent {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    content: row.get(2)?,
                    tags: row.get(3)?,
                    reference_id: row.get(4)?,
                    created_at: row.get(5)?,
                    npub: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        if let Some(message) = decode_row(row, key) {
            out.push(message);
        }
    }
    fold_latest_authorized_edits(conn, &mut out, key)?;
    Ok(out)
}

/// Per original id, the newest authorized edit with a usable body wins; same predicate as live edits.
fn fold_latest_authorized_edits(
    conn: &Connection,
    messages: &mut [HistoryExportMessage],
    key: &[u8; 32],
) -> Result<(), String> {
    let original_ids: Vec<&str> = messages
        .iter()
        .filter(|message| {
            message.kind == event_kind::PRIVATE_DIRECT_MESSAGE
                || message.kind == event_kind::FILE_ATTACHMENT
        })
        .map(|message| message.id.as_str())
        .collect();
    if original_ids.is_empty() {
        return Ok(());
    }
    // Bound by SQLite's variable limit (32766 in the bundled build).
    let placeholders = (1..=original_ids.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(",");
    let mut stmt = conn
        .prepare(&crate::db::latest_authorized_edits_sql(&placeholders))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(original_ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut winners = std::collections::HashMap::<String, String>::new();
    for row in rows {
        let (reference_id, stored) = row.map_err(|e| e.to_string())?;
        if winners.contains_key(&reference_id) {
            continue;
        }
        if let Ok(body) = decrypt_with_key(&stored, key) {
            if !is_structured_product_content(&body) {
                winners.insert(reference_id, body);
            }
        }
    }
    drop(stmt);

    for message in messages.iter_mut() {
        let Some(body) = winners.remove(&message.id) else {
            continue;
        };
        match message.kind {
            event_kind::FILE_ATTACHMENT => write_caption_tag(&mut message.tags, body),
            event_kind::PRIVATE_DIRECT_MESSAGE => message.content = body,
            _ => {}
        }
    }
    Ok(())
}

fn write_caption_tag(tags: &mut Vec<Vec<String>>, caption: String) {
    if let Some(tag) = tags
        .iter_mut()
        .find(|tag| tag.first().is_some_and(|name| name == "caption"))
    {
        if tag.len() >= 2 {
            tag[1] = caption;
        } else {
            tag.push(caption);
        }
        return;
    }
    tags.push(vec!["caption".to_string(), caption]);
}

struct RawEvent {
    id: String,
    kind: i64,
    content: String,
    tags: String,
    reference_id: Option<String>,
    created_at: i64,
    npub: Option<String>,
}

fn decode_row(row: RawEvent, key: &[u8; 32]) -> Option<HistoryExportMessage> {
    let kind = u16::try_from(row.kind).ok()?;
    let author_npub = row.npub.unwrap_or_default().trim().to_string();
    if author_npub.is_empty() || row.id.is_empty() {
        return None;
    }
    let content = if kind == event_kind::REACTION {
        row.content
    } else {
        decrypt_with_key(&row.content, key).ok()?
    };
    if is_structured_product_content(&content) {
        return None;
    }
    let tags = serde_json::from_str::<Vec<Vec<String>>>(&row.tags).ok()?;
    let reference_id = row
        .reference_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty());
    let created_at = u64::try_from(row.created_at).ok()?;
    Some(HistoryExportMessage {
        id: row.id,
        kind,
        created_at,
        author_npub,
        content,
        tags,
        reference_id,
    })
}

/// Rows written by a history import. `inserted_ids` omits ids that already existed.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryImportResult {
    pub inserted_ids: Vec<String>,
    pub group_id: String,
    pub timeline: Vec<Message>,
    pub reactions: Vec<Reaction>,
}

/// Write accepted chunk rows. Rejects the whole batch when any row is not human chat.
/// Does not call `apply_mls_virtual_bucket_side_effects`.
pub fn import_channel_history(
    conn: &mut Connection,
    group_id: &str,
    bucket: HistoryExportBucket,
    local_npub: &str,
    messages: &[HistoryExportMessage],
    received_at_ms: u64,
    key: &[u8; 32],
) -> Result<HistoryImportResult, String> {
    for message in messages {
        validate_import_message(message)?;
    }
    write_imported_rows(
        conn,
        group_id,
        bucket,
        local_npub,
        messages,
        received_at_ms,
        key,
    )
}

fn validate_import_message(message: &HistoryExportMessage) -> Result<(), String> {
    if message.id.trim().is_empty() || message.author_npub.trim().is_empty() {
        return Err("invalid history message".to_string());
    }
    let human_kind = matches!(
        message.kind,
        event_kind::PRIVATE_DIRECT_MESSAGE | event_kind::FILE_ATTACHMENT | event_kind::REACTION
    );
    if !human_kind {
        return Err("invalid history message".to_string());
    }
    if is_structured_product_content(&message.content) {
        return Err("structured product in history chunk".to_string());
    }
    Ok(())
}

/// Insert rows without the human-chat check. Callers reject a bad chunk first.
fn write_imported_rows(
    conn: &mut Connection,
    group_id: &str,
    bucket: HistoryExportBucket,
    local_npub: &str,
    messages: &[HistoryExportMessage],
    received_at_ms: u64,
    key: &[u8; 32],
) -> Result<HistoryImportResult, String> {
    let group_key = group_id.trim().to_lowercase();
    if group_key.is_empty() {
        return Err("history import missing group".to_string());
    }
    let received_at = i64::try_from(received_at_ms).map_err(|_| "received_at is out of range")?;
    let local_npub = local_npub.trim();
    let bucket_value = match bucket {
        HistoryExportBucket::Announcements => Some("announcements"),
        HistoryExportBucket::Unfiltered => None,
    };

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (chat_id, stored_group_id): (i64, String) = tx
        .query_row(
            "SELECT id, chat_identifier FROM chats WHERE lower(chat_identifier) = ?1 AND chat_type = ?2",
            params![group_key, ChatType::MlsGroup.to_i32()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "history import chat not found".to_string())?;

    let mut inserted_ids = Vec::new();
    let mut timeline = Vec::new();
    let mut reactions = Vec::new();
    // Reactions go last so a target in this batch is already stored.
    let (reaction_rows, content_rows): (Vec<_>, Vec<_>) = messages
        .iter()
        .partition(|message| message.kind == event_kind::REACTION);
    for message in content_rows.into_iter().chain(reaction_rows) {
        if message.kind == event_kind::REACTION
            && !reaction_targets_imported_row(&tx, chat_id, message)?
        {
            continue;
        }
        let created_at =
            i64::try_from(message.created_at).map_err(|_| "created_at is out of range")?;
        let stored_content = if message.kind == event_kind::REACTION {
            message.content.clone()
        } else {
            encrypt_with_key(&message.content, key)
        };
        let tags = serde_json::to_string(&message.tags).map_err(|e| e.to_string())?;
        let mine = !local_npub.is_empty() && message.author_npub.trim() == local_npub;
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO events (
                    id, kind, chat_id, content, tags, reference_id,
                    created_at, received_at, mine, pending, failed, npub, virtual_bucket, history_import
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0, ?10, ?11, 1)",
                params![
                    message.id,
                    message.kind,
                    chat_id,
                    stored_content,
                    tags,
                    message.reference_id,
                    created_at,
                    received_at,
                    mine as i32,
                    message.author_npub,
                    bucket_value,
                ],
            )
            .map_err(|e| e.to_string())?;
        if inserted == 1 {
            inserted_ids.push(message.id.clone());
            match message.kind {
                event_kind::PRIVATE_DIRECT_MESSAGE | event_kind::FILE_ATTACHMENT => {
                    timeline.push(timeline_message(message, mine, bucket_value));
                }
                event_kind::REACTION => {
                    if let Some(reaction) = reaction_from_import(message) {
                        reactions.push(reaction);
                    }
                }
                _ => {}
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(HistoryImportResult {
        inserted_ids,
        group_id: stored_group_id,
        timeline,
        reactions,
    })
}

/// A copied reaction may only land on a kind 14 or 15 row that an import wrote in this chat.
fn reaction_targets_imported_row(
    conn: &Connection,
    chat_id: i64,
    message: &HistoryExportMessage,
) -> Result<bool, String> {
    let Some(target) = message.reference_id.as_deref().map(str::trim) else {
        return Ok(false);
    };
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events
         WHERE id = ?1 AND chat_id = ?2 AND history_import = 1 AND kind IN (?3, ?4))",
        params![
            target,
            chat_id,
            event_kind::PRIVATE_DIRECT_MESSAGE,
            event_kind::FILE_ATTACHMENT
        ],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn tag_value<'a>(tags: &'a [Vec<String>], name: &str) -> Option<&'a str> {
    tags.iter().find_map(|tag| match tag.as_slice() {
        [tag_name, value, ..] if tag_name == name => Some(value.as_str()),
        _ => None,
    })
}

fn history_caption(tags: &[Vec<String>]) -> String {
    crate::attachment_tags::caption_body(tag_value(tags, "caption"))
}

/// Same rules as the live kind-15 path. Empty key and nonce mark a remote-plaintext attachment.
fn attachment_from_history(message: &HistoryExportMessage) -> Option<Attachment> {
    let tags = &message.tags;
    let mime = tag_value(tags, "file-type")?;
    let key = tag_value(tags, "decryption-key")?.to_string();
    let nonce = tag_value(tags, "decryption-nonce")?.to_string();
    if message
        .content
        .contains(crate::attachment_tags::EMPTY_FILE_HASH)
    {
        return None;
    }
    let extension = crate::util::extension_from_mime(mime);
    let dir = crate::TAURI_APP
        .get()
        .and_then(|handle| crate::cmds::media::attachments_dir(handle).ok());
    let file = crate::attachment_tags::resolve_file(
        dir.as_deref(),
        tag_value(tags, "ox"),
        &nonce,
        &extension,
    )?;
    Some(Attachment {
        id: file.id,
        key,
        nonce,
        extension,
        url: message.content.clone(),
        path: file.path,
        size: tag_value(tags, "size")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        img_meta: crate::attachment_tags::image_metadata(
            tag_value(tags, "blurhash"),
            tag_value(tags, "dim"),
        ),
        downloading: false,
        downloaded: file.downloaded,
        webxdc_topic: None,
        file_name: tag_value(tags, "filename")
            .and_then(crate::message::sanitize_incoming_file_name),
    })
}

fn reaction_from_import(message: &HistoryExportMessage) -> Option<Reaction> {
    let reference_id = message.reference_id.as_deref()?.trim();
    if reference_id.is_empty() {
        return None;
    }
    Some(Reaction {
        id: message.id.clone(),
        reference_id: reference_id.to_string(),
        author_id: message.author_npub.clone(),
        emoji: message.content.clone(),
    })
}

fn timeline_message(message: &HistoryExportMessage, mine: bool, bucket: Option<&str>) -> Message {
    let (content, attachments) = if message.kind == event_kind::FILE_ATTACHMENT {
        (
            history_caption(&message.tags),
            attachment_from_history(message).into_iter().collect(),
        )
    } else {
        (message.content.clone(), Vec::new())
    };
    Message {
        id: message.id.clone(),
        content,
        replied_to: message.reference_id.clone().unwrap_or_default(),
        at: message.created_at.saturating_mul(1000),
        mine,
        npub: Some(message.author_npub.clone()),
        virtual_bucket: bucket.map(str::to_string),
        attachments,
        ..Default::default()
    }
}

struct AppliedImport {
    to_emit: Vec<Message>,
    /// New `last_read` id when the import moved it.
    last_read: Option<String>,
}

fn apply_imported_timeline(
    state: &mut crate::ChatState,
    chat_id: &str,
    timeline: &[Message],
    reactions: &[Reaction],
) -> AppliedImport {
    for message in timeline {
        state.add_message_to_chat(chat_id, message.clone());
    }
    if let Some(chat) = state.get_chat_mut(chat_id) {
        for reaction in reactions {
            if let Some(message) = chat.get_message_mut(&reaction.reference_id) {
                message.add_reaction(reaction.clone(), None);
            }
        }
    }
    let to_emit = state
        .get_chat(chat_id)
        .map(|chat| {
            timeline
                .iter()
                .filter_map(|message| {
                    chat.messages
                        .iter()
                        .find(|stored| stored.id == message.id)
                        .cloned()
                })
                .collect()
        })
        .unwrap_or_default();
    let last_read = advance_imported_last_read(state, chat_id, timeline);
    AppliedImport { to_emit, last_read }
}

/// Moves `last_read` onto the last imported message in chat order unless it already sits at or
/// after it, so the copy is never unread and live messages behind it stay unread.
fn advance_imported_last_read(
    state: &mut crate::ChatState,
    chat_id: &str,
    imported: &[Message],
) -> Option<String> {
    let chat = state.get_chat_mut(chat_id)?;
    let newest = chat
        .messages
        .iter()
        .rposition(|message| imported.iter().any(|copy| copy.id == message.id))?;
    let read = chat
        .messages
        .iter()
        .position(|message| message.id == chat.last_read);
    if read.is_some_and(|read| read >= newest) {
        return None;
    }
    chat.last_read = chat.messages[newest].id.clone();
    Some(chat.last_read.clone())
}

async fn publish_imported_timeline(imported: &HistoryImportResult) {
    if imported.timeline.is_empty() && imported.reactions.is_empty() {
        return;
    }
    let applied = {
        let mut state = crate::STATE.lock().await;
        apply_imported_timeline(
            &mut state,
            &imported.group_id,
            &imported.timeline,
            &imported.reactions,
        )
    };
    if let Some(last_read) = &applied.last_read {
        persist_imported_last_read(&imported.group_id, last_read).await;
    }
    emit_imported_timeline(&imported.group_id, &applied.to_emit);
}

/// Targeted update: the in-memory chat snapshot must not overwrite participants or metadata.
fn write_last_read(conn: &Connection, chat_id: &str, last_read: &str) -> Result<usize, String> {
    conn.execute(
        "UPDATE chats SET last_read = ?1 WHERE chat_identifier = ?2",
        params![last_read, chat_id],
    )
    .map_err(|e| e.to_string())
}

async fn persist_imported_last_read(chat_id: &str, last_read: &str) {
    let Some(handle) = crate::TAURI_APP.get() else {
        return;
    };
    if let Err(err) = with_account_conn(|conn| write_last_read(conn, chat_id, last_read)) {
        eprintln!("history import: persist last_read failed: {err}");
    }
    crate::cmds::chat::update_unread_counter(handle.clone()).await;
}

/// Kind-14 gift wrap that must not become a DM.
pub(crate) fn is_history_backfill_gift(content: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content.trim()) else {
        return false;
    };
    matches!(
        value.get("type").and_then(|kind| kind.as_str()),
        Some("history_chunk") | Some("history_unavailable")
    )
}

const HISTORY_WINDOW_SECS: u64 = 30 * 24 * 60 * 60;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryWireMessage {
    pub id: String,
    pub kind: u16,
    pub created_at: u64,
    pub author_npub: String,
    pub content: String,
    pub tags: Vec<Vec<String>>,
    pub reference_id: Option<String>,
}

fn bucket_from_wire(bucket: Option<String>) -> Result<HistoryExportBucket, String> {
    match bucket.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(HistoryExportBucket::Unfiltered),
        Some("announcements") => Ok(HistoryExportBucket::Announcements),
        Some(_) => Err("invalid history bucket".to_string()),
    }
}

fn to_export_message(message: HistoryWireMessage) -> HistoryExportMessage {
    HistoryExportMessage {
        id: message.id,
        kind: message.kind,
        created_at: message.created_at,
        author_npub: message.author_npub,
        content: message.content,
        tags: message.tags,
        reference_id: message.reference_id,
    }
}

fn to_wire_message(message: HistoryExportMessage) -> HistoryWireMessage {
    HistoryWireMessage {
        id: message.id,
        kind: message.kind,
        created_at: message.created_at,
        author_npub: message.author_npub,
        content: message.content,
        tags: message.tags,
        reference_id: message.reference_id,
    }
}

fn with_account_conn<T>(
    f: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let handle = crate::TAURI_APP
        .get()
        .ok_or_else(|| "app handle missing".to_string())?;
    let mut conn = crate::account_manager::get_db_connection(handle)?;
    let result = f(&mut conn);
    crate::account_manager::return_db_connection(conn);
    result
}

fn now_unix() -> Result<(u64, u64), String> {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok((elapsed.as_secs(), elapsed.as_millis() as u64))
}

pub mod commands {
    use super::{
        bucket_from_wire, is_history_backfill_gift, now_unix, to_export_message, to_wire_message,
        with_account_conn, HistoryExportMessage, HistoryWireMessage, HISTORY_WINDOW_SECS,
    };

    #[tauri::command]
    pub fn export_channel_history(
        group_id: String,
        bucket: Option<String>,
    ) -> Result<Vec<HistoryWireMessage>, String> {
        let bucket = bucket_from_wire(bucket)?;
        let key = crate::current_encryption_key().ok_or("encryption key unavailable")?;
        let (now_secs, _) = now_unix()?;
        let since = now_secs.saturating_sub(HISTORY_WINDOW_SECS);
        with_account_conn(|conn| {
            super::export_channel_history(conn, &group_id, bucket, since, &key)
                .map(|rows| rows.into_iter().map(to_wire_message).collect())
        })
    }

    #[tauri::command]
    pub async fn import_channel_history(
        group_id: String,
        bucket: Option<String>,
        messages: Vec<HistoryWireMessage>,
    ) -> Result<Vec<String>, String> {
        let bucket = bucket_from_wire(bucket)?;
        let key = crate::current_encryption_key().ok_or("encryption key unavailable")?;
        let local_npub = crate::account_manager::get_current_account()?;
        let (_, received_at_ms) = now_unix()?;
        let rows: Vec<HistoryExportMessage> = messages.into_iter().map(to_export_message).collect();
        let imported = with_account_conn(|conn| {
            super::import_channel_history(
                conn,
                &group_id,
                bucket,
                &local_npub,
                &rows,
                received_at_ms,
                &key,
            )
        })?;
        super::publish_imported_timeline(&imported).await;
        Ok(imported.inserted_ids)
    }

    #[tauri::command]
    pub fn list_imported_history_ids(group_id: String) -> Result<Vec<String>, String> {
        let group_id = group_id.trim().to_lowercase();
        if group_id.is_empty() {
            return Ok(Vec::new());
        }
        with_account_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT e.id FROM events e
                     JOIN chats c ON c.id = e.chat_id
                     WHERE lower(c.chat_identifier) = ?1 AND c.chat_type = ?2 AND e.history_import = 1
                     ORDER BY e.created_at ASC, e.id ASC",
                )
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map(
                    rusqlite::params![group_id, crate::chat::ChatType::MlsGroup.to_i32()],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(ids)
        })
    }

    #[tauri::command]
    pub async fn send_history_gift_wrap(
        recipient_npub: String,
        content: String,
    ) -> Result<(), String> {
        if !is_history_backfill_gift(&content) {
            return Err("not a history gift".to_string());
        }
        let client = crate::get_nostr_client().map_err(|e| e.to_string())?;
        let signer = client.signer().await.map_err(|e| e.to_string())?;
        let my_pk = signer.get_public_key().await.map_err(|e| e.to_string())?;
        let receiver =
            nostr_sdk::PublicKey::parse(recipient_npub.trim()).map_err(|e| e.to_string())?;
        let rumor = nostr_sdk::EventBuilder::private_msg_rumor(receiver, content).build(my_pk);
        crate::message::gift_wrap_to_trusted_in_pool(&client, &receiver, rumor, Vec::new())
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Timeline notify only. Squad state stays on the MLS ingest path.
fn emit_imported_timeline(group_id: &str, messages: &[Message]) {
    let Some(handle) = crate::TAURI_APP.get() else {
        return;
    };
    for message in messages {
        let _ = handle.emit(
            "mls_message_new",
            serde_json::json!({
                "group_id": group_id,
                "message": message,
            }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::encrypt_with_key;

    const KEY: [u8; 32] = [9u8; 32];

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    fn insert_chat(conn: &Connection, group_id: &str) -> i64 {
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at)
             VALUES (?1, 1, '[]', 1)",
            params![group_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn insert_event(
        conn: &Connection,
        chat_id: i64,
        id: &str,
        kind: u16,
        content: &str,
        tags: &str,
        reference_id: Option<&str>,
        created_at: i64,
        npub: Option<&str>,
        pending: i64,
        failed: i64,
        bucket: Option<&str>,
    ) {
        let stored = if kind == event_kind::REACTION {
            content.to_string()
        } else {
            encrypt_with_key(content, &KEY)
        };
        conn.execute(
            "INSERT INTO events (
                id, kind, chat_id, content, tags, reference_id, created_at, received_at,
                mine, pending, failed, npub, virtual_bucket
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0, ?8, ?9, ?10, ?11)",
            params![
                id,
                kind,
                chat_id,
                stored,
                tags,
                reference_id,
                created_at,
                pending,
                failed,
                npub,
                bucket,
            ],
        )
        .unwrap();
    }

    fn export(conn: &Connection, bucket: HistoryExportBucket) -> Vec<HistoryExportMessage> {
        export_channel_history(conn, "GroupABC", bucket, 1_700_000_000, &KEY).unwrap()
    }

    fn ids(rows: &[HistoryExportMessage]) -> Vec<&str> {
        rows.iter().map(|row| row.id.as_str()).collect()
    }

    #[test]
    fn exports_human_chat_and_drops_product_rows() {
        let conn = conn();
        let chat = insert_chat(&conn, "groupabc");
        let other = insert_chat(&conn, "other-group");
        let tags = "[]";
        let file_tags = r#"[["file-type","image/png"],["decryption-key","kk"],["decryption-nonce","nn"],["ox","hh"],["filename","a.png"],["caption","pic"]]"#;

        insert_event(
            &conn,
            chat,
            "text",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "hello",
            tags,
            None,
            1_700_000_100,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "mention",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            r#"{"kind":"pacto.mentions.envelope.v1","body":"hi @bob","mentions":[{"npub":"npub1bob","alias":"bob"}]}"#,
            tags,
            None,
            1_700_000_110,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "reply",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "reply body",
            tags,
            Some("text"),
            1_700_000_120,
            Some("npub1bob"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "file",
            event_kind::FILE_ATTACHMENT,
            "https://blob.example/abc",
            file_tags,
            None,
            1_700_000_130,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "edit-older",
            event_kind::MESSAGE_EDIT,
            "hello older",
            tags,
            Some("text"),
            1_700_000_110,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "edit",
            event_kind::MESSAGE_EDIT,
            "hello edited",
            tags,
            Some("text"),
            1_700_000_140,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "file-edit",
            event_kind::MESSAGE_EDIT,
            "pic edited",
            tags,
            Some("file"),
            1_700_000_170,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "react",
            event_kind::REACTION,
            "👍",
            r#"[["e","text"]]"#,
            Some("text"),
            1_700_000_150,
            Some("npub1bob"),
            0,
            0,
            Some("announcements"),
        );

        insert_event(
            &conn,
            chat,
            "gov",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            r#"{"type":"governance_updated"}"#,
            tags,
            None,
            1_700_000_160,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "poll",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            r#"{"schema":"pacto.dashboard_poll.v1"}"#,
            tags,
            None,
            1_700_000_170,
            Some("npub1alice"),
            0,
            0,
            Some("polls"),
        );
        insert_event(
            &conn,
            chat,
            "join",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            r#"{"schema":"pacto.squad.join_request.v1"}"#,
            tags,
            None,
            1_700_000_180,
            Some("npub1alice"),
            0,
            0,
            Some("join_requests"),
        );
        insert_event(
            &conn,
            chat,
            "inbox",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            r#"{"type":"squad_state_sync_request"}"#,
            tags,
            None,
            1_700_000_190,
            Some("npub1alice"),
            0,
            0,
            Some("inbox"),
        );
        insert_event(
            &conn,
            chat,
            "typing",
            event_kind::APPLICATION_SPECIFIC,
            "typing",
            tags,
            None,
            1_700_000_200,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "pending",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "not yet",
            tags,
            None,
            1_700_000_210,
            Some("npub1alice"),
            1,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "failed",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "nope",
            tags,
            None,
            1_700_000_220,
            Some("npub1alice"),
            0,
            1,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "old",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "too old",
            tags,
            None,
            1_600_000_000,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "inbox-plain",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "personal",
            tags,
            None,
            1_700_000_230,
            Some("npub1alice"),
            0,
            0,
            Some("inbox"),
        );
        insert_event(
            &conn,
            other,
            "elsewhere",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "other group",
            tags,
            None,
            1_700_000_240,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "no-author",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "anon",
            tags,
            None,
            1_700_000_250,
            None,
            0,
            0,
            Some("announcements"),
        );

        let rows = export(&conn, HistoryExportBucket::Announcements);
        assert_eq!(
            ids(&rows),
            vec!["text", "mention", "reply", "file", "react"]
        );
        assert!(rows.iter().all(|row| row.kind != event_kind::MESSAGE_EDIT));

        let text = rows.iter().find(|row| row.id == "text").unwrap();
        assert_eq!(text.kind, event_kind::PRIVATE_DIRECT_MESSAGE);
        assert_eq!(text.content, "hello edited");

        let reply = rows.iter().find(|row| row.id == "reply").unwrap();
        assert_eq!(reply.reference_id.as_deref(), Some("text"));
        assert_eq!(reply.content, "reply body");

        let file = rows.iter().find(|row| row.id == "file").unwrap();
        assert_eq!(file.content, "https://blob.example/abc");
        assert_eq!(
            file.tags,
            vec![
                vec!["file-type".to_string(), "image/png".to_string()],
                vec!["decryption-key".to_string(), "kk".to_string()],
                vec!["decryption-nonce".to_string(), "nn".to_string()],
                vec!["ox".to_string(), "hh".to_string()],
                vec!["filename".to_string(), "a.png".to_string()],
                vec!["caption".to_string(), "pic edited".to_string()],
            ]
        );

        let reaction = rows.iter().find(|row| row.id == "react").unwrap();
        assert_eq!(reaction.kind, event_kind::REACTION);
        assert_eq!(reaction.content, "👍");
        assert_eq!(reaction.reference_id.as_deref(), Some("text"));

        let mention = rows.iter().find(|row| row.id == "mention").unwrap();
        assert!(mention.content.contains("pacto.mentions.envelope.v1"));

        let custom = export(&conn, HistoryExportBucket::Unfiltered);
        assert!(ids(&custom).contains(&"inbox-plain"));
        assert!(!ids(&custom).contains(&"gov"));
        assert!(!ids(&custom).contains(&"poll"));
    }

    #[test]
    fn unauthorized_edits_are_not_applied() {
        let conn = conn();
        let chat = insert_chat(&conn, "groupabc");
        let tags = "[]";
        let base = 1_700_000_300_i64;

        insert_event(
            &conn,
            chat,
            "author-line",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "stay author",
            tags,
            None,
            base,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "author-edit",
            event_kind::MESSAGE_EDIT,
            "pwned",
            tags,
            Some("author-line"),
            base + 40,
            Some("npub1mallory"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "late-line",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "stay late",
            tags,
            None,
            base + 200,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "late-edit",
            event_kind::MESSAGE_EDIT,
            "too late",
            tags,
            Some("late-line"),
            base + 200 + 61,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "imported-line",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "stay imported",
            tags,
            None,
            base + 400,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        conn.execute(
            "UPDATE events SET history_import = 1 WHERE id = 'imported-line'",
            [],
        )
        .unwrap();
        insert_event(
            &conn,
            chat,
            "imported-edit",
            event_kind::MESSAGE_EDIT,
            "changed",
            tags,
            Some("imported-line"),
            base + 440,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );

        let rows = export(&conn, HistoryExportBucket::Announcements);
        assert_eq!(
            ids(&rows),
            vec!["author-line", "late-line", "imported-line"]
        );
        assert!(rows.iter().all(|row| row.kind != event_kind::MESSAGE_EDIT));
        let body = |id: &str| {
            rows.iter()
                .find(|row| row.id == id)
                .unwrap()
                .content
                .as_str()
        };
        assert_eq!(body("author-line"), "stay author");
        assert_eq!(body("late-line"), "stay late");
        assert_eq!(body("imported-line"), "stay imported");
    }

    #[test]
    fn authorized_file_edit_appends_caption_and_keeps_url() {
        let conn = conn();
        let chat = insert_chat(&conn, "groupabc");
        insert_event(
            &conn,
            chat,
            "bare",
            event_kind::FILE_ATTACHMENT,
            "https://blob.example/bare",
            r#"[["file-type","image/png"]]"#,
            None,
            1_700_000_100,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "bare-edit",
            event_kind::MESSAGE_EDIT,
            "added caption",
            "[]",
            Some("bare"),
            1_700_000_140,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        let rows = export(&conn, HistoryExportBucket::Announcements);
        assert_eq!(ids(&rows), vec!["bare"]);
        assert_eq!(rows[0].content, "https://blob.example/bare");
        assert_eq!(
            rows[0].tags,
            vec![
                vec!["file-type".to_string(), "image/png".to_string()],
                vec!["caption".to_string(), "added caption".to_string()],
            ]
        );
    }

    #[test]
    fn orders_by_created_at_then_id() {
        let conn = conn();
        let chat = insert_chat(&conn, "groupabc");
        for (id, at) in [
            ("b", 1_700_000_200),
            ("a", 1_700_000_200),
            ("early", 1_700_000_100),
        ] {
            insert_event(
                &conn,
                chat,
                id,
                event_kind::PRIVATE_DIRECT_MESSAGE,
                id,
                "[]",
                None,
                at,
                Some("npub1alice"),
                0,
                0,
                Some("announcements"),
            );
        }
        let rows = export(&conn, HistoryExportBucket::Announcements);
        assert_eq!(ids(&rows), vec!["early", "a", "b"]);
    }

    fn row(id: &str, content: &str) -> HistoryExportMessage {
        HistoryExportMessage {
            id: id.to_string(),
            kind: event_kind::PRIVATE_DIRECT_MESSAGE,
            created_at: 1_700_000_100,
            author_npub: "npub1alice".to_string(),
            content: content.to_string(),
            tags: Vec::new(),
            reference_id: None,
        }
    }

    fn table_count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn smuggled_chunk_does_not_change_squad_tables() {
        let mut conn = conn();
        insert_chat(&conn, "groupabc");
        for content in [
            r#"{"type":"governance_updated"}"#,
            r#"{"type":"squad_member_evm_share"}"#,
        ] {
            let err = import_channel_history(
                &mut conn,
                "groupabc",
                HistoryExportBucket::Announcements,
                "npub1joiner",
                &[row("bad", content)],
                1_700_000_000_000,
                &KEY,
            )
            .unwrap_err();
            assert!(err.contains("structured product"));
        }
        assert_eq!(table_count(&conn, "events"), 0);
        assert_eq!(table_count(&conn, "squad_infra"), 0);
        assert_eq!(table_count(&conn, "squad_member_evm"), 0);

        let mixed = import_channel_history(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1joiner",
            &[
                row("ok", "hello"),
                row("gov", r#"{"type":"governance_updated"}"#),
            ],
            1_700_000_000_000,
            &KEY,
        );
        assert!(mixed.is_err());
        assert_eq!(table_count(&conn, "events"), 0);
    }

    #[test]
    fn stored_smuggled_row_still_skips_squad_side_effects() {
        let mut conn = conn();
        insert_chat(&conn, "groupabc");
        let imported = write_imported_rows(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1joiner",
            &[row("gov", r#"{"type":"governance_updated"}"#)],
            1_700_000_000_000,
            &KEY,
        )
        .unwrap();
        assert_eq!(imported.inserted_ids, vec!["gov".to_string()]);
        assert_eq!(table_count(&conn, "squad_infra"), 0);
        assert_eq!(table_count(&conn, "squad_member_evm"), 0);
        let flag: i64 = conn
            .query_row(
                "SELECT history_import FROM events WHERE id = 'gov'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(flag, 1);
    }

    #[test]
    fn import_dedupes_and_does_not_overwrite_an_mls_row() {
        let mut conn = conn();
        let chat = insert_chat(&conn, "GroupABC");
        insert_event(
            &conn,
            chat,
            "keep",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "original",
            "[]",
            None,
            1_700_000_100,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        let before: String = conn
            .query_row("SELECT content FROM events WHERE id = 'keep'", [], |r| {
                r.get(0)
            })
            .unwrap();

        let first = import_channel_history(
            &mut conn,
            "GroupABC",
            HistoryExportBucket::Announcements,
            "npub1alice",
            &[row("copy", "hello"), row("keep", "replaced")],
            1_700_000_500_000,
            &KEY,
        )
        .unwrap();
        assert_eq!(first.inserted_ids, vec!["copy".to_string()]);

        let again = import_channel_history(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1alice",
            &[row("copy", "hello again")],
            1_700_000_500_000,
            &KEY,
        )
        .unwrap();
        assert!(again.inserted_ids.is_empty());
        assert_eq!(table_count(&conn, "events"), 2);

        let after: String = conn
            .query_row("SELECT content FROM events WHERE id = 'keep'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(before, after);
        let keep_flag: i64 = conn
            .query_row(
                "SELECT history_import FROM events WHERE id = 'keep'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(keep_flag, 0);
        let copy_flag: (i64, i64, i64) = conn
            .query_row(
                "SELECT history_import, mine, received_at FROM events WHERE id = 'copy'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(copy_flag, (1, 1, 1_700_000_500_000));
        let plain = export(&conn, HistoryExportBucket::Announcements);
        assert_eq!(
            plain.iter().find(|r| r.id == "copy").unwrap().content,
            "hello"
        );
    }

    #[test]
    fn dm_chat_is_not_exported_or_imported_into() {
        let mut conn = conn();
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at)
             VALUES ('npub1peer', 0, '[]', 1)",
            [],
        )
        .unwrap();
        let dm_chat = conn.last_insert_rowid();
        insert_event(
            &conn,
            dm_chat,
            "dm-line",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "private hello",
            "[]",
            None,
            1_700_000_100,
            Some("npub1peer"),
            0,
            0,
            None,
        );
        let rows = export_channel_history(
            &conn,
            "npub1peer",
            HistoryExportBucket::Unfiltered,
            1_700_000_000,
            &KEY,
        )
        .unwrap();
        assert!(rows.is_empty());

        let err = import_channel_history(
            &mut conn,
            "npub1peer",
            HistoryExportBucket::Unfiltered,
            "npub1alice",
            &[row("forged", "hi")],
            1_700_000_500_000,
            &KEY,
        );
        assert!(err.is_err());
        assert_eq!(table_count(&conn, "events"), 1);
    }

    #[test]
    fn import_rejects_kind_16() {
        let mut conn = conn();
        insert_chat(&conn, "groupabc");
        let mut edit = row("edit", "hello edited");
        edit.kind = event_kind::MESSAGE_EDIT;
        edit.reference_id = Some("text".to_string());
        let err = import_channel_history(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1joiner",
            &[edit],
            1_700_000_000_000,
            &KEY,
        )
        .unwrap_err();
        assert!(err.contains("invalid history message"));
        assert_eq!(table_count(&conn, "events"), 0);
    }

    fn insert_stored_content(
        conn: &Connection,
        chat_id: i64,
        id: &str,
        kind: u16,
        stored_content: &str,
        reference_id: &str,
        created_at: i64,
        npub: &str,
    ) {
        conn.execute(
            "INSERT INTO events (
                id, kind, chat_id, content, tags, reference_id, created_at, received_at,
                mine, pending, failed, npub, virtual_bucket
             ) VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, ?6, 0, 0, 0, ?7, 'announcements')",
            params![
                id,
                kind,
                chat_id,
                stored_content,
                reference_id,
                created_at,
                npub
            ],
        )
        .unwrap();
    }

    #[test]
    fn newest_unusable_edit_falls_back_to_the_next_usable_one() {
        let conn = conn();
        let chat = insert_chat(&conn, "groupabc");
        let base = 1_700_000_500_i64;
        insert_event(
            &conn,
            chat,
            "sealed",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "stay sealed",
            "[]",
            None,
            base,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "sealed-older",
            event_kind::MESSAGE_EDIT,
            "older body",
            "[]",
            Some("sealed"),
            base + 10,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_stored_content(
            &conn,
            chat,
            "sealed-newer",
            event_kind::MESSAGE_EDIT,
            &encrypt_with_key("should not apply", &[3u8; 32]),
            "sealed",
            base + 20,
            "npub1alice",
        );

        insert_event(
            &conn,
            chat,
            "product",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "stay product",
            "[]",
            None,
            base + 200,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "product-older",
            event_kind::MESSAGE_EDIT,
            "older product",
            "[]",
            Some("product"),
            base + 210,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_event(
            &conn,
            chat,
            "product-newer",
            event_kind::MESSAGE_EDIT,
            r#"{"type":"governance_updated"}"#,
            "[]",
            Some("product"),
            base + 220,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );

        insert_event(
            &conn,
            chat,
            "lonely",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "stay lonely",
            "[]",
            None,
            base + 400,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        insert_stored_content(
            &conn,
            chat,
            "lonely-edit",
            event_kind::MESSAGE_EDIT,
            &encrypt_with_key("should not apply", &[3u8; 32]),
            "lonely",
            base + 410,
            "npub1alice",
        );

        let rows = export(&conn, HistoryExportBucket::Announcements);
        let body = |id: &str| {
            rows.iter()
                .find(|row| row.id == id)
                .unwrap()
                .content
                .clone()
        };
        assert_eq!(body("sealed"), "older body");
        assert_eq!(body("product"), "older product");
        assert_eq!(body("lonely"), "stay lonely");
    }

    fn file_row(id: &str, at: u64, url: &str, tags: Vec<Vec<String>>) -> HistoryExportMessage {
        HistoryExportMessage {
            id: id.to_string(),
            kind: event_kind::FILE_ATTACHMENT,
            created_at: at,
            author_npub: "npub1alice".to_string(),
            content: url.to_string(),
            tags,
            reference_id: None,
        }
    }

    fn reaction_row(id: &str, target: &str, emoji: &str, at: u64) -> HistoryExportMessage {
        HistoryExportMessage {
            id: id.to_string(),
            kind: event_kind::REACTION,
            created_at: at,
            author_npub: "npub1bob".to_string(),
            content: emoji.to_string(),
            tags: vec![vec!["e".to_string(), target.to_string()]],
            reference_id: Some(target.to_string()),
        }
    }

    fn live_message(id: &str, at: u64) -> Message {
        Message {
            id: id.to_string(),
            at,
            content: "live".to_string(),
            mine: false,
            npub: Some("npub1bob".to_string()),
            ..Default::default()
        }
    }

    fn tag(name: &str, value: &str) -> Vec<String> {
        vec![name.to_string(), value.to_string()]
    }

    const BLOB_URL: &str = "https://blob.example/abc";

    fn file_tags(extra: Vec<Vec<String>>) -> Vec<Vec<String>> {
        let mut tags = vec![
            tag("file-type", "image/png"),
            tag("decryption-key", "kk"),
            tag("decryption-nonce", "nn"),
        ];
        tags.extend(extra);
        tags
    }

    fn import_rows(rows: &[HistoryExportMessage]) -> (Connection, HistoryImportResult) {
        let mut conn = conn();
        insert_chat(&conn, "GroupABC");
        let imported = import_channel_history(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1joiner",
            rows,
            1_700_000_500_000,
            &KEY,
        )
        .unwrap();
        (conn, imported)
    }

    fn timeline_by_id<'a>(imported: &'a HistoryImportResult, id: &str) -> &'a Message {
        imported
            .timeline
            .iter()
            .find(|message| message.id == id)
            .unwrap()
    }

    #[test]
    fn imported_file_carries_caption_and_attachment_fields() {
        let (conn, imported) = import_rows(&[file_row(
            "file",
            1_700_000_100,
            BLOB_URL,
            file_tags(vec![
                tag("ox", "hh"),
                tag("filename", "../a.png"),
                tag("caption", "pic"),
                tag("size", "12"),
                tag("blurhash", "LEHV6n"),
                tag("dim", "32x16"),
            ]),
        )]);
        assert_eq!(imported.group_id, "GroupABC");
        assert_eq!(table_count(&conn, "events"), 1);

        let file = timeline_by_id(&imported, "file");
        assert_eq!(file.content, "pic");
        let attachment = &file.attachments[0];
        assert_eq!(attachment.url, BLOB_URL);
        assert_eq!(attachment.id, "hh");
        assert_eq!(attachment.key, "kk");
        assert_eq!(attachment.nonce, "nn");
        assert_eq!(attachment.extension, "png");
        assert_eq!(attachment.file_name.as_deref(), Some("a.png"));
        assert_eq!(attachment.size, 12);
        assert!(!attachment.downloaded);
        assert!(!attachment.downloading);
        assert!(attachment.path.is_empty());
        let meta = attachment.img_meta.as_ref().unwrap();
        assert_eq!(meta.blurhash, "LEHV6n");
        assert_eq!((meta.width, meta.height), (32, 16));
    }

    #[test]
    fn imported_file_without_ox_uses_the_nonce_id() {
        let (_, imported) = import_rows(&[file_row(
            "nonce-file",
            1_700_000_110,
            BLOB_URL,
            file_tags(vec![tag("caption", "nonce pic")]),
        )]);
        let message = timeline_by_id(&imported, "nonce-file");
        assert_eq!(message.attachments[0].id, "nn");
        assert_eq!(message.content, "nonce pic");
    }

    #[test]
    fn imported_traversal_ox_falls_back_to_the_nonce_id() {
        let (_, imported) = import_rows(&[file_row(
            "evil",
            1_700_000_110,
            BLOB_URL,
            file_tags(vec![tag("ox", "../../secret")]),
        )]);
        assert_eq!(timeline_by_id(&imported, "evil").attachments[0].id, "nn");
    }

    #[test]
    fn imported_remote_plaintext_file_keeps_its_attachment() {
        let (_, imported) = import_rows(&[file_row(
            "gif",
            1_700_000_110,
            "https://media.example/slug.gif",
            vec![
                tag("file-type", "image/gif"),
                tag("size", "0"),
                tag("decryption-key", ""),
                tag("decryption-nonce", ""),
                tag("ox", "slug"),
                tag("caption", "party"),
            ],
        )]);
        let message = timeline_by_id(&imported, "gif");
        assert_eq!(message.content, "party");
        let attachment = &message.attachments[0];
        assert_eq!(attachment.id, "slug");
        assert!(attachment.key.is_empty() && attachment.nonce.is_empty());
        assert_eq!(attachment.url, "https://media.example/slug.gif");
        assert_eq!(attachment.extension, "gif");
    }

    #[test]
    fn imported_file_without_descriptor_shows_the_caption_only() {
        let (_, imported) = import_rows(&[file_row(
            "bare",
            1_700_000_120,
            BLOB_URL,
            vec![tag("caption", "just words")],
        )]);
        let bare = timeline_by_id(&imported, "bare");
        assert!(bare.attachments.is_empty());
        assert_eq!(bare.content, "just words");
    }

    #[test]
    fn batch_reactions_apply_in_chat_state_and_skip_missing_targets() {
        let (_, imported) = import_rows(&[
            file_row(
                "file",
                1_700_000_100,
                BLOB_URL,
                file_tags(vec![tag("ox", "hh")]),
            ),
            file_row(
                "bare",
                1_700_000_120,
                BLOB_URL,
                vec![tag("caption", "just words")],
            ),
            reaction_row("react", "file", "👍", 1_700_000_130),
            reaction_row("react-live", "already", "🔥", 1_700_000_140),
            reaction_row("react-miss", "missing", "👀", 1_700_000_150),
        ]);
        let reaction_ids: Vec<_> = imported
            .reactions
            .iter()
            .map(|reaction| reaction.id.as_str())
            .collect();
        assert_eq!(reaction_ids, vec!["react"]);
        assert!(!imported.inserted_ids.contains(&"react-live".to_string()));
        assert!(!imported.inserted_ids.contains(&"react-miss".to_string()));

        let mut state = crate::ChatState::new();
        state.add_message_to_chat(&imported.group_id, live_message("already", 1));
        let applied = apply_imported_timeline(
            &mut state,
            &imported.group_id,
            &imported.timeline,
            &imported.reactions,
        );
        assert!(applied
            .to_emit
            .iter()
            .all(|message| message.id != "react" && message.id != "react-live"));
        let emitted = applied
            .to_emit
            .iter()
            .find(|message| message.id == "file")
            .unwrap();
        assert_eq!(emitted.reactions.len(), 1);
        assert_eq!(emitted.reactions[0].emoji, "👍");
        assert_eq!(emitted.reactions[0].author_id, "npub1bob");
        assert_eq!(emitted.reactions[0].reference_id, "file");
        assert_eq!(emitted.reactions[0].id, "react");

        let chat = state.get_chat(&imported.group_id).unwrap();
        let already = chat
            .messages
            .iter()
            .find(|message| message.id == "already")
            .unwrap();
        assert!(already.reactions.is_empty());
        assert!(chat.messages.iter().all(|message| message.id != "missing"));
    }

    #[test]
    fn reaction_may_target_a_row_from_an_earlier_import() {
        let (mut conn, _) = import_rows(&[file_row(
            "file",
            1_700_000_100,
            BLOB_URL,
            file_tags(vec![tag("ox", "hh")]),
        )]);
        let later = import_channel_history(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1joiner",
            &[reaction_row("react", "file", "👍", 1_700_000_130)],
            1_700_000_500_000,
            &KEY,
        )
        .unwrap();
        assert_eq!(later.reactions.len(), 1);
        assert_eq!(later.reactions[0].reference_id, "file");
    }

    #[test]
    fn reaction_to_a_live_row_is_not_stored() {
        let mut conn = conn();
        let chat = insert_chat(&conn, "groupabc");
        insert_event(
            &conn,
            chat,
            "live",
            event_kind::PRIVATE_DIRECT_MESSAGE,
            "hello",
            "[]",
            None,
            1_700_000_100,
            Some("npub1alice"),
            0,
            0,
            Some("announcements"),
        );
        let imported = import_channel_history(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1joiner",
            &[reaction_row("forged", "live", "🔥", 1_700_000_130)],
            1_700_000_500_000,
            &KEY,
        )
        .unwrap();
        assert!(imported.inserted_ids.is_empty());
        assert!(imported.reactions.is_empty());
        let stored: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE kind = 7", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, 0);
    }

    #[test]
    fn imported_rows_join_chat_state_in_time_order_and_read() {
        let (_, imported) = import_rows(&[
            file_row(
                "file",
                1_700_000_100,
                BLOB_URL,
                file_tags(vec![tag("ox", "hh")]),
            ),
            file_row(
                "bare",
                1_700_000_120,
                BLOB_URL,
                vec![tag("caption", "just words")],
            ),
        ]);
        let mut state = crate::ChatState::new();
        state.add_message_to_chat(&imported.group_id, live_message("already", 1));
        let applied = apply_imported_timeline(
            &mut state,
            &imported.group_id,
            &imported.timeline,
            &imported.reactions,
        );
        let order: Vec<_> = state
            .get_chat(&imported.group_id)
            .unwrap()
            .messages
            .iter()
            .map(|message| message.id.as_str())
            .collect();
        assert_eq!(order, vec!["already", "file", "bare"]);
        assert_eq!(
            state.get_chat(&imported.group_id).unwrap().last_read,
            "bare"
        );
        assert_eq!(applied.last_read.as_deref(), Some("bare"));
        assert!(state
            .unread_counts_by_chat()
            .get(&imported.group_id)
            .is_none());
    }

    #[test]
    fn last_read_tracks_the_newest_imported_message() {
        let mut state = crate::ChatState::new();
        let early = live_message("early", 1_000);
        let low = live_message("m", 2_000);
        let high = live_message("z", 2_000);
        let applied = apply_imported_timeline(&mut state, "group", &[early, low, high], &[]);
        assert_eq!(state.get_chat("group").unwrap().last_read, "z");
        assert_eq!(applied.last_read.as_deref(), Some("z"));
        assert!(state.unread_counts_by_chat().get("group").is_none());
        let order: Vec<_> = state
            .get_chat("group")
            .unwrap()
            .messages
            .iter()
            .map(|message| message.id.as_str())
            .collect();
        assert_eq!(order, vec!["early", "m", "z"]);
    }

    #[test]
    fn earlier_live_messages_stay_unread_after_the_copy_is_marked_read() {
        let mut newer = crate::ChatState::new();
        newer.add_message_to_chat("group", live_message("live", 9_000));
        let applied =
            apply_imported_timeline(&mut newer, "group", &[live_message("old", 1_000)], &[]);
        assert_eq!(applied.last_read.as_deref(), Some("old"));
        assert_eq!(newer.get_chat("group").unwrap().last_read, "old");
        assert_eq!(newer.unread_counts_by_chat().get("group"), Some(&1));
    }

    #[test]
    fn last_read_never_moves_back_past_newer_read_content() {
        let mut read = crate::ChatState::new();
        read.add_message_to_chat("group", live_message("live", 9_000));
        read.get_chat_mut("group").unwrap().last_read = "live".to_string();
        let applied =
            apply_imported_timeline(&mut read, "group", &[live_message("old", 1_000)], &[]);
        assert!(applied.last_read.is_none());
        assert_eq!(read.get_chat("group").unwrap().last_read, "live");

        let mut behind = crate::ChatState::new();
        behind.add_message_to_chat("group", live_message("a", 500));
        behind.get_chat_mut("group").unwrap().last_read = "a".to_string();
        let applied =
            apply_imported_timeline(&mut behind, "group", &[live_message("m", 2_000)], &[]);
        assert_eq!(applied.last_read.as_deref(), Some("m"));

        let mut dangling = crate::ChatState::new();
        dangling.add_message_to_chat("group", live_message("a", 500));
        dangling.get_chat_mut("group").unwrap().last_read = "gone".to_string();
        let applied =
            apply_imported_timeline(&mut dangling, "group", &[live_message("m", 2_000)], &[]);
        assert_eq!(applied.last_read.as_deref(), Some("m"));
    }

    #[test]
    fn write_last_read_leaves_the_rest_of_the_chat_row() {
        let conn = conn();
        insert_chat(&conn, "GroupABC");
        conn.execute(
            "UPDATE chats SET participants = '[\"npub1alice\"]' WHERE chat_identifier = 'GroupABC'",
            [],
        )
        .unwrap();
        assert_eq!(write_last_read(&conn, "GroupABC", "m1").unwrap(), 1);
        let (last_read, participants): (String, String) = conn
            .query_row(
                "SELECT last_read, participants FROM chats WHERE chat_identifier = 'GroupABC'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(last_read, "m1");
        assert_eq!(participants, "[\"npub1alice\"]");
        assert_eq!(write_last_read(&conn, "missing", "m1").unwrap(), 0);
    }
}
