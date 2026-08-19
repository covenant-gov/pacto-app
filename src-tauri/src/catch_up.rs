//! Catch up entry store (U8; R13, R20, R21, R24; KD1, KTD8).
//!
//! A references-only index of events admitted by U2's `earns_catch_up_entry`
//! predicate: source ids and a resolution timestamp only, never message
//! content or a sender name (see `migrations/V29__catch_up_entries.sql`).
//! That absence is what keeps KD1's "Catch up indexes; per-squad homes stay
//! canonical" rule enforceable at the schema level rather than aspirational.
//!
//! Also carries restart-safe MLS welcome deduplication (R13), replacing the
//! in-memory `NOTIFIED_WELCOMES` set that used to live in `lib.rs`: a
//! `Welcome`-kind row already existing for a wrapper_event_id means "already
//! notified", and because the row is in SQLite that holds across a restart.
//!
//! Every write is conflict-tolerant on `source_event_id` (`ON CONFLICT ...
//! DO NOTHING`) rather than a read-then-write check, so two arrival paths
//! processing the same event race safely down to one row (Approach #7).

use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::notification::EventKind;
use crate::ChatState;

/// The catch-up-specific kind label. Coarser reuse of `EventKind` alone
/// isn't enough: `Welcome` needs its own label because it alone carries the
/// restart-dedup contract, and `Mention` narrows `GroupMessage` down to the
/// one case (`mention_hit`) that actually earns admission.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatchUpKind {
    Mention,
    DirectMessage,
    ActionPrompt,
    Welcome,
}

impl CatchUpKind {
    pub fn as_db_str(&self) -> &'static str {
        match self {
            CatchUpKind::Mention => "mention",
            CatchUpKind::DirectMessage => "direct_message",
            CatchUpKind::ActionPrompt => "action_prompt",
            CatchUpKind::Welcome => "welcome",
        }
    }

    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "mention" => Some(CatchUpKind::Mention),
            "direct_message" => Some(CatchUpKind::DirectMessage),
            "action_prompt" => Some(CatchUpKind::ActionPrompt),
            "welcome" => Some(CatchUpKind::Welcome),
            _ => None,
        }
    }
}

/// One row: references only, per KD1/KTD8. No content, title, or sender
/// name field exists here by design — see the migration's own comment.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatchUpEntry {
    pub id: String,
    pub source_event_id: String,
    pub kind: String,
    pub chat_id: String,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
}

fn now_epoch_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Kind-prefixed, time-salted, randomized id — unique without a dependency
/// this crate doesn't otherwise pull in.
fn generate_id(kind: CatchUpKind) -> String {
    format!(
        "{}-{}-{:x}",
        kind.as_db_str(),
        now_epoch_seconds(),
        rand::random::<u64>()
    )
}

/// Insert one entry. Returns whether a new row was actually inserted —
/// `false` means `source_event_id` already had a row (the dedup case).
fn insert_entry(
    conn: &rusqlite::Connection,
    kind: CatchUpKind,
    chat_id: &str,
    source_event_id: &str,
) -> Result<bool, String> {
    let id = generate_id(kind);
    let created_at = now_epoch_seconds();
    let inserted = conn
        .execute(
            "INSERT INTO catch_up_entries (id, source_event_id, kind, chat_id, created_at, resolved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)
             ON CONFLICT(source_event_id) DO NOTHING",
            rusqlite::params![id, source_event_id, kind.as_db_str(), chat_id, created_at],
        )
        .map_err(|e| format!("Failed to insert catch up entry: {}", e))?;
    Ok(inserted > 0)
}

/// Record a Catch up entry for an admitted event (R20), using the same
/// classification already passed to `notification::emit` at the call site.
/// A no-op — not an error — when the event doesn't earn admission; an
/// ordinary group message without a mention hit must never produce a row
/// (KD5), which is enforced here by delegating to the same predicate U3
/// already gates the OS notification on.
pub fn record_admitted_event(
    conn: &rusqlite::Connection,
    kind: EventKind,
    is_own: bool,
    mention_hit: bool,
    chat_id: &str,
    source_event_id: &str,
) -> Result<(), String> {
    if !crate::notification::earns_catch_up_entry(kind, is_own, mention_hit) {
        return Ok(());
    }
    let catch_up_kind = match kind {
        EventKind::GroupMessage => CatchUpKind::Mention,
        EventKind::DirectMessage => CatchUpKind::DirectMessage,
        EventKind::ActionPrompt => CatchUpKind::ActionPrompt,
    };
    insert_entry(conn, catch_up_kind, chat_id, source_event_id).map(|_| ())
}

/// `AppHandle`-based wrapper for the `notification::emit` call sites in
/// `lib.rs`. Failure is logged and swallowed (KTD12): a Catch up write must
/// never fail the message or notification it describes.
pub async fn record_admitted_event_for_handle<R: Runtime>(
    handle: &AppHandle<R>,
    kind: EventKind,
    is_own: bool,
    mention_hit: bool,
    chat_id: &str,
    source_event_id: &str,
) {
    if !crate::notification::earns_catch_up_entry(kind, is_own, mention_hit) {
        return;
    }
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[CatchUp] Failed to open connection for entry write: {}", e);
            return;
        }
    };
    if let Err(e) =
        record_admitted_event(&conn, kind, is_own, mention_hit, chat_id, source_event_id)
    {
        eprintln!("[CatchUp] Failed to record entry: {}", e);
    }
    crate::account_manager::return_db_connection(conn);
}

