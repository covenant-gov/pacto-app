//! Squad docs shelf over MLS (kind 30078, `d` = `pacto_squad_doc`): doc links inside the encrypted
//! rumor, plus a SQLite replica that keeps the raw URL. Only the add card leaves the replica, masked.
//!
//! Writes are last-`updated_at_ms`-wins per doc (equal keeps the stored row); remove is sticky.
//! Logs carry the doc id and counts only.

use std::collections::HashMap;

use nostr_sdk::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use crate::nostr_tags;
use crate::rumor::{ConversationType, RumorContext, RumorEvent, RumorProcessingResult};
use crate::squad_record_privilege::{admit, Kind as PrivilegeKind, Parked};
use crate::squad_records::{
    self, card_message, signer_identity, store_local_card, with_conn, SquadGroupRole,
    SQUAD_DOC_D_TAG,
};
use crate::url_secrets::mask_doc_url;
use crate::TAURI_APP;

const SCHEMA: &str = "pacto.squad_doc.v1";
const REPLICA_UPDATED_EVENT: &str = "squad_doc_replica_updated";
/// Ingest drops ops stamped further ahead of the local clock than this.
const MAX_FUTURE_SKEW_MS: i64 = 24 * 60 * 60 * 1000;
/// Queued children kept per parent and author; older ones are dropped first.
const MAX_PENDING_PER_AUTHOR: i64 = 200;
const PENDING_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// Command error codes the frontend translates.
pub mod err {
    pub const NOT_MEMBER: &str = "squad_records_not_member";
    pub const WRONG_GROUP: &str = "squad_records_wrong_group";
    pub const ADD_RESTRICTED: &str = "squad_doc_add_restricted";
    pub const NOT_FOUND: &str = "squad_doc_not_found";
    pub const NOT_EDITABLE: &str = "squad_doc_not_editable";
    pub const INVALID_URL: &str = "squad_doc_invalid_url";
    pub const INVALID_TITLE: &str = "squad_doc_invalid_title";
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Cryptpad,
    Google,
    Zoho,
    Notion,
    Etherpad,
    Other,
}

impl Provider {
    fn as_str(self) -> &'static str {
        match self {
            Provider::Cryptpad => "cryptpad",
            Provider::Google => "google",
            Provider::Zoho => "zoho",
            Provider::Notion => "notion",
            Provider::Etherpad => "etherpad",
            Provider::Other => "other",
        }
    }

    /// Unknown values are `other`.
    fn parse(s: &str) -> Self {
        match s {
            "cryptpad" => Provider::Cryptpad,
            "google" => Provider::Google,
            "zoho" => Provider::Zoho,
            "notion" => Provider::Notion,
            "etherpad" => Provider::Etherpad,
            _ => Provider::Other,
        }
    }

    /// Local hostname check; no network.
    pub fn from_url(raw: &str) -> Self {
        let host = url::Url::parse(raw)
            .ok()
            .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
            .unwrap_or_default();
        if host.contains("cryptpad") {
            Provider::Cryptpad
        } else if host.contains("docs.google.") || host.contains("drive.google.") {
            Provider::Google
        } else if host.contains("zoho") {
            Provider::Zoho
        } else if host.contains("notion.") {
            Provider::Notion
        } else if host.contains("etherpad") {
            Provider::Etherpad
        } else {
            Provider::Other
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Add,
    Update,
    Remove,
}

impl Op {
    fn as_str(self) -> &'static str {
        match self {
            Op::Add => "add",
            Op::Update => "update",
            Op::Remove => "remove",
        }
    }
}

/// Rumor content. `remove` carries only schema, op, id, parent id, and stamp.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocWire {
    pub schema: String,
    pub op: Op,
    pub id: String,
    pub parent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_by: Option<String>,
    pub updated_at_ms: i64,
}

/// Validated doc fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocFields {
    pub url: String,
    pub title: String,
    pub provider: Provider,
    pub channel_id: Option<String>,
    pub note: Option<String>,
}

/// Form input (`SquadDocInput` in the frontend API).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadDocInput {
    pub url: String,
    pub title: String,
    pub channel_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadDocDto {
    pub id: String,
    pub parent_id: String,
    pub mls_group_id: String,
    pub url: String,
    pub title: String,
    pub provider: Provider,
    pub channel_id: Option<String>,
    pub note: Option<String>,
    pub author_npub: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub updated_by_npub: String,
    pub can_edit: bool,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn trimmed_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Absolute http(s) URL with a host and no whitespace; returned trimmed.
fn valid_url(raw: &str) -> Option<String> {
    let url = raw.trim();
    if url.is_empty() || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let parsed = url::Url::parse(url).ok()?;
    let http = matches!(parsed.scheme(), "http" | "https");
    (http && parsed.host_str().is_some_and(|h| !h.is_empty())).then(|| url.to_string())
}

/// Validates one form submission before any send; provider comes from the hostname.
pub fn fields_from_input(input: &SquadDocInput) -> Result<DocFields, String> {
    let url = valid_url(&input.url).ok_or_else(|| err::INVALID_URL.to_string())?;
    let title = input.title.trim();
    if title.is_empty() {
        return Err(err::INVALID_TITLE.into());
    }
    Ok(DocFields {
        provider: Provider::from_url(&url),
        url,
        title: title.to_string(),
        channel_id: trimmed_opt(input.channel_id.as_deref()),
        note: trimmed_opt(input.note.as_deref()),
    })
}

fn fields_from_wire(w: &DocWire) -> Option<DocFields> {
    let url = valid_url(w.url.as_deref()?)?;
    let title = w
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())?;
    Some(DocFields {
        url,
        title: title.to_string(),
        provider: w
            .provider
            .as_deref()
            .map_or(Provider::Other, Provider::parse),
        channel_id: trimmed_opt(w.channel_id.as_deref()),
        note: trimmed_opt(w.note.as_deref()),
    })
}

