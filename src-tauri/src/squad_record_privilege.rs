//! Receive-side create/add gate for squad events and docs. A rumor is applied on `Allowed`, dropped on
//! `Denied`, and parked in SQLite on `Undecided` (RPC failure or no roster binding yet) until a re-check decides.
//! See `docs/governance/ACCESS_CONTROL.md`.

use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Runtime};

use crate::evm::squad_privilege_enforce::{
    member_has_squad_privilege, MemberPrivilege, SquadPrivilegeAction,
};
use crate::squad_records::with_conn;

const MAX_PARKED_PER_AUTHOR: i64 = 200;
const PARKED_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const PARENT_DRAIN_MIN_INTERVAL_MS: i64 = 30_000;
const ALL_DRAIN_MIN_INTERVAL_MS: i64 = 120_000;
const ALL_SCOPE: &str = "*";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Event,
    Doc,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Event => "event",
            Self::Doc => "doc",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "event" => Some(Self::Event),
            "doc" => Some(Self::Doc),
            _ => None,
        }
    }

    fn action(self) -> SquadPrivilegeAction {
        match self {
            Self::Event => SquadPrivilegeAction::CreateEvent,
            Self::Doc => SquadPrivilegeAction::AddDoc,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Route {
    Apply,
    Drop,
    Park,
}

fn route(p: MemberPrivilege) -> Route {
    match p {
        MemberPrivilege::Allowed => Route::Apply,
        MemberPrivilege::Denied => Route::Drop,
        MemberPrivilege::Undecided => Route::Park,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Parked {
    pub rumor_id: String,
    pub kind: Kind,
    pub parent_id: String,
    pub mls_group_id: String,
    pub author_npub: String,
    pub payload_json: String,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn purge_expired(conn: &Connection, now_ms: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM squad_record_privilege_pending WHERE received_ms < ?1",
        params![now_ms.saturating_sub(PARKED_TTL_MS)],
    )
    .map_err(|e| format!("Failed to purge parked squad records: {}", e))?;
    Ok(())
}

fn park(conn: &Connection, p: &Parked, now_ms: i64) -> Result<(), String> {
    purge_expired(conn, now_ms)?;
    conn.execute(
        "INSERT OR IGNORE INTO squad_record_privilege_pending
            (rumor_id, kind, parent_id, mls_group_id, author_npub, payload_json, received_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            p.rumor_id,
            p.kind.as_str(),
            p.parent_id,
            p.mls_group_id,
            p.author_npub,
            p.payload_json,
            now_ms,
        ],
    )
    .map_err(|e| format!("Failed to park squad record: {}", e))?;
    conn.execute(
        "DELETE FROM squad_record_privilege_pending
         WHERE parent_id = ?1 AND author_npub = ?2 AND rumor_id NOT IN (
            SELECT rumor_id FROM squad_record_privilege_pending
            WHERE parent_id = ?1 AND author_npub = ?2
            ORDER BY received_ms DESC, rumor_id DESC LIMIT ?3)",
        params![p.parent_id, p.author_npub, MAX_PARKED_PER_AUTHOR],
    )
    .map_err(|e| format!("Failed to trim parked squad records: {}", e))?;
    Ok(())
}

/// Oldest first; filters are optional.
fn load(
    conn: &Connection,
    parent_id: Option<&str>,
    author_npub: Option<&str>,
) -> Result<Vec<Parked>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT rumor_id, kind, parent_id, mls_group_id, author_npub, payload_json
             FROM squad_record_privilege_pending
             WHERE (?1 IS NULL OR parent_id = ?1) AND (?2 IS NULL OR author_npub = ?2)
             ORDER BY received_ms ASC, rumor_id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent_id, author_npub], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(
            |(rumor_id, kind, parent_id, mls_group_id, author_npub, payload_json)| {
                Some(Parked {
                    rumor_id,
                    kind: Kind::parse(&kind)?,
                    parent_id,
                    mls_group_id,
                    author_npub,
                    payload_json,
                })
            },
        )
        .collect())
}

fn remove(conn: &Connection, rumor_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM squad_record_privilege_pending WHERE rumor_id = ?1",
        params![rumor_id],
    )
    .map_err(|e| format!("Failed to clear parked squad record: {}", e))?;
    Ok(())
}

static LAST_DRAIN_MS: Lazy<Mutex<HashMap<String, i64>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Marks `scope` as drained now and returns `true` when `min_interval_ms` has elapsed since the last mark.
fn drain_due(scope: &str, min_interval_ms: i64, now_ms: i64) -> bool {
    let Ok(mut last) = LAST_DRAIN_MS.lock() else {
        return true;
    };
    match last.get(scope) {
        Some(prev) if now_ms.saturating_sub(*prev) < min_interval_ms => false,
        _ => {
            last.insert(scope.to_string(), now_ms);
            true
        }
    }
}