/// Record a pending welcome, replacing the in-memory `NOTIFIED_WELCOMES`
/// set (R13). Returns whether this is the first sighting of this wrapper
/// event id — the caller should send the OS notification only when this is
/// `true`. The dedup check and the write are one atomic step (the unique
/// index), not a check-then-insert race, and it holds across a restart
/// because the row lives in SQLite rather than process memory.
fn record_welcome(
    conn: &rusqlite::Connection,
    chat_id: &str,
    wrapper_event_id: &str,
) -> Result<bool, String> {
    insert_entry(conn, CatchUpKind::Welcome, chat_id, wrapper_event_id)
}

/// `AppHandle`-based wrapper used by `list_pending_mls_welcomes`. On a
/// connection failure this fails open (returns `true`, i.e. "treat as new"):
/// silently dropping a first-time welcome notification is worse than a
/// spurious duplicate (KTD12 — a failed Catch up write degrades Catch up,
/// never the thing it is describing).
pub async fn record_welcome_for_handle<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    wrapper_event_id: &str,
) -> bool {
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[CatchUp] Failed to open connection for welcome check: {}",
                e
            );
            return true;
        }
    };
    let result = record_welcome(&conn, chat_id, wrapper_event_id);
    crate::account_manager::return_db_connection(conn);
    match result {
        Ok(is_new) => is_new,
        Err(e) => {
            eprintln!("[CatchUp] Failed to record welcome entry: {}", e);
            true
        }
    }
}

/// Resolve one entry by its source event id. Returns whether a row was
/// actually resolved (`false` if it was already resolved or never existed).
fn resolve_entry(conn: &rusqlite::Connection, source_event_id: &str) -> Result<bool, String> {
    let resolved_at = now_epoch_seconds();
    let changed = conn
        .execute(
            "UPDATE catch_up_entries SET resolved_at = ?1 WHERE source_event_id = ?2 AND resolved_at IS NULL",
            rusqlite::params![resolved_at, source_event_id],
        )
        .map_err(|e| format!("Failed to resolve catch up entry: {}", e))?;
    Ok(changed > 0)
}

/// Resolve an accepted welcome's entry (Approach #6). `accept_mls_welcome`
/// used to remove the wrapper id from `NOTIFIED_WELCOMES`, which
/// un-suppressed it; this is the same intent against durable storage.
/// Losing this turns an accepted welcome into a permanently stale Catch up
/// row.
pub async fn resolve_welcome_for_handle<R: Runtime>(handle: &AppHandle<R>, wrapper_event_id: &str) {
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[CatchUp] Failed to open connection to resolve welcome: {}",
                e
            );
            return;
        }
    };
    if let Err(e) = resolve_entry(&conn, wrapper_event_id) {
        eprintln!("[CatchUp] Failed to resolve welcome entry: {}", e);
    }
    crate::account_manager::return_db_connection(conn);
}

/// Resolve every unresolved message-shaped entry (`Mention`, `DirectMessage`)
/// for a chat in one statement — the counterpart to `chat::mark_as_read`
/// advancing that chat's read watermark. `ActionPrompt` and `Welcome`
/// entries resolve through their own dedicated paths and are untouched here.
fn resolve_chat_message_entries(
    conn: &rusqlite::Connection,
    chat_id: &str,
) -> Result<usize, String> {
    let resolved_at = now_epoch_seconds();
    conn.execute(
        "UPDATE catch_up_entries SET resolved_at = ?1
         WHERE chat_id = ?2 AND resolved_at IS NULL AND kind IN ('mention', 'direct_message')",
        rusqlite::params![resolved_at, chat_id],
    )
    .map_err(|e| format!("Failed to resolve chat catch up entries: {}", e))
}

/// `AppHandle`-based wrapper called from `chat::mark_as_read`.
pub async fn resolve_chat_message_entries_for_handle<R: Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
) {
    let conn = match crate::account_manager::get_db_connection(handle) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[CatchUp] Failed to open connection to resolve chat entries: {}",
                e
            );
            return;
        }
    };
    if let Err(e) = resolve_chat_message_entries(&conn, chat_id) {
        eprintln!("[CatchUp] Failed to resolve chat entries: {}", e);
    }
    crate::account_manager::return_db_connection(conn);
}

/// Delete every entry for one chat (Approach #4): explicit cleanup, run
/// wherever a chat is deleted, never a cascade — foreign keys are not
/// enforced on these connections.
pub fn delete_entries_for_chat(
    conn: &rusqlite::Connection,
    chat_id: &str,
) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM catch_up_entries WHERE chat_id = ?1",
        rusqlite::params![chat_id],
    )
    .map_err(|e| format!("Failed to delete catch up entries for chat: {}", e))
}

/// Delete every entry across a set of chats — used when a squad is deleted,
/// keyed off the squad's own channel list (`SquadRow.channels`) rather than
/// a stored `squad_id` on this table. The catalog already owns the
/// squad-to-channel mapping; duplicating it here would make this table a
/// second store of record for something it must stay reference-only about.
pub fn delete_entries_for_chats(
    conn: &rusqlite::Connection,
    chat_ids: &[String],
) -> Result<usize, String> {
    if chat_ids.is_empty() {
        return Ok(0);
    }
    let placeholders = vec!["?"; chat_ids.len()].join(",");
    let sql = format!(
        "DELETE FROM catch_up_entries WHERE chat_id IN ({})",
        placeholders
    );
    let params: Vec<&dyn rusqlite::ToSql> =
        chat_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Failed to delete catch up entries for chats: {}", e))
}

