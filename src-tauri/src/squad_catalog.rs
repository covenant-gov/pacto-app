//! Squad / squad-pair catalog in SQLite. See `docs/communities/SQUAD_CATALOG.md`.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Runtime};

const KIND_SQUAD: &str = "squad";
const KIND_SQUAD_PAIR: &str = "squad-pair";
const VIS_PRIVATE: &str = "private";
const VIS_PUBLIC: &str = "public";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SquadChannelRow {
    pub name: String,
    pub group_id: String,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairedSquadRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SquadRow {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    pub channels: Vec<SquadChannelRow>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paired_squads: Option<Vec<PairedSquadRef>>,
    pub visibility: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commons_tags: Option<Vec<String>>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadUpsert {
    pub id: String,
    pub name: String,
    pub icon_url: Option<String>,
    pub channels: Vec<SquadChannelRow>,
    #[serde(default)]
    pub kind: Option<String>,
    pub paired_squads: Option<Vec<PairedSquadRef>>,
    #[serde(default)]
    pub visibility: Option<String>,
    pub commons_tags: Option<Vec<String>>,
    #[serde(default)]
    pub created_at_ms: Option<i64>,
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_kind(raw: Option<&str>) -> Result<String, String> {
    match raw.unwrap_or(KIND_SQUAD).trim().to_ascii_lowercase().as_str() {
        KIND_SQUAD => Ok(KIND_SQUAD.to_string()),
        KIND_SQUAD_PAIR => Ok(KIND_SQUAD_PAIR.to_string()),
        other if other.is_empty() => Ok(KIND_SQUAD.to_string()),
        other => Err(format!("Invalid squad kind: {other}")),
    }
}

fn normalize_visibility(raw: Option<&str>) -> Result<String, String> {
    match raw.unwrap_or(VIS_PRIVATE).trim().to_ascii_lowercase().as_str() {
        VIS_PRIVATE => Ok(VIS_PRIVATE.to_string()),
        VIS_PUBLIC => Ok(VIS_PUBLIC.to_string()),
        other if other.is_empty() => Ok(VIS_PRIVATE.to_string()),
        other => Err(format!("Invalid squad visibility: {other}")),
    }
}

fn normalize_commons_tag(raw: &str) -> Option<String> {
    let t = raw.trim().trim_start_matches('#').to_ascii_lowercase();
    if t.is_empty() || t.len() > 32 {
        return None;
    }
    if !t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return None;
    }
    if t == "new" {
        return None;
    }
    Some(t)
}

fn normalize_commons_tags(raw: Option<&[String]>, visibility: &str) -> Result<Option<Vec<String>>, String> {
    if visibility != VIS_PUBLIC {
        return Ok(None);
    }
    let Some(tags) = raw else {
        return Err("public squads require commonsTags".to_string());
    };
    if tags.is_empty() || tags.len() > 3 {
        return Err("commonsTags must contain 1 to 3 tags".to_string());
    }
    let mut out: Vec<String> = Vec::new();
    for item in tags {
        let t = normalize_commons_tag(item).ok_or_else(|| format!("Invalid commons tag: {item}"))?;
        if !out.contains(&t) {
            out.push(t);
        }
    }
    if out.is_empty() {
        return Err("commonsTags must contain at least one valid tag".to_string());
    }
    Ok(Some(out))
}

fn validate_channels(channels: &[SquadChannelRow]) -> Result<(), String> {
    if channels.is_empty() {
        return Err("At least one channel is required".to_string());
    }
    for ch in channels {
        if ch.name.trim().is_empty() {
            return Err("Channel name must be non-empty".to_string());
        }
        if ch.group_id.trim().is_empty() {
            return Err("Channel groupId must be non-empty".to_string());
        }
    }
    Ok(())
}

fn validate_paired_squads(kind: &str, paired: Option<&[PairedSquadRef]>) -> Result<Option<Vec<PairedSquadRef>>, String> {
    match kind {
        KIND_SQUAD_PAIR => {
            let Some(ps) = paired else {
                return Err("squad-pair requires pairedSquads".to_string());
            };
            if ps.len() != 2 {
                return Err("pairedSquads must contain exactly two entries".to_string());
            }
            for p in ps {
                if p.id.trim().is_empty() || p.name.trim().is_empty() {
                    return Err("pairedSquads entries require id and name".to_string());
                }
            }
            Ok(Some(ps.to_vec()))
        }
        _ => Ok(None),
    }
}

fn prepare_row(input: SquadUpsert) -> Result<SquadRow, String> {
    let id = input.id.trim();
    if id.is_empty() {
        return Err("Squad id must be non-empty".to_string());
    }
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Squad name must be non-empty".to_string());
    }
    validate_channels(&input.channels)?;
    let kind = normalize_kind(input.kind.as_deref())?;
    let visibility = normalize_visibility(input.visibility.as_deref())?;
    let commons_tags = normalize_commons_tags(input.commons_tags.as_deref(), visibility.as_str())?;
    let paired_squads = validate_paired_squads(kind.as_str(), input.paired_squads.as_deref())?;
    let ts = now_ms();
    let created_at_ms = input.created_at_ms.unwrap_or(ts);
    let updated_at_ms = input.updated_at_ms.unwrap_or(ts);
    let icon_url = input
        .icon_url
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    Ok(SquadRow {
        id: id.to_string(),
        name: name.to_string(),
        icon_url,
        channels: input.channels,
        kind,
        paired_squads,
        visibility,
        commons_tags,
        created_at_ms,
        updated_at_ms,
    })
}

fn row_from_query(
    id: String,
    name: String,
    icon_url: Option<String>,
    kind: String,
    visibility: String,
    commons_tags_json: Option<String>,
    paired_squads_json: Option<String>,
    channels_json: String,
    created_at_ms: i64,
    updated_at_ms: i64,
) -> Result<SquadRow, String> {
    let channels: Vec<SquadChannelRow> =
        serde_json::from_str(channels_json.as_str()).map_err(|e| format!("Invalid channels JSON: {e}"))?;
    let commons_tags = match commons_tags_json {
        Some(raw) if !raw.trim().is_empty() => Some(
            serde_json::from_str(raw.as_str()).map_err(|e| format!("Invalid commons_tags JSON: {e}"))?,
        ),
        _ => None,
    };
    let paired_squads = match paired_squads_json {
        Some(raw) if !raw.trim().is_empty() => Some(
            serde_json::from_str(raw.as_str()).map_err(|e| format!("Invalid paired_squads JSON: {e}"))?,
        ),
        _ => None,
    };
    Ok(SquadRow {
        id,
        name,
        icon_url,
        channels,
        kind,
        paired_squads,
        visibility,
        commons_tags,
        created_at_ms,
        updated_at_ms,
    })
}

pub(crate) fn upsert_squad_inner(conn: &rusqlite::Connection, row: &SquadRow) -> Result<(), String> {
    let channels_json =
        serde_json::to_string(&row.channels).map_err(|e| format!("channels serialize: {e}"))?;
    let commons_tags_json = match &row.commons_tags {
        Some(tags) => Some(
            serde_json::to_string(tags).map_err(|e| format!("commons_tags serialize: {e}"))?,
        ),
        None => None,
    };
    let paired_squads_json = match &row.paired_squads {
        Some(ps) => Some(
            serde_json::to_string(ps).map_err(|e| format!("paired_squads serialize: {e}"))?,
        ),
        None => None,
    };

    conn.execute(
        "INSERT INTO squads (id, name, icon_url, kind, visibility, commons_tags, paired_squads, channels, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           icon_url = excluded.icon_url,
           kind = excluded.kind,
           visibility = excluded.visibility,
           commons_tags = excluded.commons_tags,
           paired_squads = excluded.paired_squads,
           channels = excluded.channels,
           updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            row.id.as_str(),
            row.name.as_str(),
            row.icon_url.as_deref(),
            row.kind.as_str(),
            row.visibility.as_str(),
            commons_tags_json.as_deref(),
            paired_squads_json.as_deref(),
            channels_json.as_str(),
            row.created_at_ms,
            row.updated_at_ms,
        ],
    )
    .map_err(|e| format!("Failed to upsert squad: {e}"))?;
    Ok(())
}

