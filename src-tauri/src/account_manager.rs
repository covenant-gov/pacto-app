use lazy_static::lazy_static;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Runtime};

lazy_static! {
    /// Global state tracking the currently active account (npub)
    static ref CURRENT_ACCOUNT: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));

    /// Pending account waiting for encryption (npub stored before database creation)
    static ref PENDING_ACCOUNT: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));

    /// Persistent database connection pool (one per account)
    /// Keeps connection open to avoid repeated open/close overhead
    static ref DB_CONNECTION_POOL: Arc<Mutex<Option<(String, rusqlite::Connection)>>> =
        Arc::new(Mutex::new(None));
}

/// Get the profile directory for a given npub (full npub, no truncation)
///
/// Returns: AppData/npub1qwertyuiop.../
pub fn get_profile_directory<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
) -> Result<PathBuf, String> {
    let app_data = crate::test_sandbox::test_data_dir(handle)
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Validate npub format
    if !npub.starts_with("npub1") {
        return Err(format!("Invalid npub format: {}", npub));
    }

    // Use full npub as directory name
    let profile_dir = app_data.join(npub);

    // Create directory if it doesn't exist
    if !profile_dir.exists() {
        std::fs::create_dir_all(&profile_dir)
            .map_err(|e| format!("Failed to create profile directory: {}", e))?;
        println!(
            "[Account Manager] Created profile directory: {}",
            profile_dir.display()
        );
    }

    Ok(profile_dir)
}

/// Get the database path for a given npub
///
/// Returns: AppData/npub1qwerty.../vector.db
pub fn get_database_path<R: Runtime>(handle: &AppHandle<R>, npub: &str) -> Result<PathBuf, String> {
    let profile_dir = get_profile_directory(handle, npub)?;
    Ok(profile_dir.join("vector.db"))
}

/// Get the MLS directory for a given npub
///
/// Returns: AppData/npub1qwerty.../mls/
pub fn get_mls_directory<R: Runtime>(handle: &AppHandle<R>, npub: &str) -> Result<PathBuf, String> {
    let profile_dir = get_profile_directory(handle, npub)?;
    let mls_dir = profile_dir.join("mls");

    if !mls_dir.exists() {
        std::fs::create_dir_all(&mls_dir)
            .map_err(|e| format!("Failed to create MLS directory: {}", e))?;
        println!(
            "[Account Manager] Created MLS directory: {}",
            mls_dir.display()
        );
    }

    Ok(mls_dir)
}

/// List all existing accounts by scanning directories, most-recently-used first
///
/// Returns: Vec of full npubs that have valid pkeys (not just directories),
/// ordered by each account's database mtime (most recent first) so callers
/// that auto-select `accounts[0]` (see `auto_select_account`) deterministically
/// reopen the last-used account instead of an arbitrary one from OS
/// directory-enumeration order.
///
/// Also cleans up invalid account directories without pkeys. The current and
/// pending account are never deleted by this cleanup (a directory mid-creation
/// has no pkey yet), but -- unlike cleanup -- they are still validated and
/// included in the returned list like any other account; otherwise the very
/// act of auto-selecting an account at startup makes `list_accounts` (and by
/// extension `has_any_account`/`check_any_account_exists`) blind to it on the
/// next call, which the frontend reads as "no account exists".
pub fn list_accounts<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<String>, String> {
    let app_data = crate::test_sandbox::test_data_dir(handle)
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let current = get_current_account().ok();
    let pending = get_pending_account().ok().flatten();

    let mut accounts: Vec<(String, std::time::SystemTime)> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(app_data) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    // Check if it looks like an npub directory
                    if name.starts_with("npub1") {
                        let in_flight =
                            is_in_flight_account(name, current.as_deref(), pending.as_deref());
                        let format =
                            crate::storage_format::classify_database(&entry.path().join("vector.db"));
                        let has_pkey = account_has_valid_pkey(handle, name);
                        match classify_account_scan(&has_pkey, in_flight, format) {
                            AccountScanVerdict::Include => {
                                let last_used = get_database_path(handle, name)
                                    .ok()
                                    .and_then(|p| std::fs::metadata(p).ok())
                                    .and_then(|m| m.modified().ok())
                                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                                accounts.push((name.to_string(), last_used));
                            }
                            AccountScanVerdict::Delete => {
                                let invalid_dir = entry.path();
                                if let Err(e) = std::fs::remove_dir_all(&invalid_dir) {
                                    eprintln!("[Account Manager] Failed to remove invalid account directory {}: {}", invalid_dir.display(), e);
                                } else {
                                    println!("[Account Manager] Cleaned up invalid account directory: {}", invalid_dir.display());
                                }
                            }
                            AccountScanVerdict::Skip => {}
                        }
                    }
                }
            }
        }
    }

    accounts.sort_by_key(|(_, last_used)| std::cmp::Reverse(*last_used));

    Ok(accounts.into_iter().map(|(npub, _)| npub).collect())
}