/// List unresolved entries, optionally filtered by kind and/or restricted to
/// a set of chat ids — the composition point for a "by squad" filter, which
/// resolves a squad to its member chat ids (via the squads catalog) before
/// calling this. Newest first. Backed by `idx_catch_up_entries_kind_resolved`
/// and `idx_catch_up_entries_chat`.
pub fn list_unresolved_entries(
    conn: &rusqlite::Connection,
    kind: Option<CatchUpKind>,
    chat_ids: Option<&[String]>,
) -> Result<Vec<CatchUpEntry>, String> {
    if let Some(ids) = chat_ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
    }

    let mut sql = String::from(
        "SELECT id, source_event_id, kind, chat_id, created_at, resolved_at
         FROM catch_up_entries WHERE resolved_at IS NULL",
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(k) = kind {
        sql.push_str(" AND kind = ?");
        params.push(Box::new(k.as_db_str().to_string()));
    }
    if let Some(ids) = chat_ids {
        let placeholders = vec!["?"; ids.len()].join(",");
        sql.push_str(&format!(" AND chat_id IN ({})", placeholders));
        for id in ids {
            params.push(Box::new(id.clone()));
        }
    }
    sql.push_str(" ORDER BY created_at DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare catch up query: {}", e))?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(CatchUpEntry {
                id: row.get(0)?,
                source_event_id: row.get(1)?,
                kind: row.get(2)?,
                chat_id: row.get(3)?,
                created_at: row.get(4)?,
                resolved_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query catch up entries: {}", e))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Failed to read catch up entry row: {}", e))?);
    }
    Ok(out)
}