/// Ingest bound on peer-set stamps.
fn stamp_acceptable(updated_at_ms: i64, now_ms: i64) -> bool {
    updated_at_ms >= 0 && updated_at_ms <= now_ms.saturating_add(MAX_FUTURE_SKEW_MS)
}

// ---------------------------------------------------------------------------
// Wire builders and card JSON
// ---------------------------------------------------------------------------

fn doc_wire(
    op: Op,
    doc_id: &str,
    parent_id: &str,
    f: Option<&DocFields>,
    added_by: Option<&str>,
    updated_at_ms: i64,
) -> DocWire {
    DocWire {
        schema: SCHEMA.to_string(),
        op,
        id: doc_id.to_string(),
        parent_id: parent_id.to_string(),
        url: f.map(|f| f.url.clone()),
        title: f.map(|f| f.title.clone()),
        provider: f.map(|f| f.provider.as_str().to_string()),
        channel_id: f.and_then(|f| f.channel_id.clone()),
        note: f.and_then(|f| f.note.clone()),
        added_by: added_by.map(str::to_string),
        updated_at_ms,
    }
}

fn parse_wire(content: &str) -> Option<DocWire> {
    let w: DocWire = serde_json::from_str(content).ok()?;
    if w.schema != SCHEMA || w.parent_id.trim().is_empty() || w.id.trim().is_empty() {
        return None;
    }
    Some(w)
}

/// Announcements card: masked URL, no note.
fn added_card_content(doc_id: &str, parent_id: &str, f: &DocFields) -> String {
    serde_json::json!({
        "type": "squad_doc_added",
        "payload": {
            "id": doc_id,
            "parent_id": parent_id,
            "title": f.title,
            "provider": f.provider,
            "channel_id": f.channel_id,
            "display_url": mask_doc_url(&f.url),
        }
    })
    .to_string()
}

/// Replica log line: op, doc id, and the parent's visible count.
fn replica_log_line(op: Op, doc_id: &str, visible: i64) -> String {
    format!(
        "[squad_doc] {} applied doc={} visible={}",
        op.as_str(),
        doc_id,
        visible
    )
}

// ---------------------------------------------------------------------------
// Replica (sync, `&Connection`)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
struct DocRow {
    doc_id: String,
    parent_id: String,
    mls_group_id: String,
    fields: DocFields,
    author_npub: String,
    add_rumor_id: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    updated_by_npub: String,
    hidden: bool,
}

const DOC_COLUMNS: &str =
    "doc_id, parent_id, mls_group_id, url, title, provider, channel_id, note, \
     author_npub, add_rumor_id, created_at_ms, updated_at_ms, updated_by_npub, hidden";

fn row_from_sql(r: &rusqlite::Row<'_>) -> rusqlite::Result<DocRow> {
    let provider: String = r.get(5)?;
    Ok(DocRow {
        doc_id: r.get(0)?,
        parent_id: r.get(1)?,
        mls_group_id: r.get(2)?,
        fields: DocFields {
            url: r.get(3)?,
            title: r.get(4)?,
            provider: Provider::parse(&provider),
            channel_id: r.get(6)?,
            note: r.get(7)?,
        },
        author_npub: r.get(8)?,
        add_rumor_id: r.get(9)?,
        created_at_ms: r.get(10)?,
        updated_at_ms: r.get(11)?,
        updated_by_npub: r.get(12)?,
        hidden: r.get(13)?,
    })
}

fn load_row(conn: &Connection, doc_id: &str) -> Result<Option<DocRow>, String> {
    conn.query_row(
        &format!("SELECT {DOC_COLUMNS} FROM squad_docs WHERE doc_id = ?1"),
        params![doc_id],
        row_from_sql,
    )
    .optional()
    .map_err(|e| format!("Failed to load squad doc: {}", e))
}

fn visible_count(conn: &Connection, parent_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM squad_docs WHERE parent_id = ?1 AND hidden = 0",
        params![parent_id],
        |r| r.get(0),
    )
    .map_err(|e| format!("Failed to count squad docs: {}", e))
}

/// Rumor identity for one op.
#[derive(Clone, Copy, Debug)]
pub struct OpMeta<'a> {
    pub rumor_id: &'a str,
    pub mls_group_id: &'a str,
    pub signer_npub: &'a str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Applied {
    /// Replica row changed.
    Changed {
        inserted: bool,
    },
    /// The stored add's own rumor again.
    Replay,
    /// Child op kept until its add lands.
    Queued,
    Ignored,
}

impl Applied {
    fn changed(&self) -> bool {
        matches!(self, Applied::Changed { .. })
    }
}

fn may_add(role: SquadGroupRole) -> bool {
    role.is_member
}

/// Applies one op from `meta.signer_npub` whose role in `meta.mls_group_id` is `role`.
/// Only the parent's own announcements group may write its records.
/// Does not drain queued children; see [`drain_pending`].
pub fn apply_op(
    conn: &Connection,
    w: &DocWire,
    meta: &OpMeta<'_>,
    role: SquadGroupRole,
    now_ms: i64,
) -> Result<Applied, String> {
    if !role.is_member
        || !crate::db::side_effect_parent_matches_chat(meta.mls_group_id, &w.parent_id)
        || w.added_by
            .as_deref()
            .is_some_and(|by| by != meta.signer_npub)
    {
        return Ok(Applied::Ignored);
    }
    let row = load_row(conn, &w.id)?;
    match w.op {
        Op::Add => {
            let Some(fields) = fields_from_wire(w) else {
                return Ok(Applied::Ignored);
            };
            match row {
                // A second add for a stored id never rewrites it.
                Some(row) if row.add_rumor_id == meta.rumor_id && !row.hidden => {
                    Ok(Applied::Replay)
                }
                Some(_) => Ok(Applied::Ignored),
                None => insert_add(conn, w, fields, meta, role),
            }
        }
        Op::Update => {
            let Some(fields) = fields_from_wire(w) else {
                return Ok(Applied::Ignored);
            };
            match row {
                Some(row) => apply_update(conn, &row, w, fields, meta, role),
                None => queue(conn, w, meta, now_ms),
            }
        }
        Op::Remove => match row {
            Some(row) => apply_remove(conn, &row, w, meta, role),
            None => queue(conn, w, meta, now_ms),
        },
    }
}