/// Whether `name` is the current or pending account and must be skipped by the
/// orphan-directory cleanup in `list_accounts`, regardless of whether it has a
/// pkey yet (account creation writes the directory/database before the pkey).
fn is_in_flight_account(name: &str, current: Option<&str>, pending: Option<&str>) -> bool {
    current == Some(name) || pending == Some(name)
}

/// Check if an account has a valid pkey in its database.
///
/// Returns `Ok(false)` only when the database opened successfully and the
/// query definitively found no (or an empty) `pkey` row -- the legitimate
/// "account setup never finished" case that `list_accounts` should clean up.
/// Any other failure (locked/busy database, transient I/O error, mid-write
/// schema state) returns `Err` so the caller treats validity as unknown and
/// leaves the directory alone, instead of deleting a possibly-valid account
/// because a query happened to fail for an unrelated reason.
fn account_has_valid_pkey<R: Runtime>(handle: &AppHandle<R>, npub: &str) -> Result<bool, String> {
    // Try to get database connection for this account
    let db_path = get_database_path(handle, npub)?;

    // Check if database file exists
    if !db_path.exists() {
        return Ok(false);
    }

    // Try to open database connection
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    // Wait out transient locks from the main pooled connection instead of
    // failing the read immediately, which would otherwise look identical to
    // "no pkey" below.
    conn.busy_timeout(std::time::Duration::from_millis(2000))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    // Check if the pkey exists in settings table and is not empty
    classify_pkey_query_result(conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params!["pkey"],
        |row| row.get::<_, String>(0),
    ))
}

/// Turn a `pkey` settings-row lookup into a validity verdict. `Ok(false)` means
/// the query ran and definitively found no (or an empty) pkey -- safe to treat
/// as an unfinished/orphaned account. Any other error (locked database,
/// transient I/O failure, mid-write schema state) is `Err`, so the caller
/// leaves the directory alone rather than deleting a possibly-valid account.
fn classify_pkey_query_result(result: Result<String, rusqlite::Error>) -> Result<bool, String> {
    match result {
        Ok(value) => Ok(!value.is_empty()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(format!("Failed to query pkey setting: {}", e)),
    }
}

/// Three-way verdict for a single directory scanned by `list_accounts`,
/// derived purely from `account_has_valid_pkey`'s result, whether the
/// directory is the current or pending account, and the profile's
/// `crate::storage_format::StorageFormatVerdict`.
///
/// A valid pkey always means `Include`, even while in-flight: in-flight only
/// protects a directory with *no* pkey yet (mid-creation) from cleanup, it
/// never excludes a directory that already has one. Treating in-flight as a
/// reason to skip a valid pkey was exactly the bug that blanked the Create
/// Account screen -- it left a fully valid current/pending account out of
/// the list `list_accounts` returns.
///
/// A query `Err` (locked/busy database, transient I/O error, mid-write
/// schema state) always means `Skip`: validity is unknown, so the caller
/// leaves the directory alone rather than guessing and possibly deleting a
/// live account.
///
/// An `Unrecognized` or `Divergent` format verdict is never `Delete`,
/// regardless of what the pkey probe found: that schema shape means a
/// *newer* build wrote (or is writing) this database, not that account
/// setup was abandoned. Deleting it would be unrecoverable data loss for a
/// profile this build simply doesn't understand yet -- unlike a genuinely
/// orphaned `Recognized`-format profile, which this build can fully read
/// and confidently judge as pkey-less.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum AccountScanVerdict {
    /// Valid pkey found; the account belongs in the returned list.
    Include,
    /// No pkey and not in-flight; safe to clean up the orphaned directory.
    Delete,
    /// In-flight with no pkey yet, pkey validity is unknown, or the format
    /// is unrecognized/divergent; leave alone.
    Skip,
}

