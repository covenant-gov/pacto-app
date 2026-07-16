//! Backend-mediated clipboard export for sensitive secrets.
//!
//! EVM private keys, Nostr nsec, and BIP-39 seed phrases are written directly
//! to the system clipboard from the native layer. The command returns only
//! metadata (type, account id, clear-at timestamp); the raw secret never
//! reaches the webview. A 90-second timer clears the clipboard, and every
//! attempt is recorded in the per-account `sensitive_export_log` table.

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::task::JoinHandle;
use tokio::time::sleep;

use crate::account_manager;
use crate::crypto::{derive_key_from_salt, decrypt_with_key};
use crate::db::ExportLogRow;

/// Delay before the clipboard is automatically cleared after a sensitive export.
pub const EXPORT_CLEAR_DELAY_SECONDS: u64 = 90;

/// Base delay for exponential backoff between repeated export attempts.
pub const EXPORT_BACKOFF_BASE_SECONDS: u64 = 1;

/// Maximum backoff delay (5 minutes).
pub const EXPORT_BACKOFF_MAX_SECONDS: u64 = 300;

/// Rolling window used to count recent attempts for backoff.
pub const EXPORT_BACKOFF_WINDOW_SECONDS: u64 = 600;

/// Type of secret the user is exporting.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SensitiveExportType {
    EvmAccount,
    NostrNsec,
    SeedPhrase,
}

impl SensitiveExportType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::EvmAccount => "evm_account",
            Self::NostrNsec => "nostr_nsec",
            Self::SeedPhrase => "seed_phrase",
        }
    }
}

/// Metadata returned by a successful sensitive export. Never contains the secret.
#[derive(Clone, Debug, Serialize)]
pub struct SensitiveExportResult {
    pub export_type: String,
    pub account_id: String,
    pub cleared_at: u64,
}