pub(crate) fn list_squads_inner(conn: &rusqlite::Connection) -> Result<Vec<SquadRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, icon_url, kind, visibility, commons_tags, paired_squads, channels, created_at_ms, updated_at_ms
             FROM squads ORDER BY updated_at_ms DESC",
        )
        .map_err(|e| format!("Failed to prepare list squads: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
            ))
        })
        .map_err(|e| format!("Failed to list squads: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, icon_url, kind, visibility, commons_tags, paired_squads, channels, created, updated) =
            row.map_err(|e| format!("Failed to read squad row: {e}"))?;
        out.push(row_from_query(
            id,
            name,
            icon_url,
            kind,
            visibility,
            commons_tags,
            paired_squads,
            channels,
            created,
            updated,
        )?);
    }
    Ok(out)
}

pub(crate) fn get_squad_inner(conn: &rusqlite::Connection, parent_id: &str) -> Result<Option<SquadRow>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(None);
    }
    let row = conn
        .query_row(
            "SELECT id, name, icon_url, kind, visibility, commons_tags, paired_squads, channels, created_at_ms, updated_at_ms
             FROM squads WHERE id = ?1",
            rusqlite::params![pid],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, i64>(9)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read squad: {e}"))?;
    Ok(match row {
        Some((id, name, icon_url, kind, visibility, commons_tags, paired_squads, channels, created, updated)) => {
            Some(row_from_query(
                id,
                name,
                icon_url,
                kind,
                visibility,
                commons_tags,
                paired_squads,
                channels,
                created,
                updated,
            )?)
        }
        None => None,
    })
}

