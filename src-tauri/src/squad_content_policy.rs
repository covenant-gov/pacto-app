//! Per-squad content restrictions replicated from admin rumors (kind 30078, silent).
//! Each flag is last-timestamp-wins on its own; ties keep the stored value.

use nostr_sdk::prelude::*;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use crate::nostr_tags;
use crate::rumor::{ConversationType, RumorContext, RumorEvent, RumorProcessingResult};
use crate::squad_records::{self, SQUAD_CONTENT_POLICY_D_TAG};

const POLICY_SCHEMA: &str = "pacto.squad_content_policy.v1";
/// Incoming flag stamps further ahead of the local clock are dropped.
const MAX_FUTURE_SKEW_MS: i64 = 24 * 60 * 60 * 1000;

const ERR_NOT_MEMBER: &str = "squad_records_not_member";
const ERR_NOT_ADMIN: &str = "squad_records_not_admin";
const ERR_WRONG_GROUP: &str = "squad_records_wrong_group";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SquadContentPolicy {
    pub restrict_event_create: bool,
    pub restrict_event_create_updated_at_ms: i64,
    pub restrict_event_create_by_npub: Option<String>,
    pub restrict_doc_add: bool,
    pub restrict_doc_add_updated_at_ms: i64,
    pub restrict_doc_add_by_npub: Option<String>,
}

/// Rumor content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SquadContentPolicyWire {
    pub schema: String,
    pub parent_id: String,
    pub restrict_event_create: bool,
    pub restrict_event_create_updated_at_ms: i64,
    pub restrict_doc_add: bool,
    pub restrict_doc_add_updated_at_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyFlag {
    RestrictEventCreate,
    RestrictDocAdd,
}