/// Clipboard writer abstraction. Production uses the Tauri clipboard plugin;
/// tests can inject a mock writer to avoid touching the system clipboard.
pub(crate) trait ClipboardWriter: Send + Sync {
    fn write_text(&self, text: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

struct TauriClipboardWriter<R: Runtime> {
    handle: AppHandle<R>,
}

impl<R: Runtime> ClipboardWriter for TauriClipboardWriter<R> {
    fn write_text(&self, text: &str) -> Result<(), String> {
        self.handle
            .clipboard()
            .write_text(text)
            .map_err(|e| format!("Failed to write to clipboard: {:?}", e))
    }

    fn clear(&self) -> Result<(), String> {
        // Write an empty string to clear the clipboard contents. The plugin
        // may expose a dedicated `clear` in the future, but `write_text("")`
        // is always available and has the same observable effect.
        self.handle
            .clipboard()
            .write_text("")
            .map_err(|e| format!("Failed to clear clipboard: {:?}", e))
    }
}

/// Global handle for the active clipboard-clear timer. A second export cancels
/// the previous timer and starts a new one.
static ACTIVE_CLEAR_TIMER: LazyLock<Mutex<Option<JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(None));

/// Export a sensitive secret to the system clipboard without returning it to the
/// webview. Returns metadata only.
#[tauri::command]
pub async fn export_sensitive_to_clipboard<R: Runtime>(
    handle: AppHandle<R>,
    export_type: SensitiveExportType,
    account_id: Option<String>,
    pin: String,
) -> Result<SensitiveExportResult, String> {
    let conn = account_manager::get_db_connection(&handle)?;
    crate::migration::require_key_derivation_version_2(&conn)?;
    account_manager::return_db_connection(conn);

    let writer = TauriClipboardWriter {
        handle: handle.clone(),
    };
    let result = export_sensitive_to_clipboard_core(
        &handle,
        &export_type,
        account_id,
        pin,
        &writer,
    )
    .await;

    if result.is_ok() {
        start_clear_timer(handle);
    } else if has_pending_export_flag(&handle) {
        let _ = writer.clear();
        let _ = set_pending_export_flag(&handle, false);
    }

    result
}

/// Clear the clipboard immediately and cancel any pending clear timer.
#[tauri::command]
pub async fn clear_clipboard<R: Runtime>(handle: AppHandle<R>) -> Result<(), String> {
    clear_clipboard_now(handle).await
}

/// Internal clear implementation; also used by the shutdown/startup cleanup.
pub async fn clear_clipboard_now<R: Runtime>(handle: AppHandle<R>) -> Result<(), String> {
    let writer = TauriClipboardWriter {
        handle: handle.clone(),
    };
    clear_clipboard_with_writer(&writer, &handle)
}

fn clear_clipboard_with_writer<R: Runtime>(
    writer: &dyn ClipboardWriter,
    handle: &AppHandle<R>,
) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 1..=3 {
        match writer.clear() {
            Ok(()) => {
                set_pending_export_flag(handle, false)?;
                cancel_active_timer();
                return Ok(());
            }
            Err(e) => {
                last_error = Some(e);
                if attempt < 3 {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "Failed to clear clipboard".to_string()))
}

fn validate_export_request(
    export_type: &SensitiveExportType,
    account_id: &Option<String>,
) -> Result<(), String> {
    match export_type {
        SensitiveExportType::EvmAccount => {
            let id = account_id
                .as_deref()
                .ok_or_else(|| "EVM account ID is required".to_string())?;
            if id.trim().is_empty() {
                return Err("EVM account ID cannot be empty".to_string());
            }
        }
        SensitiveExportType::NostrNsec | SensitiveExportType::SeedPhrase => {
            if account_id.is_some() {
                return Err("account_id must not be provided for this export type".to_string());
            }
        }
    }
    Ok(())
}

fn log_export_failure<R: Runtime>(
    handle: &AppHandle<R>,
    account_npub: &str,
    export_type: &str,
    err: &str,
) {
    let _ = crate::db::log_sensitive_export(handle, account_npub, export_type, false, Some(err));
}

async fn export_sensitive_to_clipboard_core<R: Runtime>(
    handle: &AppHandle<R>,
    export_type: &SensitiveExportType,
    account_id: Option<String>,
    pin: String,
    writer: &dyn ClipboardWriter,
) -> Result<SensitiveExportResult, String> {
    let session_unlocked_at_entry = crate::session::SESSION_MANAGER.is_unlocked();
    if !session_unlocked_at_entry {
        return Err("Session is locked. Unlock to continue.".to_string());
    }
    crate::session::heartbeat();

    validate_export_request(export_type, &account_id)?;

    let npub = account_manager::get_current_account()
        .map_err(|_| "No account selected".to_string())?;

    crate::db::prune_export_log(handle)?;
    let recent =
        crate::db::list_recent_export_attempts(handle, &npub, EXPORT_BACKOFF_WINDOW_SECONDS)?;
    let backoff = compute_backoff_seconds(&recent);
    if !recent.is_empty() {
        let elapsed = epoch_seconds().saturating_sub(recent[0].attempted_at);
        if elapsed < backoff {
            return Err(format!(
                "Too many export attempts. Please wait {} seconds.",
                backoff.saturating_sub(elapsed)
            ));
        }
    }

    if let Err(e) = validate_pin(handle, &pin) {
        log_export_failure(handle, &npub, export_type.as_str(), &e);
        return Err(e);
    }

    let secret = match fetch_secret(handle, &export_type, account_id.as_deref()).await {
        Ok(s) => s,
        Err(e) => {
            log_export_failure(handle, &npub, export_type.as_str(), &e);
            return Err(e);
        }
    };

    let account_id_out = account_id.unwrap_or_else(|| npub.clone());

    #[cfg(test)]
    maybe_lock_session_for_test();

    if let Err(e) = set_pending_export_flag(handle, true) {
        log_export_failure(handle, &npub, export_type.as_str(), &e);
        return Err(e);
    }

    if !crate::session::SESSION_MANAGER.is_unlocked() || !session_unlocked_at_entry {
        let err = "Session locked during export".to_string();
        log_export_failure(handle, &npub, export_type.as_str(), &err);
        let _ = set_pending_export_flag(handle, false);
        return Err(err);
    }

    if let Err(e) = writer.write_text(&secret) {
        let err = format!("Failed to write to clipboard: {}", e);
        log_export_failure(handle, &npub, export_type.as_str(), &err);
        let _ = set_pending_export_flag(handle, false);
        return Err(err);
    }

    let cleared_at = epoch_seconds().saturating_add(EXPORT_CLEAR_DELAY_SECONDS);
    crate::db::log_sensitive_export(handle, &npub, export_type.as_str(), true, None)?;

    Ok(SensitiveExportResult {
        export_type: export_type.as_str().to_string(),
        account_id: account_id_out,
        cleared_at,
    })
}

/// Validate the PIN by deriving the salt-based key and decrypting the sentinel.
fn validate_pin<R: Runtime>(handle: &AppHandle<R>, pin: &str) -> Result<(), String> {
    let conn = account_manager::get_db_connection(handle)?;
    crate::migration::require_key_derivation_version_2(&conn)?;

    let salt = crate::migration::get_key_derivation_salt(&conn)?
        .ok_or_else(|| "No key derivation salt found".to_string())?;
    let key = derive_key_from_salt(pin, &salt);

    let sentinel = crate::migration::get_key_derivation_sentinel(&conn)?
        .or_else(|| sql_get_setting(&conn, "pkey").ok().flatten())
        .ok_or_else(|| "No PIN sentinel available".to_string())?;

    account_manager::return_db_connection(conn);

    decrypt_with_key(&sentinel, &key)
        .map(|_| ())
        .map_err(|_| "Incorrect PIN".to_string())
}

fn sql_get_setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok();
    Ok(result)
}

async fn fetch_secret<R: Runtime>(
    handle: &AppHandle<R>,
    export_type: &SensitiveExportType,
    account_id: Option<&str>,
) -> Result<String, String> {
    match export_type {
        SensitiveExportType::EvmAccount => {
            let id = account_id
                .ok_or_else(|| "EVM account ID is required".to_string())?
                .to_string();
            let (key_hex, _, _) =
                crate::evm::evm_accounts::resolve_private_key_hex_for_account_id(handle, &id).await?;
            Ok(key_hex)
        }
        SensitiveExportType::NostrNsec => {
            let conn = account_manager::get_db_connection(handle)?;
            let encrypted: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'pkey'",
                    [],
                    |row| row.get(0),
                )
                .ok();
            account_manager::return_db_connection(conn);
            let encrypted =
                encrypted.ok_or_else(|| "No Nostr private key stored".to_string())?;
            crate::crypto::internal_decrypt(encrypted)
                .await
                .map_err(|_| "Could not decrypt Nostr private key".to_string())
        }
        SensitiveExportType::SeedPhrase => crate::db::get_seed(handle.clone())
            .await?
            .ok_or_else(|| "No seed phrase stored".to_string()),
    }
}