/// Combine `account_has_valid_pkey`'s result, in-flight status, and the
/// profile's storage-format verdict into a scan verdict. See
/// `AccountScanVerdict` for the policy this encodes.
fn classify_account_scan(
    has_pkey: &Result<bool, String>,
    in_flight: bool,
    format: crate::storage_format::StorageFormatVerdict,
) -> AccountScanVerdict {
    if matches!(
        format,
        crate::storage_format::StorageFormatVerdict::Unrecognized(_)
            | crate::storage_format::StorageFormatVerdict::Divergent(_)
    ) {
        // A newer build may have written this schema; only a confirmed
        // valid pkey overrides the exemption, never Ok(false) or Err.
        return match has_pkey {
            Ok(true) => AccountScanVerdict::Include,
            _ => AccountScanVerdict::Skip,
        };
    }

    match (has_pkey, in_flight) {
        (Ok(true), _) => AccountScanVerdict::Include,
        (Ok(false), false) => AccountScanVerdict::Delete,
        (Ok(false), true) => AccountScanVerdict::Skip,
        (Err(_), _) => AccountScanVerdict::Skip,
    }
}

/// Check if any account exists. If exactly one account exists and none is selected, selects it
/// so that get_pkey/hasStoredKey works after logout-without-restart.
pub fn has_any_account<R: Runtime>(handle: &AppHandle<R>) -> bool {
    let sql_accounts = list_accounts(handle).unwrap_or_default();
    if !sql_accounts.is_empty() && get_current_account().is_err() {
        let _ = set_current_account(sql_accounts[0].clone());
    }
    !sql_accounts.is_empty()
}

/// Get the currently active account
#[tauri::command]
pub fn get_current_account() -> Result<String, String> {
    CURRENT_ACCOUNT
        .read()
        .map_err(|e| format!("Failed to read current account: {}", e))?
        .clone()
        .ok_or_else(|| "No account selected".to_string())
}

/// Auto-select the first available account if none is currently selected
/// This is useful when an account exists but isn't selected yet
pub fn auto_select_account<R: Runtime>(handle: &AppHandle<R>) -> Result<Option<String>, String> {
    // Check if an account is already selected
    if let Ok(current) = get_current_account() {
        return Ok(Some(current));
    }

    // No account selected, try to find one
    let accounts = list_accounts(handle)?;

    if accounts.is_empty() {
        return Ok(None);
    }

    // Select the first account
    let first_account = accounts[0].clone();
    set_current_account(first_account.clone())?;

    Ok(Some(first_account))
}

/// Set the currently active account
pub fn set_current_account(npub: String) -> Result<(), String> {
    *CURRENT_ACCOUNT
        .write()
        .map_err(|e| format!("Failed to write current account: {}", e))? = Some(npub.clone());

    // Close old connection when switching accounts
    close_db_connection();

    Ok(())
}

/// Clear the current account (e.g. on logout)
pub fn clear_current_account() -> Result<(), String> {
    *CURRENT_ACCOUNT
        .write()
        .map_err(|e| format!("Failed to write current account: {}", e))? = None;
    Ok(())
}

/// Set a pending account (before database creation)
pub fn set_pending_account(npub: String) -> Result<(), String> {
    *PENDING_ACCOUNT
        .write()
        .map_err(|e| format!("Failed to write pending account: {}", e))? = Some(npub);
    Ok(())
}

/// Get the pending account (if any)
pub fn get_pending_account() -> Result<Option<String>, String> {
    Ok(PENDING_ACCOUNT
        .read()
        .map_err(|e| format!("Failed to read pending account: {}", e))?
        .clone())
}

/// Clear the pending account
pub fn clear_pending_account() -> Result<(), String> {
    *PENDING_ACCOUNT
        .write()
        .map_err(|e| format!("Failed to clear pending account: {}", e))? = None;
    Ok(())
}

