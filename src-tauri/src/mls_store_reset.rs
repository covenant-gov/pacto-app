use once_cell::sync::Lazy;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

const RESET_MARKER_KEY: &str = "mls_store_reset_v1";
const LOST_GROUPS_KEY: &str = "mls_store_reset_lost_groups";
const PENDING_WRAPPERS_KEY: &str = "mls_store_reset_pending_wrappers";
const KEYPACKAGE_REFRESH_KEY: &str = "mls_store_keypackage_refresh_required";
const ARCHIVE_RETENTION_SECS: u64 = 7 * 24 * 60 * 60;
const ARCHIVE_PREFIX: &str = "mls.archive.";

static ACCOUNT_RESET_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StoreClassification {
    Fresh,
    Current,
    Legacy,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ResetOutcome {
    pub reset_performed: bool,
    pub pending_wrapper_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
struct LostGroups(Vec<String>);

fn account_lock(account: &str) -> Result<Arc<Mutex<()>>, String> {
    let mut locks = ACCOUNT_RESET_LOCKS
        .lock()
        .map_err(|_| "MLS reset lock registry poisoned".to_string())?;
    Ok(locks
        .entry(account.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}

fn setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|e| format!("Failed to read MLS reset setting {key}: {e}"))
}

fn put_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("Failed to write MLS reset setting {key}: {e}"))?;
    Ok(())
}

fn json_setting<T: serde::de::DeserializeOwned + Default>(
    conn: &Connection,
    key: &str,
) -> Result<T, String> {
    match setting(conn, key)? {
        Some(value) => serde_json::from_str(&value)
            .map_err(|e| format!("Invalid MLS reset setting {key}: {e}")),
        None => Ok(T::default()),
    }
}

fn put_json_setting<T: Serialize>(conn: &Connection, key: &str, value: &T) -> Result<(), String> {
    let encoded = serde_json::to_string(value)
        .map_err(|e| format!("Failed to encode MLS reset setting {key}: {e}"))?;
    put_setting(conn, key, &encoded)
}

fn history_version(conn: &Connection) -> Result<Option<i64>, rusqlite::Error> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_refinery_schema_history_nostr_mls')",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(None);
    }
    conn.query_row(
        "SELECT MAX(version) FROM _refinery_schema_history_nostr_mls",
        [],
        |row| row.get(0),
    )
}

fn classify_version(version: Option<i64>, table_exists: bool) -> StoreClassification {
    match version {
        Some(1..=5) => StoreClassification::Current,
        Some(100..) => StoreClassification::Legacy,
        Some(_) => StoreClassification::Legacy,
        None if table_exists => StoreClassification::Legacy,
        None => StoreClassification::Fresh,
    }
}

fn inspect_connection(conn: &Connection) -> Result<StoreClassification, rusqlite::Error> {
    let table_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_refinery_schema_history_nostr_mls')",
        [],
        |row| row.get(0),
    )?;
    let version = history_version(conn)?;
    Ok(classify_version(version, table_exists))
}

fn classify_store(store_path: &Path, encryption_key: &[u8; 32]) -> StoreClassification {
    if !store_path.exists() {
        return StoreClassification::Fresh;
    }

    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if let Ok(conn) = Connection::open_with_flags(store_path, flags) {
        if let Ok(classification) = inspect_connection(&conn) {
            return classification;
        }
    }

    // Current stores are SQLCipher-encrypted. Legacy stores were plaintext, so
    // try the current key only after a plain read fails.
    if let Ok(conn) = Connection::open_with_flags(store_path, flags) {
        let key_hex = hex::encode(encryption_key);
        if conn
            .execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))
            .is_ok()
        {
            if let Ok(classification) = inspect_connection(&conn) {
                return classification;
            }
        }
    }

    StoreClassification::Legacy
}

