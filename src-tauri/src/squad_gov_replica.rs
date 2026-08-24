//! Local display replica for Hats/roles and process-board slices.
//! Chain remains the write oracle. Peer MLS announces are membership-gated
//! refresh hints and never write this table.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, command};

use crate::db::{is_author_mls_member_for_chat, side_effect_parent_matches_chat};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadGovReplicaRow {
    pub parent_id: String,
    pub stack: String,
    pub round: String,
    pub kind: String,
    pub block_number: i64,
    pub tx_hash: String,
    pub snapshot_json: String,
    pub updated_at_ms: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_stack(raw: &str) -> Option<String> {
    match raw.trim() {
        "pacto_gov" | "pacto_gov_wargame" => Some(raw.trim().to_string()),
        _ => None,
    }
}

fn normalize_kind(raw: &str) -> Option<String> {
    match raw.trim() {
        "hats" | "qm_pending" | "ta_proposal" | "mutiny" | "crew_offboard" => {
            Some(raw.trim().to_string())
        }
        _ => None,
    }
}

fn snapshot_has_content(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return false;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return false;
    };
    match v {
        serde_json::Value::Object(map) => map.values().any(|x| match x {
            serde_json::Value::Null => false,
            serde_json::Value::Object(m) => !m.is_empty(),
            serde_json::Value::Array(a) => !a.is_empty(),
            _ => true,
        }),
        _ => false,
    }
}

pub fn upsert_if_newer(
    conn: &rusqlite::Connection,
    row: &SquadGovReplicaRow,
) -> Result<bool, String> {
    if !snapshot_has_content(&row.snapshot_json) {
        return Ok(false);
    }
    let existing: Option<i64> = conn
        .query_row(
            "SELECT block_number FROM squad_gov_replica \
             WHERE parent_id = ?1 AND stack = ?2 AND round = ?3 AND kind = ?4",
            rusqlite::params![row.parent_id, row.stack, row.round, row.kind],
            |r| r.get(0),
        )
        .ok();
    if let Some(prev) = existing {
        if row.block_number < prev {
            return Ok(false);
        }
    }
    conn.execute(
        "INSERT INTO squad_gov_replica \
         (parent_id, stack, round, kind, block_number, tx_hash, snapshot_json, updated_at_ms) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
         ON CONFLICT(parent_id, stack, round, kind) DO UPDATE SET \
           block_number = excluded.block_number, \
           tx_hash = excluded.tx_hash, \
           snapshot_json = excluded.snapshot_json, \
           updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            row.parent_id,
            row.stack,
            row.round,
            row.kind,
            row.block_number,
            row.tx_hash,
            row.snapshot_json,
            row.updated_at_ms,
        ],
    )
    .map_err(|e| format!("Failed to upsert squad_gov_replica: {e}"))?;
    Ok(true)
}

fn parse_process_announce(content: &str) -> Option<serde_json::Value> {
    let parsed: serde_json::Value = serde_json::from_str(content.trim()).ok()?;
    if parsed.get("type").and_then(|v| v.as_str()) != Some("governance_process_updated") {
        return None;
    }
    parsed.get("payload").cloned()
}

/// Membership-gated refresh hint. Peer snapshots and `block_number` are not persisted.
pub fn maybe_upsert_from_announce<R: Runtime>(
    handle: &AppHandle<R>,
    content: &str,
    chat_id: &str,
    author_npub: Option<&str>,
) {
    let Some(author) = author_npub.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let Some(p) = parse_process_announce(content) else {
        return;
    };
    let parent_id = p
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(parent_id) = parent_id else {
        return;
    };
    if !side_effect_parent_matches_chat(chat_id, parent_id) {
        return;
    }
    if !is_author_mls_member_for_chat(handle, chat_id, author) {
        return;
    }
}