/// Get or reuse database connection for the current account
/// This keeps the connection open to avoid repeated open/close overhead
pub fn get_db_connection<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<rusqlite::Connection, String> {
    let npub = get_current_account()?;

    // Try to reuse existing connection
    let mut pool = DB_CONNECTION_POOL.lock().unwrap();

    if let Some((cached_npub, _)) = pool.as_ref() {
        if cached_npub == &npub {
            // Same account, take the connection out
            if let Some((_, conn)) = pool.take() {
                return Ok(conn);
            }
        } else {
            // Different account, close old connection
            *pool = None;
        }
    }

    // Open new connection
    let db_path = get_database_path(handle, &npub)?;
    let mut conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    // Enable WAL mode for better concurrency
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    // Run migrations to ensure schema is up to date
    // This is important for existing databases that may not have new columns
    crate::migrations::run_migrations(&mut conn)?;

    // One-time repair for reaction rows persisted before the author_id hex/bech32
    // fix (pacto-app-rmq.2); idempotent, no-op after the first successful run.
    if let Err(e) = crate::db::repair_legacy_hex_reaction_npubs(&conn) {
        eprintln!(
            "[Account Manager] Failed to repair legacy reaction npubs: {}",
            e
        );
    }

    Ok(conn)
}

/// Return connection to the pool for reuse
pub fn return_db_connection(conn: rusqlite::Connection) {
    if let Ok(npub) = get_current_account() {
        let mut pool = DB_CONNECTION_POOL.lock().unwrap();
        *pool = Some((npub, conn));
    }
}

/// Close the current database connection (e.g., when switching accounts)
pub fn close_db_connection() {
    let mut pool = DB_CONNECTION_POOL.lock().unwrap();
    *pool = None;
}

/// List all accounts (Tauri command)
#[tauri::command]
pub fn list_all_accounts<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<String>, String> {
    list_accounts(&handle)
}

/// Check if any account exists - Tauri command
#[tauri::command]
pub fn check_any_account_exists<R: Runtime>(handle: AppHandle<R>) -> bool {
    has_any_account(&handle)
}

/// Initialize SQL database for a specific profile
/// Creates all tables if they don't exist
pub async fn init_profile_database<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
) -> Result<(), String> {
    let db_path = get_database_path(handle, npub)?;
    println!(
        "[Account Manager] Initializing database: {}",
        db_path.display()
    );

    // Create the database directory if it doesn't exist
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create database directory: {}", e))?;
    }

    // Open connection and create schema
    let mut conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    // Run migrations (schema creation for new accounts, incremental migrations for existing ones)
    crate::migrations::run_migrations(&mut conn)
        .map_err(|e| format!("Failed to run database migrations: {}", e))?;

    println!("[Account Manager] Database schema created successfully");

    Ok(())
}

/// One `pacto_gov` infra row per parent: drop older duplicates, then enforce at the schema level.
/// Singleton writes use a deterministic row id (`pacto-gov-{parent}`), so `ON CONFLICT(id)` upserts
/// keep working; a second `pacto_gov` row with a different id is rejected instead of silently forking state.

/// Run database migrations for schema updates
/// This handles adding new columns to existing tables

/// Migration 4: Copy attachment metadata from messages table into event tags
/// This completes the migration to fully self-contained events

/// Migrate existing messages from the old nested format to the flat events table
/// This extracts reactions and attachments as separate event rows

/// Switch to a different account
#[tauri::command]
pub async fn switch_account<R: Runtime>(handle: AppHandle<R>, npub: String) -> Result<(), String> {
    // Validate npub
    if !npub.starts_with("npub1") {
        return Err(format!("Invalid npub format: {}", npub));
    }

    println!("[Account Manager] Switching to account: {}", npub);

    // Initialize database for this profile
    init_profile_database(&handle, &npub).await?;

    // Update current account
    set_current_account(npub.clone())?;

    // Clear old account's ID caches and preload new account's caches
    crate::db::clear_id_caches();
    if let Err(e) = crate::db::preload_id_caches(&handle).await {
        eprintln!("[Account Manager] Failed to preload ID caches: {}", e);
    }

    // Update MLS directory
    let mls_dir = get_mls_directory(&handle, &npub)?;
    println!("[Account Manager] MLS directory: {}", mls_dir.display());

    // TODO: Update MLS configuration to use new directory
    // This will be done when we update the MLS module

    Ok(())
}