fn archive_path(profile_dir: &Path, now: u64) -> PathBuf {
    let base = profile_dir.join(format!("{ARCHIVE_PREFIX}{now}"));
    if !base.exists() {
        return base;
    }
    for suffix in 1..=u16::MAX {
        let candidate = profile_dir.join(format!("{ARCHIVE_PREFIX}{now}.{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    profile_dir.join(format!("{ARCHIVE_PREFIX}{now}.overflow"))
}

fn archive_store_directory(mls_dir: &Path, now: u64) -> Result<PathBuf, String> {
    let profile_dir = mls_dir
        .parent()
        .ok_or_else(|| "MLS directory has no profile parent".to_string())?;
    let archive = archive_path(profile_dir, now);
    std::fs::rename(mls_dir, &archive).map_err(|e| {
        format!(
            "Failed to archive legacy MLS store {} to {}: {e}",
            mls_dir.display(),
            archive.display()
        )
    })?;
    if let Err(e) = std::fs::create_dir_all(mls_dir) {
        let rollback = std::fs::rename(&archive, mls_dir);
        return Err(format!(
            "Failed to recreate MLS directory after archiving: {e}; rollback: {rollback:?}"
        ));
    }
    Ok(archive)
}

fn archive_timestamp(path: &Path) -> Option<u64> {
    let name = path.file_name()?.to_str()?;
    let rest = name.strip_prefix(ARCHIVE_PREFIX)?;
    rest.split('.').next()?.parse().ok()
}

fn prune_archives(profile_dir: &Path, now: u64) -> Result<(), String> {
    let entries = match std::fs::read_dir(profile_dir) {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Failed to scan MLS archives: {e}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read MLS archive entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(created_at) = archive_timestamp(&path) else {
            continue;
        };
        if now.saturating_sub(created_at) > ARCHIVE_RETENTION_SECS {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to prune MLS archive {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

fn known_group_ids(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT group_id FROM mls_groups WHERE evicted = 0 ORDER BY group_id")
        .map_err(|e| format!("Failed to prepare reset group scan: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to scan reset groups: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read reset group: {e}"))
}

fn reset_with_connection(
    conn: &Connection,
    mls_dir: &Path,
    store_path: &Path,
    encryption_key: &[u8; 32],
    now: u64,
) -> Result<ResetOutcome, String> {
    let profile_dir = mls_dir
        .parent()
        .ok_or_else(|| "MLS directory has no profile parent".to_string())?;

    if setting(conn, RESET_MARKER_KEY)?.as_deref() == Some("complete") {
        prune_archives(profile_dir, now)?;
        return Ok(ResetOutcome::default());
    }

    let classification = classify_store(store_path, encryption_key);
    if classification != StoreClassification::Legacy {
        put_setting(conn, RESET_MARKER_KEY, "complete")?;
        prune_archives(profile_dir, now)?;
        return Ok(ResetOutcome::default());
    }

    let harvest = crate::db::harvest_legacy_mls_store(store_path);
    let pending_wrapper_ids = harvest.pending_wrapper_ids.clone();
    let lost_groups = LostGroups(known_group_ids(conn)?);

    // This transaction is the commit in harvest -> commit -> move -> mark.
    // A retry before the move is harmless because the admin rows are unique.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start MLS reset transaction: {e}"))?;
    crate::db::persist_legacy_group_admins_conn(&tx, &harvest)?;
    crate::db::clear_discarded_giftwraps_conn(&tx, &pending_wrapper_ids)?;
    put_json_setting(&tx, LOST_GROUPS_KEY, &lost_groups)?;
    put_json_setting(&tx, PENDING_WRAPPERS_KEY, &pending_wrapper_ids)?;
    put_setting(&tx, KEYPACKAGE_REFRESH_KEY, "true")?;
    tx.commit()
        .map_err(|e| format!("Failed to commit MLS reset harvest: {e}"))?;

    archive_store_directory(mls_dir, now)?;
    put_setting(conn, RESET_MARKER_KEY, "complete")?;
    prune_archives(profile_dir, now)?;

    Ok(ResetOutcome {
        reset_performed: true,
        pending_wrapper_ids,
    })
}

pub(crate) fn ensure_store_ready<R: Runtime>(
    handle: &AppHandle<R>,
    account: &str,
    mls_dir: &Path,
    store_path: &Path,
    encryption_key: &[u8; 32],
) -> Result<ResetOutcome, String> {
    let lock = account_lock(account)?;
    let _guard = lock
        .lock()
        .map_err(|_| format!("MLS reset lock poisoned for account {account}"))?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let result = reset_with_connection(&conn, mls_dir, store_path, encryption_key, now);
    crate::account_manager::return_db_connection(conn);
    result
}

fn with_account_connection<R: Runtime, T>(
    handle: &AppHandle<R>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = f(&conn);
    crate::account_manager::return_db_connection(conn);
    result
}

pub(crate) fn keypackage_refresh_required<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<bool, String> {
    with_account_connection(handle, |conn| {
        Ok(setting(conn, KEYPACKAGE_REFRESH_KEY)?.as_deref() == Some("true"))
    })
}

pub(crate) fn mark_keypackage_refreshed<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    with_account_connection(handle, |conn| {
        put_setting(conn, KEYPACKAGE_REFRESH_KEY, "false")
    })
}

pub(crate) fn pending_wrapper_ids<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<String>, String> {
    with_account_connection(handle, |conn| json_setting(conn, PENDING_WRAPPERS_KEY))
}

pub(crate) fn retain_pending_wrapper_ids<R: Runtime>(
    handle: &AppHandle<R>,
    ids: &[String],
) -> Result<(), String> {
    with_account_connection(handle, |conn| {
        put_json_setting(conn, PENDING_WRAPPERS_KEY, &ids)
    })
}

pub(crate) fn lost_group_ids<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<String>, String> {
    with_account_connection(handle, |conn| {
        Ok(json_setting::<LostGroups>(conn, LOST_GROUPS_KEY)?.0)
    })
}

pub(crate) fn is_group_state_lost<R: Runtime>(
    handle: &AppHandle<R>,
    group_id: &str,
) -> Result<bool, String> {
    Ok(lost_group_ids(handle)?.iter().any(|id| id == group_id))
}

pub(crate) fn mark_group_restored<R: Runtime>(
    handle: &AppHandle<R>,
    group_id: &str,
) -> Result<(), String> {
    with_account_connection(handle, |conn| {
        let mut lost = json_setting::<LostGroups>(conn, LOST_GROUPS_KEY)?;
        lost.0.retain(|id| id != group_id);
        put_json_setting(conn, LOST_GROUPS_KEY, &lost)
    })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct MlsStoreResetGroupState {
    pub group_id: String,
    pub state_lost: bool,
    pub admin_npubs: Vec<String>,
    pub single_admin: bool,
}

fn reset_group_states_conn(conn: &Connection) -> Result<Vec<MlsStoreResetGroupState>, String> {
    let lost = json_setting::<LostGroups>(conn, LOST_GROUPS_KEY)?;
    let mut states = Vec::with_capacity(lost.0.len());
    for group_id in lost.0 {
        let mut stmt = conn
            .prepare(
                "SELECT admin_npub FROM mls_legacy_admins WHERE group_id = ?1 ORDER BY admin_npub",
            )
            .map_err(|e| format!("Failed to prepare reset admin query: {e}"))?;
        let admin_npubs = stmt
            .query_map([&group_id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query reset admins: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read reset admins: {e}"))?;
        let single_admin = admin_npubs.len() == 1;
        states.push(MlsStoreResetGroupState {
            group_id,
            state_lost: true,
            admin_npubs,
            single_admin,
        });
    }
    Ok(states)
}

pub(crate) fn reset_group_states<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<MlsStoreResetGroupState>, String> {
    with_account_connection(handle, reset_group_states_conn)
}

pub(crate) fn emit_reset_state<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let groups = reset_group_states(handle)?;
    handle
        .emit("mls_store_reset", groups)
        .map_err(|e| format!("Failed to emit MLS reset state: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "pacto-mls-reset-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn app_db(path: &Path) -> Connection {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE mls_groups (group_id TEXT PRIMARY KEY, engine_group_id TEXT NOT NULL, evicted INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE mls_legacy_admins (group_id TEXT NOT NULL, admin_npub TEXT NOT NULL, harvested_at INTEGER NOT NULL);
             CREATE UNIQUE INDEX idx_mls_legacy_admins_group_admin ON mls_legacy_admins(group_id, admin_npub);
             CREATE TABLE discarded_giftwraps (wrapper_id TEXT PRIMARY KEY);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mls_groups(group_id, engine_group_id, evicted) VALUES ('group-a', 'engine-a', 0)",
            [],
        )
        .unwrap();
        conn
    }

    fn store(path: &Path, version: Option<i64>) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _refinery_schema_history_nostr_mls (version INTEGER);
             CREATE TABLE groups (nostr_group_id TEXT, admin_pubkeys JSONB);
             CREATE TABLE welcomes (wrapper_event_id TEXT, state TEXT);",
        )
        .unwrap();
        if let Some(version) = version {
            conn.execute(
                "INSERT INTO _refinery_schema_history_nostr_mls(version) VALUES (?1)",
                [version],
            )
            .unwrap();
        }
    }

    #[test]
    fn classifies_v104_v5_missing_and_empty_history() {
        let root = temp_dir("classify");
        let v104 = root.join("v104.db");
        let v5 = root.join("v5.db");
        let empty = root.join("empty.db");
        store(&v104, Some(104));
        store(&v5, Some(5));
        store(&empty, None);
        assert_eq!(classify_store(&v104, &[0; 32]), StoreClassification::Legacy);
        assert_eq!(classify_store(&v5, &[0; 32]), StoreClassification::Current);
        assert_eq!(
            classify_store(&root.join("missing.db"), &[0; 32]),
            StoreClassification::Fresh
        );
        assert_eq!(
            classify_store(&empty, &[0; 32]),
            StoreClassification::Legacy
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unopenable_existing_store_is_legacy() {
        let root = temp_dir("unopenable");
        let path = root.join("broken.db");
        std::fs::write(&path, b"not sqlite").unwrap();
        assert_eq!(classify_store(&path, &[0; 32]), StoreClassification::Legacy);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_store_archives_directory_with_wal_and_shm_and_marks_once() {
        let root = temp_dir("archive");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        let db_path = mls.join("vector-mls.db");
        store(&db_path, Some(104));
        std::fs::write(mls.join("vector-mls.db-wal"), b"wal").unwrap();
        std::fs::write(mls.join("vector-mls.db-shm"), b"shm").unwrap();
        let conn = app_db(&root.join("app.db"));

        let outcome = reset_with_connection(&conn, &mls, &db_path, &[0; 32], 1_000_000).unwrap();
        assert!(outcome.reset_performed);
        let archive = root.join("mls.archive.1000000");
        assert!(archive.join("vector-mls.db").exists());
        assert!(archive.join("vector-mls.db-wal").exists());
        assert!(archive.join("vector-mls.db-shm").exists());
        assert!(mls.exists());
        assert!(!db_path.exists());
        assert_eq!(
            setting(&conn, RESET_MARKER_KEY).unwrap().as_deref(),
            Some("complete")
        );

        let second = reset_with_connection(&conn, &mls, &db_path, &[0; 32], 1_000_001).unwrap();
        assert!(!second.reset_performed);
        assert_eq!(
            std::fs::read_dir(&root)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with(ARCHIVE_PREFIX))
                .count(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn current_and_fresh_stores_are_marked_without_archive() {
        for (name, create) in [("current", true), ("fresh", false)] {
            let root = temp_dir(name);
            let mls = root.join("mls");
            std::fs::create_dir_all(&mls).unwrap();
            let db_path = mls.join("vector-mls.db");
            if create {
                store(&db_path, Some(5));
            }
            let conn = app_db(&root.join("app.db"));
            let outcome = reset_with_connection(&conn, &mls, &db_path, &[0; 32], 50).unwrap();
            assert!(!outcome.reset_performed);
            assert!(mls.exists());
            assert!(!root.join("mls.archive.50").exists());
            assert_eq!(
                setting(&conn, RESET_MARKER_KEY).unwrap().as_deref(),
                Some("complete")
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn pruning_removes_old_complete_sets_but_keeps_recent_and_active() {
        let root = temp_dir("prune");
        let active = root.join("mls");
        let old = root.join("mls.archive.1");
        let recent = root.join(format!("mls.archive.{}", ARCHIVE_RETENTION_SECS + 50));
        for path in [&active, &old, &recent] {
            std::fs::create_dir_all(path).unwrap();
            std::fs::write(path.join("vector-mls.db-wal"), b"wal").unwrap();
        }
        prune_archives(&root, ARCHIVE_RETENTION_SECS + 100).unwrap();
        assert!(active.exists());
        assert!(!old.exists());
        assert!(recent.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn harvest_commit_survives_interruption_before_move_and_reentry_is_idempotent() {
        let root = temp_dir("reentry");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        let db_path = mls.join("vector-mls.db");
        store(&db_path, Some(104));
        let conn = app_db(&root.join("app.db"));
        // Simulate the committed app-DB phase with the marker deliberately unset.
        put_json_setting(&conn, LOST_GROUPS_KEY, &LostGroups(vec!["group-a".into()])).unwrap();
        put_setting(&conn, KEYPACKAGE_REFRESH_KEY, "true").unwrap();
        let outcome = reset_with_connection(&conn, &mls, &db_path, &[0; 32], 70).unwrap();
        assert!(outcome.reset_performed);
        assert_eq!(
            json_setting::<LostGroups>(&conn, LOST_GROUPS_KEY)
                .unwrap()
                .0,
            vec!["group-a"]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn encrypted_v5_store_is_current_with_the_session_derived_key() {
        let root = temp_dir("encrypted-current");
        let path = root.join("current.db");
        let key = [7u8; 32];
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(&format!(
            "PRAGMA key = \"x'{}'\";
             CREATE TABLE _refinery_schema_history_nostr_mls (version INTEGER);
             INSERT INTO _refinery_schema_history_nostr_mls(version) VALUES (5);",
            hex::encode(key)
        ))
        .unwrap();
        drop(conn);
        assert_eq!(classify_store(&path, &key), StoreClassification::Current);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_legacy_welcome_is_unsuppressed_and_queued_for_exact_refetch() {
        let root = temp_dir("pending-welcome");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        let store_path = mls.join("vector-mls.db");
        store(&store_path, Some(104));
        let wrapper_bytes = vec![0xabu8; 32];
        let wrapper_id = hex::encode(&wrapper_bytes);
        let legacy = Connection::open(&store_path).unwrap();
        legacy
            .execute(
                "INSERT INTO welcomes(wrapper_event_id, state) VALUES (?1, 'pending')",
                rusqlite::params![wrapper_bytes],
            )
            .unwrap();
        drop(legacy);
        let conn = app_db(&root.join("app.db"));
        conn.execute(
            "INSERT INTO discarded_giftwraps(wrapper_id) VALUES (?1)",
            [&wrapper_id],
        )
        .unwrap();

        let outcome = reset_with_connection(&conn, &mls, &store_path, &[0; 32], 75).unwrap();
        assert_eq!(outcome.pending_wrapper_ids, vec![wrapper_id.clone()]);
        let suppressed: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM discarded_giftwraps WHERE wrapper_id = ?1)",
                [&wrapper_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!suppressed);
        assert_eq!(
            json_setting::<Vec<String>>(&conn, PENDING_WRAPPERS_KEY).unwrap(),
            vec![wrapper_id]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn archive_move_failure_returns_error_without_marker() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("move-failure");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        let store_path = mls.join("vector-mls.db");
        store(&store_path, Some(104));
        let conn = app_db(&root.join("app.db"));
        conn.execute_batch("PRAGMA journal_mode = MEMORY;").unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o500)).unwrap();

        let result = reset_with_connection(&conn, &mls, &store_path, &[0; 32], 77);
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert_ne!(
            setting(&conn, RESET_MARKER_KEY).unwrap().as_deref(),
            Some("complete")
        );
        assert!(store_path.exists());
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn account_lock_serializes_two_callers_to_one_archive() {
        let root = temp_dir("concurrent");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        let store_path = mls.join("vector-mls.db");
        store(&store_path, Some(104));
        let app_path = root.join("app.db");
        drop(app_db(&app_path));
        let barrier = Arc::new(Barrier::new(2));
        let mut joins = Vec::new();
        for _ in 0..2 {
            let mls = mls.clone();
            let store_path = store_path.clone();
            let app_path = app_path.clone();
            let barrier = barrier.clone();
            joins.push(std::thread::spawn(move || {
                barrier.wait();
                let lock = account_lock("npub-concurrent").unwrap();
                let _guard = lock.lock().unwrap();
                let conn = Connection::open(app_path).unwrap();
                reset_with_connection(&conn, &mls, &store_path, &[0; 32], 80).unwrap()
            }));
        }
        let outcomes: Vec<_> = joins.into_iter().map(|j| j.join().unwrap()).collect();
        assert_eq!(outcomes.iter().filter(|o| o.reset_performed).count(), 1);
        assert_eq!(
            std::fs::read_dir(&root)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with(ARCHIVE_PREFIX))
                .count(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reset_state_distinguishes_multiple_single_and_no_admin_records() {
        let root = temp_dir("reset-state");
        let conn = app_db(&root.join("app.db"));
        put_json_setting(
            &conn,
            LOST_GROUPS_KEY,
            &LostGroups(vec!["multi".into(), "single".into(), "missing".into()]),
        )
        .unwrap();
        for (group, admin) in [
            ("multi", "npub-a"),
            ("multi", "npub-b"),
            ("single", "npub-a"),
        ] {
            conn.execute(
                "INSERT INTO mls_legacy_admins(group_id, admin_npub, harvested_at) VALUES (?1, ?2, 1)",
                rusqlite::params![group, admin],
            )
            .unwrap();
        }

        let states = reset_group_states_conn(&conn).unwrap();
        let multi = states
            .iter()
            .find(|state| state.group_id == "multi")
            .unwrap();
        let single = states
            .iter()
            .find(|state| state.group_id == "single")
            .unwrap();
        let missing = states
            .iter()
            .find(|state| state.group_id == "missing")
            .unwrap();
        assert_eq!(multi.admin_npubs, vec!["npub-a", "npub-b"]);
        assert!(!multi.single_admin);
        assert!(single.single_admin);
        assert!(missing.admin_npubs.is_empty());
        assert!(!missing.single_admin);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires MLS_LEGACY_FIXTURE pointing at a copied pre-upgrade mls directory"]
    fn real_legacy_store_copy_archives_with_hot_wal_and_fresh_store_opens() {
        let source =
            PathBuf::from(std::env::var("MLS_LEGACY_FIXTURE").expect("MLS_LEGACY_FIXTURE"));
        let root = temp_dir("real-store");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        for entry in std::fs::read_dir(&source).unwrap() {
            let entry = entry.unwrap();
            if entry.path().is_file() {
                std::fs::copy(entry.path(), mls.join(entry.file_name())).unwrap();
            }
        }
        let store_path = mls.join("vector-mls.db");
        assert!(store_path.exists());

        // Leave genuine uncheckpointed frames beside the copied real database.
        let hot = Connection::open(&store_path).unwrap();
        hot.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS _pacto_reset_gate(value INTEGER);
             INSERT INTO _pacto_reset_gate(value) VALUES (1);",
        )
        .unwrap();
        assert!(mls.join("vector-mls.db-wal").exists());

        let conn = app_db(&root.join("app.db"));
        let key = [11u8; 32];
        let outcome = reset_with_connection(&conn, &mls, &store_path, &key, 90).unwrap();
        assert!(outcome.reset_performed);
        assert!(root.join("mls.archive.90/vector-mls.db-wal").exists());
        drop(hot);

        let storage = mdk_sqlite_storage::MdkSqliteStorage::new_with_key(
            &store_path,
            mdk_sqlite_storage::EncryptionConfig::new(key),
        )
        .unwrap();
        drop(storage);
        assert_eq!(
            classify_store(&store_path, &key),
            StoreClassification::Current
        );
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }
}