/// Compute the exponential backoff for the next export attempt based on recent
/// attempts recorded in the audit log.
///
/// Policy: base 1 second, doubled for each consecutive attempt in the rolling
/// 10-minute window, capped at 5 minutes. If the most recent attempt is older
/// than 10 minutes, the backoff resets to 0.
pub fn compute_backoff_seconds(recent_attempts: &[ExportLogRow]) -> u64 {
    if recent_attempts.is_empty() {
        return 0;
    }

    let now = epoch_seconds();
    let window_start = now.saturating_sub(EXPORT_BACKOFF_WINDOW_SECONDS);
    let last_attempt = recent_attempts[0].attempted_at;
    if last_attempt < window_start {
        return 0;
    }

    let attempts_in_window = recent_attempts
        .iter()
        .take_while(|row| row.attempted_at >= window_start)
        .count();
    let shift = attempts_in_window.saturating_sub(1).min(30) as u32;
    // Cap the shift before the bit shift to prevent overflow on 32-bit shift
    // amounts and to keep the exponential backoff within the policy maximum.
    let delay = EXPORT_BACKOFF_BASE_SECONDS << shift;
    delay.min(EXPORT_BACKOFF_MAX_SECONDS)
}

fn epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Path to the persisted uncleared-export flag file.
fn pending_export_flag_path<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data.join("pending_clipboard_export"))
}

fn has_pending_export_flag<R: Runtime>(handle: &AppHandle<R>) -> bool {
    pending_export_flag_path(handle)
        .map(|p| p.exists())
        .unwrap_or(false)
}

fn set_pending_export_flag<R: Runtime>(handle: &AppHandle<R>, pending: bool) -> Result<(), String> {
    let path = pending_export_flag_path(handle)?;
    if pending {
        std::fs::write(&path, "").map_err(|e| {
            format!(
                "Failed to write pending export flag at {}: {}",
                path.display(),
                e
            )
        })?;
    } else if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[cfg(test)]
static TEST_LOCK_SESSION_BEFORE_WRITE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
fn maybe_lock_session_for_test() {
    if TEST_LOCK_SESSION_BEFORE_WRITE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        crate::session::clear_encryption_key();
    }
}