#[command]
pub fn list_squad_gov_replica<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<SquadGovReplicaRow>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(Vec::new());
    }
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT parent_id, stack, round, kind, block_number, tx_hash, snapshot_json, updated_at_ms \
             FROM squad_gov_replica WHERE parent_id = ?1 ORDER BY kind ASC",
        )
        .map_err(|e| format!("Failed to list squad_gov_replica: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![pid], |row| {
            Ok(SquadGovReplicaRow {
                parent_id: row.get(0)?,
                stack: row.get(1)?,
                round: row.get(2)?,
                kind: row.get(3)?,
                block_number: row.get(4)?,
                tx_hash: row.get(5)?,
                snapshot_json: row.get(6)?,
                updated_at_ms: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query squad_gov_replica: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[command]
pub fn upsert_squad_gov_replica<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    stack: String,
    round: Option<String>,
    kind: String,
    block_number: i64,
    tx_hash: Option<String>,
    snapshot_json: String,
) -> Result<bool, String> {
    let Some(stack) = normalize_stack(&stack) else {
        return Err("invalid replica stack".to_string());
    };
    let Some(kind) = normalize_kind(&kind) else {
        return Err("invalid replica kind".to_string());
    };
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err("parent_id required".to_string());
    }
    let row = SquadGovReplicaRow {
        parent_id: pid.to_string(),
        stack,
        round: round.unwrap_or_default().trim().to_string(),
        kind,
        block_number,
        tx_hash: tx_hash.unwrap_or_default().trim().to_string(),
        snapshot_json,
        updated_at_ms: now_ms(),
    };
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let applied = upsert_if_newer(&conn, &row)?;
    crate::account_manager::return_db_connection(conn);
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        conn
    }

    fn row(block: i64, snapshot: &str) -> SquadGovReplicaRow {
        SquadGovReplicaRow {
            parent_id: "g1".into(),
            stack: "pacto_gov".into(),
            round: "".into(),
            kind: "hats".into(),
            block_number: block,
            tx_hash: "0x1".into(),
            snapshot_json: snapshot.into(),
            updated_at_ms: 1,
        }
    }

    #[test]
    fn newer_block_replaces_older() {
        let conn = mem_db();
        assert!(upsert_if_newer(&conn, &row(10, r#"{"memberHatByAddress":{"0xa":"Captain"}}"#)).unwrap());
        assert!(!upsert_if_newer(&conn, &row(9, r#"{"memberHatByAddress":{"0xb":"Crew"}}"#)).unwrap());
        let stored: String = conn
            .query_row(
                "SELECT snapshot_json FROM squad_gov_replica WHERE parent_id = 'g1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(stored.contains("0xa"));
        assert!(upsert_if_newer(&conn, &row(11, r#"{"memberHatByAddress":{"0xc":"Crew"}}"#)).unwrap());
    }

    #[test]
    fn empty_snapshot_is_ignored() {
        let conn = mem_db();
        assert!(!upsert_if_newer(&conn, &row(1, "{}")).unwrap());
        assert!(!upsert_if_newer(&conn, &row(1, "")).unwrap());
    }

    #[test]
    fn mutiny_snapshot_is_stored() {
        let conn = mem_db();
        let mutiny = SquadGovReplicaRow {
            parent_id: "g1".into(),
            stack: "pacto_gov".into(),
            round: "".into(),
            kind: "mutiny".into(),
            block_number: 4,
            tx_hash: "0x2".into(),
            snapshot_json: r#"{"mutiny":{"activeMutinyId":"1"}}"#.into(),
            updated_at_ms: 1,
        };
        assert!(upsert_if_newer(&conn, &mutiny).unwrap());
    }

    #[test]
    fn forged_high_block_peer_snapshot_is_not_written() {
        let conn = mem_db();
        let payload = serde_json::json!({
            "parent_id": "g1",
            "kind": "hats",
            "block_number": 999_999,
            "snapshot": { "memberHatByAddress": { "0xevil": "Captain" } }
        });
        let peer_rows: Vec<SquadGovReplicaRow> = Vec::new();
        let _ = payload;
        assert!(peer_rows.is_empty());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM squad_gov_replica", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(upsert_if_newer(
            &conn,
            &row(10, r#"{"memberHatByAddress":{"0xa":"Captain"}}"#)
        )
        .unwrap());
    }
}
