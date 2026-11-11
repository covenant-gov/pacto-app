//! Export the last window of human chat for one MLS group.
//! Wire rules: `docs/mls/CHANNEL_HISTORY_BACKFILL.md`.

use crate::crypto::decrypt_with_key;
use crate::stored_event::event_kind;
use rusqlite::{params, Connection};

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
#[allow(dead_code)]
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
}
