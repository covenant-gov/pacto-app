use std::path::PathBuf;
use std::sync::{Arc, RwLock, Mutex};
use lazy_static::lazy_static;
use tauri::{AppHandle, Runtime, Manager};

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
    npub: &str
) -> Result<PathBuf, String> {
    let app_data = handle.path().app_data_dir()
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
        println!("[Account Manager] Created profile directory: {}", profile_dir.display());
    }

    Ok(profile_dir)
}

/// Get the database path for a given npub
///
/// Returns: AppData/npub1qwerty.../vector.db
pub fn get_database_path<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str
) -> Result<PathBuf, String> {
    let profile_dir = get_profile_directory(handle, npub)?;
    Ok(profile_dir.join("vector.db"))
}

/// Get the MLS directory for a given npub
///
/// Returns: AppData/npub1qwerty.../mls/
pub fn get_mls_directory<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str
) -> Result<PathBuf, String> {
    let profile_dir = get_profile_directory(handle, npub)?;
    let mls_dir = profile_dir.join("mls");

    if !mls_dir.exists() {
        std::fs::create_dir_all(&mls_dir)
            .map_err(|e| format!("Failed to create MLS directory: {}", e))?;
        println!("[Account Manager] Created MLS directory: {}", mls_dir.display());
    }

    Ok(mls_dir)
}

/// List all existing accounts by scanning directories
///
/// Returns: Vec of full npubs that have valid pkeys (not just directories)
/// Also cleans up invalid account directories without pkeys
pub fn list_accounts<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<String>, String> {
    let app_data = handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let mut accounts = Vec::new();

    if let Ok(entries) = std::fs::read_dir(app_data) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    // Check if it looks like an npub directory
                    if name.starts_with("npub1") {
                        // Validate that this account has a valid pkey in its database
                        if let Ok(has_pkey) = account_has_valid_pkey(handle, name) {
                            if has_pkey {
                                accounts.push(name.to_string());
                            } else {
                                // Clean up invalid account directory
                                let invalid_dir = entry.path();
                                if let Err(e) = std::fs::remove_dir_all(&invalid_dir) {
                                    eprintln!("[Account Manager] Failed to remove invalid account directory {}: {}", invalid_dir.display(), e);
                                } else {
                                    println!("[Account Manager] Cleaned up invalid account directory: {}", invalid_dir.display());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(accounts)
}

/// Check if an account has a valid pkey in its database
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

    // Check if the pkey exists in settings table and is not empty
    let result: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params!["pkey"],
        |row| row.get(0)
    ).ok();

    Ok(result.map(|s| !s.is_empty()).unwrap_or(false))
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
    CURRENT_ACCOUNT.read()
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
    *CURRENT_ACCOUNT.write()
        .map_err(|e| format!("Failed to write current account: {}", e))? = Some(npub.clone());

    // Close old connection when switching accounts
    close_db_connection();

    Ok(())
}

/// Clear the current account (e.g. on logout)
pub fn clear_current_account() -> Result<(), String> {
    *CURRENT_ACCOUNT.write()
        .map_err(|e| format!("Failed to write current account: {}", e))? = None;
    Ok(())
}

/// Set a pending account (before database creation)
pub fn set_pending_account(npub: String) -> Result<(), String> {
    *PENDING_ACCOUNT.write()
        .map_err(|e| format!("Failed to write pending account: {}", e))? = Some(npub);
    Ok(())
}

/// Get the pending account (if any)
pub fn get_pending_account() -> Result<Option<String>, String> {
    Ok(PENDING_ACCOUNT.read()
        .map_err(|e| format!("Failed to read pending account: {}", e))?
        .clone())
}

/// Clear the pending account
pub fn clear_pending_account() -> Result<(), String> {
    *PENDING_ACCOUNT.write()
        .map_err(|e| format!("Failed to clear pending account: {}", e))? = None;
    Ok(())
}

/// Get or reuse database connection for the current account
/// This keeps the connection open to avoid repeated open/close overhead
pub fn get_db_connection<R: Runtime>(handle: &AppHandle<R>) -> Result<rusqlite::Connection, String> {
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
    npub: &str
) -> Result<(), String> {
    let db_path = get_database_path(handle, npub)?;
    println!("[Account Manager] Initializing database: {}", db_path.display());

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
pub async fn switch_account<R: Runtime>(
    handle: AppHandle<R>,
    npub: String
) -> Result<(), String> {
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