async fn apply_parked<R: Runtime>(handle: &AppHandle<R>, p: &Parked) -> Result<(), String> {
    match p.kind {
        Kind::Event => {
            crate::squad_event::apply_deferred(
                handle,
                &p.mls_group_id,
                &p.author_npub,
                &p.rumor_id,
                &p.payload_json,
            )
            .await
        }
        Kind::Doc => {
            crate::squad_doc::apply_deferred(
                handle,
                &p.mls_group_id,
                &p.author_npub,
                &p.rumor_id,
                &p.payload_json,
            )
            .await
        }
    }
}

/// Re-checks parked rumors: applies allowed, deletes denied, keeps undecided.
pub(crate) async fn drain<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: Option<&str>,
    author_npub: Option<&str>,
) {
    let rows = with_conn(handle, |c| {
        purge_expired(c, now_ms())?;
        load(c, parent_id, author_npub)
    })
    .unwrap_or_default();
    for row in rows {
        let decision =
            member_has_squad_privilege(handle, &row.parent_id, &row.author_npub, row.kind.action())
                .await;
        match route(decision) {
            Route::Park => {}
            Route::Drop => {
                let _ = with_conn(handle, |c| remove(c, &row.rumor_id));
            }
            Route::Apply => match apply_parked(handle, &row).await {
                Ok(()) => {
                    let _ = with_conn(handle, |c| remove(c, &row.rumor_id));
                }
                Err(e) => eprintln!("[squad_record_privilege] apply parked failed: {}", e),
            },
        }
    }
}

/// Retry every parked rumor in the background, at most once per interval. Called from the session scan loop.
pub(crate) fn spawn_drain_all_if_due<R: Runtime>(handle: &AppHandle<R>) {
    if !drain_due(ALL_SCOPE, ALL_DRAIN_MIN_INTERVAL_MS, now_ms()) {
        return;
    }
    let handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        drain(&handle, None, None).await;
    });
}

/// Re-check one parent's parked rumors when a roster binding arrives.
pub(crate) fn spawn_drain<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    author_npub: Option<&str>,
) {
    let handle = handle.clone();
    let parent = parent_id.to_string();
    let author = author_npub.map(str::to_string);
    tauri::async_runtime::spawn(async move {
        drain(&handle, Some(&parent), author.as_deref()).await;
    });
}