pub(crate) fn delete_squad_inner(conn: &rusqlite::Connection, parent_id: &str) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err("parentId must be non-empty".to_string());
    }
    conn.execute(
        "DELETE FROM squad_member_evm_account WHERE parent_id = ?1",
        rusqlite::params![pid],
    )
    .map_err(|e| format!("Failed to delete squad_member_evm_account: {e}"))?;
    conn.execute(
        "DELETE FROM squad_member_evm WHERE parent_id = ?1",
        rusqlite::params![pid],
    )
    .map_err(|e| format!("Failed to delete squad_member_evm: {e}"))?;
    conn.execute("DELETE FROM squads WHERE id = ?1", rusqlite::params![pid])
        .map_err(|e| format!("Failed to delete squad: {e}"))?;
    Ok(())
}

#[command]
pub fn list_squads<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<SquadRow>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let out = list_squads_inner(&conn)?;
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[command]
pub fn get_squad<R: Runtime>(handle: AppHandle<R>, parent_id: String) -> Result<Option<SquadRow>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let out = get_squad_inner(&conn, parent_id.as_str())?;
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[command]
pub fn upsert_squad<R: Runtime>(handle: AppHandle<R>, squad: SquadUpsert) -> Result<SquadRow, String> {
    let mut row = prepare_row(squad)?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    if let Some(existing) = get_squad_inner(&conn, row.id.as_str())? {
        row.created_at_ms = existing.created_at_ms;
    }
    upsert_squad_inner(&conn, &row)?;
    let saved = get_squad_inner(&conn, row.id.as_str())?
        .ok_or_else(|| "Squad missing after upsert".to_string())?;
    crate::account_manager::return_db_connection(conn);
    Ok(saved)
}

