use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

// ============================================================================
// MLS Metadata SQL Functions
// ============================================================================

/// Save a single MLS group to SQL database (plaintext columns) - more efficient for adding new groups
pub async fn save_mls_group<R: Runtime>(
    handle: AppHandle<R>,
    group: &crate::mls::MlsGroupMetadata,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    // Insert or replace a single group
    let pending_welcomes_json = serde_json::to_string(&group.pending_welcomes).map_err(|e| {
        format!(
            "Failed to serialize pending_welcomes for {}: {}",
            group.group_id, e
        )
    })?;
    conn.execute(
        "INSERT OR REPLACE INTO mls_groups (group_id, engine_group_id, creator_pubkey, name, avatar_ref, created_at, updated_at, evicted, pending_welcomes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            group.group_id,
            group.engine_group_id,
            group.creator_pubkey,
            group.name,
            group.avatar_ref,
            group.created_at as i64,
            group.updated_at as i64,
            group.evicted as i32,
            pending_welcomes_json,
        ],
    ).map_err(|e| format!("Failed to save MLS group {}: {}", group.group_id, e))?;

    println!("[SQL] Saved 1 MLS group to mls_groups table");
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Delete a single MLS group row by `group_id` — targeted, so a concurrent writer of a
/// *different* group's row can never be lost to a stale read.
pub async fn delete_mls_group<R: Runtime>(
    handle: AppHandle<R>,
    group_id: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    conn.execute(
        "DELETE FROM mls_groups WHERE group_id = ?1",
        rusqlite::params![group_id],
    )
    .map_err(|e| format!("Failed to delete MLS group {}: {}", group_id, e))?;
    println!("[SQL] Deleted MLS group {} from mls_groups table", group_id);
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Column-scoped update of one group's pending-welcome list, matched on either id alias
/// (`group_id` or `engine_group_id`). Narrower than `save_mls_group`: it cannot clobber a
/// concurrent writer's changes to the row's other columns. Returns rows affected.
pub async fn set_mls_group_pending_welcomes<R: Runtime>(
    handle: AppHandle<R>,
    group_id: &str,
    pending_welcomes: &[String],
    updated_at: u64,
) -> Result<usize, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let pending_welcomes_json = serde_json::to_string(pending_welcomes).map_err(|e| {
        format!(
            "Failed to serialize pending_welcomes for {}: {}",
            group_id, e
        )
    })?;
    // Guard empty ids: legacy rows default `engine_group_id` to '', so
    // `OR engine_group_id = ?3` with an empty bind would rewrite every such row.
    let rows_affected = conn
        .execute(
            "UPDATE mls_groups SET pending_welcomes = ?1, updated_at = ?2 WHERE group_id = ?3 OR (?3 != '' AND engine_group_id = ?3)",
            rusqlite::params![pending_welcomes_json, updated_at as i64, group_id],
        )
        .map_err(|e| format!("Failed to update pending_welcomes for MLS group {}: {}", group_id, e))?;
    println!(
        "[SQL] Updated pending_welcomes for MLS group {} ({} row(s) affected)",
        group_id, rows_affected
    );
    crate::account_manager::return_db_connection(conn);
    Ok(rows_affected)
}

/// Atomically drop one npub from `pending_welcomes` without a full-list read-modify-write.
/// Concurrent resend/remove of different npubs cannot resurrect a just-cleared entry.
pub async fn remove_mls_group_pending_welcome<R: Runtime>(
    handle: AppHandle<R>,
    group_id: &str,
    member_npub: &str,
    updated_at: u64,
) -> Result<usize, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let rows_affected = conn
        .execute(
            "UPDATE mls_groups SET pending_welcomes = COALESCE((
                 SELECT json_group_array(value)
                 FROM json_each(mls_groups.pending_welcomes)
                 WHERE value != ?1
             ), '[]'), updated_at = ?2
             WHERE group_id = ?3 OR (?3 != '' AND engine_group_id = ?3)",
            rusqlite::params![member_npub, updated_at as i64, group_id],
        )
        .map_err(|e| {
            format!(
                "Failed to remove pending welcome {} from MLS group {}: {}",
                member_npub, group_id, e
            )
        })?;
    println!(
        "[SQL] Removed pending welcome {} from MLS group {} ({} row(s) affected)",
        member_npub, group_id, rows_affected
    );
    crate::account_manager::return_db_connection(conn);
    Ok(rows_affected)
}