/// Read one entry by its source event id. Used by production resolution
/// paths (a caller must see an entry's `kind` before deciding whether
/// resolving it should also advance a chat's read watermark) as well as
/// by tests.
fn get_entry(
    conn: &rusqlite::Connection,
    source_event_id: &str,
) -> Result<Option<CatchUpEntry>, String> {
    conn.query_row(
        "SELECT id, source_event_id, kind, chat_id, created_at, resolved_at
         FROM catch_up_entries WHERE source_event_id = ?1",
        rusqlite::params![source_event_id],
        |row| {
            Ok(CatchUpEntry {
                id: row.get(0)?,
                source_event_id: row.get(1)?,
                kind: row.get(2)?,
                chat_id: row.get(3)?,
                created_at: row.get(4)?,
                resolved_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read catch up entry: {}", e))
}

/// Resolves a squad id to its member chat ids (channel group ids), for the
/// "by squad" filter (R25). `None` in means no squad filter; `None` out
/// means "no filter" for `list_unresolved_entries`, distinct from `Some(
/// vec![])` which that function already treats as "match nothing" — an
/// unknown squad id correctly returns an empty list rather than falling
/// back to unfiltered.
fn resolve_squad_chat_ids(
    conn: &rusqlite::Connection,
    squad_id: Option<&str>,
) -> Result<Option<Vec<String>>, String> {
    let Some(sid) = squad_id else { return Ok(None) };
    let squad = crate::squad_catalog::get_squad_inner(conn, sid)?;
    Ok(Some(
        squad
            .map(|s| s.channels.into_iter().map(|c| c.group_id).collect())
            .unwrap_or_default(),
    ))
}

fn parse_kind_filter(kind: Option<&str>) -> Result<Option<CatchUpKind>, String> {
    match kind {
        Some(k) => CatchUpKind::from_db_str(k)
            .map(Some)
            .ok_or_else(|| format!("Unknown catch up kind: {}", k)),
        None => Ok(None),
    }
}

/// List unresolved entries, optionally narrowed to one kind and/or one
/// squad (R25 — needs-action is `kind = "action_prompt"`, mentions is
/// `kind = "mention"`).
#[tauri::command]
pub async fn list_catch_up_entries<R: Runtime>(
    handle: AppHandle<R>,
    kind: Option<String>,
    squad_id: Option<String>,
) -> Result<Vec<CatchUpEntry>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let out = (|| {
        let parsed_kind = parse_kind_filter(kind.as_deref())?;
        let chat_ids = resolve_squad_chat_ids(&conn, squad_id.as_deref())?;
        list_unresolved_entries(&conn, parsed_kind, chat_ids.as_deref())
    })();
    crate::account_manager::return_db_connection(conn);
    out
}

/// Pure predicate behind `catch_up_count`'s filter, isolated from `STATE`'s
/// global lock so the "excludes Nothing" and "orphan counts" contracts are
/// unit-testable against a local `ChatState`.
fn entry_counts_toward_badge(state: &ChatState, chat_id: &str) -> bool {
    state
        .get_chat(chat_id)
        .map(|c| c.notification_level != crate::chat::NotificationLevel::Nothing)
        .unwrap_or(true)
}

/// Unresolved count excluding entries whose chat sits at Nothing (R24) —
/// the same authority every other badge reads (R14), not a second count.
/// A chat id with no matching row in `STATE` (an orphan the deletion
/// cleanup should already prevent, per Approach #4) counts rather than
/// silently hides a bug.
#[tauri::command]
pub async fn catch_up_count<R: Runtime>(handle: AppHandle<R>) -> Result<usize, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let entries = list_unresolved_entries(&conn, None, None);
    crate::account_manager::return_db_connection(conn);
    let entries = entries?;

    let state = crate::STATE.lock().await;
    let count = entries
        .iter()
        .filter(|e| entry_counts_toward_badge(&state, &e.chat_id))
        .count();
    Ok(count)
}

/// Resolve one entry by its source event id (R23's "clear individually").
/// Mention/DirectMessage entries route through `chat::mark_as_read` so the
/// chat's read watermark agrees with the canonical home (Approach #5) —
/// which also cascades to every sibling message-shaped entry for that
/// chat, not just this row. Other kinds have no watermark to move and
/// resolve directly.
#[tauri::command]
pub async fn resolve_catch_up_entry<R: Runtime>(
    handle: AppHandle<R>,
    source_event_id: String,
) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let entry = get_entry(&conn, &source_event_id);
    crate::account_manager::return_db_connection(conn);
    let Some(entry) = entry? else {
        return Ok(false);
    };
    if entry.resolved_at.is_some() {
        return Ok(false);
    }

    if entry.kind == CatchUpKind::Mention.as_db_str()
        || entry.kind == CatchUpKind::DirectMessage.as_db_str()
    {
        crate::chat::mark_as_read(entry.chat_id, None).await;
        return Ok(true);
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    let resolved = resolve_entry(&conn, &source_event_id);
    crate::account_manager::return_db_connection(conn);
    resolved
}

/// Resolve exactly the entries a given filter currently lists (R23's
/// "mark the whole surface read", Approach #6) — never the whole table.
/// Message-shaped entries resolve via `chat::mark_as_read` per chat, which
/// stays exact because a chat only ever produces one of Mention/
/// DirectMessage (DM chats -> DirectMessage, MLS groups -> Mention), so
/// "mark this chat read" never reaches outside the filtered set for it.
#[tauri::command]
pub async fn resolve_all_catch_up_entries<R: Runtime>(
    handle: AppHandle<R>,
    kind: Option<String>,
    squad_id: Option<String>,
) -> Result<usize, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let entries = (|| {
        let parsed_kind = parse_kind_filter(kind.as_deref())?;
        let chat_ids = resolve_squad_chat_ids(&conn, squad_id.as_deref())?;
        list_unresolved_entries(&conn, parsed_kind, chat_ids.as_deref())
    })();
    crate::account_manager::return_db_connection(conn);
    let entries = entries?;
    let total = entries.len();

    let mut message_chat_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut other_source_ids: Vec<String> = Vec::new();
    for e in &entries {
        if e.kind == CatchUpKind::Mention.as_db_str()
            || e.kind == CatchUpKind::DirectMessage.as_db_str()
        {
            message_chat_ids.insert(e.chat_id.clone());
        } else {
            other_source_ids.push(e.source_event_id.clone());
        }
    }

    for chat_id in message_chat_ids {
        crate::chat::mark_as_read(chat_id, None).await;
    }

    if !other_source_ids.is_empty() {
        let conn = crate::account_manager::get_db_connection(&handle)?;
        for source_id in other_source_ids {
            let _ = resolve_entry(&conn, &source_id);
        }
        crate::account_manager::return_db_connection(conn);
    }

    Ok(total)
}

/// Upsert an "action needed" entry, reopening it (`resolved_at` cleared)
/// if it was previously resolved while the condition it describes still
/// holds. Deliberately distinct from `insert_entry`'s conflict-tolerant
/// no-op: an event-sourced entry (a mention, a welcome) must never reopen
/// once resolved, but a derived-state entry has no event to re-arrive —
/// resurfacing it on the next reconciliation pass IS how it stays correct
/// (Approach #4).
fn record_or_reopen_action_needed(
    conn: &rusqlite::Connection,
    chat_id: &str,
    source_event_id: &str,
) -> Result<(), String> {
    let id = generate_id(CatchUpKind::ActionPrompt);
    let created_at = now_epoch_seconds();
    conn.execute(
        "INSERT INTO catch_up_entries (id, source_event_id, kind, chat_id, created_at, resolved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)
         ON CONFLICT(source_event_id) DO UPDATE SET resolved_at = NULL",
        rusqlite::params![
            id,
            source_event_id,
            CatchUpKind::ActionPrompt.as_db_str(),
            chat_id,
            created_at
        ],
    )
    .map_err(|e| format!("Failed to record action-needed entry: {}", e))?;
    Ok(())
}

/// Frontend-callable counterpart for a derived "needs action" condition
/// that has no backend event to hook (Approach #4) — currently the
/// per-squad roster-key-choice prompt (`needsSquadRosterKeyChoice`). The
/// caller re-evaluates its own predicate on its existing background
/// refresh: calls this when the condition is true, and
/// `resolve_catch_up_entry` with the same `source_event_id` when it turns
/// false.
#[tauri::command]
pub async fn record_action_needed_entry<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    source_event_id: String,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let result = record_or_reopen_action_needed(&conn, &chat_id, &source_event_id);
    crate::account_manager::return_db_connection(conn);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Chat, NotificationLevel};

    fn migrated_conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("run migrations");
        conn
    }

    #[test]
    fn catch_up_kind_db_str_round_trips() {
        for kind in [
            CatchUpKind::Mention,
            CatchUpKind::DirectMessage,
            CatchUpKind::ActionPrompt,
            CatchUpKind::Welcome,
        ] {
            let db_str = kind.as_db_str();
            assert_eq!(CatchUpKind::from_db_str(db_str), Some(kind));
        }
        assert_eq!(CatchUpKind::from_db_str("bogus"), None);
    }

    #[test]
    fn schema_has_no_content_column() {
        let conn = migrated_conn();
        let mut stmt = conn.prepare("PRAGMA table_info(catch_up_entries)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        let expected: std::collections::HashSet<&str> = [
            "id",
            "source_event_id",
            "kind",
            "chat_id",
            "created_at",
            "resolved_at",
        ]
        .into_iter()
        .collect();
        let actual: std::collections::HashSet<&str> = columns.iter().map(|s| s.as_str()).collect();
        assert_eq!(
            actual, expected,
            "schema must carry references only, no content/title/body/sender column"
        );
    }

    #[test]
    fn mention_and_action_prompt_events_create_an_entry() {
        let conn = migrated_conn();

        // A group message with a mention hit resolves Interrupt or Record
        // depending on level, but earns admission either way (KD5) — use
        // resolve_tier to show the tie explicitly rather than asserting the
        // admission predicate in isolation.
        let tier = crate::notification::severity::resolve_tier(
            EventKind::GroupMessage,
            crate::chat::NotificationLevel::Mentions,
            false,
            true,
        );
        assert_eq!(tier, crate::notification::Tier::Interrupt);
        record_admitted_event(
            &conn,
            EventKind::GroupMessage,
            false,
            true,
            "chat-1",
            "evt-mention",
        )
        .unwrap();
        let entry = get_entry(&conn, "evt-mention")
            .unwrap()
            .expect("mention entry should exist");
        assert_eq!(entry.kind, "mention");
        assert_eq!(entry.chat_id, "chat-1");
        assert!(entry.resolved_at.is_none());

        record_admitted_event(
            &conn,
            EventKind::ActionPrompt,
            false,
            false,
            "chat-2",
            "evt-action",
        )
        .unwrap();
        let entry = get_entry(&conn, "evt-action")
            .unwrap()
            .expect("action prompt entry should exist");
        assert_eq!(entry.kind, "action_prompt");
    }

    #[test]
    fn record_and_passive_tier_events_create_no_entry() {
        let conn = migrated_conn();

        // A member's own event is always Passive and never admitted.
        let tier = crate::notification::severity::resolve_tier(
            EventKind::GroupMessage,
            crate::chat::NotificationLevel::All,
            true,
            false,
        );
        assert_eq!(tier, crate::notification::Tier::Passive);
        record_admitted_event(
            &conn,
            EventKind::GroupMessage,
            true,
            false,
            "chat-1",
            "evt-own",
        )
        .unwrap();
        assert!(get_entry(&conn, "evt-own").unwrap().is_none());

        // An ordinary group message without a mention hit resolves Record
        // at Mentions level — counted (elsewhere) but never listed (AE3).
        let tier = crate::notification::severity::resolve_tier(
            EventKind::GroupMessage,
            crate::chat::NotificationLevel::Mentions,
            false,
            false,
        );
        assert_eq!(tier, crate::notification::Tier::Record);
        record_admitted_event(
            &conn,
            EventKind::GroupMessage,
            false,
            false,
            "chat-1",
            "evt-ordinary",
        )
        .unwrap();
        assert!(get_entry(&conn, "evt-ordinary").unwrap().is_none());
    }

    #[test]
    fn a_needs_action_prompt_in_a_nothing_chat_still_creates_an_entry() {
        // AE1: admission is independent of the chat's level (R24).
        let conn = migrated_conn();
        record_admitted_event(
            &conn,
            EventKind::ActionPrompt,
            false,
            false,
            "muted-chat",
            "evt-needs-action",
        )
        .unwrap();
        assert!(get_entry(&conn, "evt-needs-action").unwrap().is_some());
    }

    #[test]
    fn own_events_never_create_an_entry() {
        let conn = migrated_conn();
        record_admitted_event(
            &conn,
            EventKind::DirectMessage,
            true,
            false,
            "chat-1",
            "evt-own",
        )
        .unwrap();
        assert!(get_entry(&conn, "evt-own").unwrap().is_none());
    }

    #[test]
    fn concurrent_inserts_of_the_same_source_id_yield_one_row_and_no_error() {
        let conn = migrated_conn();
        let first = insert_entry(&conn, CatchUpKind::Mention, "chat-1", "evt-dup").unwrap();
        let second = insert_entry(&conn, CatchUpKind::Mention, "chat-1", "evt-dup").unwrap();
        assert!(first, "first insert should create the row");
        assert!(
            !second,
            "second insert of the same source id must be a no-op, not an error"
        );

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM catch_up_entries WHERE source_event_id = 'evt-dup'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn mark_as_read_resolves_message_shaped_entries_but_not_others() {
        let conn = migrated_conn();
        insert_entry(&conn, CatchUpKind::Mention, "chat-1", "evt-mention").unwrap();
        insert_entry(&conn, CatchUpKind::DirectMessage, "chat-1", "evt-dm").unwrap();
        insert_entry(&conn, CatchUpKind::ActionPrompt, "chat-1", "evt-action").unwrap();
        insert_entry(&conn, CatchUpKind::Welcome, "chat-1", "evt-welcome").unwrap();
        // A different chat's mention must not be touched by resolving chat-1.
        insert_entry(&conn, CatchUpKind::Mention, "chat-2", "evt-other-chat").unwrap();

        let resolved_count = resolve_chat_message_entries(&conn, "chat-1").unwrap();
        assert_eq!(
            resolved_count, 2,
            "exactly the mention and direct_message rows for chat-1"
        );

        assert!(get_entry(&conn, "evt-mention")
            .unwrap()
            .unwrap()
            .resolved_at
            .is_some());
        assert!(get_entry(&conn, "evt-dm")
            .unwrap()
            .unwrap()
            .resolved_at
            .is_some());
        assert!(
            get_entry(&conn, "evt-action")
                .unwrap()
                .unwrap()
                .resolved_at
                .is_none(),
            "action prompts resolve elsewhere"
        );
        assert!(
            get_entry(&conn, "evt-welcome")
                .unwrap()
                .unwrap()
                .resolved_at
                .is_none(),
            "welcomes resolve elsewhere"
        );
        assert!(
            get_entry(&conn, "evt-other-chat")
                .unwrap()
                .unwrap()
                .resolved_at
                .is_none(),
            "other chats untouched"
        );
    }

    #[test]
    fn accepting_a_welcome_resolves_its_entry_rather_than_leaving_it_listed() {
        let conn = migrated_conn();
        let is_new = record_welcome(&conn, "group-1", "wrapper-evt-1").unwrap();
        assert!(is_new);
        assert!(get_entry(&conn, "wrapper-evt-1")
            .unwrap()
            .unwrap()
            .resolved_at
            .is_none());

        let resolved = resolve_entry(&conn, "wrapper-evt-1").unwrap();
        assert!(resolved);
        let entry = get_entry(&conn, "wrapper-evt-1").unwrap().unwrap();
        assert!(
            entry.resolved_at.is_some(),
            "accepting a welcome must resolve, not delete, its entry"
        );
    }

    #[test]
    fn reprocessing_the_same_welcome_creates_no_second_row() {
        let conn = migrated_conn();
        let first = record_welcome(&conn, "group-1", "wrapper-evt-1").unwrap();
        let second = record_welcome(&conn, "group-1", "wrapper-evt-1").unwrap();
        assert!(first, "first sighting should be new (should notify)");
        assert!(!second, "re-processing the same welcome must not renotify");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM catch_up_entries WHERE source_event_id = 'wrapper-evt-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    /// The restart half of the welcome-dedup contract (R13, AE7). A real
    /// on-disk file is opened, closed, and reopened as a brand new
    /// `rusqlite::Connection` — clearing an in-memory set could never fail
    /// this test, which is exactly why it is the one that catches a
    /// regression back to `NOTIFIED_WELCOMES`.
    #[test]
    fn welcome_dedup_holds_across_a_real_database_reopen() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "pacto-catch-up-reopen-test-{:x}.sqlite",
            rand::random::<u64>()
        ));
        let _ = std::fs::remove_file(&path);

        {
            let mut conn = rusqlite::Connection::open(&path).expect("open db file");
            crate::migrations::run_migrations(&mut conn).expect("run migrations");
            let is_new =
                record_welcome(&conn, "group-1", "wrapper-evt-restart").expect("record welcome");
            assert!(is_new, "first sighting before restart should be new");
            // Connection dropped here — simulates process exit closing the
            // file handle, not merely clearing a process-local collection.
        }

        {
            let conn = rusqlite::Connection::open(&path).expect("reopen db file");
            let is_new = record_welcome(&conn, "group-1", "wrapper-evt-restart")
                .expect("record welcome again");
            assert!(
                !is_new,
                "the same welcome after a real reopen must not renotify"
            );
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn deleting_a_chat_removes_its_entries_only() {
        let conn = migrated_conn();
        insert_entry(&conn, CatchUpKind::Mention, "chat-1", "evt-1").unwrap();
        insert_entry(&conn, CatchUpKind::ActionPrompt, "chat-1", "evt-2").unwrap();
        insert_entry(&conn, CatchUpKind::Mention, "chat-2", "evt-3").unwrap();

        let deleted = delete_entries_for_chat(&conn, "chat-1").unwrap();
        assert_eq!(deleted, 2);
        assert!(get_entry(&conn, "evt-1").unwrap().is_none());
        assert!(get_entry(&conn, "evt-2").unwrap().is_none());
        assert!(
            get_entry(&conn, "evt-3").unwrap().is_some(),
            "other chats must survive"
        );
    }

    #[test]
    fn deleting_a_squads_channels_removes_entries_for_every_chat_beneath_it() {
        let conn = migrated_conn();
        insert_entry(&conn, CatchUpKind::Mention, "channel-a", "evt-1").unwrap();
        insert_entry(&conn, CatchUpKind::Mention, "channel-b", "evt-2").unwrap();
        insert_entry(&conn, CatchUpKind::Mention, "channel-c", "evt-3").unwrap();

        let squad_channels = vec!["channel-a".to_string(), "channel-b".to_string()];
        let deleted = delete_entries_for_chats(&conn, &squad_channels).unwrap();
        assert_eq!(deleted, 2);
        assert!(get_entry(&conn, "evt-1").unwrap().is_none());
        assert!(get_entry(&conn, "evt-2").unwrap().is_none());
        assert!(
            get_entry(&conn, "evt-3").unwrap().is_some(),
            "a channel outside the squad must survive"
        );
    }

    #[test]
    fn no_listed_entry_survives_whose_target_no_longer_resolves() {
        // A listed entry pointing at nothing is a bug in this unit (Approach
        // #4): after deleting a chat, it must not appear in an unresolved
        // listing scoped to that chat id.
        let conn = migrated_conn();
        insert_entry(&conn, CatchUpKind::Mention, "chat-1", "evt-1").unwrap();
        delete_entries_for_chat(&conn, "chat-1").unwrap();

        let chat_ids = vec!["chat-1".to_string()];
        let listed = list_unresolved_entries(&conn, None, Some(&chat_ids)).unwrap();
        assert!(listed.is_empty());
    }

    #[test]
    fn resolving_an_entry_sets_the_timestamp_and_keeps_the_row() {
        let conn = migrated_conn();
        insert_entry(&conn, CatchUpKind::ActionPrompt, "chat-1", "evt-1").unwrap();
        let resolved = resolve_entry(&conn, "evt-1").unwrap();
        assert!(resolved);

        let entry = get_entry(&conn, "evt-1")
            .unwrap()
            .expect("row must still exist");
        assert!(entry.resolved_at.is_some());

        // Resolving an already-resolved entry is a no-op, not a second event.
        let resolved_again = resolve_entry(&conn, "evt-1").unwrap();
        assert!(!resolved_again);
    }

    #[test]
    fn list_unresolved_entries_filters_by_kind_and_by_chat_and_excludes_resolved() {
        let conn = migrated_conn();
        insert_entry(&conn, CatchUpKind::Mention, "chat-1", "evt-mention").unwrap();
        insert_entry(&conn, CatchUpKind::ActionPrompt, "chat-1", "evt-action").unwrap();
        insert_entry(&conn, CatchUpKind::Mention, "chat-2", "evt-other-chat").unwrap();
        insert_entry(&conn, CatchUpKind::Mention, "chat-1", "evt-resolved").unwrap();
        resolve_entry(&conn, "evt-resolved").unwrap();

        let by_kind = list_unresolved_entries(&conn, Some(CatchUpKind::Mention), None).unwrap();
        assert_eq!(
            by_kind
                .iter()
                .map(|e| e.source_event_id.as_str())
                .collect::<std::collections::HashSet<_>>(),
            std::collections::HashSet::from(["evt-mention", "evt-other-chat"])
        );

        let chat_ids = vec!["chat-1".to_string()];
        let by_chat = list_unresolved_entries(&conn, None, Some(&chat_ids)).unwrap();
        assert_eq!(
            by_chat
                .iter()
                .map(|e| e.source_event_id.as_str())
                .collect::<std::collections::HashSet<_>>(),
            std::collections::HashSet::from(["evt-mention", "evt-action"])
        );
    }

    /// Filtering by kind and by chat ("by squad", once a squad is resolved
    /// to its member chat ids) must use an index, not a full table scan.
    #[test]
    fn filtering_unresolved_entries_by_kind_and_by_chat_uses_an_index() {
        let conn = migrated_conn();

        let plan_detail = |sql: &str| -> String {
            let mut stmt = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {}", sql))
                .unwrap();
            let rows: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(3))
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            rows.join(" | ")
        };

        let by_kind = plan_detail(
            "SELECT * FROM catch_up_entries WHERE kind = 'mention' AND resolved_at IS NULL",
        );
        assert!(
            by_kind.contains("USING INDEX idx_catch_up_entries_kind_resolved"),
            "kind filter must use the kind/resolved_at index, got: {by_kind}"
        );
        assert!(
            !by_kind.contains("SCAN catch_up_entries"),
            "must not fall back to a full scan, got: {by_kind}"
        );

        let by_chat = plan_detail(
            "SELECT * FROM catch_up_entries WHERE chat_id = 'chat-1' AND resolved_at IS NULL",
        );
        assert!(
            by_chat.contains("USING INDEX idx_catch_up_entries_chat"),
            "squad(chat) filter must use the chat_id index, got: {by_chat}"
        );
        assert!(
            !by_chat.contains("SCAN catch_up_entries"),
            "must not fall back to a full scan, got: {by_chat}"
        );
    }

    #[test]
    fn parse_kind_filter_accepts_known_kinds_and_rejects_unknown() {
        assert_eq!(parse_kind_filter(None).unwrap(), None);
        assert_eq!(
            parse_kind_filter(Some("mention")).unwrap(),
            Some(CatchUpKind::Mention)
        );
        assert_eq!(
            parse_kind_filter(Some("action_prompt")).unwrap(),
            Some(CatchUpKind::ActionPrompt)
        );
        assert!(parse_kind_filter(Some("bogus")).is_err());
    }

    fn squad_row_with_channels(id: &str, group_ids: &[&str]) -> crate::squad_catalog::SquadRow {
        crate::squad_catalog::SquadRow {
            id: id.to_string(),
            name: "Test Squad".to_string(),
            icon_url: None,
            channels: group_ids
                .iter()
                .enumerate()
                .map(|(i, gid)| crate::squad_catalog::SquadChannelRow {
                    name: format!("channel-{i}"),
                    group_id: gid.to_string(),
                    order: i as i32,
                    access: None,
                })
                .collect(),
            kind: "squad".to_string(),
            paired_squads: None,
            visibility: "private".to_string(),
            commons_tags: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn resolve_squad_chat_ids_returns_the_squads_channel_group_ids() {
        let conn = migrated_conn();
        let squad = squad_row_with_channels("squad-1", &["chan-a", "chan-b"]);
        crate::squad_catalog::upsert_squad_inner(&conn, &squad).unwrap();

        let ids = resolve_squad_chat_ids(&conn, Some("squad-1")).unwrap();
        assert_eq!(ids, Some(vec!["chan-a".to_string(), "chan-b".to_string()]));
    }

    #[test]
    fn resolve_squad_chat_ids_unknown_squad_matches_nothing_rather_than_falling_back_unfiltered() {
        let conn = migrated_conn();
        let ids = resolve_squad_chat_ids(&conn, Some("no-such-squad")).unwrap();
        assert_eq!(ids, Some(Vec::new()));
    }

    #[test]
    fn resolve_squad_chat_ids_no_squad_filter_returns_none() {
        let conn = migrated_conn();
        assert_eq!(resolve_squad_chat_ids(&conn, None).unwrap(), None);
    }

    #[test]
    fn the_needs_action_filter_and_the_squad_filter_each_narrow_independently() {
        let conn = migrated_conn();
        let squad = squad_row_with_channels("squad-1", &["chan-a"]);
        crate::squad_catalog::upsert_squad_inner(&conn, &squad).unwrap();

        insert_entry(&conn, CatchUpKind::Mention, "chan-a", "evt-mention").unwrap();
        insert_entry(&conn, CatchUpKind::ActionPrompt, "chan-a", "evt-action").unwrap();
        insert_entry(
            &conn,
            CatchUpKind::Mention,
            "chan-outside-squad",
            "evt-outside",
        )
        .unwrap();

        let needs_action =
            list_unresolved_entries(&conn, Some(CatchUpKind::ActionPrompt), None).unwrap();
        assert_eq!(needs_action.len(), 1);
        assert_eq!(needs_action[0].source_event_id, "evt-action");

        let squad_ids = resolve_squad_chat_ids(&conn, Some("squad-1")).unwrap();
        let by_squad = list_unresolved_entries(&conn, None, squad_ids.as_deref()).unwrap();
        assert_eq!(
            by_squad.len(),
            2,
            "both chan-a entries, not the one outside the squad"
        );
        assert!(by_squad.iter().all(|e| e.chat_id == "chan-a"));
    }

    #[test]
    fn entry_counts_toward_badge_excludes_nothing_level_chats() {
        let mut state = ChatState::new();
        let mut nothing_chat = Chat::new_dm("npub1nothing".to_string());
        nothing_chat.notification_level = NotificationLevel::Nothing;
        state.chats.push(nothing_chat);
        let mut mentions_chat = Chat::new_dm("npub1mentions".to_string());
        mentions_chat.notification_level = NotificationLevel::Mentions;
        state.chats.push(mentions_chat);

        assert!(!entry_counts_toward_badge(&state, "npub1nothing"));
        assert!(entry_counts_toward_badge(&state, "npub1mentions"));
    }

    #[test]
    fn entry_counts_toward_badge_counts_an_orphaned_chat_id_rather_than_hiding_it() {
        let state = ChatState::new();
        assert!(entry_counts_toward_badge(&state, "no-such-chat"));
    }

    #[test]
    fn record_or_reopen_action_needed_creates_an_unresolved_entry() {
        let conn = migrated_conn();
        record_or_reopen_action_needed(&conn, "squad-dashboard-chat", "roster-key:squad-1")
            .unwrap();
        let entry = get_entry(&conn, "roster-key:squad-1")
            .unwrap()
            .expect("entry should exist");
        assert_eq!(entry.kind, "action_prompt");
        assert_eq!(entry.chat_id, "squad-dashboard-chat");
        assert!(entry.resolved_at.is_none());
    }

    #[test]
    fn record_or_reopen_action_needed_resurfaces_a_resolved_entry_when_the_condition_still_holds() {
        let conn = migrated_conn();
        record_or_reopen_action_needed(&conn, "squad-dashboard-chat", "roster-key:squad-1")
            .unwrap();
        let first = get_entry(&conn, "roster-key:squad-1").unwrap().unwrap();

        // The member dismissed it in Catch up, or a prior reconciliation
        // pass resolved it, but the condition is still true on this pass.
        resolve_entry(&conn, "roster-key:squad-1").unwrap();
        assert!(get_entry(&conn, "roster-key:squad-1")
            .unwrap()
            .unwrap()
            .resolved_at
            .is_some());

        record_or_reopen_action_needed(&conn, "squad-dashboard-chat", "roster-key:squad-1")
            .unwrap();
        let reopened = get_entry(&conn, "roster-key:squad-1").unwrap().unwrap();
        assert!(
            reopened.resolved_at.is_none(),
            "must resurface, not stay silently resolved"
        );
        assert_eq!(
            reopened.id, first.id,
            "reopening must not fork a second row"
        );
        assert_eq!(
            reopened.created_at, first.created_at,
            "original creation time is preserved"
        );

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM catch_up_entries WHERE source_event_id = 'roster-key:squad-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "reopen must update the existing row, never insert a second one"
        );
    }

    #[test]
    fn record_or_reopen_action_needed_leaves_an_already_unresolved_entry_untouched() {
        let conn = migrated_conn();
        record_or_reopen_action_needed(&conn, "squad-dashboard-chat", "roster-key:squad-1")
            .unwrap();
        record_or_reopen_action_needed(&conn, "squad-dashboard-chat", "roster-key:squad-1")
            .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM catch_up_entries WHERE source_event_id = 'roster-key:squad-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn message_shaped_kinds_never_mix_within_one_chat() {
        // The exactness `resolve_all_catch_up_entries` relies on ("mark this
        // chat read" never reaches outside the filtered set) depends on a
        // DM chat only ever producing DirectMessage-kind entries and an MLS
        // group only ever producing Mention-kind entries. Pin that mapping
        // here so a future EventKind/CatchUpKind change that breaks it is
        // caught in this unit, not discovered as a resolve-all over-reach.
        let conn = migrated_conn();
        record_admitted_event(
            &conn,
            EventKind::DirectMessage,
            false,
            false,
            "dm-chat",
            "evt-dm",
        )
        .unwrap();
        record_admitted_event(
            &conn,
            EventKind::GroupMessage,
            false,
            true,
            "mls-chat",
            "evt-mention",
        )
        .unwrap();

        let dm_entry = get_entry(&conn, "evt-dm").unwrap().unwrap();
        assert_eq!(dm_entry.kind, CatchUpKind::DirectMessage.as_db_str());
        let mention_entry = get_entry(&conn, "evt-mention").unwrap().unwrap();
        assert_eq!(mention_entry.kind, CatchUpKind::Mention.as_db_str());
    }
}