#[command]
pub fn delete_squad<R: Runtime>(handle: AppHandle<R>, parent_id: String) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    delete_squad_inner(&conn, parent_id.as_str())?;
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_channels() -> Vec<SquadChannelRow> {
        vec![
            SquadChannelRow {
                name: "announcements".to_string(),
                group_id: "grp-announce".to_string(),
                order: 0,
            },
            SquadChannelRow {
                name: "personal-alerts".to_string(),
                group_id: "grp-announce".to_string(),
                order: 1,
            },
        ]
    }

    fn sample_upsert(id: &str, name: &str) -> SquadUpsert {
        SquadUpsert {
            id: id.to_string(),
            name: name.to_string(),
            icon_url: None,
            channels: sample_channels(),
            kind: Some(KIND_SQUAD.to_string()),
            paired_squads: None,
            visibility: Some(VIS_PRIVATE.to_string()),
            commons_tags: None,
            created_at_ms: Some(1000),
            updated_at_ms: Some(1000),
        }
    }

    fn test_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE squads (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon_url TEXT,
                kind TEXT NOT NULL DEFAULT 'squad',
                visibility TEXT NOT NULL DEFAULT 'private',
                commons_tags TEXT,
                paired_squads TEXT,
                channels TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE TABLE squad_member_evm (
                parent_id TEXT NOT NULL,
                member_npub TEXT NOT NULL,
                evm_address TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (parent_id, member_npub)
            );
            CREATE TABLE squad_member_evm_account (
                parent_id TEXT NOT NULL,
                member_npub TEXT NOT NULL,
                evm_account_id TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (parent_id, member_npub)
            );
            CREATE TABLE evm_accounts (
                id TEXT PRIMARY KEY NOT NULL,
                scheme TEXT NOT NULL,
                hd_index INTEGER,
                address TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                imported_enc TEXT,
                purpose TEXT NOT NULL DEFAULT 'squad'
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn upsert_squad_insert_round_trips() {
        let conn = test_conn();
        let row = prepare_row(sample_upsert("grp-announce", "Alpha")).expect("prepare");
        upsert_squad_inner(&conn, &row).expect("upsert");
        let listed = list_squads_inner(&conn).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Alpha");
        assert_eq!(listed[0].channels.len(), 2);
    }

    #[test]
    fn upsert_squad_update_preserves_created_at() {
        let conn = test_conn();
        let row = prepare_row(sample_upsert("grp-announce", "Alpha")).expect("prepare");
        upsert_squad_inner(&conn, &row).expect("upsert");
        let mut updated = prepare_row(sample_upsert("grp-announce", "Beta")).expect("prepare");
        updated.created_at_ms = 9999;
        updated.updated_at_ms = 2000;
        upsert_squad_inner(&conn, &updated).expect("upsert");
        let got = get_squad_inner(&conn, "grp-announce").expect("get").expect("row");
        assert_eq!(got.name, "Beta");
        assert_eq!(got.created_at_ms, 1000);
        assert_eq!(got.updated_at_ms, 2000);
    }

    #[test]
    fn list_squads_orders_by_updated_at_desc() {
        let conn = test_conn();
        let mut older = prepare_row(sample_upsert("s-old", "Old")).expect("prepare");
        older.updated_at_ms = 1000;
        upsert_squad_inner(&conn, &older).expect("upsert old");
        let mut newer = prepare_row(sample_upsert("s-new", "New")).expect("prepare");
        newer.updated_at_ms = 5000;
        upsert_squad_inner(&conn, &newer).expect("upsert new");
        let listed = list_squads_inner(&conn).expect("list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "s-new");
        assert_eq!(listed[1].id, "s-old");
    }

    #[test]
    fn delete_squad_cascades_bindings_not_evm_accounts() {
        let conn = test_conn();
        let row = prepare_row(sample_upsert("grp-announce", "Alpha")).expect("prepare");
        upsert_squad_inner(&conn, &row).expect("upsert");
        conn.execute(
            "INSERT INTO evm_accounts (id, scheme, address, label, purpose) VALUES ('acc-1', 'bip44_v1', '0xabc', '', 'squad')",
            [],
        )
        .expect("evm account");
        conn.execute(
            "INSERT INTO squad_member_evm_account (parent_id, member_npub, evm_account_id, updated_at_ms) VALUES ('grp-announce', 'npub1me', 'acc-1', 1)",
            [],
        )
        .expect("binding");
        conn.execute(
            "INSERT INTO squad_member_evm (parent_id, member_npub, evm_address, updated_at_ms) VALUES ('grp-announce', 'npub1me', '0xabc', 1)",
            [],
        )
        .expect("roster");
        delete_squad_inner(&conn, "grp-announce").expect("delete");
        assert!(get_squad_inner(&conn, "grp-announce").expect("get").is_none());
        let binding_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM squad_member_evm_account", [], |r| r.get(0))
            .expect("count bindings");
        assert_eq!(binding_count, 0);
        let evm_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM evm_accounts", [], |r| r.get(0))
            .expect("count evm");
        assert_eq!(evm_count, 1);
    }

    #[test]
    fn delete_squad_idempotent() {
        let conn = test_conn();
        delete_squad_inner(&conn, "missing").expect("first delete");
        delete_squad_inner(&conn, "missing").expect("second delete");
    }

    #[test]
    fn invalid_channels_rejected() {
        let mut input = sample_upsert("grp-announce", "Alpha");
        input.channels = vec![];
        assert!(prepare_row(input).is_err());
    }

    #[test]
    fn public_squad_requires_commons_tags() {
        let mut input = sample_upsert("grp-announce", "Alpha");
        input.visibility = Some(VIS_PUBLIC.to_string());
        input.commons_tags = None;
        assert!(prepare_row(input).is_err());
    }
}