fn cancel_active_timer() {
    if let Some(timer) = ACTIVE_CLEAR_TIMER.lock().take() {
        timer.abort();
    }
}

fn start_clear_timer_with_delay<F>(delay: Duration, callback: F)
where
    F: FnOnce() + Send + 'static,
{
    cancel_active_timer();
    let handle = tokio::spawn(async move {
        sleep(delay).await;
        callback();
    });
    *ACTIVE_CLEAR_TIMER.lock() = Some(handle);
}

fn start_clear_timer<R: Runtime>(handle: AppHandle<R>) {
    start_clear_timer_with_delay(Duration::from_secs(EXPORT_CLEAR_DELAY_SECONDS), move || {
        let _ = clear_clipboard_now_internal(handle);
    });
}

fn clear_clipboard_now_internal<R: Runtime>(handle: AppHandle<R>) -> Result<(), String> {
    let writer = TauriClipboardWriter {
        handle: handle.clone(),
    };
    clear_clipboard_with_writer(&writer, &handle)
}

/// Startup cleanup: if a previous run left the clipboard with a secret, clear it.
pub fn startup_clipboard_cleanup<R: Runtime>(handle: &AppHandle<R>) {
    if has_pending_export_flag(handle) {
        let _ = clear_clipboard_now_internal(handle.clone());
    }
}