/// `true` when `parked` may be applied now. Parks it on `Undecided`; drops it on `Denied`.
pub(crate) async fn admit<R: Runtime>(handle: &AppHandle<R>, parked: Parked) -> bool {
    if drain_due(&parked.parent_id, PARENT_DRAIN_MIN_INTERVAL_MS, now_ms()) {
        drain(handle, Some(&parked.parent_id), None).await;
    }
    let decision = member_has_squad_privilege(
        handle,
        &parked.parent_id,
        &parked.author_npub,
        parked.kind.action(),
    )
    .await;
    match route(decision) {
        Route::Apply => true,
        Route::Drop => false,
        Route::Park => {
            if let Err(e) = with_conn(handle, |c| park(c, &parked, now_ms())) {
                eprintln!("[squad_record_privilege] park failed: {}", e);
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PARENT: &str = "parent-1";
    const ALICE: &str = "npub1alice";
    const BOB: &str = "npub1bob";

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    fn parked(rumor_id: &str, kind: Kind, author: &str) -> Parked {
        Parked {
            rumor_id: rumor_id.to_string(),
            kind,
            parent_id: PARENT.to_string(),
            mls_group_id: "group-1".to_string(),
            author_npub: author.to_string(),
            payload_json: "{}".to_string(),
        }
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM squad_record_privilege_pending",
            [],
            |r| r.get(0),
        )
        .expect("count")
    }

    #[test]
    fn only_undecided_parks() {
        assert_eq!(route(MemberPrivilege::Allowed), Route::Apply);
        assert_eq!(route(MemberPrivilege::Denied), Route::Drop);
        assert_eq!(route(MemberPrivilege::Undecided), Route::Park);
    }

    #[test]
    fn park_is_idempotent_and_loads_oldest_first() {
        let conn = conn();
        park(&conn, &parked("r2", Kind::Doc, ALICE), 2_000).unwrap();
        park(&conn, &parked("r1", Kind::Event, ALICE), 1_000).unwrap();
        park(&conn, &parked("r1", Kind::Event, ALICE), 3_000).unwrap();
        assert_eq!(count(&conn), 2);
        let rows = load(&conn, Some(PARENT), None).unwrap();
        let ids: Vec<_> = rows.iter().map(|r| r.rumor_id.as_str()).collect();
        assert_eq!(ids, ["r1", "r2"]);
        assert_eq!(rows[0].kind, Kind::Event);
        assert_eq!(rows[1].kind, Kind::Doc);
    }

    #[test]
    fn load_filters_by_author_and_remove_deletes() {
        let conn = conn();
        park(&conn, &parked("r1", Kind::Event, ALICE), 1_000).unwrap();
        park(&conn, &parked("r2", Kind::Event, BOB), 1_000).unwrap();
        let bob = load(&conn, Some(PARENT), Some(BOB)).unwrap();
        assert_eq!(bob.len(), 1);
        assert_eq!(bob[0].rumor_id, "r2");
        remove(&conn, "r2").unwrap();
        assert_eq!(count(&conn), 1);
        assert!(load(&conn, Some("other-parent"), None).unwrap().is_empty());
    }

    #[test]
    fn parked_rows_are_capped_per_author() {
        let conn = conn();
        let extra = 5;
        for i in 1..=(MAX_PARKED_PER_AUTHOR + extra) {
            park(
                &conn,
                &parked(&format!("r{i:04}"), Kind::Event, ALICE),
                1_000 + i,
            )
            .unwrap();
        }
        park(&conn, &parked("bob", Kind::Event, BOB), 1_000).unwrap();
        assert_eq!(count(&conn), MAX_PARKED_PER_AUTHOR + 1);
        let oldest: i64 = conn
            .query_row(
                "SELECT MIN(received_ms) FROM squad_record_privilege_pending WHERE author_npub = ?1",
                params![ALICE],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(oldest, 1_000 + extra + 1);
    }

    #[test]
    fn parked_rows_older_than_ttl_are_purged() {
        let conn = conn();
        park(&conn, &parked("r1", Kind::Doc, ALICE), 1_000).unwrap();
        purge_expired(&conn, 1_000 + PARKED_TTL_MS).unwrap();
        assert_eq!(count(&conn), 1);
        purge_expired(&conn, 1_000 + PARKED_TTL_MS + 1).unwrap();
        assert_eq!(count(&conn), 0);
    }

    const SELF_NPUB: &str = "npub1privilegegatetestself";
    const PROXY: &str = "0x1111111111111111111111111111111111111111";

    /// Mock app with a migrated on-disk db for `SELF_NPUB`, set as the current account.
    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        crate::account_manager::set_current_account(SELF_NPUB.to_string()).unwrap();
        crate::account_manager::close_db_connection();
        let app = tauri::test::mock_app();
        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), SELF_NPUB).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);
        let db_path = crate::account_manager::get_database_path(app.handle(), SELF_NPUB).unwrap();
        let mut conn = Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);
        app
    }

    fn activate_squad_admin<R: Runtime>(handle: &AppHandle<R>) {
        with_conn(handle, |c| {
            c.execute(
                "INSERT INTO squad_infra (id, parent_id, infra_type, chain, canonical_ref, created_at_ms, updated_at_ms)
                 VALUES ('sa-1', ?1, 'squad_admin', 'sepolia', ?2, 1, 1)",
                params![PARENT, PROXY],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
        .unwrap();
    }

    fn parked_count<R: Runtime>(handle: &AppHandle<R>) -> i64 {
        with_conn(handle, |c| Ok(count(c))).unwrap()
    }

    #[tokio::test]
    async fn admit_allows_when_squad_admin_inactive() {
        let app = setup();
        let ok = admit(app.handle(), parked("r1", Kind::Event, ALICE)).await;
        assert!(ok);
        assert_eq!(parked_count(app.handle()), 0);
    }

    #[tokio::test]
    async fn admit_parks_when_author_has_no_roster_binding() {
        let app = setup();
        activate_squad_admin(app.handle());
        let ok = admit(app.handle(), parked("r1", Kind::Doc, ALICE)).await;
        assert!(!ok);
        assert_eq!(parked_count(app.handle()), 1);
    }

    #[tokio::test]
    async fn drain_keeps_undecided_and_removes_once_allowed() {
        let app = setup();
        activate_squad_admin(app.handle());
        with_conn(app.handle(), |c| {
            park(c, &parked("r1", Kind::Doc, ALICE), now_ms())
        })
        .unwrap();

        drain(app.handle(), Some(PARENT), None).await;
        assert_eq!(parked_count(app.handle()), 1);

        with_conn(app.handle(), |c| {
            c.execute("DELETE FROM squad_infra", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .unwrap();
        drain(app.handle(), Some(PARENT), Some(ALICE)).await;
        assert_eq!(parked_count(app.handle()), 0);
    }

    #[test]
    fn drain_due_throttles_per_scope() {
        assert!(drain_due("scope-a", 1_000, 10_000));
        assert!(!drain_due("scope-a", 1_000, 10_500));
        assert!(drain_due("scope-b", 1_000, 10_500));
        assert!(drain_due("scope-a", 1_000, 11_000));
    }
}