/// True when a non-evicted MLS group row matches the parent id (`group_id` or `engine_group_id`).
pub(super) fn parent_exists_in_groups_conn(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM mls_groups WHERE evicted = 0 AND (group_id = ?1 OR engine_group_id = ?1))",
        rusqlite::params![parent_id],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| format!("Failed to check MLS group membership: {}", e))
}

/// Targeted membership check for a parent id against persisted MLS groups.
pub async fn parent_exists_in_groups<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
) -> Result<bool, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(false);
    }
    let conn = crate::account_manager::get_db_connection(handle)?;
    let exists = parent_exists_in_groups_conn(&conn, pid);
    crate::account_manager::return_db_connection(conn);
    exists
}

/// Load MLS groups from SQL database (plaintext columns)
pub async fn load_mls_groups<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<crate::mls::MlsGroupMetadata>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Load from mls_groups table
    let mut stmt = conn.prepare(
        "SELECT group_id, engine_group_id, creator_pubkey, name, avatar_ref, created_at, updated_at, evicted, pending_welcomes FROM mls_groups"
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let group_id: String = row.get(0)?;
            let pending_welcomes_json: String = row.get(8)?;
            // A hard failure here would make the whole group list unreadable, so log loudly
            // and degrade to "no pending welcomes" instead of losing the row entirely.
            let pending_welcomes =
                serde_json::from_str(&pending_welcomes_json).unwrap_or_else(|e| {
                    eprintln!(
                        "[SQL] Failed to parse pending_welcomes for MLS group {}: {}",
                        group_id, e
                    );
                    Vec::new()
                });
            Ok(crate::mls::MlsGroupMetadata {
                group_id,
                engine_group_id: row.get(1)?,
                creator_pubkey: row.get(2)?,
                name: row.get(3)?,
                avatar_ref: row.get(4)?,
                created_at: row.get::<_, i64>(5)? as u64,
                updated_at: row.get::<_, i64>(6)? as u64,
                evicted: row.get::<_, i32>(7)? != 0,
                pending_welcomes,
            })
        })
        .map_err(|e| format!("Failed to query mls_groups: {}", e))?;

    let groups: Vec<crate::mls::MlsGroupMetadata> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect groups: {}", e))?;

    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(groups)
}

#[cfg(test)]
mod mls_group_metadata_persistence_tests {
    //! Proves the two persistence steps `MlsService::create_group` depends on round-trip
    //! through real SQL: a failed welcome delivery must leave the group persisted, not
    //! discarded. `MlsService::read_groups` hard-codes the process global `TAURI_APP` (bound to
    //! the real `Wry` runtime, which `tauri::test::mock_app()`'s `MockRuntime` handle cannot
    //! populate) — but `save_mls_group`/`load_mls_groups`/`delete_mls_group` are the same
    //! generic-over-`Runtime` calls `create_group` makes.
    use super::*;
    use crate::mls::MlsGroupMetadata;