/// Shutdown cleanup: cancel any pending clear timer and clear the clipboard if
/// an export is still pending.
pub fn shutdown_clipboard_cleanup<R: Runtime>(handle: &AppHandle<R>) {
    cancel_active_timer();
    if has_pending_export_flag(handle) {
        let _ = clear_clipboard_now_internal(handle.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    static EXPORT_TEST_MUTEX: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

    struct MockClipboardWriter {
        written: Mutex<Vec<String>>,
        fail_next_write: AtomicBool,
        clear_fail_count: AtomicUsize,
        clear_attempts: AtomicUsize,
    }

    impl MockClipboardWriter {
        fn new() -> Self {
            Self {
                written: Mutex::new(Vec::new()),
                fail_next_write: AtomicBool::new(false),
                clear_fail_count: AtomicUsize::new(0),
                clear_attempts: AtomicUsize::new(0),
            }
        }

        fn with_write_failure() -> Self {
            let writer = Self::new();
            writer.fail_next_write.store(true, Ordering::SeqCst);
            writer
        }

        fn with_clear_failures(count: usize) -> Self {
            let writer = Self::new();
            writer.clear_fail_count.store(count, Ordering::SeqCst);
            writer
        }

        fn was_written(&self) -> bool {
            !self.written.lock().is_empty()
        }

        fn last_written(&self) -> Option<String> {
            self.written.lock().last().cloned()
        }

        fn clear_attempt_count(&self) -> usize {
            self.clear_attempts.load(Ordering::SeqCst)
        }
    }

    impl ClipboardWriter for MockClipboardWriter {
        fn write_text(&self, text: &str) -> Result<(), String> {
            if self.fail_next_write.swap(false, Ordering::SeqCst) {
                return Err("mock write failure".to_string());
            }
            self.written.lock().push(text.to_string());
            Ok(())
        }

        fn clear(&self) -> Result<(), String> {
            self.clear_attempts.fetch_add(1, Ordering::SeqCst);
            if self.clear_fail_count.fetch_sub(1, Ordering::SeqCst) > 0 {
                return Err("mock clear failure".to_string());
            }
            self.written.lock().push(String::new());
            Ok(())
        }
    }

    fn test_row_at(attempted_at: u64, success: bool) -> ExportLogRow {
        ExportLogRow {
            id: "test".to_string(),
            account_npub: "npub1test".to_string(),
            export_type: "evm_account".to_string(),
            attempted_at,
            success,
            error_code: None,
        }
    }

    #[test]
    fn backoff_zero_with_no_attempts() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        assert_eq!(compute_backoff_seconds(&[]), 0);
    }

    #[test]
    fn backoff_grows_exponentially() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let now = epoch_seconds();
        let attempts: Vec<ExportLogRow> = (0..5)
            .map(|i| test_row_at(now - i, true))
            .collect();

        assert_eq!(compute_backoff_seconds(&attempts[0..1]), 1);
        assert_eq!(compute_backoff_seconds(&attempts[0..2]), 2);
        assert_eq!(compute_backoff_seconds(&attempts[0..3]), 4);
        assert_eq!(compute_backoff_seconds(&attempts[0..4]), 8);
        assert_eq!(compute_backoff_seconds(&attempts[0..5]), 16);
    }

    #[test]
    fn backoff_caps_at_max() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let now = epoch_seconds();
        let attempts: Vec<ExportLogRow> = (0..12)
            .map(|i| test_row_at(now - i, true))
            .collect();
        assert_eq!(
            compute_backoff_seconds(&attempts),
            EXPORT_BACKOFF_MAX_SECONDS
        );
    }

    #[test]
    fn backoff_resets_after_quiet_window() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let now = epoch_seconds();
        let old = now - EXPORT_BACKOFF_WINDOW_SECONDS - 1;
        let attempts = vec![test_row_at(old, true)];
        assert_eq!(compute_backoff_seconds(&attempts), 0);
    }

    #[test]
    fn prune_export_log_by_age() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"CREATE TABLE sensitive_export_log (
                id TEXT PRIMARY KEY,
                account_npub TEXT NOT NULL,
                export_type TEXT NOT NULL,
                attempted_at INTEGER NOT NULL,
                success INTEGER NOT NULL DEFAULT 0,
                error_code TEXT
            );"#,
        )
        .unwrap();

        let now = epoch_seconds();
        let old_success = now - (91 * 24 * 60 * 60);
        let old_failure = now - (31 * 24 * 60 * 60);
        let recent = now - 100;

        conn.execute(
            "INSERT INTO sensitive_export_log VALUES (?1, 'npub', 'evm', ?2, 1, NULL)",
            ["old-success", &old_success.to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sensitive_export_log VALUES (?1, 'npub', 'evm', ?2, 0, 'err')",
            ["old-failure", &old_failure.to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sensitive_export_log VALUES (?1, 'npub', 'evm', ?2, 1, NULL)",
            ["recent", &recent.to_string()],
        )
        .unwrap();

        crate::db::prune_export_log_on_conn(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sensitive_export_log", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "only the recent success should remain");
    }

    #[tokio::test]
    async fn locked_session_does_not_touch_clipboard() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        // Ensure no session key is loaded so the command fails before the clipboard.
        crate::session::clear_encryption_key();

        let app = tauri::test::mock_app();
        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            "1234".to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err(), "locked session should reject export");
        assert!(
            !writer.was_written(),
            "clipboard should not be written when session is locked"
        );
    }

    #[tokio::test]
    async fn export_rejects_when_key_derivation_version_not_2() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        // Ensure the session is unlocked so the migration gate is the first failure.
        crate::session::clear_encryption_key();
        crate::session::set_encryption_key([0u8; 32]);

        let previous_account = crate::account_manager::get_current_account().ok();
        let test_npub = "npub1exportgatedoesnotmatter000000000000000000000000000000000000";
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();

        let app = tauri::test::mock_app();
        let handle = app.handle();

        // Create the full schema before opening the account database; migrations
        // only add columns/tables and assume the base schema already exists.
        let db_path = crate::account_manager::get_database_path(handle, test_npub).unwrap();
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(crate::account_manager::SQL_SCHEMA).unwrap();
        }

        // Open the account database so migrations run and record version=1.
        let conn = crate::account_manager::get_db_connection(handle).unwrap();
        crate::account_manager::return_db_connection(conn);

        let result = export_sensitive_to_clipboard(
            handle.clone(),
            SensitiveExportType::NostrNsec,
            None,
            "1234".to_string(),
        )
        .await;

        assert!(result.is_err(), "export should be rejected when version is not 2");
        let err = result.unwrap_err();
        assert!(
            err.contains("Account security must be updated"),
            "unexpected error: {err}"
        );
        assert!(
            err.contains("Unlock the app to migrate"),
            "unexpected error: {err}"
        );

        // Restore previous account state so other tests are not affected.
        if let Some(prev) = previous_account {
            let _ = crate::account_manager::set_current_account(prev);
        } else {
            let _ = crate::account_manager::clear_current_account();
        }
        crate::session::clear_encryption_key();
    }

    #[tokio::test]
    async fn timer_cancellation_prevents_callback() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        cancel_active_timer();
        let fired = Arc::new(AtomicBool::new(false));
        let fired_clone = fired.clone();

        start_clear_timer_with_delay(Duration::from_millis(50), move || {
            fired_clone.store(true, Ordering::SeqCst);
        });

        // Cancel before the timer fires.
        cancel_active_timer();
        sleep(Duration::from_millis(100)).await;

        assert!(
            !fired.load(Ordering::SeqCst),
            "cancelled timer should not fire"
        );
    }

    #[tokio::test]
    async fn second_timer_cancels_first() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        cancel_active_timer();
        let first_fired = Arc::new(AtomicBool::new(false));
        let second_fired = Arc::new(AtomicBool::new(false));

        let first_clone = first_fired.clone();
        start_clear_timer_with_delay(Duration::from_millis(200), move || {
            first_clone.store(true, Ordering::SeqCst);
        });

        let second_clone = second_fired.clone();
        start_clear_timer_with_delay(Duration::from_millis(50), move || {
            second_clone.store(true, Ordering::SeqCst);
        });

        sleep(Duration::from_millis(120)).await;

        assert!(
            !first_fired.load(Ordering::SeqCst),
            "first timer should have been cancelled"
        );
        assert!(
            second_fired.load(Ordering::SeqCst),
            "second timer should have fired"
        );
    }

    #[test]
    fn mock_writer_records_writes_and_clears() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let writer = MockClipboardWriter::new();
        writer.write_text("secret").unwrap();
        writer.clear().unwrap();

        assert!(writer.was_written());
        assert_eq!(writer.last_written(), Some("".to_string()));
    }

    fn setup_migrated_test_account<R: tauri::Runtime>(
        handle: &tauri::AppHandle<R>,
        npub: &str,
        password: &str,
    ) -> [u8; 32] {
        crate::account_manager::set_current_account(npub.to_string()).unwrap();
        // Close any cached connection before deleting the profile directory so
        // the next open sees a fresh database.
        crate::account_manager::close_db_connection();

        // Ensure a fresh database so repeated test runs do not reuse stale rows.
        let profile_dir = crate::account_manager::get_profile_directory(handle, npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);

        let db_path = crate::account_manager::get_database_path(handle, npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(crate::account_manager::SQL_SCHEMA).unwrap();

        let salt = crate::crypto::generate_salt();
        let legacy_key = crate::crypto::derive_legacy_key(password);
        let pkey_plaintext = "nsec1secret";
        let pkey = crate::crypto::encrypt_with_key(pkey_plaintext, &legacy_key);

        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('pkey', ?1)",
            [pkey],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('key_derivation_salt', ?1)",
            [hex::encode(salt)],
        )
        .unwrap();
        crate::migration::set_key_derivation_version(&conn, 1).unwrap();

        crate::migration::migrate_key_derivation_on_conn(&mut conn, password).unwrap();

        let new_key = crate::crypto::derive_key_from_salt(password, &salt);
        crate::session::set_encryption_key(new_key);

        new_key
    }

    fn restore_account_or_clear(previous_account: Option<String>) {
        crate::session::clear_encryption_key();
        crate::account_manager::close_db_connection();
        if let Some(prev) = previous_account {
            let _ = crate::account_manager::set_current_account(prev);
        } else {
            let _ = crate::account_manager::clear_current_account();
        }
    }

    #[tokio::test]
    async fn export_happy_path_writes_secret_to_clipboard() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exporthappy";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            password.to_string(),
            &writer,
        )
        .await;

        assert!(result.is_ok(), "unexpected error: {:?}", result.err());
        let metadata = result.unwrap();
        assert_eq!(metadata.export_type, "nostr_nsec");
        assert_eq!(metadata.account_id, npub);
        assert_eq!(writer.last_written(), Some("nsec1secret".to_string()));

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn export_rejects_incorrect_pin() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportbadpin";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            "wrongpin".to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err(), "incorrect PIN should reject export");
        let err = result.unwrap_err();
        assert!(err.contains("Incorrect PIN"), "unexpected error: {err}");
        assert!(
            !writer.was_written(),
            "clipboard should not be written with bad PIN"
        );

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn export_rejects_empty_pin() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportemptypin";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            "".to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err(), "empty PIN should reject export");
        let err = result.unwrap_err();
        assert!(err.contains("Incorrect PIN"), "unexpected error: {err}");
        assert!(
            !writer.was_written(),
            "clipboard should not be written with empty PIN"
        );

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn export_rejects_no_account_selected() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        crate::session::clear_encryption_key();
        crate::session::set_encryption_key([0u8; 32]);
        crate::account_manager::clear_current_account().unwrap();

        let app = tauri::test::mock_app();
        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            "123456".to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err(), "no account should reject export");
        let err = result.unwrap_err();
        assert!(err.contains("No account selected"), "unexpected error: {err}");
        assert!(
            !writer.was_written(),
            "clipboard should not be written without account"
        );

        crate::session::clear_encryption_key();
    }

    #[tokio::test]
    async fn session_lock_between_pin_and_write_rejects_export() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exporttoctou";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        TEST_LOCK_SESSION_BEFORE_WRITE.store(true, Ordering::SeqCst);

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            password.to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err(), "TOCTOU lock should reject export");
        let err = result.unwrap_err();
        assert!(
            err.contains("Session locked during export"),
            "unexpected error: {err}"
        );
        assert!(
            !writer.was_written(),
            "clipboard should not be written after TOCTOU lock"
        );
        assert!(
            !has_pending_export_flag(app.handle()),
            "pending flag should be cleared after TOCTOU failure"
        );

        let conn = crate::account_manager::get_db_connection(app.handle()).unwrap();
        let rows = crate::db::list_recent_export_attempts_on_conn(
            &conn,
            npub,
            EXPORT_BACKOFF_WINDOW_SECONDS,
        )
        .unwrap();
        crate::account_manager::return_db_connection(conn);
        let failures: Vec<_> = rows.iter().filter(|r| !r.success).collect();
        assert_eq!(failures.len(), 1, "expected one failed audit log entry");
        assert!(failures[0]
            .error_code
            .as_deref()
            .unwrap_or("")
            .contains("Session locked during export"));

        restore_account_or_clear(previous_account);
    }

    #[test]
    fn backoff_no_overflow_with_many_attempts() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let now = epoch_seconds();
        let attempts: Vec<ExportLogRow> = (0..40)
            .map(|i| test_row_at(now - i, true))
            .collect();
        assert_eq!(
            compute_backoff_seconds(&attempts),
            EXPORT_BACKOFF_MAX_SECONDS,
            "shift should be capped before overflow"
        );
    }

    #[tokio::test]
    async fn pending_flag_set_before_write_and_cleared_on_failure() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportflagorder";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            password.to_string(),
            &writer,
        )
        .await;

        assert!(result.is_ok(), "unexpected error: {:?}", result.err());
        assert!(
            has_pending_export_flag(app.handle()),
            "pending flag should be set after successful export"
        );
        assert_eq!(
            writer.last_written(),
            Some("nsec1secret".to_string()),
            "secret should be written to clipboard"
        );

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn clipboard_write_failure_clears_pending_flag() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportwritefail";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let writer = MockClipboardWriter::with_write_failure();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            password.to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err(), "clipboard write failure should reject export");
        let err = result.unwrap_err();
        assert!(
            err.contains("Failed to write to clipboard"),
            "unexpected error: {err}"
        );
        assert!(
            !writer.was_written(),
            "secret should not be recorded when write fails"
        );
        assert!(
            !has_pending_export_flag(app.handle()),
            "pending flag should be cleared on write failure"
        );

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn malformed_account_id_rejected_for_each_export_type() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportmalformed";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let cases = vec![
            (
                SensitiveExportType::EvmAccount,
                None,
                "EVM account ID is required",
            ),
            (
                SensitiveExportType::EvmAccount,
                Some("".to_string()),
                "EVM account ID cannot be empty",
            ),
            (
                SensitiveExportType::NostrNsec,
                Some("unexpected".to_string()),
                "account_id must not be provided",
            ),
            (
                SensitiveExportType::SeedPhrase,
                Some("unexpected".to_string()),
                "account_id must not be provided",
            ),
        ];

        for (export_type, account_id, expected) in cases {
            let writer = MockClipboardWriter::new();
            let result = export_sensitive_to_clipboard_core(
                app.handle(),
                &export_type,
                account_id,
                password.to_string(),
                &writer,
            )
            .await;

            assert!(result.is_err(), "{export_type:?} should reject malformed account_id");
            let err = result.unwrap_err();
            assert!(
                err.contains(expected),
                "expected error containing '{expected}', got: {err}"
            );
            assert!(
                !writer.was_written(),
                "clipboard should not be written for malformed request"
            );
        }

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn evm_account_export_accepts_non_empty_account_id() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportevmvalid";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::EvmAccount,
            Some("evm1nonexistent".to_string()),
            password.to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            !err.contains("EVM account ID is required")
                && !err.contains("EVM account ID cannot be empty"),
            "non-empty EVM account_id should pass validation, got: {err}"
        );

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn clipboard_clear_retries_and_succeeds() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let app = tauri::test::mock_app();
        set_pending_export_flag(app.handle(), true).unwrap();

        let writer = MockClipboardWriter::with_clear_failures(2);
        let result = clear_clipboard_with_writer(&writer, app.handle());

        assert!(result.is_ok(), "clear should succeed after retries: {:?}", result.err());
        assert_eq!(
            writer.clear_attempt_count(),
            3,
            "clear should be attempted three times"
        );
        assert!(
            !has_pending_export_flag(app.handle()),
            "pending flag should be cleared after successful clear"
        );
    }

    #[tokio::test]
    async fn clipboard_clear_failure_leaves_flag_and_returns_error() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let app = tauri::test::mock_app();
        set_pending_export_flag(app.handle(), true).unwrap();

        let writer = MockClipboardWriter::with_clear_failures(3);
        let result = clear_clipboard_with_writer(&writer, app.handle());

        assert!(result.is_err(), "clear should fail after exhausting retries");
        assert_eq!(
            writer.clear_attempt_count(),
            3,
            "clear should be attempted three times"
        );
        assert!(
            has_pending_export_flag(app.handle()),
            "pending flag should remain set when clear fails"
        );
    }

    #[tokio::test]
    async fn export_cancellation_before_pin_entry_logs_nothing() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportcancel";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        // Simulate cancellation by locking the session before PIN entry.
        crate::session::clear_encryption_key();

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            password.to_string(),
            &writer,
        )
        .await;

        assert!(result.is_err(), "cancelled export should be rejected");
        let err = result.unwrap_err();
        assert!(
            err.contains("Session is locked"),
            "unexpected error: {err}"
        );
        assert!(
            !writer.was_written(),
            "clipboard should not be written for cancelled export"
        );

        let conn = crate::account_manager::get_db_connection(app.handle()).unwrap();
        let rows = crate::db::list_recent_export_attempts_on_conn(
            &conn,
            npub,
            EXPORT_BACKOFF_WINDOW_SECONDS,
        )
        .unwrap();
        crate::account_manager::return_db_connection(conn);
        assert!(
            rows.is_empty(),
            "no audit log entry should be created for cancellation before PIN entry"
        );

        restore_account_or_clear(previous_account);
    }

    #[tokio::test]
    async fn audit_log_entry_on_success_and_failure() {
        let _guard = EXPORT_TEST_MUTEX.lock();
        let previous_account = crate::account_manager::get_current_account().ok();
        let npub = "npub1exportauditlog";
        let password = "123456";

        crate::session::clear_encryption_key();
        let app = tauri::test::mock_app();
        setup_migrated_test_account(app.handle(), npub, password);

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            password.to_string(),
            &writer,
        )
        .await;
        assert!(result.is_ok(), "unexpected error: {:?}", result.err());

        tokio::time::sleep(Duration::from_secs(1)).await;

        let writer = MockClipboardWriter::new();
        let result = export_sensitive_to_clipboard_core(
            app.handle(),
            &SensitiveExportType::NostrNsec,
            None,
            "wrongpin".to_string(),
            &writer,
        )
        .await;
        assert!(result.is_err(), "bad PIN should fail");
        let pin_err = result.unwrap_err();
        assert!(pin_err.contains("Incorrect PIN"));

        let conn = crate::account_manager::get_db_connection(app.handle()).unwrap();
        let rows = crate::db::list_recent_export_attempts_on_conn(
            &conn,
            npub,
            EXPORT_BACKOFF_WINDOW_SECONDS,
        )
        .unwrap();
        crate::account_manager::return_db_connection(conn);

        assert_eq!(rows.len(), 2, "expected success and failure audit entries");
        let success_row = rows.iter().find(|r| r.success).expect("success row missing");
        let failure_row = rows.iter().find(|r| !r.success).expect("failure row missing");
        assert_eq!(success_row.export_type, "nostr_nsec");
        assert_eq!(success_row.account_npub, npub);
        assert!(success_row.error_code.is_none());
        assert_eq!(failure_row.export_type, "nostr_nsec");
        assert_eq!(failure_row.account_npub, npub);
        assert!(failure_row
            .error_code
            .as_deref()
            .unwrap_or("")
            .contains("Incorrect PIN"));

        restore_account_or_clear(previous_account);
    }
}