impl PolicyFlag {
    pub fn parse(flag: &str) -> Result<Self, String> {
        match flag {
            "restrict_event_create" => Ok(Self::RestrictEventCreate),
            "restrict_doc_add" => Ok(Self::RestrictDocAdd),
            _ => Err(format!("Unknown squad content policy flag: {}", flag)),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PolicyApplyOutcome {
    /// At least one flag was stored.
    pub changed: bool,
    /// `restrict_event_create` went from off to on.
    pub event_create_turned_on: bool,
    /// Event rows removed by a restrict-on.
    pub deleted_events: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadContentPolicyView {
    pub restrict_event_create: bool,
    pub restrict_event_create_updated_at_ms: i64,
    pub restrict_doc_add: bool,
    pub restrict_doc_add_updated_at_ms: i64,
    pub caller_is_admin: bool,
    pub admin_is_member: bool,
}

/// Absent row = both off, timestamps 0.
pub fn load_policy(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<SquadContentPolicy, String> {
    conn.query_row(
        "SELECT restrict_event_create, restrict_event_create_updated_at_ms, restrict_event_create_by_npub,
                restrict_doc_add, restrict_doc_add_updated_at_ms, restrict_doc_add_by_npub
         FROM squad_content_policy WHERE parent_id = ?1",
        rusqlite::params![parent_id],
        |row| {
            Ok(SquadContentPolicy {
                restrict_event_create: row.get(0)?,
                restrict_event_create_updated_at_ms: row.get(1)?,
                restrict_event_create_by_npub: row.get(2)?,
                restrict_doc_add: row.get(3)?,
                restrict_doc_add_updated_at_ms: row.get(4)?,
                restrict_doc_add_by_npub: row.get(5)?,
            })
        },
    )
    .optional()
    .map(Option::unwrap_or_default)
    .map_err(|e| format!("Failed to load squad content policy: {}", e))
}

/// Rejects other schemas, negative stamps, and stamps beyond `now_ms` plus the skew allowance.
pub fn try_parse_wire(content: &str, now_ms: i64) -> Option<SquadContentPolicyWire> {
    let w: SquadContentPolicyWire = serde_json::from_str(content.trim()).ok()?;
    let max_ms = now_ms.saturating_add(MAX_FUTURE_SKEW_MS);
    let stamp_ok = |ms: i64| (0..=max_ms).contains(&ms);
    if w.schema != POLICY_SCHEMA
        || w.parent_id.trim().is_empty()
        || !stamp_ok(w.restrict_event_create_updated_at_ms)
        || !stamp_ok(w.restrict_doc_add_updated_at_ms)
    {
        return None;
    }
    Some(w)
}

/// Non-admin authors change nothing; each flag is taken only when its timestamp is strictly newer.
pub fn merge_policy(
    stored: &SquadContentPolicy,
    incoming: &SquadContentPolicyWire,
    author_npub: &str,
    author_is_admin: bool,
) -> (SquadContentPolicy, PolicyApplyOutcome) {
    let mut next = stored.clone();
    let mut outcome = PolicyApplyOutcome::default();
    if !author_is_admin {
        return (next, outcome);
    }
    if incoming.restrict_event_create_updated_at_ms > stored.restrict_event_create_updated_at_ms {
        next.restrict_event_create = incoming.restrict_event_create;
        next.restrict_event_create_updated_at_ms = incoming.restrict_event_create_updated_at_ms;
        next.restrict_event_create_by_npub = Some(author_npub.to_string());
        outcome.changed = true;
        outcome.event_create_turned_on =
            incoming.restrict_event_create && !stored.restrict_event_create;
    }
    if incoming.restrict_doc_add_updated_at_ms > stored.restrict_doc_add_updated_at_ms {
        next.restrict_doc_add = incoming.restrict_doc_add;
        next.restrict_doc_add_updated_at_ms = incoming.restrict_doc_add_updated_at_ms;
        next.restrict_doc_add_by_npub = Some(author_npub.to_string());
        outcome.changed = true;
    }
    (next, outcome)
}

fn upsert_policy(
    conn: &rusqlite::Connection,
    parent_id: &str,
    p: &SquadContentPolicy,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO squad_content_policy (
            parent_id, restrict_event_create, restrict_event_create_updated_at_ms, restrict_event_create_by_npub,
            restrict_doc_add, restrict_doc_add_updated_at_ms, restrict_doc_add_by_npub)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(parent_id) DO UPDATE SET
            restrict_event_create = excluded.restrict_event_create,
            restrict_event_create_updated_at_ms = excluded.restrict_event_create_updated_at_ms,
            restrict_event_create_by_npub = excluded.restrict_event_create_by_npub,
            restrict_doc_add = excluded.restrict_doc_add,
            restrict_doc_add_updated_at_ms = excluded.restrict_doc_add_updated_at_ms,
            restrict_doc_add_by_npub = excluded.restrict_doc_add_by_npub",
        rusqlite::params![
            parent_id,
            p.restrict_event_create,
            p.restrict_event_create_updated_at_ms,
            p.restrict_event_create_by_npub,
            p.restrict_doc_add,
            p.restrict_doc_add_updated_at_ms,
            p.restrict_doc_add_by_npub,
        ],
    )
    .map(|_| ())
    .map_err(|e| format!("Failed to store squad content policy: {}", e))
}

/// Remove every non-admin event of the parent, with its RSVPs and pending ops. Not time-scoped:
/// creation stamps are sender-set (see docs/communities/SQUAD_CONTENT_POLICY.md).
fn delete_restricted_events(
    conn: &rusqlite::Connection,
    parent_id: &str,
    admin_npubs: &[String],
) -> Result<usize, String> {
    let map_err = |e: rusqlite::Error| format!("Failed to apply event restriction: {}", e);
    let doomed: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT event_id, author_npub FROM squad_events WHERE parent_id = ?1")
            .map_err(map_err)?;
        let rows = stmt
            .query_map([parent_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(map_err)?;
        let mut ids = Vec::new();
        for row in rows {
            let (event_id, author) = row.map_err(map_err)?;
            if !admin_npubs.iter().any(|a| a == &author) {
                ids.push(event_id);
            }
        }
        ids
    };
    for event_id in &doomed {
        conn.execute(
            "DELETE FROM squad_event_rsvps WHERE event_id = ?1",
            [event_id],
        )
        .map_err(map_err)?;
        conn.execute(
            "DELETE FROM squad_event_pending_ops WHERE event_id = ?1",
            [event_id],
        )
        .map_err(map_err)?;
        conn.execute("DELETE FROM squad_events WHERE event_id = ?1", [event_id])
            .map_err(map_err)?;
    }
    Ok(doomed.len())
}

/// Merge, store, and enforce a restrict-on in one transaction.
/// An empty `admin_npubs` means the admin lookup failed: the flag is stored but nothing is deleted.
pub fn apply_policy(
    conn: &rusqlite::Connection,
    incoming: &SquadContentPolicyWire,
    author_npub: &str,
    author_is_admin: bool,
    admin_npubs: &[String],
) -> Result<PolicyApplyOutcome, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to open policy transaction: {}", e))?;
    let stored = load_policy(&tx, &incoming.parent_id)?;
    let (next, mut outcome) = merge_policy(&stored, incoming, author_npub, author_is_admin);
    if !outcome.changed {
        return Ok(outcome);
    }
    upsert_policy(&tx, &incoming.parent_id, &next)?;
    if outcome.event_create_turned_on && !admin_npubs.is_empty() {
        outcome.deleted_events = delete_restricted_events(&tx, &incoming.parent_id, admin_npubs)?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit squad content policy: {}", e))?;
    Ok(outcome)
}

/// Wire for an admin toggling one flag; the other flag carries its stored value and timestamp.
pub fn build_set_wire(
    stored: &SquadContentPolicy,
    parent_id: &str,
    flag: PolicyFlag,
    value: bool,
    now_ms: i64,
) -> SquadContentPolicyWire {
    let mut wire = SquadContentPolicyWire {
        schema: POLICY_SCHEMA.to_string(),
        parent_id: parent_id.to_string(),
        restrict_event_create: stored.restrict_event_create,
        restrict_event_create_updated_at_ms: stored.restrict_event_create_updated_at_ms,
        restrict_doc_add: stored.restrict_doc_add,
        restrict_doc_add_updated_at_ms: stored.restrict_doc_add_updated_at_ms,
    };
    // Stay strictly newer than the stored stamp even if another admin's clock ran ahead.
    match flag {
        PolicyFlag::RestrictEventCreate => {
            wire.restrict_event_create = value;
            wire.restrict_event_create_updated_at_ms =
                now_ms.max(stored.restrict_event_create_updated_at_ms.saturating_add(1));
        }
        PolicyFlag::RestrictDocAdd => {
            wire.restrict_doc_add = value;
            wire.restrict_doc_add_updated_at_ms =
                now_ms.max(stored.restrict_doc_add_updated_at_ms.saturating_add(1));
        }
    }
    wire
}

fn with_conn<R: Runtime, T>(
    handle: &AppHandle<R>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let res = f(&conn);
    crate::account_manager::return_db_connection(conn);
    res
}

fn now_ms() -> Result<i64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .map_err(|e| e.to_string())
}

/// Apply in SQLite and notify the webview.
async fn apply_and_emit<R: Runtime>(
    handle: &AppHandle<R>,
    mls_group_id: &str,
    wire: &SquadContentPolicyWire,
    author_npub: &str,
    author_is_admin: bool,
) -> Result<PolicyApplyOutcome, String> {
    let admins = if author_is_admin && wire.restrict_event_create {
        squad_records::group_admin_npubs(handle, mls_group_id).await
    } else {
        Vec::new()
    };
    let outcome = with_conn(handle, |conn| {
        apply_policy(conn, wire, author_npub, author_is_admin, &admins)
    })?;
    if outcome.changed {
        let _ = handle.emit(
            "squad_content_policy_updated",
            serde_json::json!({ "parentId": wire.parent_id }),
        );
    }
    if outcome.deleted_events > 0 {
        eprintln!(
            "[SquadContentPolicy] Restriction removed {} event(s)",
            outcome.deleted_events
        );
        let _ = handle.emit(
            "squad_event_replica_updated",
            serde_json::json!({ "parentId": wire.parent_id, "eventId": null }),
        );
    }
    Ok(outcome)
}

/// Records are only accepted from the parent's own announcements group.
fn require_parent_group(mls_group_id: &str, parent_id: &str) -> Result<(), String> {
    if crate::db::side_effect_parent_matches_chat(mls_group_id, parent_id) {
        Ok(())
    } else {
        Err(ERR_WRONG_GROUP.into())
    }
}

/// MLS kind 30078 with `d` = policy tag. Always silent; non-admin, foreign-group or malformed rumors are dropped.
pub async fn process_rumor(
    rumor: RumorEvent,
    context: RumorContext,
) -> Result<RumorProcessingResult, String> {
    if context.conversation_type != ConversationType::MlsGroup {
        return Ok(RumorProcessingResult::Ignored);
    }
    let Some(wire) = try_parse_wire(&rumor.content, now_ms()?) else {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    };
    if require_parent_group(&context.conversation_id, &wire.parent_id).is_err() {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    }
    if let Some(tag_parent) =
        nostr_tags::find_custom(&rumor.tags, "parent").and_then(|t| t.content())
    {
        if tag_parent != wire.parent_id {
            return Ok(RumorProcessingResult::SquadRecordSilent);
        }
    }
    let handle = crate::TAURI_APP
        .get()
        .ok_or_else(|| "App handle not initialized".to_string())?;
    let author = rumor
        .pubkey
        .to_bech32()
        .map_err(|e| format!("pubkey bech32: {}", e))?;
    let role = squad_records::group_role(handle, &context.conversation_id, &author).await;
    if role.is_admin {
        apply_and_emit(handle, &context.conversation_id, &wire, &author, true).await?;
    }
    Ok(RumorProcessingResult::SquadRecordSilent)
}

fn require_admin(role: squad_records::SquadGroupRole) -> Result<(), String> {
    if !role.is_member {
        Err(ERR_NOT_MEMBER.into())
    } else if !role.is_admin {
        Err(ERR_NOT_ADMIN.into())
    } else {
        Ok(())
    }
}

/// `(caller_is_admin, admin_is_member)`; admin requires membership, as in `squad_records::group_role`.
fn view_roles(participants: &[String], admins: &[String], caller_npub: &str) -> (bool, bool) {
    let is_member = |npub: &str| participants.iter().any(|p| p.trim() == npub.trim());
    let caller_is_admin = is_member(caller_npub) && admins.iter().any(|a| a == caller_npub.trim());
    let admin_is_member = admins.iter().any(|a| is_member(a));
    (caller_is_admin, admin_is_member)
}

/// Loaded chat participants, else the stored chat row; empty when unknown.
async fn chat_participants<R: Runtime>(handle: &AppHandle<R>, chat_id: &str) -> Vec<String> {
    let loaded = {
        let state = crate::STATE.lock().await;
        state.get_chat(chat_id).map(|c| c.participants().clone())
    };
    if let Some(parts) = loaded.filter(|p| !p.is_empty()) {
        return parts;
    }
    with_conn(handle, |conn| {
        let raw: Option<String> = conn
            .query_row(
                "SELECT participants FROM chats WHERE chat_identifier = ?1",
                [chat_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(raw
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default())
    })
    .unwrap_or_default()
}

async fn policy_view<R: Runtime>(
    handle: &AppHandle<R>,
    mls_group_id: &str,
    parent_id: &str,
    caller_npub: &str,
) -> Result<SquadContentPolicyView, String> {
    let policy = with_conn(handle, |conn| load_policy(conn, parent_id))?;
    let admins = squad_records::group_admin_npubs(handle, mls_group_id).await;
    let participants = chat_participants(handle, mls_group_id.trim()).await;
    let (caller_is_admin, admin_is_member) = view_roles(&participants, &admins, caller_npub);
    Ok(SquadContentPolicyView {
        restrict_event_create: policy.restrict_event_create,
        restrict_event_create_updated_at_ms: policy.restrict_event_create_updated_at_ms,
        restrict_doc_add: policy.restrict_doc_add,
        restrict_doc_add_updated_at_ms: policy.restrict_doc_add_updated_at_ms,
        caller_is_admin,
        admin_is_member,
    })
}

#[tauri::command]
pub async fn get_squad_content_policy<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
) -> Result<SquadContentPolicyView, String> {
    require_parent_group(&mls_group_id, &parent_id)?;
    let caller = crate::account_manager::get_current_account()?;
    policy_view(&handle, &mls_group_id, &parent_id, &caller).await
}

#[tauri::command]
pub async fn set_squad_content_policy<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    flag: String,
    value: bool,
) -> Result<SquadContentPolicyView, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let flag = PolicyFlag::parse(&flag)?;
    require_parent_group(&mls_group_id, &parent_id)?;

    let client = crate::get_nostr_client()?;
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pk = signer.get_public_key().await.map_err(|e| e.to_string())?;
    let caller = pk.to_bech32().map_err(|e| e.to_string())?;
    require_admin(squad_records::group_role(&handle, &mls_group_id, &caller).await)?;

    let stored = with_conn(&handle, |conn| load_policy(conn, &parent_id))?;
    let now = now_ms()?;
    let wire = build_set_wire(&stored, &parent_id, flag, value, now);
    let content = serde_json::to_string(&wire).map_err(|e| e.to_string())?;

    let rumor = EventBuilder::new(Kind::ApplicationSpecificData, &content)
        .tag(nostr_tags::d_tag([SQUAD_CONTENT_POLICY_D_TAG]))
        .tag(nostr_tags::custom_tag("parent", [&parent_id]))
        .tag(nostr_tags::custom_tag("ms", [(now % 1000).to_string()]))
        .build(pk);
    crate::mls::send_mls_message(&mls_group_id, rumor, None).await?;

    apply_and_emit(&handle, &mls_group_id, &wire, &caller, true).await?;
    policy_view(&handle, &mls_group_id, &parent_id, &caller).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const ADMIN: &str = "npub1admin";
    const MEMBER: &str = "npub1member";

    fn migrated_conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    fn wire(event: bool, event_ms: i64, doc: bool, doc_ms: i64) -> SquadContentPolicyWire {
        SquadContentPolicyWire {
            schema: POLICY_SCHEMA.to_string(),
            parent_id: "squad-1".to_string(),
            restrict_event_create: event,
            restrict_event_create_updated_at_ms: event_ms,
            restrict_doc_add: doc,
            restrict_doc_add_updated_at_ms: doc_ms,
        }
    }

    fn admins() -> Vec<String> {
        vec![ADMIN.to_string()]
    }

    fn apply_as_admin(
        conn: &rusqlite::Connection,
        w: &SquadContentPolicyWire,
    ) -> PolicyApplyOutcome {
        apply_policy(conn, w, ADMIN, true, &admins()).expect("apply")
    }

    fn insert_event(
        conn: &rusqlite::Connection,
        event_id: &str,
        parent: &str,
        author: &str,
        created_at_ms: i64,
    ) {
        conn.execute(
            "INSERT INTO squad_events (event_id, parent_id, mls_group_id, nip52_kind, title, start_unix,
                start_tzid, place_kind, author_npub, created_at_ms, updated_at_ms, updated_by_npub, content_hash)
             VALUES (?1, ?2, 'group-1', 31923, 't', 1767225600, 'UTC', 'online', ?3, ?4, ?4, ?3, 'h')",
            rusqlite::params![event_id, parent, author, created_at_ms],
        )
        .expect("insert event");
        conn.execute(
            "INSERT INTO squad_event_rsvps (event_id, member_npub, status, updated_at_ms, rumor_id)
             VALUES (?1, ?2, 'accepted', ?3, ?4)",
            rusqlite::params![
                event_id,
                author,
                created_at_ms,
                format!("rsvp-{}", event_id)
            ],
        )
        .expect("insert rsvp");
        conn.execute(
            "INSERT INTO squad_event_pending_ops (rumor_id, event_id, parent_id, mls_group_id, author_npub, op, payload_json, updated_at_ms)
             VALUES (?1, ?2, ?3, 'group-1', ?4, 'rsvp', '{}', ?5)",
            rusqlite::params![format!("op-{}", event_id), event_id, parent, author, created_at_ms],
        )
        .expect("insert pending op");
    }

    fn count(conn: &rusqlite::Connection, table: &str, event_id: &str) -> i64 {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {} WHERE event_id = ?1", table),
            [event_id],
            |r| r.get(0),
        )
        .expect("count")
    }

    fn event_ids(conn: &rusqlite::Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT event_id FROM squad_events ORDER BY event_id")
            .expect("prepare");
        stmt.query_map([], |r| r.get(0))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows")
    }

    #[test]
    fn absent_row_is_default() {
        let conn = migrated_conn();
        assert_eq!(
            load_policy(&conn, "squad-1"),
            Ok(SquadContentPolicy::default())
        );
    }

    #[test]
    fn stored_row_round_trips() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO squad_content_policy (parent_id, restrict_event_create, restrict_event_create_updated_at_ms, restrict_event_create_by_npub)
             VALUES ('squad-1', 1, 1700, 'npub1admin')",
            [],
        )
        .expect("insert");
        assert_eq!(
            load_policy(&conn, "squad-1"),
            Ok(SquadContentPolicy {
                restrict_event_create: true,
                restrict_event_create_updated_at_ms: 1700,
                restrict_event_create_by_npub: Some("npub1admin".to_string()),
                ..SquadContentPolicy::default()
            })
        );
        assert_eq!(
            load_policy(&conn, "squad-2"),
            Ok(SquadContentPolicy::default())
        );
    }

    #[test]
    fn wire_round_trips_and_rejects_other_schemas() {
        let w = wire(true, 10, false, 20);
        let json = serde_json::to_string(&w).expect("serialize");
        assert_eq!(try_parse_wire(&json, 1_000), Some(w));
        assert_eq!(
            try_parse_wire(
                &json.replace(POLICY_SCHEMA, "pacto.squad_content_policy.v2"),
                1_000
            ),
            None
        );
        assert_eq!(try_parse_wire("{}", 1_000), None);
        assert_eq!(
            try_parse_wire(
                &serde_json::to_string(&wire(true, -1, false, 0)).unwrap(),
                1_000
            ),
            None
        );
    }

    #[test]
    fn far_future_stamps_are_rejected() {
        let now = 1_000_000;
        let at_limit = wire(true, now + MAX_FUTURE_SKEW_MS, false, 0);
        assert!(try_parse_wire(&serde_json::to_string(&at_limit).unwrap(), now).is_some());
        for w in [
            wire(true, now + MAX_FUTURE_SKEW_MS + 1, false, 0),
            wire(false, 0, true, i64::MAX),
        ] {
            assert_eq!(
                try_parse_wire(&serde_json::to_string(&w).unwrap(), now),
                None
            );
        }
    }

    #[test]
    fn foreign_group_cannot_target_a_parent() {
        assert_eq!(
            require_parent_group("channel-group", "squad-1"),
            Err(ERR_WRONG_GROUP.to_string())
        );
        assert_eq!(
            require_parent_group("", ""),
            Err(ERR_WRONG_GROUP.to_string())
        );
        assert_eq!(require_parent_group(" squad-1 ", "squad-1"), Ok(()));
    }

    #[test]
    fn admin_publish_both_false_inserts_row() {
        let conn = migrated_conn();
        let outcome = apply_as_admin(&conn, &wire(false, 100, false, 100));
        assert!(outcome.changed);
        assert!(!outcome.event_create_turned_on);
        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM squad_content_policy WHERE parent_id = 'squad-1'",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(row_count, 1);
        let p = load_policy(&conn, "squad-1").expect("load");
        assert!(!p.restrict_event_create && !p.restrict_doc_add);
        assert_eq!(p.restrict_event_create_updated_at_ms, 100);
        assert_eq!(p.restrict_doc_add_by_npub.as_deref(), Some(ADMIN));
    }

    #[test]
    fn newer_doc_timestamp_changes_docs_only() {
        let conn = migrated_conn();
        apply_as_admin(&conn, &wire(true, 100, false, 100));
        // Event flag carries an older stamp and a different value; it must not move.
        let outcome = apply_policy(
            &conn,
            &wire(false, 50, true, 200),
            "npub1admin2",
            true,
            &admins(),
        )
        .expect("apply");
        assert!(outcome.changed);
        assert!(!outcome.event_create_turned_on);
        let p = load_policy(&conn, "squad-1").expect("load");
        assert!(p.restrict_event_create);
        assert_eq!(p.restrict_event_create_updated_at_ms, 100);
        assert_eq!(p.restrict_event_create_by_npub.as_deref(), Some(ADMIN));
        assert!(p.restrict_doc_add);
        assert_eq!(p.restrict_doc_add_updated_at_ms, 200);
        assert_eq!(p.restrict_doc_add_by_npub.as_deref(), Some("npub1admin2"));
    }

    #[test]
    fn older_or_equal_timestamps_keep_stored() {
        let conn = migrated_conn();
        apply_as_admin(&conn, &wire(true, 100, true, 100));
        let before = load_policy(&conn, "squad-1").expect("load");
        let older = apply_as_admin(&conn, &wire(false, 99, false, 99));
        assert!(!older.changed);
        let equal = apply_as_admin(&conn, &wire(false, 100, false, 100));
        assert!(!equal.changed);
        assert_eq!(load_policy(&conn, "squad-1"), Ok(before));
    }

    #[test]
    fn non_admin_rumor_is_ignored() {
        let conn = migrated_conn();
        insert_event(&conn, "ev-member", "squad-1", MEMBER, 500);
        let outcome = apply_policy(&conn, &wire(true, 100, true, 100), MEMBER, false, &admins())
            .expect("apply");
        assert_eq!(outcome, PolicyApplyOutcome::default());
        assert_eq!(
            load_policy(&conn, "squad-1"),
            Ok(SquadContentPolicy::default())
        );
        assert_eq!(event_ids(&conn), vec!["ev-member".to_string()]);
    }

    #[test]
    fn non_admin_send_is_rejected() {
        let member = squad_records::SquadGroupRole {
            is_member: true,
            is_admin: false,
        };
        let admin = squad_records::SquadGroupRole {
            is_member: true,
            is_admin: true,
        };
        assert_eq!(require_admin(member), Err(ERR_NOT_ADMIN.to_string()));
        assert_eq!(
            require_admin(squad_records::SquadGroupRole::default()),
            Err(ERR_NOT_MEMBER.to_string())
        );
        assert_eq!(require_admin(admin), Ok(()));
    }

    #[test]
    fn failed_admin_lookup_stores_flag_without_deleting() {
        let conn = migrated_conn();
        insert_event(&conn, "ev-member", "squad-1", MEMBER, 2_000);
        let outcome =
            apply_policy(&conn, &wire(true, 1_000, false, 0), ADMIN, true, &[]).expect("apply");
        assert!(outcome.event_create_turned_on);
        assert_eq!(outcome.deleted_events, 0);
        assert!(
            load_policy(&conn, "squad-1")
                .expect("load")
                .restrict_event_create
        );
        assert_eq!(event_ids(&conn), vec!["ev-member".to_string()]);
    }

    #[test]
    fn view_roles_use_one_admin_list_and_participants() {
        let parts = vec![ADMIN.to_string(), MEMBER.to_string()];
        let admins = vec![ADMIN.to_string()];
        assert_eq!(view_roles(&parts, &admins, ADMIN), (true, true));
        assert_eq!(view_roles(&parts, &admins, MEMBER), (false, true));
        // Admin who left the group: nobody can lift a restriction.
        assert_eq!(
            view_roles(&[MEMBER.to_string()], &admins, MEMBER),
            (false, false)
        );
        assert_eq!(view_roles(&[], &admins, ADMIN), (false, false));
    }

    #[test]
    fn restrict_on_deletes_every_non_admin_row_of_the_parent() {
        let conn = migrated_conn();
        // A stamp long before the flag (honest or backdated) does not protect a member row.
        insert_event(&conn, "ev-member-before", "squad-1", MEMBER, 0);
        insert_event(&conn, "ev-member-after", "squad-1", MEMBER, 2_000);
        // Same shape a local send produces: authored by this (non-admin) client.
        insert_event(&conn, "ev-local", "squad-1", "npub1me", 1_500);
        insert_event(&conn, "ev-admin-before", "squad-1", ADMIN, 0);
        insert_event(&conn, "ev-other-squad", "squad-2", MEMBER, 2_000);

        let outcome = apply_as_admin(&conn, &wire(true, 1_000, false, 0));
        assert!(outcome.event_create_turned_on);
        assert_eq!(outcome.deleted_events, 3);
        assert_eq!(
            event_ids(&conn),
            vec!["ev-admin-before".to_string(), "ev-other-squad".to_string()]
        );
        for gone in ["ev-member-before", "ev-member-after", "ev-local"] {
            assert_eq!(count(&conn, "squad_event_rsvps", gone), 0);
            assert_eq!(count(&conn, "squad_event_pending_ops", gone), 0);
        }
        assert_eq!(count(&conn, "squad_event_rsvps", "ev-admin-before"), 1);
        assert_eq!(count(&conn, "squad_event_pending_ops", "ev-other-squad"), 1);
    }

    #[test]
    fn turning_off_restores_nothing() {
        let conn = migrated_conn();
        insert_event(&conn, "ev-member", "squad-1", MEMBER, 2_000);
        apply_as_admin(&conn, &wire(true, 1_000, false, 0));
        assert!(event_ids(&conn).is_empty());
        let outcome = apply_as_admin(&conn, &wire(false, 3_000, false, 0));
        assert!(outcome.changed);
        assert_eq!(outcome.deleted_events, 0);
        assert!(
            !load_policy(&conn, "squad-1")
                .expect("load")
                .restrict_event_create
        );
        assert!(event_ids(&conn).is_empty());
    }

    #[test]
    fn doc_restriction_only_stores() {
        let conn = migrated_conn();
        insert_event(&conn, "ev-member", "squad-1", MEMBER, 2_000);
        let outcome = apply_as_admin(&conn, &wire(false, 0, true, 1_000));
        assert!(outcome.changed);
        assert_eq!(outcome.deleted_events, 0);
        assert!(
            load_policy(&conn, "squad-1")
                .expect("load")
                .restrict_doc_add
        );
        assert_eq!(event_ids(&conn), vec!["ev-member".to_string()]);
    }

    #[test]
    fn set_keeps_other_flag_value_and_timestamp() {
        let conn = migrated_conn();
        apply_as_admin(&conn, &wire(true, 100, false, 40));
        let stored = load_policy(&conn, "squad-1").expect("load");

        let w = build_set_wire(&stored, "squad-1", PolicyFlag::RestrictDocAdd, true, 5_000);
        assert!(w.restrict_event_create);
        assert_eq!(w.restrict_event_create_updated_at_ms, 100);
        assert!(w.restrict_doc_add);
        assert_eq!(w.restrict_doc_add_updated_at_ms, 5_000);

        apply_as_admin(&conn, &w);
        let p = load_policy(&conn, "squad-1").expect("load");
        assert!(p.restrict_event_create);
        assert_eq!(p.restrict_event_create_updated_at_ms, 100);
        assert!(p.restrict_doc_add);
        assert_eq!(p.restrict_doc_add_updated_at_ms, 5_000);
    }

    #[test]
    fn set_stamp_stays_newer_than_stored() {
        let stored = SquadContentPolicy {
            restrict_event_create: true,
            restrict_event_create_updated_at_ms: 9_000,
            ..SquadContentPolicy::default()
        };
        let w = build_set_wire(
            &stored,
            "squad-1",
            PolicyFlag::RestrictEventCreate,
            false,
            5_000,
        );
        assert_eq!(w.restrict_event_create_updated_at_ms, 9_001);
        assert!(!w.restrict_event_create);
        let maxed = SquadContentPolicy {
            restrict_doc_add_updated_at_ms: i64::MAX,
            ..SquadContentPolicy::default()
        };
        let w = build_set_wire(&maxed, "squad-1", PolicyFlag::RestrictDocAdd, true, 5_000);
        assert_eq!(w.restrict_doc_add_updated_at_ms, i64::MAX);
    }

    #[test]
    fn unknown_flag_is_rejected() {
        assert!(PolicyFlag::parse("restrict_everything").is_err());
        assert_eq!(
            PolicyFlag::parse("restrict_doc_add"),
            Ok(PolicyFlag::RestrictDocAdd)
        );
    }

    fn policy_rumor(content: &str, tag_parent: &str) -> RumorEvent {
        let keys = Keys::generate();
        let built = EventBuilder::new(Kind::ApplicationSpecificData, content)
            .tag(nostr_tags::d_tag([SQUAD_CONTENT_POLICY_D_TAG]))
            .tag(nostr_tags::custom_tag("parent", [tag_parent]))
            .build(keys.public_key());
        RumorEvent {
            id: built.id.expect("rumor id"),
            kind: built.kind,
            content: built.content.clone(),
            tags: built.tags.clone(),
            created_at: built.created_at,
            pubkey: built.pubkey,
        }
    }

    fn context(conversation_id: &str, conversation_type: ConversationType) -> RumorContext {
        RumorContext {
            sender: Keys::generate().public_key(),
            is_mine: false,
            conversation_id: conversation_id.to_string(),
            conversation_type,
        }
    }

    #[tokio::test]
    async fn policy_rumor_never_becomes_a_timeline_message() {
        // Each case stops at the policy arm before any role lookup (no app handle in tests).
        let valid = serde_json::to_string(&wire(true, 1, false, 0)).expect("serialize");
        let future = serde_json::to_string(&wire(true, i64::MAX, false, 0)).expect("serialize");
        let cases = [
            ("squad-1", "not json", "squad-1"),
            // Admin of some other group (e.g. a custom channel) naming this squad.
            ("channel-group", valid.as_str(), "squad-1"),
            ("squad-1", valid.as_str(), "squad-2"),
            ("squad-1", future.as_str(), "squad-1"),
        ];
        for (group, content, tag_parent) in cases {
            let result = crate::rumor::process_rumor(
                policy_rumor(content, tag_parent),
                context(group, ConversationType::MlsGroup),
            )
            .await
            .expect("process");
            assert!(matches!(result, RumorProcessingResult::SquadRecordSilent));
        }
        let dm = crate::rumor::process_rumor(
            policy_rumor("not json", "squad-1"),
            context("squad-1", ConversationType::DirectMessage),
        )
        .await
        .expect("process");
        assert!(matches!(dm, RumorProcessingResult::Ignored));
    }
}
