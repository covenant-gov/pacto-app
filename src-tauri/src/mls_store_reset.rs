//! Reset-execution machinery: detects a legacy (pre-0.8.0 MDK) store, harvests
//! its admin/welcome data by direct SQL, archives the legacy directory, and
//! marks the account as reset. `mls_store_reset_state` owns the ongoing
//! read/mutate settings API that the Tauri command layer polls afterward.

use nostr_sdk::ToBech32;
use once_cell::sync::Lazy;
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Runtime};

use crate::mls_store_reset_state::{
    put_json_setting, put_setting, setting, LostGroups, KEYPACKAGE_REFRESH_KEY, LOST_GROUPS_KEY,
    PENDING_WRAPPERS_KEY, RESET_AT_KEY,
};

const RESET_MARKER_KEY: &str = "mls_store_reset_v1";
const ARCHIVE_RETENTION_SECS: u64 = 7 * 24 * 60 * 60;
const ARCHIVE_PREFIX: &str = "mls.archive.";

static ACCOUNT_RESET_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StoreClassification {
    Fresh,
    Current,
    Legacy,
    /// Schema versions outside the known current (1–5) and legacy (≥100) ranges.
    Unsupported(i64),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ResetOutcome {
    pub reset_performed: bool,
    pub pending_wrapper_ids: Vec<String>,
}

fn account_lock(account: &str) -> Result<Arc<Mutex<()>>, String> {
    let mut locks = ACCOUNT_RESET_LOCKS
        .lock()
        .map_err(|_| "MLS reset lock registry poisoned".to_string())?;
    Ok(locks
        .entry(account.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
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
        // Unknown mid-range versions must not be archived or opened as current.
        Some(v) => StoreClassification::Unsupported(v),
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

/// True when `mls_dir` is missing from disk but `profile_dir` still holds an
/// archive from a prior reset. This can only happen if a previous
/// `archive_store_directory` recreate AND its rollback both failed, leaving
/// the legacy data archived with the directory never restored. Treating a
/// missing directory as "fresh" here would silently abandon that archive.
fn mls_dir_missing_with_stale_archive(mls_dir: &Path, profile_dir: &Path) -> bool {
    if mls_dir.exists() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(profile_dir) else {
        return false;
    };
    entries
        .filter_map(Result::ok)
        .any(|entry| entry.path().is_dir() && archive_timestamp(&entry.path()).is_some())
}

// ============================================================================
// Legacy MLS Store Admin/Welcome Harvest
// ============================================================================

/// Direct-SQL harvest of a legacy (pre-0.8.0) MDK store: admin keys per group
/// plus pending welcome wrapper ids. Never opens MDK — the legacy store is
/// plain unencrypted SQLite, so a bare `rusqlite` read-only connection can
/// inspect it before MDK 0.8.0 ever touches the file.
pub(crate) struct LegacyStoreHarvest {
    /// group wire id (lowercase hex of `nostr_group_id`) -> canonical admin npubs
    pub admins_by_group: std::collections::BTreeMap<String, Vec<String>>,
    /// `welcomes.wrapper_event_id` values still `state = 'pending'`, lowercase hex
    pub pending_wrapper_ids: Vec<String>,
}

pub(crate) fn legacy_store_table_exists(conn: &rusqlite::Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        rusqlite::params![name],
        |row| row.get::<_, i32>(0),
    )
    .map(|count| count > 0)
    .unwrap_or(false)
}

/// The legacy `groups.nostr_group_id` / `welcomes.wrapper_event_id` columns are
/// declared TEXT but MDK actually binds them as 32-byte blobs, so SQLite stores
/// them under BLOB storage class regardless of the declared affinity. Accept
/// either: hex-encode a blob directly, or accept a 64-char hex string as a
/// defensive fallback for a row that happens to store it as text.
fn legacy_id_to_hex(value: rusqlite::types::Value) -> Option<String> {
    match value {
        rusqlite::types::Value::Blob(bytes) => Some(hex::encode(bytes)),
        rusqlite::types::Value::Text(text) => {
            let trimmed = text.trim();
            (trimmed.len() == 64 && trimmed.bytes().all(|b| b.is_ascii_hexdigit()))
                .then(|| trimmed.to_lowercase())
        }
        _ => None,
    }
}

/// Parse one legacy `admin_pubkeys` array element into its canonical npub.
/// The legacy column stores hex; the current account is compared as an npub
/// downstream, so an unnormalized value would break that comparison.
fn parse_legacy_admin_pubkey(raw: &str) -> Option<String> {
    let pubkey = nostr_sdk::PublicKey::from_hex(raw)
        .or_else(|_| nostr_sdk::PublicKey::parse(raw))
        .ok()?;
    pubkey.to_bech32().ok()
}

fn harvest_legacy_group_admins(
    conn: &rusqlite::Connection,
) -> std::collections::BTreeMap<String, Vec<String>> {
    let mut out = std::collections::BTreeMap::new();
    let Ok(mut stmt) = conn.prepare("SELECT nostr_group_id, admin_pubkeys FROM groups") else {
        return out;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        let group_id: rusqlite::types::Value = row.get(0)?;
        let admin_json: String = row.get(1)?;
        Ok((group_id, admin_json))
    }) else {
        return out;
    };

    for row in rows {
        let Ok((group_id_value, admin_json)) = row else {
            continue;
        };
        let Some(group_id) = legacy_id_to_hex(group_id_value) else {
            continue;
        };
        // Malformed JSON drops this group's entry without aborting the scan;
        // a well-formed array of non-key strings parses to no admins, which
        // also drops the entry rather than persisting an empty admin list.
        let Ok(raw_keys) = serde_json::from_str::<Vec<String>>(&admin_json) else {
            continue;
        };
        let admins: Vec<String> = raw_keys
            .iter()
            .filter_map(|k| parse_legacy_admin_pubkey(k))
            .collect();
        if !admins.is_empty() {
            out.insert(group_id, admins);
        }
    }
    out
}

fn harvest_legacy_pending_wrapper_ids(conn: &rusqlite::Connection) -> Vec<String> {
    let Ok(mut stmt) =
        conn.prepare("SELECT wrapper_event_id FROM welcomes WHERE state = 'pending'")
    else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, rusqlite::types::Value>(0)) else {
        return Vec::new();
    };
    rows.filter_map(|r| r.ok())
        .filter_map(legacy_id_to_hex)
        .collect()
}

/// Read `groups` and `welcomes` out of a legacy (pre-0.8.0) MDK store by
/// direct SQL. Never opens MDK. Missing/unreadable tables yield an empty
/// harvest (nothing to recover, but the store itself was readable); a store
/// that can't be opened at all is returned as an error so the caller can
/// fail closed instead of treating an I/O failure as "no admins to save".
fn harvest_legacy_mls_store(store_path: &std::path::Path) -> Result<LegacyStoreHarvest, String> {
    let mut harvest = LegacyStoreHarvest {
        admins_by_group: std::collections::BTreeMap::new(),
        pending_wrapper_ids: Vec::new(),
    };

    let conn = rusqlite::Connection::open_with_flags(
        store_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| {
        format!(
            "Failed to open legacy MLS store {}: {e}",
            store_path.display()
        )
    })?;

    if legacy_store_table_exists(&conn, "groups") {
        harvest.admins_by_group = harvest_legacy_group_admins(&conn);
    }
    if legacy_store_table_exists(&conn, "welcomes") {
        harvest.pending_wrapper_ids = harvest_legacy_pending_wrapper_ids(&conn);
    }

    Ok(harvest)
}

pub(crate) fn load_all_legacy_group_admins_conn(
    conn: &rusqlite::Connection,
) -> Result<std::collections::BTreeMap<String, Vec<String>>, String> {
    let mut stmt = conn
        .prepare("SELECT group_id, admin_npub FROM mls_legacy_admins ORDER BY group_id, admin_npub")
        .map_err(|e| format!("Failed to prepare legacy admin scan: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to scan legacy admins: {}", e))?;

    let mut out: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for row in rows {
        let (group_id, admin_npub) =
            row.map_err(|e| format!("Failed to read legacy admin row: {}", e))?;
        out.entry(group_id).or_default().push(admin_npub);
    }
    Ok(out)
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
        // Best-effort: a stuck archive directory (held-open handle, read-only
        // FS) must never block every future MLS engine acquisition.
        if let Err(e) = prune_archives(profile_dir, now) {
            eprintln!("[MLS Reset] Failed to prune archives: {e}");
        }
        return Ok(ResetOutcome::default());
    }

    if mls_dir_missing_with_stale_archive(mls_dir, profile_dir) {
        return Err(format!(
            "MLS directory {} is missing but an archived legacy store exists under {}; refusing to classify as fresh",
            mls_dir.display(),
            profile_dir.display()
        ));
    }

    let classification = classify_store(store_path, encryption_key);
    match classification {
        StoreClassification::Unsupported(version) => {
            return Err(format!(
                "Unsupported MLS store schema version {version}; refusing to open or archive. Expected 1–5 (current) or ≥100 (legacy)."
            ));
        }
        StoreClassification::Fresh | StoreClassification::Current => {
            put_setting(conn, RESET_MARKER_KEY, "complete")?;
            if let Err(e) = prune_archives(profile_dir, now) {
                eprintln!("[MLS Reset] Failed to prune archives: {e}");
            }
            return Ok(ResetOutcome::default());
        }
        StoreClassification::Legacy => {}
    }

    let harvest = harvest_legacy_mls_store(store_path).map_err(|e| {
        format!("Aborting MLS reset: failed to harvest legacy admins before archiving: {e}")
    })?;
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
    put_setting(&tx, RESET_AT_KEY, &now.to_string())?;
    tx.commit()
        .map_err(|e| format!("Failed to commit MLS reset harvest: {e}"))?;

    archive_store_directory(mls_dir, now)?;
    put_setting(conn, RESET_MARKER_KEY, "complete")?;
    // Marker is committed; prune must not fail the first open after a successful reset.
    if let Err(e) = prune_archives(profile_dir, now) {
        eprintln!("[MLS Reset] Failed to prune archives after reset: {e}");
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mls_store_reset_state::json_setting;
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
    fn mid_range_schema_versions_are_unsupported() {
        assert_eq!(
            classify_version(Some(6), true),
            StoreClassification::Unsupported(6)
        );
        assert_eq!(
            classify_version(Some(50), true),
            StoreClassification::Unsupported(50)
        );
        assert_eq!(
            classify_version(Some(99), true),
            StoreClassification::Unsupported(99)
        );
    }

    #[test]
    fn unsupported_schema_version_fails_closed_without_archiving() {
        let root = temp_dir("unsupported");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        let db_path = mls.join("vector-mls.db");
        store(&db_path, Some(50));
        let conn = app_db(&root.join("app.db"));

        let err = reset_with_connection(&conn, &mls, &db_path, &[0; 32], 1_000_000).unwrap_err();
        assert!(err.contains("Unsupported MLS store schema version 50"));
        assert!(db_path.exists(), "must not archive an unsupported store");
        assert!(
            setting(&conn, RESET_MARKER_KEY).unwrap().is_none(),
            "must not mark reset complete for unsupported schema"
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
        assert_eq!(
            setting(&conn, RESET_AT_KEY).unwrap().as_deref(),
            Some("1000000")
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
    fn fast_complete_path_tolerates_prune_failure() {
        let root = temp_dir("fast-path-prune-failure");
        // profile_dir intentionally never created so prune_archives fails to
        // scan it; the fast-complete path must not propagate that error.
        let profile_dir = root.join("missing-profile");
        let mls = profile_dir.join("mls");
        let db_path = mls.join("vector-mls.db");
        let conn = app_db(&root.join("app.db"));
        put_setting(&conn, RESET_MARKER_KEY, "complete").unwrap();

        let outcome = reset_with_connection(&conn, &mls, &db_path, &[0; 32], 5).unwrap();
        assert!(!outcome.reset_performed);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_reset_tolerates_prune_failure_after_marker() {
        let root = temp_dir("legacy-prune-failure");
        let mls = root.join("mls");
        std::fs::create_dir_all(&mls).unwrap();
        let db_path = mls.join("vector-mls.db");
        store(&db_path, Some(104));

        // Aged archive so prune will attempt deletion. Mode 0555 often blocks
        // remove_dir_all for non-root; CI-as-root may still delete it — either
        // outcome is fine as long as reset completes after the marker.
        let sticky = root.join(format!("{ARCHIVE_PREFIX}1"));
        std::fs::create_dir_all(&sticky).unwrap();
        std::fs::write(sticky.join("hold"), b"x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sticky, std::fs::Permissions::from_mode(0o555)).unwrap();
        }

        let conn = app_db(&root.join("app.db"));
        let now = ARCHIVE_RETENTION_SECS + 100;
        let outcome = reset_with_connection(&conn, &mls, &db_path, &[0; 32], now).unwrap();
        assert!(outcome.reset_performed);
        assert_eq!(
            setting(&conn, RESET_MARKER_KEY).unwrap().as_deref(),
            Some("complete")
        );

        #[cfg(unix)]
        if sticky.exists() {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sticky, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_mls_dir_with_stale_archive_fails_closed() {
        let root = temp_dir("stale-archive");
        let mls = root.join("mls");
        let db_path = mls.join("vector-mls.db");
        // Simulate a prior archive whose directory recreate+rollback both
        // failed: an archive exists but `mls` itself is gone.
        let archive = root.join("mls.archive.10");
        std::fs::create_dir_all(&archive).unwrap();
        let conn = app_db(&root.join("app.db"));

        let result = reset_with_connection(&conn, &mls, &db_path, &[0; 32], 20);
        assert!(result.is_err());
        assert_ne!(
            setting(&conn, RESET_MARKER_KEY).unwrap().as_deref(),
            Some("complete"),
            "must not silently reclassify the account as fresh"
        );
        assert!(!mls.exists());
        assert!(archive.exists(), "the stale archive must not be touched");
        std::fs::remove_dir_all(root).unwrap();
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

        // Root bypasses DAC checks, so a read-only parent cannot inject a rename
        // failure there. Probe it and skip rather than assert a false negative.
        if std::fs::write(root.join(".probe"), b"x").is_ok() {
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
            drop(conn);
            std::fs::remove_dir_all(root).unwrap();
            return;
        }

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

    mod legacy_harvest {
        use super::*;

        fn unique_fixture_path(name: &str) -> PathBuf {
            let pid = std::process::id();
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            std::env::temp_dir().join(format!(
                "pacto-legacy-mls-fixture-{}-{}-{}.sqlite",
                name, pid, nanos
            ))
        }

        struct FixtureGroup {
            nostr_group_id: [u8; 32],
            name: &'static str,
            admin_pubkeys_json: String,
        }

        struct FixtureWelcome {
            wrapper_event_id: [u8; 32],
            state: &'static str,
        }

        /// Build a legacy (pre-0.8.0) MDK store fixture stamped at `history_version`,
        /// with `groups`/`welcomes` shaped like MDK rev f46875e. `history_version`
        /// selects the `groups` column set: 100 uses the V100 initial shape
        /// (`group_type`, no image columns); 104+ uses the post-V104 shape
        /// (`group_type` dropped, `image_key`/`image_nonce`/`image_hash` added).
        /// Both `nostr_group_id` and `wrapper_event_id` are written as real BLOBs,
        /// matching the actual on-disk store (the TEXT column declaration lies).
        fn write_legacy_store_fixture(
            path: &Path,
            history_version: i32,
            groups: &[FixtureGroup],
            welcomes: &[FixtureWelcome],
        ) {
            let conn = rusqlite::Connection::open(path).expect("open legacy fixture db");
            conn.execute_batch(
                "CREATE TABLE _refinery_schema_history_nostr_mls (
                    version INTEGER PRIMARY KEY,
                    name VARCHAR(255),
                    applied_on VARCHAR(255),
                    checksum VARCHAR(255)
                );",
            )
            .expect("create legacy history table");
            conn.execute(
                "INSERT INTO _refinery_schema_history_nostr_mls (version, name, applied_on, checksum)
                 VALUES (?1, 'fixture', '2024-01-01T00:00:00Z', 'fixture')",
                rusqlite::params![history_version],
            )
            .expect("stamp legacy history");

            if history_version >= 104 {
                conn.execute_batch(
                    "CREATE TABLE groups (
                        mls_group_id BLOB PRIMARY KEY,
                        nostr_group_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL,
                        admin_pubkeys JSONB NOT NULL,
                        last_message_id BLOB,
                        last_message_at INTEGER,
                        epoch INTEGER NOT NULL,
                        state TEXT NOT NULL,
                        image_key BLOB,
                        image_nonce BLOB,
                        image_hash BLOB
                    );",
                )
                .expect("create v104 groups table");
            } else {
                conn.execute_batch(
                    "CREATE TABLE groups (
                        mls_group_id BLOB PRIMARY KEY,
                        nostr_group_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL,
                        admin_pubkeys JSONB NOT NULL,
                        last_message_id BLOB,
                        last_message_at INTEGER,
                        group_type TEXT NOT NULL,
                        epoch INTEGER NOT NULL,
                        state TEXT NOT NULL
                    );",
                )
                .expect("create v100 groups table");
            }
            conn.execute_batch(
                "CREATE TABLE welcomes (
                    id BLOB PRIMARY KEY,
                    event JSONB NOT NULL,
                    mls_group_id BLOB NOT NULL,
                    nostr_group_id TEXT NOT NULL,
                    group_name TEXT NOT NULL,
                    group_description TEXT NOT NULL,
                    group_admin_pubkeys JSONB NOT NULL,
                    group_relays JSONB NOT NULL,
                    welcomer BLOB NOT NULL,
                    member_count INTEGER NOT NULL,
                    state TEXT NOT NULL,
                    wrapper_event_id BLOB NOT NULL
                );",
            )
            .expect("create welcomes table");

            for (idx, group) in groups.iter().enumerate() {
                let mls_group_id = vec![idx as u8; 32];
                if history_version >= 104 {
                    conn.execute(
                        "INSERT INTO groups (mls_group_id, nostr_group_id, name, description, admin_pubkeys, epoch, state)
                         VALUES (?1, ?2, ?3, '', ?4, 1, 'active')",
                        rusqlite::params![mls_group_id, group.nostr_group_id.to_vec(), group.name, group.admin_pubkeys_json],
                    )
                    .expect("insert v104 group");
                } else {
                    conn.execute(
                        "INSERT INTO groups (mls_group_id, nostr_group_id, name, description, admin_pubkeys, group_type, epoch, state)
                         VALUES (?1, ?2, ?3, '', ?4, 'mls_group', 1, 'active')",
                        rusqlite::params![mls_group_id, group.nostr_group_id.to_vec(), group.name, group.admin_pubkeys_json],
                    )
                    .expect("insert v100 group");
                }
            }

            for (idx, welcome) in welcomes.iter().enumerate() {
                let id = vec![(100 + idx) as u8; 32];
                let mls_group_id = vec![0u8; 32];
                conn.execute(
                    "INSERT INTO welcomes (id, event, mls_group_id, nostr_group_id, group_name, group_description,
                        group_admin_pubkeys, group_relays, welcomer, member_count, state, wrapper_event_id)
                     VALUES (?1, '{}', ?2, ?3, '', '', '[]', '[]', ?4, 1, ?5, ?6)",
                    rusqlite::params![
                        id,
                        mls_group_id,
                        mls_group_id,
                        vec![0u8; 32],
                        welcome.state,
                        welcome.wrapper_event_id.to_vec(),
                    ],
                )
                .expect("insert welcome");
            }
        }

        fn cleanup(path: &Path) {
            let _ = std::fs::remove_file(path);
        }

        #[test]
        fn harvests_two_admins_for_a_known_group() {
            let path = unique_fixture_path("two-admins");
            let keys_a = nostr_sdk::Keys::generate();
            let keys_b = nostr_sdk::Keys::generate();
            let group_id = [0xABu8; 32];
            write_legacy_store_fixture(
                &path,
                104,
                &[FixtureGroup {
                    nostr_group_id: group_id,
                    name: "squad",
                    admin_pubkeys_json: serde_json::to_string(&[
                        keys_a.public_key().to_hex(),
                        keys_b.public_key().to_hex(),
                    ])
                    .unwrap(),
                }],
                &[],
            );

            let harvest = harvest_legacy_mls_store(&path).expect("harvest");
            let group_hex = hex::encode(group_id);
            let admins = harvest
                .admins_by_group
                .get(&group_hex)
                .expect("group present");
            assert_eq!(admins.len(), 2);
            assert!(admins.contains(&keys_a.public_key().to_bech32().unwrap()));
            assert!(admins.contains(&keys_b.public_key().to_bech32().unwrap()));

            cleanup(&path);
        }

        #[test]
        fn harvests_exactly_one_key_when_member_is_sole_admin() {
            let path = unique_fixture_path("sole-admin");
            let keys = nostr_sdk::Keys::generate();
            let group_id = [0x11u8; 32];
            write_legacy_store_fixture(
                &path,
                104,
                &[FixtureGroup {
                    nostr_group_id: group_id,
                    name: "solo",
                    admin_pubkeys_json: serde_json::to_string(&[keys.public_key().to_hex()])
                        .unwrap(),
                }],
                &[],
            );

            let harvest = harvest_legacy_mls_store(&path).expect("harvest");
            let group_hex = hex::encode(group_id);
            assert_eq!(harvest.admins_by_group.len(), 1);
            assert_eq!(
                harvest.admins_by_group[&group_hex],
                vec![keys.public_key().to_bech32().unwrap()]
            );

            cleanup(&path);
        }

        #[test]
        fn harvest_returns_empty_when_groups_table_absent() {
            let path = unique_fixture_path("no-groups-table");
            {
                let conn = rusqlite::Connection::open(&path).expect("open");
                conn.execute_batch("CREATE TABLE unrelated (id INTEGER PRIMARY KEY);")
                    .unwrap();
            }

            let harvest = harvest_legacy_mls_store(&path).expect("harvest");
            assert!(harvest.admins_by_group.is_empty());
            assert!(harvest.pending_wrapper_ids.is_empty());

            cleanup(&path);
        }

        #[test]
        fn harvest_returns_error_when_store_cannot_be_opened() {
            let path = unique_fixture_path("cannot-open");
            assert!(!path.exists());
            assert!(
                harvest_legacy_mls_store(&path).is_err(),
                "a store that can't be opened must surface an error, not an empty harvest"
            );
        }

        #[test]
        fn malformed_admin_pubkeys_json_skips_only_that_group() {
            let path = unique_fixture_path("malformed-json");
            let keys = nostr_sdk::Keys::generate();
            let good_group = [0x22u8; 32];
            let bad_group = [0x33u8; 32];
            let conn = rusqlite::Connection::open(&path).expect("open");
            conn.execute_batch(
                "CREATE TABLE groups (
                    mls_group_id BLOB PRIMARY KEY,
                    nostr_group_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    admin_pubkeys JSONB NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO groups (mls_group_id, nostr_group_id, name, admin_pubkeys) VALUES (?1, ?2, 'good', ?3)",
                rusqlite::params![vec![1u8; 32], good_group.to_vec(), serde_json::to_string(&[keys.public_key().to_hex()]).unwrap()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO groups (mls_group_id, nostr_group_id, name, admin_pubkeys) VALUES (?1, ?2, 'bad', 'not json')",
                rusqlite::params![vec![2u8; 32], bad_group.to_vec()],
            )
            .unwrap();
            drop(conn);

            let harvest = harvest_legacy_mls_store(&path).expect("harvest");
            assert!(harvest
                .admins_by_group
                .contains_key(&hex::encode(good_group)));
            assert!(!harvest
                .admins_by_group
                .contains_key(&hex::encode(bad_group)));

            cleanup(&path);
        }

        #[test]
        fn non_key_string_in_admin_pubkeys_array_drops_only_that_entry() {
            let path = unique_fixture_path("non-key-string");
            let good_group = [0x44u8; 32];
            let junk_group = [0x55u8; 32];
            let keys = nostr_sdk::Keys::generate();
            write_legacy_store_fixture(
                &path,
                104,
                &[
                    FixtureGroup {
                        nostr_group_id: good_group,
                        name: "good",
                        admin_pubkeys_json: serde_json::to_string(&[keys.public_key().to_hex()])
                            .unwrap(),
                    },
                    FixtureGroup {
                        nostr_group_id: junk_group,
                        name: "junk",
                        admin_pubkeys_json: serde_json::to_string(&["not-a-pubkey"]).unwrap(),
                    },
                ],
                &[],
            );

            let harvest = harvest_legacy_mls_store(&path).expect("harvest");
            assert!(harvest
                .admins_by_group
                .contains_key(&hex::encode(good_group)));
            assert!(
                !harvest
                    .admins_by_group
                    .contains_key(&hex::encode(junk_group)),
                "an entry whose only admin key is unparseable must persist nothing"
            );

            cleanup(&path);
        }

        #[test]
        fn v104_fixture_returns_same_fields_as_v100_fixture() {
            let keys = nostr_sdk::Keys::generate();
            let group_id = [0x66u8; 32];
            let admin_json = serde_json::to_string(&[keys.public_key().to_hex()]).unwrap();

            let path_v100 = unique_fixture_path("v100");
            write_legacy_store_fixture(
                &path_v100,
                100,
                &[FixtureGroup {
                    nostr_group_id: group_id,
                    name: "g",
                    admin_pubkeys_json: admin_json.clone(),
                }],
                &[],
            );
            let path_v104 = unique_fixture_path("v104");
            write_legacy_store_fixture(
                &path_v104,
                104,
                &[FixtureGroup {
                    nostr_group_id: group_id,
                    name: "g",
                    admin_pubkeys_json: admin_json,
                }],
                &[],
            );

            let harvest_v100 = harvest_legacy_mls_store(&path_v100).expect("harvest v100");
            let harvest_v104 = harvest_legacy_mls_store(&path_v104).expect("harvest v104");
            assert_eq!(harvest_v100.admins_by_group, harvest_v104.admins_by_group);

            cleanup(&path_v100);
            cleanup(&path_v104);
        }

        #[test]
        fn pending_wrapper_ids_are_returned_but_accepted_are_not() {
            let path = unique_fixture_path("pending-welcomes");
            let pending_id = [0x77u8; 32];
            let accepted_id_a = [0x78u8; 32];
            let accepted_id_b = [0x79u8; 32];
            write_legacy_store_fixture(
                &path,
                104,
                &[],
                &[
                    FixtureWelcome {
                        wrapper_event_id: pending_id,
                        state: "pending",
                    },
                    FixtureWelcome {
                        wrapper_event_id: accepted_id_a,
                        state: "accepted",
                    },
                    FixtureWelcome {
                        wrapper_event_id: accepted_id_b,
                        state: "accepted",
                    },
                ],
            );

            let harvest = harvest_legacy_mls_store(&path).expect("harvest");
            assert_eq!(harvest.pending_wrapper_ids, vec![hex::encode(pending_id)]);

            cleanup(&path);
        }
    }
}