#[cfg(test)]
mod is_in_flight_account_tests {
    use super::*;

    /// Regression test for a race where the boot-time `list_accounts` scan
    /// (invoked by the login screen's `check_any_account_exists`) deleted an
    /// account's directory while it was still mid-creation — the directory
    /// exists with a fresh, pkey-less database at that point. `list_accounts`
    /// must never treat the current or pending account as an orphan.
    ///
    /// This tests the pure predicate directly rather than the full
    /// `list_accounts` scan: that function reads real global statics
    /// (`CURRENT_ACCOUNT`/`PENDING_ACCOUNT`) and the shared OS app-data
    /// directory, both of which are mutated concurrently by every other test
    /// in this file's `#[tokio::test]` suite.
    #[test]
    fn protects_current_and_pending_independently() {
        let current = "npub1current";
        let pending = "npub1pending";
        let orphan = "npub1orphan";

        // Logged into `current` while a second account `pending` is mid-creation
        // (e.g. "add account" while already signed in) — both must be protected.
        assert!(is_in_flight_account(current, Some(current), Some(pending)));
        assert!(is_in_flight_account(pending, Some(current), Some(pending)));
        assert!(!is_in_flight_account(orphan, Some(current), Some(pending)));

        // No account logged in yet; only a pending fixture/first-run account exists.
        assert!(is_in_flight_account(pending, None, Some(pending)));
        assert!(!is_in_flight_account(orphan, None, Some(pending)));

        // Steady state: no pending creation in flight.
        assert!(is_in_flight_account(current, Some(current), None));
        assert!(!is_in_flight_account(orphan, Some(current), None));
        assert!(!is_in_flight_account(orphan, None, None));
    }
}

#[cfg(test)]
mod classify_pkey_query_result_tests {
    use super::*;

    /// Regression test for a bug where the boot-time `list_accounts` scan
    /// deleted a fully valid, previously-completed account's directory
    /// because a transient DB error (lock contention, disk I/O hiccup) was
    /// swallowed by `.ok()` and treated identically to "no pkey exists yet".
    /// Only a definitive "no rows" result may be treated as invalid/deletable;
    /// every other error must propagate so the caller leaves the directory
    /// alone instead of deleting a live account.
    #[test]
    fn only_definitive_no_rows_is_treated_as_invalid() {
        assert_eq!(
            classify_pkey_query_result(Ok("nsec1somekey".to_string())),
            Ok(true)
        );
        assert_eq!(classify_pkey_query_result(Ok(String::new())), Ok(false));
        assert_eq!(
            classify_pkey_query_result(Err(rusqlite::Error::QueryReturnedNoRows)),
            Ok(false)
        );

        // A locked/busy database, disk error, or any other query failure must
        // NOT be treated as "no pkey" -- it must surface as Err so the caller
        // skips deletion rather than wiping a possibly-valid account.
        let transient_failure =
            rusqlite::Error::InvalidColumnType(0, "value".to_string(), rusqlite::types::Type::Null);
        assert!(classify_pkey_query_result(Err(transient_failure)).is_err());
    }
}

#[cfg(test)]
mod account_scan_verdict_tests {
    use super::*;
    use crate::storage_format::StorageFormatVerdict;