    fn setup(test_npub: &str) -> tauri::App<tauri::test::MockRuntime> {
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();
        let app = tauri::test::mock_app();
        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);
        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);
        app
    }

    fn fresh_group(group_id: &str) -> MlsGroupMetadata {
        MlsGroupMetadata {
            group_id: group_id.to_string(),
            engine_group_id: format!("engine-{}", group_id),
            creator_pubkey: "npub1creator".to_string(),
            name: "Test Squad".to_string(),
            avatar_ref: None,
            created_at: 1_000,
            updated_at: 1_000,
            evicted: false,
            pending_welcomes: Vec::new(),
        }
    }

    #[tokio::test]
    async fn a_freshly_persisted_group_round_trips_with_no_pending_welcomes() {
        let app = setup("npub1u4mlsgroupsroundtripfresh");
        let handle = app.handle().clone();

        save_mls_group(handle.clone(), &fresh_group("g1"))
            .await
            .unwrap();

        let groups = load_mls_groups(&handle).await.unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].group_id, "g1");
        assert!(groups[0].pending_welcomes.is_empty());
    }

    /// Mirrors `create_group`'s failure branch exactly: persist the group first (as if the
    /// engine already committed it), then re-persist with `pending_welcomes` populated (as if
    /// welcome delivery failed for some recipients) instead of ever returning `Err` and
    /// discarding it. Asserts the group survives as one row, not zero (orphaned) and not two
    /// (duplicated), with the pending list intact — the exact regression #321 fixed.
    #[tokio::test]
    async fn a_welcome_delivery_failure_repersists_pending_welcomes_without_losing_the_group() {
        let app = setup("npub1u4mlsgroupsroundtripfailure");
        let handle = app.handle().clone();

        let mut group = fresh_group("g2");
        save_mls_group(handle.clone(), &group).await.unwrap();

        // The failure branch: mutate in-memory and re-persist, exactly as create_group does.
        group.pending_welcomes = vec!["npub1undelivered".to_string()];
        group.updated_at = 2_000;
        save_mls_group(handle.clone(), &group).await.unwrap();

        let groups = load_mls_groups(&handle).await.unwrap();
        assert_eq!(
            groups.len(),
            1,
            "a welcome delivery failure must leave exactly one row, not discard or duplicate the group"
        );
        assert_eq!(groups[0].group_id, "g2");
        assert_eq!(
            groups[0].pending_welcomes,
            vec!["npub1undelivered".to_string()]
        );
        assert_eq!(groups[0].updated_at, 2_000);
    }

    /// A later successful resend clears the pending flag via the same targeted upsert
    /// `add_member_device` uses, without needing to touch any other group's row.
    #[tokio::test]
    async fn clearing_pending_welcomes_on_resend_success_leaves_sibling_groups_untouched() {
        let app = setup("npub1u4mlsgroupsroundtripclear");
        let handle = app.handle().clone();

        let mut pending = fresh_group("g3");
        pending.pending_welcomes = vec!["npub1undelivered".to_string()];
        save_mls_group(handle.clone(), &pending).await.unwrap();
        save_mls_group(handle.clone(), &fresh_group("g4"))
            .await
            .unwrap();

        let rows = set_mls_group_pending_welcomes(handle.clone(), &pending.group_id, &[], 2_000)
            .await
            .unwrap();
        assert_eq!(rows, 1);

        let groups = load_mls_groups(&handle).await.unwrap();
        assert_eq!(groups.len(), 2);
        let g3 = groups.iter().find(|g| g.group_id == "g3").unwrap();
        let g4 = groups.iter().find(|g| g.group_id == "g4").unwrap();
        assert!(g3.pending_welcomes.is_empty());
        assert_eq!(g3.updated_at, 2_000);
        assert!(g4.pending_welcomes.is_empty());
        assert_eq!(g4.updated_at, 1_000);
    }

    #[tokio::test]
    async fn set_mls_group_pending_welcomes_matches_engine_group_id_alias() {
        let app = setup("npub1u4mlsgroupsenginealias");
        let handle = app.handle().clone();

        save_mls_group(handle.clone(), &fresh_group("g-alias"))
            .await
            .unwrap();

        let rows = set_mls_group_pending_welcomes(
            handle.clone(),
            "engine-g-alias",
            &["npub1pending".to_string()],
            3_000,
        )
        .await
        .unwrap();
        assert_eq!(rows, 1);

        let groups = load_mls_groups(&handle).await.unwrap();
        assert_eq!(groups[0].pending_welcomes, vec!["npub1pending".to_string()]);
        assert_eq!(groups[0].updated_at, 3_000);
    }

    #[tokio::test]
    async fn set_mls_group_pending_welcomes_unknown_id_affects_zero_rows() {
        let app = setup("npub1u4mlsgroupsunknownid");
        let handle = app.handle().clone();
        save_mls_group(handle.clone(), &fresh_group("g-known"))
            .await
            .unwrap();

        let rows = set_mls_group_pending_welcomes(handle.clone(), "missing", &[], 4_000)
            .await
            .unwrap();
        assert_eq!(rows, 0);
        assert_eq!(load_mls_groups(&handle).await.unwrap()[0].updated_at, 1_000);
    }

    #[tokio::test]
    async fn set_mls_group_pending_welcomes_empty_id_does_not_rewrite_legacy_rows() {
        let app = setup("npub1u4mlsgroupsemptyid");
        let handle = app.handle().clone();

        let mut legacy_a = fresh_group("legacy-a");
        legacy_a.engine_group_id = String::new();
        legacy_a.pending_welcomes = vec!["npub1keep-a".to_string()];
        let mut legacy_b = fresh_group("legacy-b");
        legacy_b.engine_group_id = String::new();
        legacy_b.pending_welcomes = vec!["npub1keep-b".to_string()];
        save_mls_group(handle.clone(), &legacy_a).await.unwrap();
        save_mls_group(handle.clone(), &legacy_b).await.unwrap();

        let rows =
            set_mls_group_pending_welcomes(handle.clone(), "", &["npub1wiped".to_string()], 99)
                .await
                .unwrap();
        assert_eq!(rows, 0);

        let groups = load_mls_groups(&handle).await.unwrap();
        assert_eq!(groups.len(), 2);
        for g in &groups {
            assert!(!g.pending_welcomes.contains(&"npub1wiped".to_string()));
            assert_eq!(g.updated_at, 1_000);
        }
    }

    #[tokio::test]
    async fn remove_mls_group_pending_welcome_drops_one_npub_and_leaves_the_rest() {
        let app = setup("npub1u4mlsgroupsremoveone");
        let handle = app.handle().clone();

        let mut pending = fresh_group("g-rm");
        pending.pending_welcomes = vec!["npub1keep".to_string(), "npub1drop".to_string()];
        save_mls_group(handle.clone(), &pending).await.unwrap();
        save_mls_group(handle.clone(), &fresh_group("g-sibling"))
            .await
            .unwrap();

        let rows =
            remove_mls_group_pending_welcome(handle.clone(), &pending.group_id, "npub1drop", 5_000)
                .await
                .unwrap();
        assert_eq!(rows, 1);

        let groups = load_mls_groups(&handle).await.unwrap();
        let g = groups.iter().find(|g| g.group_id == "g-rm").unwrap();
        let sibling = groups.iter().find(|g| g.group_id == "g-sibling").unwrap();
        assert_eq!(g.pending_welcomes, vec!["npub1keep".to_string()]);
        assert_eq!(g.updated_at, 5_000);
        assert!(sibling.pending_welcomes.is_empty());
        assert_eq!(sibling.updated_at, 1_000);
    }

    #[tokio::test]
    async fn remove_mls_group_pending_welcome_empty_id_does_not_rewrite_legacy_rows() {
        let app = setup("npub1u4mlsgroupsremoveemptyid");
        let handle = app.handle().clone();

        let mut legacy = fresh_group("legacy-rm");
        legacy.engine_group_id = String::new();
        legacy.pending_welcomes = vec!["npub1keep".to_string()];
        save_mls_group(handle.clone(), &legacy).await.unwrap();

        let rows = remove_mls_group_pending_welcome(handle.clone(), "", "npub1keep", 99)
            .await
            .unwrap();
        assert_eq!(rows, 0);
        assert_eq!(
            load_mls_groups(&handle).await.unwrap()[0].pending_welcomes,
            vec!["npub1keep".to_string()]
        );
    }

    /// `delete_mls_group` is targeted: removing one group must never take a sibling's row with it.
    #[tokio::test]
    async fn deleting_one_group_leaves_the_other_groups_row_intact() {
        let app = setup("npub1u4mlsgroupsroundtripdelete");
        let handle = app.handle().clone();

        save_mls_group(handle.clone(), &fresh_group("g5"))
            .await
            .unwrap();
        save_mls_group(handle.clone(), &fresh_group("g6"))
            .await
            .unwrap();

        delete_mls_group(handle.clone(), "g5").await.unwrap();

        let groups = load_mls_groups(&handle).await.unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].group_id, "g6");
    }
}

