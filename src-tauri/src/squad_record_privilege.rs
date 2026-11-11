//! Receive-side create/add gate for squad events and docs. A rumor is applied on `Allowed`, dropped on
//! `Denied`, and parked in SQLite on `Undecided` (RPC failure or no roster binding yet) until a re-check decides.
//! See `docs/governance/ACCESS_CONTROL.md`.

use std::collections::HashMap;
use std::future::Future;
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
    drain_with(handle, parent_id, author_npub, |row| decide(handle, row)).await;
}

async fn decide<R: Runtime>(handle: &AppHandle<R>, row: Parked) -> MemberPrivilege {
    member_has_squad_privilege(handle, &row.parent_id, &row.author_npub, row.kind.action()).await
}

pub(crate) async fn drain_with<R, F, Fut>(
    handle: &AppHandle<R>,
    parent_id: Option<&str>,
    author_npub: Option<&str>,
    decide: F,
) where
    R: Runtime,
    F: Fn(Parked) -> Fut,
    Fut: Future<Output = MemberPrivilege>,
{
    let rows = with_conn(handle, |c| {
        purge_expired(c, now_ms())?;
        load(c, parent_id, author_npub)
    })
    .unwrap_or_default();
    for row in rows {
        match route(decide(row.clone()).await) {
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
    admit_with(handle, parked, |row| decide(handle, row)).await
}

pub(crate) async fn admit_with<R, F, Fut>(handle: &AppHandle<R>, parked: Parked, decide: F) -> bool
where
    R: Runtime,
    F: Fn(Parked) -> Fut,
    Fut: Future<Output = MemberPrivilege>,
{
    if drain_due(&parked.parent_id, PARENT_DRAIN_MIN_INTERVAL_MS, now_ms()) {
        drain_with(handle, Some(&parked.parent_id), None, &decide).await;
    }
    match route(decide(parked.clone()).await) {
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
pub(crate) mod test_support {
    use rusqlite::{params, Connection};
    use tauri::{AppHandle, Runtime};

    use crate::squad_records::with_conn;

    /// Mock app with a fresh migrated db for `npub`, set as the current account.
    /// Account state is process-global; the repo runs tests serially (`RUST_TEST_THREADS=1`) or per process (nextest).
    pub fn setup(npub: &str) -> tauri::App<tauri::test::MockRuntime> {
        crate::account_manager::set_current_account(npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();
        let app = tauri::test::mock_app();
        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);
        let db_path = crate::account_manager::get_database_path(app.handle(), npub).unwrap();
        let mut conn = Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);
        app
    }

    fn exec<R: Runtime>(handle: &AppHandle<R>, sql: &str, p: impl rusqlite::Params) {
        with_conn(handle, |c| {
            c.execute(sql, p).map(|_| ()).map_err(|e| e.to_string())
        })
        .unwrap();
    }

    pub fn activate_squad_admin<R: Runtime>(handle: &AppHandle<R>, parent_id: &str, proxy: &str) {
        exec(
            handle,
            "INSERT INTO squad_infra (id, parent_id, infra_type, chain, canonical_ref, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, 'squad_admin', 'sepolia', ?3, 1, 1)",
            params![format!("sa-{parent_id}"), parent_id, proxy],
        );
    }

    /// Announcements group `group_id` (a parent's id) with `members` as participants.
    pub fn seed_members<R: Runtime>(handle: &AppHandle<R>, group_id: &str, members: &[&str]) {
        exec(
            handle,
            "INSERT OR IGNORE INTO mls_groups (group_id, engine_group_id, creator_pubkey, name, created_at, updated_at, evicted)
             VALUES (?1, '', 'creator', 'g', 1, 1, 0)",
            params![group_id],
        );
        exec(
            handle,
            "INSERT OR REPLACE INTO chats (chat_identifier, chat_type, participants, created_at)
             VALUES (?1, 1, ?2, 1)",
            params![group_id, serde_json::to_string(members).unwrap()],
        );
    }

    /// Certified peer roster share, as ingested from a signed bind cert.
    pub fn certify_peer_share<R: Runtime>(
        handle: &AppHandle<R>,
        parent_id: &str,
        npub: &str,
        address: &str,
    ) {
        exec(
            handle,
            "INSERT OR REPLACE INTO squad_member_evm
                (parent_id, member_npub, evm_address, updated_at_ms, issued_at, bind_signature)
             VALUES (?1, ?2, ?3, 1, 1, '0xsig')",
            params![parent_id, npub, address],
        );
    }

    /// Local squad-purpose account bound as `npub`'s roster identity for `parent_id`.
    pub fn bind_self<R: Runtime>(
        handle: &AppHandle<R>,
        parent_id: &str,
        npub: &str,
        address: &str,
    ) {
        let id = format!("acct-{parent_id}-{npub}");
        exec(
            handle,
            "INSERT INTO evm_accounts (id, scheme, hd_index, address, purpose) VALUES (?1, 'bip44_v1', 0, ?2, 'squad')",
            params![id, address],
        );
        exec(
            handle,
            "INSERT INTO squad_member_evm_account (parent_id, member_npub, evm_account_id, updated_at_ms)
             VALUES (?1, ?2, ?3, 1)",
            params![parent_id, npub, id],
        );
    }

    /// Stand-in for the chain read: `Allowed` once the author has a certified share, else `Undecided`.
    pub async fn binding_decision<R: Runtime>(
        handle: AppHandle<R>,
        row: super::Parked,
    ) -> super::MemberPrivilege {
        let bound = crate::db::list_squad_member_evm(handle, row.parent_id.clone(), None)
            .map(|rows| rows.iter().any(|r| r.member_npub == row.author_npub))
            .unwrap_or(false);
        if bound {
            super::MemberPrivilege::Allowed
        } else {
            super::MemberPrivilege::Undecided
        }
    }

    /// Clears the process-global drain throttle so a test is not skipped by an earlier one.
    pub fn reset_drain_throttle() {
        super::LAST_DRAIN_MS.lock().unwrap().clear();
    }

    /// Marks the background sweep as just run, so the next `spawn_drain_all_if_due` is skipped.
    pub fn mark_sweep_done() {
        assert!(super::drain_due(
            super::ALL_SCOPE,
            super::ALL_DRAIN_MIN_INTERVAL_MS,
            super::now_ms()
        ));
    }

    /// Polls `cond` for up to five seconds; panics if it never holds.
    pub async fn eventually(what: &str, mut cond: impl FnMut() -> bool) {
        for _ in 0..250 {
            if cond() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("timed out waiting for {what}");
    }

    /// Lets a spawned task that must not run have a chance to.
    pub async fn settle() {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    pub fn parked_count<R: Runtime>(handle: &AppHandle<R>) -> i64 {
        with_conn(handle, |c| {
            c.query_row(
                "SELECT COUNT(*) FROM squad_record_privilege_pending",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
        })
        .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
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

    fn parked_in(parent: &str, rumor_id: &str, kind: Kind, author: &str) -> Parked {
        Parked {
            parent_id: parent.to_string(),
            ..parked(rumor_id, kind, author)
        }
    }

    async fn allowed(_: Parked) -> MemberPrivilege {
        MemberPrivilege::Allowed
    }

    async fn denied(_: Parked) -> MemberPrivilege {
        MemberPrivilege::Denied
    }

    async fn undecided(_: Parked) -> MemberPrivilege {
        MemberPrivilege::Undecided
    }

    #[tokio::test]
    async fn admit_allows_when_squad_admin_inactive() {
        let app = setup("npub1privgateadmitinactive");
        let ok = admit(
            app.handle(),
            parked_in("p-admit-inactive", "r1", Kind::Event, ALICE),
        )
        .await;
        assert!(ok);
        assert_eq!(parked_count(app.handle()), 0);
    }

    #[tokio::test]
    async fn admit_parks_when_author_has_no_roster_binding() {
        let app = setup("npub1privgateadmitunbound");
        activate_squad_admin(
            app.handle(),
            "p-admit-unbound",
            "0x1111111111111111111111111111111111111111",
        );
        let ok = admit(
            app.handle(),
            parked_in("p-admit-unbound", "r1", Kind::Doc, ALICE),
        )
        .await;
        assert!(!ok);
        assert_eq!(parked_count(app.handle()), 1);
    }

    #[tokio::test]
    async fn admit_routes_each_decision() {
        let app = setup("npub1privgateadmitroutes");

        let ok = admit_with(
            app.handle(),
            parked_in("p-routes-a", "r1", Kind::Doc, ALICE),
            allowed,
        )
        .await;
        assert!(ok);
        assert_eq!(parked_count(app.handle()), 0);

        let ok = admit_with(
            app.handle(),
            parked_in("p-routes-d", "r2", Kind::Doc, ALICE),
            denied,
        )
        .await;
        assert!(!ok);
        assert_eq!(
            parked_count(app.handle()),
            0,
            "denied is dropped, not parked"
        );

        let ok = admit_with(
            app.handle(),
            parked_in("p-routes-u", "r3", Kind::Doc, ALICE),
            undecided,
        )
        .await;
        assert!(!ok);
        assert_eq!(parked_count(app.handle()), 1);
    }

    #[tokio::test]
    async fn drain_keeps_undecided_and_removes_denied() {
        let app = setup("npub1privgatedrainroutes");
        let parent = "p-drain-routes";
        for (id, author) in [("keep", ALICE), ("drop", BOB)] {
            with_conn(app.handle(), |c| {
                park(c, &parked_in(parent, id, Kind::Doc, author), now_ms())
            })
            .unwrap();
        }

        drain_with(app.handle(), Some(parent), None, undecided).await;
        assert_eq!(parked_count(app.handle()), 2);

        let by_author = |row: Parked| async move {
            if row.author_npub == BOB {
                MemberPrivilege::Denied
            } else {
                MemberPrivilege::Undecided
            }
        };
        drain_with(app.handle(), Some(parent), None, by_author).await;
        let left = with_conn(app.handle(), |c| load(c, Some(parent), None)).unwrap();
        let ids: Vec<_> = left.iter().map(|r| r.rumor_id.as_str()).collect();
        assert_eq!(ids, ["keep"]);
    }

    #[tokio::test]
    async fn drain_scopes_to_the_given_parent_and_author() {
        let app = setup("npub1privgatedrainscope");
        for (parent, id, author) in [
            ("p-a", "r1", ALICE),
            ("p-a", "r2", BOB),
            ("p-b", "r3", ALICE),
        ] {
            with_conn(app.handle(), |c| {
                park(c, &parked_in(parent, id, Kind::Doc, author), now_ms())
            })
            .unwrap();
        }
        drain_with(app.handle(), Some("p-a"), Some(ALICE), denied).await;
        let left = with_conn(app.handle(), |c| load(c, None, None)).unwrap();
        let mut ids: Vec<_> = left.iter().map(|r| r.rumor_id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, ["r2", "r3"]);
    }

    #[test]
    fn drain_due_throttles_per_scope() {
        assert!(drain_due("scope-a", 1_000, 10_000));
        assert!(!drain_due("scope-a", 1_000, 10_500));
        assert!(drain_due("scope-b", 1_000, 10_500));
        assert!(drain_due("scope-a", 1_000, 11_000));
    }

    #[test]
    fn unknown_kind_rows_are_skipped_on_load() {
        let conn = conn();
        park(&conn, &parked("r1", Kind::Doc, ALICE), 1_000).unwrap();
        conn.execute(
            "UPDATE squad_record_privilege_pending SET kind = 'bogus' WHERE rumor_id = 'r1'",
            [],
        )
        .unwrap();
        assert!(load(&conn, Some(PARENT), None).unwrap().is_empty());
    }
}