    /// Regression guard for the bug that blanked the Create Account screen:
    /// an early `continue` on in-flight accounts skipped them even when they
    /// already had a valid pkey, so the current/pending account vanished
    /// from `list_accounts`'s return value right after being created. The
    /// in-flight flag must only ever protect a *missing* pkey from cleanup
    /// -- it must never exclude an account that already has a valid one.
    #[test]
    fn valid_pkey_is_always_included_even_while_in_flight() {
        assert_eq!(
            classify_account_scan(&Ok(true), true, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Include
        );
        assert_eq!(
            classify_account_scan(&Ok(true), false, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Include
        );
    }

    #[test]
    fn missing_pkey_and_not_in_flight_is_deleted() {
        assert_eq!(
            classify_account_scan(&Ok(false), false, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Delete
        );
    }

    #[test]
    fn missing_pkey_while_in_flight_is_skipped() {
        assert_eq!(
            classify_account_scan(&Ok(false), true, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Skip
        );
    }

    #[test]
    fn query_error_is_always_skipped() {
        let err = Err("locked database".to_string());
        assert_eq!(
            classify_account_scan(&err, true, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Skip
        );
        assert_eq!(
            classify_account_scan(&err, false, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Skip
        );
    }

    // -- unrecognized/divergent format exemption --------------------------
    //
    // A newer build may have written an unrecognized or divergent schema;
    // this build cannot tell an abandoned setup from live data it simply
    // doesn't understand, so it must never delete on that basis alone.

    #[test]
    fn unrecognized_format_is_skipped_not_deleted() {
        assert_eq!(
            classify_account_scan(&Ok(false), false, StorageFormatVerdict::Unrecognized(9)),
            AccountScanVerdict::Skip
        );
    }

    #[test]
    fn divergent_format_is_skipped_not_deleted() {
        assert_eq!(
            classify_account_scan(&Ok(false), false, StorageFormatVerdict::Divergent(9)),
            AccountScanVerdict::Skip
        );
    }

    #[test]
    fn unrecognized_format_with_pkey_query_error_is_skipped() {
        let err = Err("locked database".to_string());
        assert_eq!(
            classify_account_scan(&err, false, StorageFormatVerdict::Unrecognized(9)),
            AccountScanVerdict::Skip
        );
    }

    #[test]
    fn unrecognized_format_with_valid_pkey_is_still_included() {
        assert_eq!(
            classify_account_scan(&Ok(true), false, StorageFormatVerdict::Unrecognized(9)),
            AccountScanVerdict::Include
        );
    }

    #[test]
    fn recognized_format_not_in_flight_is_still_deleted() {
        assert_eq!(
            classify_account_scan(&Ok(false), false, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Delete
        );
    }

    #[test]
    fn recognized_format_in_flight_is_still_skipped() {
        assert_eq!(
            classify_account_scan(&Ok(false), true, StorageFormatVerdict::Recognized),
            AccountScanVerdict::Skip
        );
    }
}

#[cfg(test)]
mod list_accounts_orphan_exemption_tests {
    use super::*;
    use crate::storage_format::StorageFormatVerdict;

    /// Integration regression test for the data-loss bug this unit fixes:
    /// `list_accounts`'s orphan-directory cleanup must never delete a
    /// profile whose database a newer build wrote (unrecognized schema),
    /// even though this build reads no pkey from it -- the same condition
    /// that, before the fix, would have looked identical to a genuinely
    /// abandoned account setup and been deleted.
    #[test]
    fn unrecognized_format_profile_survives_list_accounts_scan() {
        let app = tauri::test::mock_app();
        let handle = app.handle();
        let npub = "npub1u3orphanexemptionintegration";

        let profile_dir = get_profile_directory(handle, npub).unwrap();
        let db_path = profile_dir.join("vector.db");

        {
            let mut conn = rusqlite::Connection::open(&db_path).unwrap();
            crate::migrations::run_migrations(&mut conn).unwrap();
        }
        // No pkey row is ever written to `settings`, matching an
        // in-progress or future-format account this build cannot read.
        let above_ceiling = crate::migrations::embedded_ceiling() + 1;
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO refinery_schema_history (version, name, applied_on, checksum) \
                 VALUES (?1, 'future_migration', '2026-01-01T00:00:00Z', 'deadbeef')",
                rusqlite::params![above_ceiling],
            )
            .unwrap();
        }
        assert_eq!(
            crate::storage_format::classify_database(&db_path),
            StorageFormatVerdict::Unrecognized(above_ceiling)
        );

        let _ = list_accounts(handle);

        assert!(
            profile_dir.exists(),
            "an unrecognized-format profile must never be deleted by list_accounts"
        );

        let _ = std::fs::remove_dir_all(&profile_dir);
    }
}