fn insert_add(
    conn: &Connection,
    w: &DocWire,
    f: DocFields,
    meta: &OpMeta<'_>,
    role: SquadGroupRole,
) -> Result<Applied, String> {
    if !may_add(role) {
        return Ok(Applied::Ignored);
    }
    conn.execute(
        "INSERT INTO squad_docs (doc_id, parent_id, mls_group_id, url, title, provider, channel_id, note,
            author_npub, add_rumor_id, created_at_ms, updated_at_ms, updated_by_npub, hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?9, 0)",
        params![
            w.id,
            w.parent_id,
            meta.mls_group_id,
            f.url,
            f.title,
            f.provider.as_str(),
            f.channel_id,
            f.note,
            meta.signer_npub,
            meta.rumor_id,
            w.updated_at_ms,
        ],
    )
    .map_err(|e| format!("Failed to insert squad doc: {}", e))?;
    Ok(Applied::Changed { inserted: true })
}

/// Author or current admin, inside the row's own group and parent.
fn may_write(row: &DocRow, w: &DocWire, meta: &OpMeta<'_>, role: SquadGroupRole) -> bool {
    row.mls_group_id == meta.mls_group_id
        && row.parent_id == w.parent_id
        && role.is_member
        && (meta.signer_npub == row.author_npub || role.is_admin)
}

fn apply_update(
    conn: &Connection,
    row: &DocRow,
    w: &DocWire,
    f: DocFields,
    meta: &OpMeta<'_>,
    role: SquadGroupRole,
) -> Result<Applied, String> {
    if !may_write(row, w, meta, role) || row.hidden || w.updated_at_ms <= row.updated_at_ms {
        return Ok(Applied::Ignored);
    }
    conn.execute(
        "UPDATE squad_docs SET url = ?2, title = ?3, provider = ?4, channel_id = ?5, note = ?6,
            updated_at_ms = ?7, updated_by_npub = ?8
         WHERE doc_id = ?1",
        params![
            row.doc_id,
            f.url,
            f.title,
            f.provider.as_str(),
            f.channel_id,
            f.note,
            w.updated_at_ms,
            meta.signer_npub,
        ],
    )
    .map_err(|e| format!("Failed to update squad doc: {}", e))?;
    Ok(Applied::Changed { inserted: false })
}

/// Sticky: hides the row whatever its stamp; the stamp moves only forward.
fn apply_remove(
    conn: &Connection,
    row: &DocRow,
    w: &DocWire,
    meta: &OpMeta<'_>,
    role: SquadGroupRole,
) -> Result<Applied, String> {
    if !may_write(row, w, meta, role) || row.hidden {
        return Ok(Applied::Ignored);
    }
    let newer = w.updated_at_ms > row.updated_at_ms;
    conn.execute(
        "UPDATE squad_docs SET hidden = 1,
            updated_at_ms = CASE WHEN ?2 THEN ?3 ELSE updated_at_ms END,
            updated_by_npub = CASE WHEN ?2 THEN ?4 ELSE updated_by_npub END
         WHERE doc_id = ?1",
        params![row.doc_id, newer, w.updated_at_ms, meta.signer_npub],
    )
    .map_err(|e| format!("Failed to remove squad doc: {}", e))?;
    Ok(Applied::Changed { inserted: false })
}

fn queue(
    conn: &Connection,
    w: &DocWire,
    meta: &OpMeta<'_>,
    now_ms: i64,
) -> Result<Applied, String> {
    purge_expired_pending(conn, now_ms)?;
    let payload = serde_json::to_string(w).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO squad_doc_pending_ops
            (rumor_id, doc_id, parent_id, mls_group_id, author_npub, payload_json, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            meta.rumor_id,
            w.id,
            w.parent_id,
            meta.mls_group_id,
            meta.signer_npub,
            payload,
            w.updated_at_ms,
        ],
    )
    .map_err(|e| format!("Failed to queue squad doc op: {}", e))?;
    conn.execute(
        "DELETE FROM squad_doc_pending_ops
         WHERE parent_id = ?1 AND author_npub = ?2 AND rumor_id NOT IN (
            SELECT rumor_id FROM squad_doc_pending_ops
            WHERE parent_id = ?1 AND author_npub = ?2
            ORDER BY updated_at_ms DESC, rumor_id DESC LIMIT ?3)",
        params![w.parent_id, meta.signer_npub, MAX_PENDING_PER_AUTHOR],
    )
    .map_err(|e| format!("Failed to trim squad doc ops: {}", e))?;
    Ok(Applied::Queued)
}

fn purge_expired_pending(conn: &Connection, now_ms: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM squad_doc_pending_ops WHERE updated_at_ms < ?1",
        params![now_ms.saturating_sub(PENDING_TTL_MS)],
    )
    .map_err(|e| format!("Failed to purge squad doc ops: {}", e))?;
    Ok(())
}