/// Persist a harvest, keeping groups that match an `mls_groups` row by
/// `group_id` or `engine_group_id` (case-insensitive for hex ids).
/// Unmatched harvest keys are logged and skipped. `INSERT OR IGNORE`
/// against the migration's unique `(group_id, admin_npub)` index makes a
/// re-run of the harvest produce no duplicate rows.
pub(crate) fn persist_legacy_group_admins_conn(
    conn: &rusqlite::Connection,
    harvest: &crate::mls_store_reset::LegacyStoreHarvest,
) -> Result<usize, String> {
    let mut canonical_group_ids: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT group_id, engine_group_id FROM mls_groups")
            .map_err(|e| format!("Failed to prepare mls_groups scan: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to scan mls_groups: {}", e))?;
        for row in rows {
            let (group_id, engine_group_id) =
                row.map_err(|e| format!("Failed to read mls_groups row: {}", e))?;
            canonical_group_ids.insert(group_id.clone(), group_id.clone());
            canonical_group_ids.insert(group_id.to_lowercase(), group_id.clone());
            if !engine_group_id.is_empty() {
                canonical_group_ids.insert(engine_group_id.clone(), group_id.clone());
                canonical_group_ids.insert(engine_group_id.to_lowercase(), group_id);
            }
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut persisted = 0usize;
    let mut unmatched: Vec<String> = Vec::new();
    for (harvested_group_id, admins) in &harvest.admins_by_group {
        let Some(group_id) = canonical_group_ids
            .get(harvested_group_id)
            .or_else(|| canonical_group_ids.get(&harvested_group_id.to_lowercase()))
            .cloned()
        else {
            unmatched.push(harvested_group_id.clone());
            continue;
        };
        for admin_npub in admins {
            persisted += conn
                .execute(
                    "INSERT OR IGNORE INTO mls_legacy_admins (group_id, admin_npub, harvested_at) VALUES (?1, ?2, ?3)",
                    rusqlite::params![group_id, admin_npub, now],
                )
                .map_err(|e| format!("Failed to persist legacy admin for {}: {}", group_id, e))?;
        }
    }

    if !unmatched.is_empty() {
        let preview: Vec<&str> = unmatched.iter().take(5).map(String::as_str).collect();
        eprintln!(
            "[MLS Reset] Harvested {} group id(s) with no mls_groups match (admins dropped for those): {}{}",
            unmatched.len(),
            preview.join(", "),
            if unmatched.len() > 5 { ", …" } else { "" }
        );
    }

    Ok(persisted)
}

pub(crate) fn clear_discarded_giftwraps_conn(
    conn: &rusqlite::Connection,
    wrapper_ids: &[String],
) -> Result<usize, String> {
    if wrapper_ids.is_empty() {
        return Ok(0);
    }
    let placeholders = std::iter::repeat("?")
        .take(wrapper_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "DELETE FROM discarded_giftwraps WHERE wrapper_id IN ({})",
        placeholders
    );
    let params: Vec<&dyn rusqlite::ToSql> = wrapper_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();
    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Failed to clear discarded giftwraps: {}", e))
}

#[cfg(test)]
mod legacy_mls_store_harvest_tests {
    use super::*;

    fn in_memory_app_conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    fn insert_mls_group(conn: &rusqlite::Connection, group_id: &str, engine_group_id: &str) {
        conn.execute(
            "INSERT INTO mls_groups (group_id, engine_group_id, creator_pubkey, name, avatar_ref, created_at, updated_at, evicted)
             VALUES (?1, ?2, 'creator', 'group', '', 1000, 1000, 0)",
            rusqlite::params![group_id, engine_group_id],
        )
        .expect("insert mls_groups row");
    }

    #[test]
    fn v30_migration_creates_mls_legacy_admins_table_on_fresh_db() {
        let conn = in_memory_app_conn();
        assert!(crate::mls_store_reset::legacy_store_table_exists(
            &conn,
            "mls_legacy_admins"
        ));
    }

    #[test]
    fn v30_migration_creates_mls_legacy_admins_table_on_baselined_db() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::migrations::seed_pre_v28_schema(&conn);

        crate::migrations::run_migrations(&mut conn).expect("baseline should run");

        assert!(crate::mls_store_reset::legacy_store_table_exists(
            &conn,
            "mls_legacy_admins"
        ));
    }

    #[test]
    fn persist_skips_groups_with_no_matching_mls_groups_row() {
        let conn = in_memory_app_conn();
        let mut admins_by_group = std::collections::BTreeMap::new();
        admins_by_group.insert(
            "unknown-group".to_string(),
            vec!["npub1fixture".to_string()],
        );
        let harvest = crate::mls_store_reset::LegacyStoreHarvest {
            admins_by_group,
            pending_wrapper_ids: vec![],
        };

        let persisted = persist_legacy_group_admins_conn(&conn, &harvest).expect("persist");
        assert_eq!(persisted, 0);
        assert!(
            crate::mls_store_reset::load_all_legacy_group_admins_conn(&conn)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn running_harvest_twice_produces_no_duplicate_rows() {
        let conn = in_memory_app_conn();
        insert_mls_group(&conn, "known-group", "");
        let mut admins_by_group = std::collections::BTreeMap::new();
        admins_by_group.insert(
            "known-group".to_string(),
            vec!["npub1fixtureadmin".to_string()],
        );
        let harvest = crate::mls_store_reset::LegacyStoreHarvest {
            admins_by_group,
            pending_wrapper_ids: vec![],
        };

        let first = persist_legacy_group_admins_conn(&conn, &harvest).expect("first persist");
        let second = persist_legacy_group_admins_conn(&conn, &harvest).expect("second persist");
        assert_eq!(first, 1);
        assert_eq!(second, 0, "re-running the harvest must not duplicate rows");

        let loaded = crate::mls_store_reset::load_all_legacy_group_admins_conn(&conn).unwrap();
        assert_eq!(
            loaded.get("known-group"),
            Some(&vec!["npub1fixtureadmin".to_string()])
        );
    }

    #[test]
    fn persist_matches_group_by_engine_group_id() {
        let conn = in_memory_app_conn();
        insert_mls_group(&conn, "wire-id", "engine-id");
        let mut admins_by_group = std::collections::BTreeMap::new();
        admins_by_group.insert(
            "engine-id".to_string(),
            vec!["npub1viaenginematch".to_string()],
        );
        let harvest = crate::mls_store_reset::LegacyStoreHarvest {
            admins_by_group,
            pending_wrapper_ids: vec![],
        };

        let persisted = persist_legacy_group_admins_conn(&conn, &harvest).expect("persist");
        assert_eq!(persisted, 1);
        let loaded = crate::mls_store_reset::load_all_legacy_group_admins_conn(&conn).unwrap();
        assert_eq!(
            loaded.get("wire-id"),
            Some(&vec!["npub1viaenginematch".to_string()])
        );
        assert!(!loaded.contains_key("engine-id"));
    }

    #[test]
    fn persist_matches_group_id_case_insensitively() {
        let conn = in_memory_app_conn();
        insert_mls_group(&conn, "abcdef0123456789", "");
        let mut admins_by_group = std::collections::BTreeMap::new();
        admins_by_group.insert(
            "ABCDEF0123456789".to_string(),
            vec!["npub1casefold".to_string()],
        );
        let harvest = crate::mls_store_reset::LegacyStoreHarvest {
            admins_by_group,
            pending_wrapper_ids: vec![],
        };

        let persisted = persist_legacy_group_admins_conn(&conn, &harvest).expect("persist");
        assert_eq!(persisted, 1);
        let loaded = crate::mls_store_reset::load_all_legacy_group_admins_conn(&conn).unwrap();
        assert_eq!(
            loaded.get("abcdef0123456789"),
            Some(&vec!["npub1casefold".to_string()])
        );
    }

    #[test]
    fn clear_discarded_giftwraps_removes_exactly_supplied_ids() {
        let conn = in_memory_app_conn();
        for id in ["wrap-a", "wrap-b", "wrap-c"] {
            conn.execute(
                "INSERT INTO discarded_giftwraps (wrapper_id) VALUES (?1)",
                rusqlite::params![id],
            )
            .unwrap();
        }

        let removed =
            clear_discarded_giftwraps_conn(&conn, &["wrap-a".to_string(), "wrap-c".to_string()])
                .unwrap();
        assert_eq!(removed, 2);

        let remaining: Vec<String> = conn
            .prepare("SELECT wrapper_id FROM discarded_giftwraps ORDER BY wrapper_id")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(remaining, vec!["wrap-b".to_string()]);
    }

    #[test]
    fn clear_discarded_giftwraps_is_a_noop_for_empty_input() {
        let conn = in_memory_app_conn();
        conn.execute(
            "INSERT INTO discarded_giftwraps (wrapper_id) VALUES ('wrap-a')",
            [],
        )
        .unwrap();

        let removed = clear_discarded_giftwraps_conn(&conn, &[]).unwrap();
        assert_eq!(removed, 0);
    }
}

/// Save MLS keypackage index to SQL database (plaintext)
pub async fn save_mls_keypackages<R: Runtime>(
    handle: AppHandle<R>,
    packages: &[serde_json::Value],
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    // Clear existing keypackages
    conn.execute("DELETE FROM mls_keypackages", [])
        .map_err(|e| format!("Failed to clear MLS keypackages: {}", e))?;

    // Insert new keypackages
    for pkg in packages {
        let owner_pubkey = pkg
            .get("owner_pubkey")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let device_id = pkg.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
        let keypackage_ref = pkg
            .get("keypackage_ref")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let keypackage_ref_secondary = pkg.get("keypackage_ref_secondary").and_then(|v| v.as_str());
        let keypackage_d_tag = pkg.get("keypackage_d_tag").and_then(|v| v.as_str());
        let fetched_at = pkg.get("fetched_at").and_then(|v| v.as_u64()).unwrap_or(0);
        let expires_at = pkg.get("expires_at").and_then(|v| v.as_u64()).unwrap_or(0);

        conn.execute(
            "INSERT INTO mls_keypackages (owner_pubkey, device_id, keypackage_ref, keypackage_ref_secondary, keypackage_d_tag, fetched_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![owner_pubkey, device_id, keypackage_ref, keypackage_ref_secondary, keypackage_d_tag, fetched_at as i64, expires_at as i64],
        ).map_err(|e| format!("Failed to insert MLS keypackage: {}", e))?;
    }

    println!("[SQL] Saved {} MLS keypackages", packages.len());
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Load MLS keypackage index from SQL database (plaintext)
pub async fn load_mls_keypackages<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn.prepare(
        "SELECT owner_pubkey, device_id, keypackage_ref, keypackage_ref_secondary, keypackage_d_tag, fetched_at, expires_at FROM mls_keypackages"
    ).map_err(|e| format!("Failed to prepare MLS keypackages query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let keypackage_ref_secondary: Option<String> = row.get(3)?;
            let keypackage_d_tag: Option<String> = row.get(4)?;
            let fetched_at: i64 = row.get(5)?;
            let expires_at: i64 = row.get(6)?;
            Ok(serde_json::json!({
                "owner_pubkey": row.get::<_, String>(0)?,
                "device_id": row.get::<_, String>(1)?,
                "keypackage_ref": row.get::<_, String>(2)?,
                "keypackage_ref_secondary": keypackage_ref_secondary,
                "keypackage_d_tag": keypackage_d_tag,
                "fetched_at": fetched_at as u64,
                "expires_at": expires_at as u64,
            }))
        })
        .map_err(|e| format!("Failed to query MLS keypackages: {}", e))?;

    let packages: Vec<serde_json::Value> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect MLS keypackages: {}", e))?;

    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(packages)
}

/// Save MLS event cursors to SQL database (plaintext)
pub async fn save_mls_event_cursors<R: Runtime>(
    handle: AppHandle<R>,
    cursors: &HashMap<String, crate::mls::EventCursor>,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    for (group_id, cursor) in cursors {
        conn.execute(
            "INSERT OR REPLACE INTO mls_event_cursors (group_id, last_seen_event_id, last_seen_at)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                group_id,
                &cursor.last_seen_event_id,
                cursor.last_seen_at as i64
            ],
        )
        .map_err(|e| format!("Failed to save MLS event cursor: {}", e))?;
    }

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Load MLS event cursors from SQL database (plaintext)
pub async fn load_mls_event_cursors<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<HashMap<String, crate::mls::EventCursor>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let mut stmt = conn
        .prepare("SELECT group_id, last_seen_event_id, last_seen_at FROM mls_event_cursors")
        .map_err(|e| format!("Failed to prepare MLS event cursors query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let group_id: String = row.get(0)?;
            let last_seen_at: i64 = row.get(2)?;
            let cursor = crate::mls::EventCursor {
                last_seen_event_id: row.get(1)?,
                last_seen_at: last_seen_at as u64,
            };
            Ok((group_id, cursor))
        })
        .map_err(|e| format!("Failed to query MLS event cursors: {}", e))?;

    let cursors: HashMap<String, crate::mls::EventCursor> = rows
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| format!("Failed to collect MLS event cursors: {}", e))?;

    drop(stmt);
    crate::account_manager::return_db_connection(conn);
    Ok(cursors)
}

/// Save MLS device ID to SQL database (plaintext)
pub async fn save_mls_device_id<R: Runtime>(
    handle: AppHandle<R>,
    device_id: &str,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('mls_device_id', ?1)",
        rusqlite::params![device_id],
    )
    .map_err(|e| format!("Failed to save MLS device ID to SQL: {}", e))?;

    println!("[SQL] Saved MLS device ID");
    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Load MLS device ID from SQL database (plaintext)
pub async fn load_mls_device_id<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Option<String>, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;

    let device_id: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'mls_device_id'",
            [],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);
    Ok(device_id)
}

