//! Export the last window of human chat for one MLS group.
//! Wire rules: `docs/mls/CHANNEL_HISTORY_BACKFILL.md`.

use crate::crypto::{decrypt_with_key, encrypt_with_key};
use crate::message::Message;
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
/// Kinds 14, 15, and 16 are decrypted with `key` before the human-chat check.
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
          AND e.kind IN (?2, ?3, ?4, ?5)
          AND e.pending = 0
          AND e.failed = 0
          AND e.created_at >= ?6
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
                event_kind::MESSAGE_EDIT,
                event_kind::REACTION,
                since,
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
    Ok(out)
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryImportResult {
    pub inserted_ids: Vec<String>,
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
    let (inserted_ids, stored_group_id, timeline) = write_imported_rows(
        conn,
        group_id,
        bucket,
        local_npub,
        messages,
        received_at_ms,
        key,
    )?;
    emit_imported_timeline(&stored_group_id, &timeline);
    Ok(HistoryImportResult { inserted_ids })
}

fn validate_import_message(message: &HistoryExportMessage) -> Result<(), String> {
    if message.id.trim().is_empty() || message.author_npub.trim().is_empty() {
        return Err("invalid history message".to_string());
    }
    let human_kind = matches!(
        message.kind,
        event_kind::PRIVATE_DIRECT_MESSAGE
            | event_kind::FILE_ATTACHMENT
            | event_kind::MESSAGE_EDIT
            | event_kind::REACTION
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
) -> Result<(Vec<String>, String, Vec<Message>), String> {
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
            "SELECT id, chat_identifier FROM chats WHERE lower(chat_identifier) = ?1",
            [&group_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "history import chat not found".to_string())?;

    let mut inserted_ids = Vec::new();
    let mut timeline = Vec::new();
    for message in messages {
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
            if message.kind == event_kind::PRIVATE_DIRECT_MESSAGE
                || message.kind == event_kind::FILE_ATTACHMENT
            {
                timeline.push(timeline_message(message, mine, bucket_value));
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((inserted_ids, stored_group_id, timeline))
}

fn timeline_message(message: &HistoryExportMessage, mine: bool, bucket: Option<&str>) -> Message {
    Message {
        id: message.id.clone(),
        content: message.content.clone(),
        replied_to: message.reference_id.clone().unwrap_or_default(),
        at: message.created_at.saturating_mul(1000),
        mine,
        npub: Some(message.author_npub.clone()),
        virtual_bucket: bucket.map(str::to_string),
        ..Default::default()
    }
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
    pub fn import_channel_history(
        group_id: String,
        bucket: Option<String>,
        messages: Vec<HistoryWireMessage>,
    ) -> Result<Vec<String>, String> {
        let bucket = bucket_from_wire(bucket)?;
        let key = crate::current_encryption_key().ok_or("encryption key unavailable")?;
        let local_npub = crate::account_manager::get_current_account()?;
        let (_, received_at_ms) = now_unix()?;
        let rows: Vec<HistoryExportMessage> = messages.into_iter().map(to_export_message).collect();
        with_account_conn(|conn| {
            super::import_channel_history(
                conn,
                &group_id,
                bucket,
                &local_npub,
                &rows,
                received_at_ms,
                &key,
            )
            .map(|result| result.inserted_ids)
        })
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
                     WHERE lower(c.chat_identifier) = ?1 AND e.history_import = 1
                     ORDER BY e.created_at ASC, e.id ASC",
                )
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map([&group_id], |row| row.get(0))
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
            vec!["text", "mention", "reply", "file", "edit", "react"]
        );

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
                vec!["caption".to_string(), "pic".to_string()],
            ]
        );

        let edit = rows.iter().find(|row| row.id == "edit").unwrap();
        assert_eq!(edit.kind, event_kind::MESSAGE_EDIT);
        assert_eq!(edit.reference_id.as_deref(), Some("text"));
        assert_eq!(edit.content, "hello edited");

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
        let (ids, _, _) = write_imported_rows(
            &mut conn,
            "groupabc",
            HistoryExportBucket::Announcements,
            "npub1joiner",
            &[row("gov", r#"{"type":"governance_updated"}"#)],
            1_700_000_000_000,
            &KEY,
        )
        .unwrap();
        assert_eq!(ids, vec!["gov".to_string()]);
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
}