/// Group id of the stored doc and the distinct authors of its queued children (`None` when not stored).
fn pending_for_stored(
    conn: &Connection,
    doc_id: &str,
) -> Result<Option<(String, Vec<String>)>, String> {
    let Some(row) = load_row(conn, doc_id)? else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare("SELECT DISTINCT author_npub FROM squad_doc_pending_ops WHERE doc_id = ?1")
        .map_err(|e| e.to_string())?;
    let authors = stmt
        .query_map(params![doc_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some((row.mls_group_id, authors)))
}

/// Applies queued children of a stored doc in `updated_at_ms` order, re-checking each author's role.
/// Returns whether the replica changed.
pub fn drain_pending(
    conn: &Connection,
    doc_id: &str,
    role_of: &dyn Fn(&str) -> SquadGroupRole,
    now_ms: i64,
) -> Result<bool, String> {
    purge_expired_pending(conn, now_ms)?;
    if load_row(conn, doc_id)?.is_none() {
        return Ok(false);
    }
    let pending: Vec<(String, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT rumor_id, mls_group_id, author_npub, payload_json FROM squad_doc_pending_ops
                 WHERE doc_id = ?1 ORDER BY updated_at_ms ASC, rumor_id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![doc_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let mut changed = false;
    for (rumor_id, mls_group_id, author, payload) in pending {
        if let Some(w) = parse_wire(&payload).filter(|w| w.id == doc_id && w.op != Op::Add) {
            let meta = OpMeta {
                rumor_id: &rumor_id,
                mls_group_id: &mls_group_id,
                signer_npub: &author,
            };
            changed |= apply_op(conn, &w, &meta, role_of(&author), now_ms)?.changed();
        }
        conn.execute(
            "DELETE FROM squad_doc_pending_ops WHERE rumor_id = ?1",
            params![rumor_id],
        )
        .map_err(|e| format!("Failed to clear squad doc op: {}", e))?;
    }
    Ok(changed)
}

/// Announcements card content for an applied add.
fn card_content(w: &DocWire, applied: &Applied) -> Option<String> {
    match (w.op, applied) {
        (Op::Add, Applied::Changed { inserted: true } | Applied::Replay) => {
            let fields = fields_from_wire(w)?;
            Some(added_card_content(&w.id, &w.parent_id, &fields))
        }
        _ => None,
    }
}

/// Visible rows for one parent, newest first. `can_edit` reflects authorship only; callers add admin.
fn load_docs(
    conn: &Connection,
    parent_id: &str,
    caller_npub: &str,
) -> Result<Vec<SquadDocDto>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {DOC_COLUMNS} FROM squad_docs WHERE parent_id = ?1 AND hidden = 0
             ORDER BY updated_at_ms DESC, doc_id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent_id], row_from_sql)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to list squad docs: {}", e))?;
    Ok(rows
        .into_iter()
        .map(|row| SquadDocDto {
            can_edit: row.author_npub == caller_npub,
            id: row.doc_id,
            parent_id: row.parent_id,
            mls_group_id: row.mls_group_id,
            url: row.fields.url,
            title: row.fields.title,
            provider: row.fields.provider,
            channel_id: row.fields.channel_id,
            note: row.fields.note,
            author_npub: row.author_npub,
            created_at_ms: row.created_at_ms,
            updated_at_ms: row.updated_at_ms,
            updated_by_npub: row.updated_by_npub,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Async glue: roles, ingest, sends
// ---------------------------------------------------------------------------

fn emit_replica_updated(parent_id: &str, doc_id: Option<&str>) {
    if let Some(handle) = TAURI_APP.get() {
        let _ = handle.emit(
            REPLICA_UPDATED_EVENT,
            serde_json::json!({ "parentId": parent_id, "docId": doc_id }),
        );
    }
}

/// Drains queued children of a stored doc after resolving their authors' roles.
async fn drain_stored<R: Runtime>(handle: &AppHandle<R>, doc_id: &str) -> Result<bool, String> {
    let Some((group_id, authors)) = with_conn(handle, |c| pending_for_stored(c, doc_id))? else {
        return Ok(false);
    };
    if authors.is_empty() {
        return Ok(false);
    }
    let mut roles = HashMap::with_capacity(authors.len());
    for author in authors {
        let role = squad_records::group_role(handle, &group_id, &author).await;
        roles.insert(author, role);
    }
    with_conn(handle, |c| {
        drain_pending(
            c,
            doc_id,
            &|npub| roles.get(npub).copied().unwrap_or_default(),
            now_ms(),
        )
    })
}

/// Same apply path for ingest and local sends; emits and logs on any replica change.
async fn apply_and_emit<R: Runtime>(
    handle: &AppHandle<R>,
    w: &DocWire,
    meta: OpMeta<'_>,
    role: SquadGroupRole,
) -> Result<Applied, String> {
    let applied = with_conn(handle, |c| apply_op(c, w, &meta, role, now_ms()))?;
    let drained = if matches!(applied, Applied::Queued | Applied::Ignored) {
        false
    } else {
        drain_stored(handle, &w.id).await?
    };
    if applied.changed() || drained {
        let visible = with_conn(handle, |c| visible_count(c, &w.parent_id)).unwrap_or(-1);
        log::info!("{}", replica_log_line(w.op, &w.id, visible));
        emit_replica_updated(&w.parent_id, Some(&w.id));
    }
    Ok(applied)
}

/// MLS ingest for `d` = `pacto_squad_doc`. Never yields a chat row except the add card.
pub async fn process_rumor(
    rumor: RumorEvent,
    context: RumorContext,
) -> Result<RumorProcessingResult, String> {
    if context.conversation_type != ConversationType::MlsGroup {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    }
    let Some(w) = parse_wire(&rumor.content) else {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    };
    let group_id = context.conversation_id.as_str();
    if !crate::db::side_effect_parent_matches_chat(group_id, &w.parent_id)
        || !stamp_acceptable(w.updated_at_ms, now_ms())
    {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    }
    let handle = TAURI_APP
        .get()
        .ok_or_else(|| "App handle not initialized".to_string())?;
    let signer = rumor
        .pubkey
        .to_bech32()
        .map_err(|e| format!("pubkey bech32: {}", e))?;
    let role = squad_records::group_role(handle, group_id, &signer).await;
    let rumor_id = rumor.id.to_hex();
    if w.op == Op::Add {
        let parked = Parked {
            rumor_id: rumor_id.clone(),
            kind: PrivilegeKind::Doc,
            parent_id: w.parent_id.clone(),
            mls_group_id: group_id.to_string(),
            author_npub: signer.clone(),
            payload_json: rumor.content.clone(),
        };
        if !admit(handle, parked).await {
            return Ok(RumorProcessingResult::SquadRecordSilent);
        }
    }
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: group_id,
        signer_npub: &signer,
    };
    let applied = apply_and_emit(handle, &w, meta, role).await?;
    let Some(content) = card_content(&w, &applied) else {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    };
    let at = crate::rumor::extract_millisecond_timestamp(&rumor);
    Ok(RumorProcessingResult::SquadRecordCard(card_message(
        rumor_id,
        content,
        at,
        context.is_mine,
        signer,
    )))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Squad records are written only through the parent's announcements group.
fn ensure_announcements_group(mls_group_id: &str, parent_id: &str) -> Result<(), String> {
    if crate::db::side_effect_parent_matches_chat(mls_group_id, parent_id) {
        Ok(())
    } else {
        Err(err::WRONG_GROUP.into())
    }
}

fn ensure_may_add(role: SquadGroupRole) -> Result<(), String> {
    if may_add(role) {
        Ok(())
    } else {
        Err(err::NOT_MEMBER.into())
    }
}

async fn ensure_add_privilege<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    npub: &str,
) -> Result<(), String> {
    crate::evm::squad_privilege_enforce::require_member_squad_privilege(
        handle,
        parent_id,
        npub,
        crate::evm::squad_privilege_enforce::SquadPrivilegeAction::AddDoc,
        err::ADD_RESTRICTED,
    )
    .await
}

/// Applies a parked add rumor once its privilege check allows it. No announcements card.
pub(crate) async fn apply_deferred<R: Runtime>(
    handle: &AppHandle<R>,
    mls_group_id: &str,
    signer: &str,
    rumor_id: &str,
    content: &str,
) -> Result<(), String> {
    let Some(w) = parse_wire(content) else {
        return Ok(());
    };
    if !crate::db::side_effect_parent_matches_chat(mls_group_id, &w.parent_id)
        || !stamp_acceptable(w.updated_at_ms, now_ms())
    {
        return Ok(());
    }
    let role = squad_records::group_role(handle, mls_group_id, signer).await;
    let meta = OpMeta {
        rumor_id,
        mls_group_id,
        signer_npub: signer,
    };
    apply_and_emit(handle, &w, meta, role).await.map(|_| ())
}

/// Visible stored row of this parent that the caller may edit or remove.
fn editable_row(
    conn: &Connection,
    mls_group_id: &str,
    parent_id: &str,
    doc_id: &str,
    npub: &str,
    role: SquadGroupRole,
) -> Result<DocRow, String> {
    if !role.is_member {
        return Err(err::NOT_MEMBER.into());
    }
    let row = load_row(conn, doc_id)?
        .filter(|row| row.parent_id == parent_id && row.mls_group_id == mls_group_id && !row.hidden)
        .ok_or_else(|| err::NOT_FOUND.to_string())?;
    if row.author_npub != npub && !role.is_admin {
        return Err(err::NOT_EDITABLE.into());
    }
    Ok(row)
}

async fn send_wire(
    mls_group_id: &str,
    parent_id: &str,
    pk: PublicKey,
    w: &DocWire,
    card: bool,
) -> Result<String, String> {
    let content = serde_json::to_string(w).map_err(|e| e.to_string())?;
    let at_ms = u64::try_from(w.updated_at_ms).unwrap_or(0);
    let mut builder = EventBuilder::new(Kind::ApplicationSpecificData, &content)
        .tag(nostr_tags::d_tag([SQUAD_DOC_D_TAG]))
        .tag(nostr_tags::custom_tag("parent", [parent_id]))
        .tag(nostr_tags::custom_tag("ms", [(at_ms % 1000).to_string()]))
        .custom_created_at(Timestamp::from_secs(at_ms / 1000));
    if card {
        builder = builder.tag(nostr_tags::custom_tag("pacto_bucket", ["announcements"]));
    }
    let built = builder.build(pk);
    let rumor_id = built
        .id
        .ok_or_else(|| "squad doc rumor id missing".to_string())?
        .to_hex();
    crate::mls::send_mls_message(mls_group_id, built, None).await?;
    Ok(rumor_id)
}

#[tauri::command]
pub async fn list_squad_docs<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<SquadDocDto>, String> {
    let caller = crate::account_manager::get_current_account()?;
    let mut docs = with_conn(&handle, |c| load_docs(c, &parent_id, &caller))?;
    let mut admin_of: HashMap<String, bool> = HashMap::new();
    for doc in docs.iter_mut().filter(|d| !d.can_edit) {
        let is_admin = match admin_of.get(&doc.mls_group_id) {
            Some(is_admin) => *is_admin,
            None => {
                let is_admin = squad_records::group_role(&handle, &doc.mls_group_id, &caller)
                    .await
                    .is_admin;
                admin_of.insert(doc.mls_group_id.clone(), is_admin);
                is_admin
            }
        };
        doc.can_edit = is_admin;
    }
    Ok(docs)
}

#[tauri::command]
pub async fn send_squad_doc_add<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    doc_id: String,
    doc: SquadDocInput,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    if doc_id.trim().is_empty() {
        return Err("Doc id required".into());
    }
    let fields = fields_from_input(&doc)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    ensure_may_add(role)?;
    ensure_add_privilege(&handle, &parent_id, &npub).await?;
    let existing = with_conn(&handle, |c| load_row(c, &doc_id))?;
    if let Some(row) = existing {
        // Retry after a send that already landed.
        if row.author_npub == npub && row.parent_id == parent_id && !row.hidden {
            return Ok(());
        }
        return Err("Doc id already in use".into());
    }

    let w = doc_wire(
        Op::Add,
        &doc_id,
        &parent_id,
        Some(&fields),
        Some(&npub),
        now_ms(),
    );
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, true).await?;
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: &mls_group_id,
        signer_npub: &npub,
    };
    apply_and_emit(&handle, &w, meta, role).await?;
    let content = added_card_content(&doc_id, &parent_id, &fields);
    let at = u64::try_from(w.updated_at_ms).unwrap_or(0);
    store_local_card(
        &handle,
        &mls_group_id,
        card_message(rumor_id, content, at, true, npub),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn send_squad_doc_update<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    doc_id: String,
    doc: SquadDocInput,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    let fields = fields_from_input(&doc)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    let row = with_conn(&handle, |c| {
        editable_row(c, &mls_group_id, &parent_id, &doc_id, &npub, role)
    })?;
    let stamp = now_ms().max(row.updated_at_ms.saturating_add(1));
    let w = doc_wire(Op::Update, &doc_id, &parent_id, Some(&fields), None, stamp);
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, false).await?;
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: &mls_group_id,
        signer_npub: &npub,
    };
    apply_and_emit(&handle, &w, meta, role).await?;
    Ok(())
}

#[tauri::command]
pub async fn send_squad_doc_remove<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    doc_id: String,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    let row = with_conn(&handle, |c| {
        editable_row(c, &mls_group_id, &parent_id, &doc_id, &npub, role)
    })?;
    let stamp = now_ms().max(row.updated_at_ms.saturating_add(1));
    let w = doc_wire(Op::Remove, &doc_id, &parent_id, None, None, stamp);
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, false).await?;
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: &mls_group_id,
        signer_npub: &npub,
    };
    apply_and_emit(&handle, &w, meta, role).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A parent's id is its announcements MLS group id.
    const PARENT: &str = "squad-1";
    const GROUP: &str = PARENT;
    const NOW: i64 = 10_000;
    const ALICE: &str = "npub1alice";
    const BOB: &str = "npub1bob";
    const ADMIN: &str = "npub1admin";
    const OUTSIDER: &str = "npub1outsider";
    const CRYPTPAD: &str = "https://cryptpad.fr/pad/#/2/pad/edit/s3cretKey";
    const TOKEN_URL: &str = "https://example.com/a?token=abc123&x=1";
    const NOTE: &str = "private planning note";

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    fn role_of(npub: &str) -> SquadGroupRole {
        match npub {
            ADMIN => SquadGroupRole {
                is_member: true,
                is_admin: true,
            },
            OUTSIDER => SquadGroupRole::default(),
            _ => SquadGroupRole {
                is_member: true,
                is_admin: false,
            },
        }
    }

    fn input(url: &str) -> SquadDocInput {
        SquadDocInput {
            url: url.into(),
            title: "Plan".into(),
            channel_id: Some("general".into()),
            note: Some(NOTE.into()),
        }
    }

    fn fields(url: &str) -> DocFields {
        fields_from_input(&input(url)).expect("valid input")
    }

    fn add(id: &str, url: &str, by: &str, ts: i64) -> DocWire {
        doc_wire(Op::Add, id, PARENT, Some(&fields(url)), Some(by), ts)
    }

    fn update(id: &str, url: &str, ts: i64) -> DocWire {
        let mut f = fields(url);
        f.title = format!("Plan @{ts}");
        doc_wire(Op::Update, id, PARENT, Some(&f), None, ts)
    }

    fn remove(id: &str, ts: i64) -> DocWire {
        doc_wire(Op::Remove, id, PARENT, None, None, ts)
    }

    /// Ingest one op (apply + drain), returning the outcome and any card content.
    fn ingest(
        conn: &Connection,
        w: &DocWire,
        rumor_id: &str,
        signer: &str,
    ) -> (Applied, Option<String>) {
        let meta = OpMeta {
            rumor_id,
            mls_group_id: GROUP,
            signer_npub: signer,
        };
        let applied = apply_op(conn, w, &meta, role_of(signer), NOW).expect("apply");
        drain_pending(conn, &w.id, &role_of, NOW).expect("drain");
        let card = card_content(w, &applied);
        (applied, card)
    }

    fn row(conn: &Connection, id: &str) -> DocRow {
        load_row(conn, id).expect("load").expect("row exists")
    }

    fn listed(conn: &Connection, caller: &str) -> Vec<SquadDocDto> {
        load_docs(conn, PARENT, caller).expect("list")
    }

    #[test]
    fn add_stores_raw_url_and_card_masks_it() {
        let conn = conn();
        let (applied, card) = ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        assert_eq!(applied, Applied::Changed { inserted: true });
        let stored = row(&conn, "d1");
        assert_eq!(stored.fields.url, CRYPTPAD);
        assert_eq!(stored.author_npub, ALICE);
        assert_eq!(stored.fields.provider, Provider::Cryptpad);

        let card = card.expect("add card");
        assert!(!card.contains("s3cretKey") && !card.contains("/2/pad/edit"));
        assert!(!card.contains(NOTE));
        let v: serde_json::Value = serde_json::from_str(&card).expect("json");
        assert_eq!(v["type"], "squad_doc_added");
        assert_eq!(v["payload"]["display_url"], "https://cryptpad.fr/pad/#••••");
        assert_eq!(v["payload"]["provider"], "cryptpad");
        assert_eq!(v["payload"]["channel_id"], "general");
        assert_eq!(v["payload"]["id"], "d1");
        assert_eq!(v["payload"]["parent_id"], PARENT);
    }

    #[test]
    fn card_has_no_secret_query_value() {
        let conn = conn();
        let (_, card) = ingest(&conn, &add("d1", TOKEN_URL, ALICE, 100), "r1", ALICE);
        let card = card.expect("card");
        assert!(!card.contains("abc123"));
        assert!(card.contains("token=••••&x=1"));
        assert_eq!(row(&conn, "d1").fields.url, TOKEN_URL);
    }

    #[test]
    fn update_and_remove_are_silent() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        let (applied, card) = ingest(&conn, &update("d1", TOKEN_URL, 200), "r2", ALICE);
        assert!(applied.changed());
        assert!(card.is_none());
        let (applied, card) = ingest(&conn, &remove("d1", 300), "r3", ALICE);
        assert!(applied.changed());
        assert!(card.is_none());
    }

    #[test]
    fn update_from_non_author_non_admin_is_ignored() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        let (applied, _) = ingest(&conn, &update("d1", TOKEN_URL, 200), "r2", BOB);
        assert_eq!(applied, Applied::Ignored);
        assert_eq!(row(&conn, "d1").fields.url, CRYPTPAD);
        let (applied, _) = ingest(&conn, &remove("d1", 300), "r3", BOB);
        assert_eq!(applied, Applied::Ignored);
        assert!(!row(&conn, "d1").hidden);
    }

    #[test]
    fn admin_may_update_and_remove_any_row() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        ingest(&conn, &update("d1", TOKEN_URL, 200), "r2", ADMIN);
        let stored = row(&conn, "d1");
        assert_eq!(stored.fields.url, TOKEN_URL);
        assert_eq!(stored.updated_by_npub, ADMIN);
        assert_eq!(stored.author_npub, ALICE);
        ingest(&conn, &remove("d1", 300), "r3", ADMIN);
        assert!(row(&conn, "d1").hidden);
    }

    #[test]
    fn last_updated_at_wins_and_equal_keeps_stored() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        ingest(&conn, &update("d1", TOKEN_URL, 300), "r2", ALICE);
        let (applied, _) = ingest(
            &conn,
            &update("d1", "https://example.com/old", 200),
            "r3",
            ALICE,
        );
        assert_eq!(applied, Applied::Ignored);
        let (applied, _) = ingest(
            &conn,
            &update("d1", "https://example.com/same", 300),
            "r4",
            ALICE,
        );
        assert_eq!(applied, Applied::Ignored);
        assert_eq!(row(&conn, "d1").fields.url, TOKEN_URL);
    }

    #[test]
    fn remove_hides_and_an_older_add_does_not_revive() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        ingest(&conn, &remove("d1", 200), "r2", ALICE);
        assert!(listed(&conn, ALICE).is_empty());
        let (applied, card) = ingest(&conn, &add("d1", CRYPTPAD, ALICE, 50), "r3", ALICE);
        assert_eq!(applied, Applied::Ignored);
        assert!(card.is_none());
        let (applied, _) = ingest(&conn, &update("d1", TOKEN_URL, 900), "r4", ALICE);
        assert_eq!(applied, Applied::Ignored);
        assert!(row(&conn, "d1").hidden);
        assert!(listed(&conn, ALICE).is_empty());
    }

    #[test]
    fn remove_before_add_waits_and_then_hides() {
        let conn = conn();
        let (applied, _) = ingest(&conn, &remove("d1", 200), "r2", ALICE);
        assert_eq!(applied, Applied::Queued);
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        assert!(row(&conn, "d1").hidden);
        assert!(listed(&conn, ALICE).is_empty());
    }

    #[test]
    fn queued_remove_from_non_author_does_not_hide() {
        let conn = conn();
        ingest(&conn, &remove("d1", 200), "r2", BOB);
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        assert!(!row(&conn, "d1").hidden);
    }

    #[test]
    fn members_may_add_and_outsiders_may_not() {
        assert!(ensure_may_add(role_of(ALICE)).is_ok());
        assert_eq!(
            ensure_may_add(role_of(OUTSIDER)),
            Err(err::NOT_MEMBER.to_string())
        );
    }

    #[test]
    fn outsiders_and_other_groups_are_ignored() {
        let conn = conn();
        let (applied, _) = ingest(&conn, &add("d1", CRYPTPAD, OUTSIDER, 100), "r1", OUTSIDER);
        assert_eq!(applied, Applied::Ignored);
        let mut w = add("d2", CRYPTPAD, ALICE, 100);
        w.parent_id = "other-squad".into();
        let (applied, _) = ingest(&conn, &w, "r2", ALICE);
        assert_eq!(applied, Applied::Ignored);
        assert_eq!(
            ensure_announcements_group("other-group", PARENT),
            Err(err::WRONG_GROUP.to_string())
        );
    }

    #[test]
    fn provider_from_hostname() {
        for (url, want) in [
            ("https://cryptpad.fr/pad/#/x", Provider::Cryptpad),
            (
                "https://docs.google.com/document/d/1/edit",
                Provider::Google,
            ),
            ("https://drive.google.com/file/d/1", Provider::Google),
            ("https://WRITER.ZOHO.com/x", Provider::Zoho),
            ("https://www.notion.so/page", Provider::Notion),
            ("https://etherpad.wikimedia.org/p/x", Provider::Etherpad),
            ("https://example.com/a", Provider::Other),
        ] {
            assert_eq!(Provider::from_url(url), want, "{url}");
        }
    }

    #[test]
    fn unknown_wire_provider_is_other() {
        let conn = conn();
        let mut w = add("d1", CRYPTPAD, ALICE, 100);
        w.provider = Some("dropbox".into());
        ingest(&conn, &w, "r1", ALICE);
        assert_eq!(row(&conn, "d1").fields.provider, Provider::Other);
    }

    #[test]
    fn non_http_url_is_rejected() {
        for url in [
            "ftp://example.com/a",
            "javascript:alert(1)",
            "mailto:a@b.c",
            "not a url",
            "",
        ] {
            assert_eq!(
                fields_from_input(&input(url)),
                Err(err::INVALID_URL.to_string()),
                "{url}"
            );
        }
        let conn = conn();
        let mut w = add("d1", CRYPTPAD, ALICE, 100);
        w.url = Some("javascript:alert(1)".into());
        let (applied, _) = ingest(&conn, &w, "r1", ALICE);
        assert_eq!(applied, Applied::Ignored);
        assert!(fields_from_input(&input("http://example.com/a")).is_ok());
    }

    #[test]
    fn blank_title_is_rejected() {
        let mut i = input(CRYPTPAD);
        i.title = "   ".into();
        assert_eq!(fields_from_input(&i), Err(err::INVALID_TITLE.to_string()));
    }

    #[test]
    fn added_by_mismatch_with_signer_is_ignored() {
        let conn = conn();
        let (applied, card) = ingest(&conn, &add("d1", CRYPTPAD, BOB, 100), "r1", ALICE);
        assert_eq!(applied, Applied::Ignored);
        assert!(card.is_none());
        assert!(load_row(&conn, "d1").expect("load").is_none());
    }

    #[test]
    fn second_add_for_existing_id_is_a_no_op() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        for (signer, rumor) in [(BOB, "r2"), (ADMIN, "r3"), (ALICE, "r4")] {
            let (applied, card) = ingest(&conn, &add("d1", TOKEN_URL, signer, 500), rumor, signer);
            assert_eq!(applied, Applied::Ignored, "{signer}");
            assert!(card.is_none());
        }
        let stored = row(&conn, "d1");
        assert_eq!(stored.fields.url, CRYPTPAD);
        assert_eq!(stored.author_npub, ALICE);
        // The same add rumor again is a replay.
        let (applied, card) = ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        assert_eq!(applied, Applied::Replay);
        assert!(card.is_some());
    }

    #[test]
    fn far_future_stamp_is_rejected() {
        assert!(stamp_acceptable(NOW + MAX_FUTURE_SKEW_MS, NOW));
        assert!(!stamp_acceptable(NOW + MAX_FUTURE_SKEW_MS + 1, NOW));
        assert!(!stamp_acceptable(-1, NOW));
    }

    #[test]
    fn list_omits_hidden_sorts_newest_and_marks_authorship() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        ingest(&conn, &add("d2", TOKEN_URL, BOB, 200), "r2", BOB);
        ingest(&conn, &add("d3", TOKEN_URL, BOB, 300), "r3", BOB);
        ingest(&conn, &update("d1", CRYPTPAD, 400), "r4", ALICE);
        ingest(&conn, &remove("d3", 500), "r5", BOB);
        let rows = listed(&conn, ALICE);
        let ids: Vec<&str> = rows.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["d1", "d2"]);
        assert!(rows[0].can_edit);
        assert!(!rows[1].can_edit);
        assert_eq!(rows[0].url, CRYPTPAD);
        assert_eq!(rows[0].note.as_deref(), Some(NOTE));
    }

    #[test]
    fn editable_row_enforces_author_or_admin() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        let check =
            |npub: &str| editable_row(&conn, GROUP, PARENT, "d1", npub, role_of(npub)).map(|_| ());
        assert!(check(ALICE).is_ok());
        assert!(check(ADMIN).is_ok());
        assert_eq!(check(BOB), Err(err::NOT_EDITABLE.to_string()));
        assert_eq!(check(OUTSIDER), Err(err::NOT_MEMBER.to_string()));
        assert_eq!(
            editable_row(&conn, GROUP, PARENT, "missing", ALICE, role_of(ALICE)).map(|_| ()),
            Err(err::NOT_FOUND.to_string())
        );
        ingest(&conn, &remove("d1", 200), "r2", ALICE);
        assert_eq!(check(ALICE), Err(err::NOT_FOUND.to_string()));
    }

    #[test]
    fn remove_wire_carries_no_doc_fields() {
        let json = serde_json::to_value(remove("d1", 5)).expect("json");
        let keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        let mut keys = keys;
        keys.sort_unstable();
        assert_eq!(keys, ["id", "op", "parent_id", "schema", "updated_at_ms"]);
    }

    #[test]
    fn wire_round_trips_and_rejects_other_schemas() {
        let w = add("d1", CRYPTPAD, ALICE, 100);
        let json = serde_json::to_string(&w).expect("json");
        assert_eq!(parse_wire(&json), Some(w));
        assert!(parse_wire(&json.replace(SCHEMA, "pacto.squad_doc.v0")).is_none());
        assert!(parse_wire(r#"{"schema":"pacto.squad_doc.v1","op":"remove","id":" ","parent_id":"p","updated_at_ms":1}"#).is_none());
    }

    #[test]
    fn log_line_has_id_and_count_but_no_url() {
        let conn = conn();
        ingest(&conn, &add("d1", CRYPTPAD, ALICE, 100), "r1", ALICE);
        let line = replica_log_line(Op::Add, "d1", visible_count(&conn, PARENT).expect("count"));
        assert_eq!(line, "[squad_doc] add applied doc=d1 visible=1");
        for secret in ["http", "cryptpad", "s3cretKey", "Plan", NOTE] {
            assert!(!line.contains(secret), "{secret}");
        }
    }
}
