use rusqlite;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::crypto::{
    decrypt_with_key, derive_key_from_salt, derive_legacy_key, encrypt_with_key, generate_salt,
    write_salt_file, SALT_LENGTH,
};
use crate::stored_event::event_kind;
use nostr_sdk::nips::nip06::FromMnemonic;
use nostr_sdk::Keys;
use nostr_sdk::ToBech32;

/// Settings key for the hex-encoded per-device Argon2 salt.
pub const KEY_DERIVATION_SALT: &str = "key_derivation_salt";

/// Settings key for the key-derivation version marker. `1` = legacy hard-coded
/// salt, `2` = per-device random salt.
pub const KEY_DERIVATION_VERSION: &str = "key_derivation_version";

/// Settings key for an encrypted sentinel value used to validate the PIN during
/// migration. If absent, `settings.pkey` is used as the sentinel.
pub const KEY_DERIVATION_SENTINEL: &str = "key_derivation_sentinel";

/// Settings key marking whether a key-derivation migration is currently in
/// progress. `1` = in progress, `0` or absent = not in progress.
pub const KEY_DERIVATION_MIGRATION_IN_PROGRESS: &str = "key_derivation_migration_in_progress";

/// Maximum number of encrypted rows allowed to migrate automatically before the
/// user is asked to migrate manually. Prevents memory exhaustion from accounts
/// with extremely large event histories.
pub const MIGRATION_ROW_LIMIT: usize = 10_000;

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok();
    Ok(result)
}

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("Failed to set {}: {}", key, e))?;
    Ok(())
}

fn settings_key_exists(conn: &rusqlite::Connection, key: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check {}: {}", key, e))?;
    Ok(count > 0)
}

fn table_exists(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check table {}: {}", name, e))?;
    Ok(count > 0)
}

/// Return the current or pending account npub. Pending accounts take precedence
/// because they are being created.
fn current_or_pending_npub() -> Result<String, String> {
    if let Ok(Some(npub)) = crate::account_manager::get_pending_account() {
        return Ok(npub);
    }
    crate::account_manager::get_current_account()
}

/// Read the key-derivation version for the account attached to `conn`.
pub fn get_key_derivation_version(conn: &rusqlite::Connection) -> Result<u32, String> {
    get_setting(conn, KEY_DERIVATION_VERSION)?
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "key_derivation_version not set".to_string())
}

/// Return an error unless the account attached to `conn` has migrated to
/// key-derivation version 2.
pub fn require_key_derivation_version_2(conn: &rusqlite::Connection) -> Result<(), String> {
    let version = get_key_derivation_version(conn)?;
    if version != 2 {
        return Err("Account security must be updated. Unlock the app to migrate.".to_string());
    }
    Ok(())
}

/// Convenience guard that borrows a pooled DB connection from `handle`, checks
/// the key-derivation version, and returns the connection for reuse.
pub fn require_key_derivation_version_2_on_handle<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = require_key_derivation_version_2(&conn);
    crate::account_manager::return_db_connection(conn);
    result
}

/// Read the stored salt, if any.
pub fn get_key_derivation_salt(
    conn: &rusqlite::Connection,
) -> Result<Option<[u8; SALT_LENGTH]>, String> {
    let Some(hex) = get_setting(conn, KEY_DERIVATION_SALT)? else {
        return Ok(None);
    };
    let bytes = hex::decode(&hex).map_err(|e| format!("Invalid salt hex: {}", e))?;
    if bytes.len() != SALT_LENGTH {
        return Err(format!("Invalid salt length: {}", bytes.len()));
    }
    let mut salt = [0u8; SALT_LENGTH];
    salt.copy_from_slice(&bytes);
    Ok(Some(salt))
}

fn set_key_derivation_salt(
    conn: &rusqlite::Connection,
    salt: &[u8; SALT_LENGTH],
) -> Result<(), String> {
    set_setting(conn, KEY_DERIVATION_SALT, &hex::encode(salt))
}

pub fn set_key_derivation_version(conn: &rusqlite::Connection, version: u32) -> Result<(), String> {
    set_setting(conn, KEY_DERIVATION_VERSION, &version.to_string())
}

pub fn get_key_derivation_sentinel(conn: &rusqlite::Connection) -> Result<Option<String>, String> {
    get_setting(conn, KEY_DERIVATION_SENTINEL)
}

fn set_key_derivation_sentinel(conn: &rusqlite::Connection, sentinel: &str) -> Result<(), String> {
    set_setting(conn, KEY_DERIVATION_SENTINEL, sentinel)
}

fn get_key_derivation_migration_in_progress(conn: &rusqlite::Connection) -> Result<bool, String> {
    Ok(get_setting(conn, KEY_DERIVATION_MIGRATION_IN_PROGRESS)?
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0)
        != 0)
}

fn set_key_derivation_migration_in_progress(
    conn: &rusqlite::Connection,
    in_progress: bool,
) -> Result<(), String> {
    set_setting(
        conn,
        KEY_DERIVATION_MIGRATION_IN_PROGRESS,
        if in_progress { "1" } else { "0" },
    )
}

/// Create a new salt for a new account, persist it in settings, set version to
/// 2, and mirror it to the salt file cache.
pub fn create_new_account_salt<R: Runtime>(
    handle: &AppHandle<R>,
    conn: &rusqlite::Connection,
) -> Result<[u8; SALT_LENGTH], String> {
    let salt = generate_salt();
    set_key_derivation_salt(conn, &salt)?;
    set_key_derivation_version(conn, 2)?;
    if let Ok(npub) = current_or_pending_npub() {
        let _ = write_salt_file(handle, &npub, &salt);
    }
    Ok(salt)
}

/// Count every encrypted row that may need re-encryption during migration.
fn count_encrypted_rows(conn: &rusqlite::Connection) -> Result<usize, String> {
    let mut count: usize = 0;

    let settings_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key IN ('pkey', 'evm_pkey', 'seed') AND value IS NOT NULL AND value != ''",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count settings rows: {}", e))?;
    count += settings_count as usize;

    if table_exists(conn, "evm_accounts")? {
        let evm_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM evm_accounts WHERE imported_enc IS NOT NULL AND imported_enc != ''",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count evm_accounts rows: {}", e))?;
        count += evm_count as usize;
    }

    if table_exists(conn, "squad_bot_secret")? {
        let squad_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM squad_bot_secret", [], |row| {
                row.get(0)
            })
            .map_err(|e| format!("Failed to count squad_bot_secret rows: {}", e))?;
        count += squad_count as usize;
    }

    if table_exists(conn, "events")? {
        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE kind IN (?1, ?2) AND content IS NOT NULL AND content != ''",
                rusqlite::params![event_kind::PRIVATE_DIRECT_MESSAGE, event_kind::MESSAGE_EDIT],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count events rows: {}", e))?;
        count += event_count as usize;
    }

    if table_exists(conn, "messages")? {
        let message_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE content_encrypted IS NOT NULL AND content_encrypted != ''",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count messages rows: {}", e))?;
        count += message_count as usize;
    }

    Ok(count)
}

/// Execute a single UPDATE for one encrypted column during migration.
fn update_single_row(
    conn: &mut rusqlite::Connection,
    table: &str,
    id_column: &str,
    value_column: &str,
    id: &str,
    value: &str,
) -> Result<(), String> {
    let sql = format!(
        "UPDATE {} SET {} = ?1 WHERE {} = ?2",
        table, value_column, id_column
    );
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction for {}: {}", table, e))?;
    tx.execute(&sql, rusqlite::params![value, id])
        .map_err(|e| format!("Failed to update {} row {}: {}", table, id, e))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit transaction for {}: {}", table, e))?;
    Ok(())
}

/// Migrate one encrypted table in a streaming fashion. Each row is processed in
/// its own transaction, so memory usage stays bounded and an interruption is
/// recoverable.
fn migrate_table_rows(
    conn: &mut rusqlite::Connection,
    table: &str,
    id_column: &str,
    value_column: &str,
    select_sql: &str,
    params: &[&dyn rusqlite::ToSql],
    legacy_key: &[u8; 32],
    new_key: &[u8; 32],
) -> Result<usize, String> {
    let mut stmt = conn
        .prepare(select_sql)
        .map_err(|e| format!("Failed to prepare query for {}: {}", table, e))?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params, |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to query {}: {}", table, e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read {} row: {}", table, e))?;
    drop(stmt);

    let mut reencrypted = 0;
    for (id, ciphertext) in rows {
        if decrypt_with_key(&ciphertext, new_key).is_ok() {
            continue;
        }
        let plaintext = decrypt_with_key(&ciphertext, legacy_key)
            .map_err(|_| format!("Failed to decrypt {} row {}", table, id))?;
        let new_ciphertext = encrypt_with_key(&plaintext, new_key);
        update_single_row(conn, table, id_column, value_column, &id, &new_ciphertext)?;
        reencrypted += 1;
    }

    Ok(reencrypted)
}

/// Migrate all encrypted tables. This is the streaming replacement for the old
/// `collect_encrypted_rows` / `update_row` flow.
fn migrate_all_tables(
    conn: &mut rusqlite::Connection,
    legacy_key: &[u8; 32],
    new_key: &[u8; 32],
) -> Result<usize, String> {
    let total = count_encrypted_rows(conn)?;
    if total > MIGRATION_ROW_LIMIT {
        return Err(format!(
            "Account has {} encrypted rows, exceeding the automatic migration limit of {}. Please contact support.",
            total, MIGRATION_ROW_LIMIT
        ));
    }

    let mut reencrypted = 0;

    reencrypted += migrate_table_rows(
        conn,
        "settings",
        "key",
        "value",
        "SELECT key, value FROM settings WHERE key IN ('pkey', 'evm_pkey', 'seed') AND value IS NOT NULL AND value != ''",
        &[],
        legacy_key,
        new_key,
    )?;

    if table_exists(conn, "evm_accounts")? {
        reencrypted += migrate_table_rows(
            conn,
            "evm_accounts",
            "id",
            "imported_enc",
            "SELECT id, imported_enc FROM evm_accounts WHERE imported_enc IS NOT NULL AND imported_enc != ''",
            &[],
            legacy_key,
            new_key,
        )?;
    }

    if table_exists(conn, "squad_bot_secret")? {
        reencrypted += migrate_table_rows(
            conn,
            "squad_bot_secret",
            "parent_id",
            "encrypted_nsec",
            "SELECT parent_id, encrypted_nsec FROM squad_bot_secret",
            &[],
            legacy_key,
            new_key,
        )?;
    }

    if table_exists(conn, "events")? {
        reencrypted += migrate_table_rows(
            conn,
            "events",
            "id",
            "content",
            "SELECT id, content FROM events WHERE kind IN (?1, ?2) AND content IS NOT NULL AND content != ''",
            &[
                &event_kind::PRIVATE_DIRECT_MESSAGE,
                &event_kind::MESSAGE_EDIT,
            ],
            legacy_key,
            new_key,
        )?;
    }

    if table_exists(conn, "messages")? {
        reencrypted += migrate_table_rows(
            conn,
            "messages",
            "id",
            "content_encrypted",
            "SELECT id, content_encrypted FROM messages WHERE content_encrypted IS NOT NULL AND content_encrypted != ''",
            &[],
            legacy_key,
            new_key,
        )?;
    }

    Ok(reencrypted)
}

/// Decrypt the migration sentinel, trying the new key first (so a retry after
/// a partial migration that already updated the sentinel does not fail), then
/// falling back to the legacy key.
fn decrypt_sentinel_for_migration(
    sentinel_ciphertext: &str,
    legacy_key: &[u8; 32],
    new_key: &[u8; 32],
) -> Result<String, String> {
    if let Ok(plaintext) = decrypt_with_key(sentinel_ciphertext, new_key) {
        return Ok(plaintext);
    }
    decrypt_with_key(sentinel_ciphertext, legacy_key).map_err(|_| "Incorrect PIN".to_string())
}

/// Core migration routine: re-encrypt every encrypted row from the legacy key
/// to the new key. If a row already decrypts with the new key it is skipped.
/// The sentinel is validated with both keys before and after the scan. All
/// mutations are executed one row per transaction so an interruption leaves
/// the account recoverable on the next unlock. A per-account row limit
/// prevents memory exhaustion from accounts with extremely large histories.
pub fn migrate_account_encryption(
    conn: &mut rusqlite::Connection,
    legacy_key: &[u8; 32],
    new_key: &[u8; 32],
    sentinel_ciphertext: &str,
) -> Result<usize, String> {
    // Validate the PIN by decrypting the sentinel. Try the new key first so a
    // retry after a crash that already updated the sentinel does not fail with
    // an "Incorrect PIN" error.
    let sentinel_plaintext =
        decrypt_sentinel_for_migration(sentinel_ciphertext, legacy_key, new_key)?;

    // Mark migration as in progress. Version is only bumped to 2 after the scan
    // completes successfully so that a crash mid-migration leaves the account in
    // a version-1 state and the next unlock will retry the whole migration.
    set_key_derivation_migration_in_progress(conn, true)?;

    let reencrypted = migrate_all_tables(conn, legacy_key, new_key)?;

    // Only commit the new version once every row has been re-encrypted. This
    // ordering makes the migration idempotent and retry-safe: a failed or
    // interrupted migration does not advance the version, so the next unlock
    // re-runs the migration from the beginning.
    set_key_derivation_version(conn, 2)?;

    // After the scan, re-encrypt the sentinel with the new key so the legacy
    // ciphertext is no longer needed for future PIN validation.
    let new_sentinel_ciphertext = encrypt_with_key(&sentinel_plaintext, new_key);
    set_key_derivation_sentinel(conn, &new_sentinel_ciphertext)
        .map_err(|e| format!("Failed to update migration sentinel: {}", e))?;

    // Validate the sentinel decrypts with the new key.
    decrypt_with_key(&new_sentinel_ciphertext, new_key)
        .map_err(|_| "Migration failed: sentinel does not decrypt with new key".to_string())?;

    set_key_derivation_migration_in_progress(conn, false)?;

    Ok(reencrypted)
}

/// Migrate an existing account from the legacy key to the salt-derived key using
/// an open connection. This is the testable core; it derives the new key from
/// the stored pending salt (or generates one if absent), validates the PIN,
/// scans and re-encrypts every encrypted row, and sets `key_derivation_version`
/// to 2.
pub fn migrate_key_derivation_on_conn(
    conn: &mut rusqlite::Connection,
    password: &str,
) -> Result<(), String> {
    let legacy_key = derive_legacy_key(password);

    let sentinel = get_key_derivation_sentinel(conn)?
        .or_else(|| get_setting(conn, "pkey").ok().flatten())
        .ok_or("No sentinel or pkey available for migration")?;

    let salt = if let Some(s) = get_key_derivation_salt(conn)? {
        s
    } else {
        let s = generate_salt();
        set_key_derivation_salt(conn, &s)?;
        s
    };

    let new_key = derive_key_from_salt(password, &salt);

    // If a previous migration was interrupted, resume from the beginning. The
    // per-row skip logic makes the scan idempotent for already-migrated rows.
    if get_key_derivation_migration_in_progress(conn)? {
        // Sentinel may already be new-key encrypted; migrate_account_encryption
        // handles both old and new sentinel ciphertexts.
    }

    let _count = migrate_account_encryption(conn, &legacy_key, &new_key, &sentinel)?;
    Ok(())
}

/// High-level migration entry point for the unlock flow. Runs the migration on
/// the current account's database, mirrors the salt to the file cache, and
/// emits a `migration_complete` event on success.
pub fn migrate_key_derivation<R: Runtime>(
    handle: &AppHandle<R>,
    password: &str,
) -> Result<(), String> {
    let mut conn = crate::account_manager::get_db_connection(handle)
        .map_err(|e| format!("Failed to open database for migration: {}", e))?;

    let result = migrate_key_derivation_on_conn(&mut conn, password);

    // Always return the connection to the pool, even if migration failed.
    if let Ok(Some(salt)) = get_key_derivation_salt(&conn) {
        if let Ok(npub) = current_or_pending_npub() {
            let _ = write_salt_file(handle, &npub, &salt);
        }
    }

    crate::account_manager::return_db_connection(conn);

    result?;

    if let Some(app) = crate::TAURI_APP.get() {
        let _ = app.emit("migration_complete", ());
    }
    Ok(())
}

/// Encrypt `input` with a password-derived key for a new account. Generates a
/// random salt, stores it and version 2 in settings, mirrors the salt to the
/// file cache, and stores the ciphertext as the migration sentinel. Sets the
/// in-memory session key.
pub async fn encrypt_with_password<R: Runtime>(
    handle: &AppHandle<R>,
    input: &str,
    password: &str,
) -> Result<String, String> {
    // For brand-new accounts the database does not exist yet; create it now so
    // we can write the salt/version settings.
    let is_new = if let Ok(Some(npub)) = crate::account_manager::get_pending_account() {
        crate::account_manager::init_profile_database(handle, &npub)
            .await
            .map_err(|e| format!("Failed to initialize profile database: {}", e))?;
        crate::account_manager::set_current_account(npub)
            .map_err(|e| format!("Failed to set current account: {}", e))?;
        crate::account_manager::clear_pending_account()
            .map_err(|e| format!("Failed to clear pending account: {}", e))?;
        true
    } else {
        false
    };

    let conn = crate::account_manager::get_db_connection(handle)
        .map_err(|e| format!("Failed to open database for encryption: {}", e))?;

    let is_new = is_new || !settings_key_exists(&conn, "pkey")?;

    let salt = if is_new {
        create_new_account_salt(handle, &conn)?
    } else {
        let version = get_key_derivation_version(&conn).unwrap_or(1);
        if version == 1 {
            return Err("Account must be migrated before encrypting with a new PIN".to_string());
        }
        get_key_derivation_salt(&conn)?.ok_or_else(|| "No key derivation salt found".to_string())?
    };

    let key = derive_key_from_salt(password, &salt);
    crate::session::load_timeout_ms_from_conn(&conn);
    crate::set_encryption_key(key);
    let ciphertext = encrypt_with_key(input, &key);

    set_key_derivation_sentinel(&conn, &ciphertext)
        .map_err(|e| format!("Failed to store sentinel: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(ciphertext)
}

/// Derive the Nostr nsec (bech32-encoded secret key) from a BIP-39 seed phrase.
fn derive_nsec_from_seed_phrase(seed_phrase: &str) -> Result<String, String> {
    let keys = Keys::from_mnemonic(seed_phrase.trim(), None)
        .map_err(|e| format!("Failed to derive key from seed: {}", e))?;
    keys.secret_key()
        .to_bech32()
        .map_err(|e| format!("Failed to encode nsec: {}", e))
}

/// Attempt to recover the nsec from the encrypted recovery seed.
/// Tries the current salt-derived key first, then the legacy key.
fn decrypt_seed_fallback(
    conn: &rusqlite::Connection,
    password: &str,
    salt: &[u8; SALT_LENGTH],
) -> Result<String, String> {
    let encrypted_seed = get_setting(conn, "seed")?.ok_or_else(|| "Incorrect PIN".to_string())?;

    let current_key = derive_key_from_salt(password, salt);
    if let Ok(seed_phrase) = decrypt_with_key(&encrypted_seed, &current_key) {
        return derive_nsec_from_seed_phrase(&seed_phrase);
    }

    let legacy_key = derive_legacy_key(password);
    if let Ok(seed_phrase) = decrypt_with_key(&encrypted_seed, &legacy_key) {
        return derive_nsec_from_seed_phrase(&seed_phrase);
    }

    Err("Incorrect PIN".to_string())
}

/// Diagnostic snapshot used to understand why a PIN unlock failed without
/// exposing the plaintext secrets. Returned by `diagnose_key_derivation_state`.
#[derive(Serialize)]
pub struct UnlockDiagnostic {
    pub version: u32,
    pub migration_in_progress: bool,
    pub has_salt: bool,
    pub has_pkey: bool,
    pub has_seed: bool,
    pub has_sentinel: bool,
    pub pkey_decrypts_new: bool,
    pub pkey_decrypts_legacy: bool,
    pub seed_decrypts_new: bool,
    pub seed_decrypts_legacy: bool,
}

/// Inspect the local key-derivation state to determine why a PIN unlock is
/// failing. The password is used to derive the candidate keys and test
/// decryption, but no plaintext secrets are returned.
pub fn diagnose_key_derivation_state(
    conn: &rusqlite::Connection,
    password: &str,
) -> Result<UnlockDiagnostic, String> {
    let version = get_key_derivation_version(conn).unwrap_or(1);
    let migration_in_progress = get_key_derivation_migration_in_progress(conn).unwrap_or(false);

    let salt = get_key_derivation_salt(conn)?;
    let has_salt = salt.is_some();
    let key = salt.as_ref().map(|s| derive_key_from_salt(password, s));
    let legacy_key = derive_legacy_key(password);

    let pkey = get_setting(conn, "pkey")?;
    let has_pkey = pkey.is_some();
    let pkey_decrypts_new = pkey
        .as_ref()
        .zip(key.as_ref())
        .map(|(p, k)| decrypt_with_key(p, k).is_ok())
        .unwrap_or(false);
    let pkey_decrypts_legacy = pkey
        .as_ref()
        .map(|p| decrypt_with_key(p, &legacy_key).is_ok())
        .unwrap_or(false);

    let seed = get_setting(conn, "seed")?;
    let has_seed = seed.is_some();
    let seed_decrypts_new = seed
        .as_ref()
        .zip(key.as_ref())
        .map(|(s, k)| decrypt_with_key(s, k).is_ok())
        .unwrap_or(false);
    let seed_decrypts_legacy = seed
        .as_ref()
        .map(|s| decrypt_with_key(s, &legacy_key).is_ok())
        .unwrap_or(false);

    let sentinel = get_key_derivation_sentinel(conn)?;
    let has_sentinel = sentinel.is_some();

    Ok(UnlockDiagnostic {
        version,
        migration_in_progress,
        has_salt,
        has_pkey,
        has_seed,
        has_sentinel,
        pkey_decrypts_new,
        pkey_decrypts_legacy,
        seed_decrypts_new,
        seed_decrypts_legacy,
    })
}

/// Decrypt `ciphertext` with a password-derived key. If the account is still on
/// version 1, transparently migrate it before decrypting. On success the
/// in-memory session key is set to the new salt-derived key.
///
/// If the encrypted pkey cannot be decrypted, the routine automatically falls
/// back to the stored recovery seed (settings.seed), trying both the current
/// salt-derived key and the legacy key. When the seed can be decrypted, the
/// Nostr nsec is derived from it and returned so the user can still unlock.
pub async fn decrypt_with_password<R: Runtime>(
    handle: &AppHandle<R>,
    ciphertext: &str,
    password: &str,
) -> Result<String, String> {
    let (version, migration_in_progress) = {
        let conn = crate::account_manager::get_db_connection(handle)
            .map_err(|e| format!("Failed to open database for decryption: {}", e))?;
        let v = get_key_derivation_version(&conn).unwrap_or(1);
        let p = get_key_derivation_migration_in_progress(&conn).unwrap_or(false);
        crate::account_manager::return_db_connection(conn);
        (v, p)
    };

    // Repair partially migrated accounts. A previous version of this code set
    // version=2 before the table scan, so a crash could leave version=2 with
    // in_progress=true and some rows still encrypted with the legacy key. If the
    // account is not fully migrated (version != 2 or in_progress flag set), rerun
    // migration before attempting to decrypt.
    let migration_ran = if version != 2 || migration_in_progress {
        migrate_key_derivation(handle, password).map_err(|e| format!("Migration failed: {}", e))?;
        true
    } else {
        false
    };

    let conn = crate::account_manager::get_db_connection(handle)
        .map_err(|e| format!("Failed to open database for decryption: {}", e))?;
    let result = decrypt_with_password_on_conn(&conn, ciphertext, password, migration_ran);
    crate::account_manager::return_db_connection(conn);
    result
}

fn decrypt_with_password_on_conn(
    conn: &rusqlite::Connection,
    ciphertext: &str,
    password: &str,
    migration_ran: bool,
) -> Result<String, String> {
    let salt =
        get_key_derivation_salt(conn)?.ok_or_else(|| "No key derivation salt found".to_string())?;
    let key = derive_key_from_salt(password, &salt);
    crate::session::load_timeout_ms_from_conn(conn);
    crate::set_encryption_key(key);

    // After migrating a legacy account, the input `ciphertext` (which was the
    // legacy pkey) is no longer valid because the DB pkey has been re-encrypted
    // with the new salt-derived key. Re-read the current ciphertext from the
    // DB before decrypting.
    let ciphertext_to_decrypt = if migration_ran {
        get_setting(conn, "pkey")?.ok_or_else(|| "No pkey found after migration".to_string())?
    } else {
        ciphertext.to_string()
    };

    match decrypt_with_key(&ciphertext_to_decrypt, &key) {
        Ok(text) => Ok(text),
        Err(_) => {
            // Try the legacy key on the pkey in case the migration marker is
            // ahead of the row data (should not happen after a successful
            // repair, but acts as a safety net).
            let legacy_key = derive_legacy_key(password);
            match decrypt_with_key(&ciphertext_to_decrypt, &legacy_key) {
                Ok(text) => Ok(text),
                Err(_) => {
                    // Final fallback: derive the nsec from the encrypted
                    // recovery seed if the seed can be decrypted with either
                    // the current or the legacy key.
                    let result = decrypt_seed_fallback(conn, password, &salt);
                    if result.is_err() {
                        if let Ok(diag) = diagnose_key_derivation_state(conn, password) {
                            eprintln!("[unlock] failed; diagnostic: version={} in_progress={} has_salt={} has_pkey={} has_seed={} has_sentinel={} pkey_new={} pkey_legacy={} seed_new={} seed_legacy={}",
                                diag.version,
                                diag.migration_in_progress,
                                diag.has_salt,
                                diag.has_pkey,
                                diag.has_seed,
                                diag.has_sentinel,
                                diag.pkey_decrypts_new,
                                diag.pkey_decrypts_legacy,
                                diag.seed_decrypts_new,
                                diag.seed_decrypts_legacy,
                            );
                        }
                    }
                    result
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_conn() -> rusqlite::Connection {
        rusqlite::Connection::open_in_memory().expect("in-memory db")
    }

    fn create_schema(conn: &mut rusqlite::Connection) {
        crate::migrations::run_migrations(conn).expect("schema creation");
    }

    #[test]
    fn migration_happy_path() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let plaintext = "nsec1secret";
        let pkey = encrypt_with_key(plaintext, &legacy_key);

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_setting(
            &conn,
            "evm_pkey",
            &encrypt_with_key("0xdeadbeef", &legacy_key),
        )
        .unwrap();
        set_setting(
            &conn,
            "seed",
            &encrypt_with_key("abandon abandon ... art", &legacy_key),
        )
        .unwrap();

        set_key_derivation_version(&conn, 1).unwrap();
        let salt = generate_salt();
        set_key_derivation_salt(&conn, &salt).unwrap();

        migrate_key_derivation_on_conn(&mut conn, password).unwrap();

        let new_key = derive_key_from_salt(password, &salt);
        let migrated_pkey = get_setting(&conn, "pkey").unwrap().unwrap();
        assert_ne!(migrated_pkey, pkey, "ciphertext should have changed");
        assert_eq!(
            decrypt_with_key(&migrated_pkey, &new_key).unwrap(),
            plaintext,
            "pkey should decrypt with new key"
        );
        assert!(
            decrypt_with_key(&migrated_pkey, &legacy_key).is_err(),
            "legacy key should no longer decrypt pkey"
        );

        let version = get_key_derivation_version(&conn).unwrap();
        assert_eq!(version, 2, "version should be 2 after migration");
    }

    #[test]
    fn migration_rejects_wrong_pin() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let pkey = encrypt_with_key("nsec1secret", &derive_legacy_key("1234"));
        set_setting(&conn, "pkey", &pkey).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();

        let salt = generate_salt();
        set_key_derivation_salt(&conn, &salt).unwrap();

        let result = migrate_key_derivation_on_conn(&mut conn, "wrong");
        assert!(result.is_err(), "wrong PIN should fail sentinel validation");

        let version = get_key_derivation_version(&conn).unwrap();
        assert_eq!(version, 1, "version should stay 1 on failure");
    }

    #[test]
    fn migration_retries_partially_migrated_rows() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let salt = generate_salt();
        let new_key = derive_key_from_salt(password, &salt);

        let pkey = encrypt_with_key("nsec1secret", &legacy_key);
        let evm_pkey = encrypt_with_key("0xdeadbeef", &legacy_key);
        let seed = encrypt_with_key("abandon abandon ... art", &legacy_key);

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_setting(&conn, "evm_pkey", &evm_pkey).unwrap();
        set_setting(&conn, "seed", &seed).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();

        // Simulate a partial migration: pkey already re-encrypted, others still legacy.
        set_setting(&conn, "pkey", &encrypt_with_key("nsec1secret", &new_key)).unwrap();

        let reencrypted =
            migrate_account_encryption(&mut conn, &legacy_key, &new_key, &pkey).unwrap();
        assert_eq!(
            reencrypted, 2,
            "only the remaining legacy rows should be re-encrypted"
        );

        // All rows should now decrypt with the new key.
        for (key, expected) in [
            ("pkey", "nsec1secret"),
            ("evm_pkey", "0xdeadbeef"),
            ("seed", "abandon abandon ... art"),
        ] {
            let ciphertext = get_setting(&conn, key).unwrap().unwrap();
            assert_eq!(decrypt_with_key(&ciphertext, &new_key).unwrap(), expected);
        }
    }

    #[test]
    fn require_key_derivation_version_2_passes_when_version_2() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);
        set_key_derivation_version(&conn, 2).unwrap();
        assert!(require_key_derivation_version_2(&conn).is_ok());
    }

    #[test]
    fn require_key_derivation_version_2_fails_when_version_1() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);
        set_key_derivation_version(&conn, 1).unwrap();
        let err = require_key_derivation_version_2(&conn).unwrap_err();
        assert!(
            err.contains("Account security must be updated"),
            "unexpected error: {err}"
        );
        assert!(
            err.contains("Unlock the app to migrate"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn require_key_derivation_version_2_fails_when_version_0() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);
        set_key_derivation_version(&conn, 0).unwrap();
        let err = require_key_derivation_version_2(&conn).unwrap_err();
        assert!(
            err.contains("Account security must be updated"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn version_set_and_get_round_trip() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);
        set_key_derivation_version(&conn, 2).unwrap();
        assert_eq!(get_key_derivation_version(&conn).unwrap(), 2);
        set_key_derivation_version(&conn, 1).unwrap();
        assert_eq!(get_key_derivation_version(&conn).unwrap(), 1);
    }

    #[test]
    fn sentinel_is_created_during_migration() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let plaintext = "nsec1secret";
        let pkey = encrypt_with_key(plaintext, &legacy_key);

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();

        assert!(
            get_key_derivation_sentinel(&conn).unwrap().is_none(),
            "sentinel should be absent before migration"
        );

        migrate_key_derivation_on_conn(&mut conn, password).unwrap();

        let sentinel = get_key_derivation_sentinel(&conn)
            .unwrap()
            .expect("sentinel should exist after migration");
        let salt = get_key_derivation_salt(&conn)
            .unwrap()
            .expect("salt should exist after migration");
        let new_key = derive_key_from_salt(password, &salt);
        assert_eq!(decrypt_with_key(&sentinel, &new_key).unwrap(), plaintext);
    }

    #[test]
    fn migration_sets_and_clears_in_progress_marker() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let pkey = encrypt_with_key("nsec1secret", &legacy_key);

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();
        let salt = generate_salt();
        set_key_derivation_salt(&conn, &salt).unwrap();

        assert!(
            !get_key_derivation_migration_in_progress(&conn).unwrap(),
            "marker should be clear before migration"
        );

        migrate_key_derivation_on_conn(&mut conn, password).unwrap();

        assert!(
            !get_key_derivation_migration_in_progress(&conn).unwrap(),
            "marker should be cleared after successful migration"
        );
        assert_eq!(get_key_derivation_version(&conn).unwrap(), 2);
    }

    #[test]
    fn migration_retries_with_new_key_sentinel() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let salt = generate_salt();
        let new_key = derive_key_from_salt(password, &salt);

        let pkey = encrypt_with_key("nsec1secret", &legacy_key);
        let evm_pkey = encrypt_with_key("0xdeadbeef", &legacy_key);

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_setting(&conn, "evm_pkey", &evm_pkey).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();

        // First migration attempt: encrypts rows and updates sentinel to new key.
        migrate_account_encryption(&mut conn, &legacy_key, &new_key, &pkey).unwrap();

        let sentinel = get_key_derivation_sentinel(&conn)
            .unwrap()
            .expect("sentinel should exist");
        assert!(
            decrypt_with_key(&sentinel, &new_key).is_ok(),
            "sentinel should decrypt with new key"
        );

        // Simulate a crash that left the sentinel new-key encrypted but reset the
        // version marker. The next retry must still accept the PIN.
        set_key_derivation_version(&conn, 1).unwrap();

        let reencrypted =
            migrate_account_encryption(&mut conn, &legacy_key, &new_key, &sentinel).unwrap();
        assert_eq!(reencrypted, 0, "already migrated rows should be skipped");
        assert_eq!(get_key_derivation_version(&conn).unwrap(), 2);
    }

    #[test]
    fn migration_aborts_on_corrupted_row() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let salt = generate_salt();
        let new_key = derive_key_from_salt(password, &salt);

        let pkey = encrypt_with_key("nsec1secret", &legacy_key);
        let bad_evm_pkey = "not-valid-ciphertext";

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_setting(&conn, "evm_pkey", bad_evm_pkey).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();

        let result = migrate_account_encryption(&mut conn, &legacy_key, &new_key, &pkey);
        assert!(result.is_err(), "migration should abort on corrupted row");
        let err = result.unwrap_err();
        assert!(err.contains("Failed to decrypt"), "unexpected error: {err}");
        assert!(
            get_key_derivation_migration_in_progress(&conn).unwrap(),
            "marker should remain set so the next unlock can resume"
        );
    }

    #[tokio::test]
    async fn decrypt_with_password_migrates_legacy_account() {
        let previous_account = crate::account_manager::get_current_account().ok();
        let test_npub = "npub1decryptlegacytest";
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();

        let app = tauri::test::mock_app();

        // Ensure a fresh database for this test account.
        let profile_dir =
            crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);

        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let plaintext = "nsec1secret";
        let pkey = encrypt_with_key(plaintext, &legacy_key);
        let salt = generate_salt();

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();

        crate::account_manager::return_db_connection(conn);

        let result = decrypt_with_password(app.handle(), &pkey, password).await;
        assert!(
            result.is_ok(),
            "legacy account should unlock and migrate: {:?}",
            result.err()
        );
        assert_eq!(result.unwrap(), plaintext);

        // The pkey in the DB should now be re-encrypted with the new key.
        let conn = crate::account_manager::get_db_connection(app.handle()).unwrap();
        let version = get_key_derivation_version(&conn).unwrap();
        assert_eq!(version, 2, "version should be 2 after migration");
        let migrated_pkey = get_setting(&conn, "pkey").unwrap().unwrap();
        assert_ne!(
            migrated_pkey, pkey,
            "ciphertext should have changed after migration"
        );
        let new_key = derive_key_from_salt(password, &salt);
        assert_eq!(
            decrypt_with_key(&migrated_pkey, &new_key).unwrap(),
            plaintext,
            "migrated pkey should decrypt with the new key"
        );
        crate::account_manager::return_db_connection(conn);

        // Restore global state.
        crate::clear_encryption_key();
        crate::account_manager::close_db_connection();
        if let Some(prev) = previous_account {
            let _ = crate::account_manager::set_current_account(prev);
        } else {
            let _ = crate::account_manager::clear_current_account();
        }
    }

    #[test]
    fn migration_refuses_accounts_with_too_many_rows() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let salt = generate_salt();
        let new_key = derive_key_from_salt(password, &salt);

        let pkey = encrypt_with_key("nsec1secret", &legacy_key);
        set_setting(&conn, "pkey", &pkey).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();

        // Insert enough events to exceed the automatic migration limit.
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES ('test-chat', 0, '[]', 0)",
            [],
        )
        .unwrap();
        for i in 0..MIGRATION_ROW_LIMIT + 1 {
            conn.execute(
                "INSERT INTO events (id, kind, chat_id, content, tags, created_at, received_at, mine) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    format!("ev-{}", i),
                    event_kind::PRIVATE_DIRECT_MESSAGE as i64,
                    1,
                    encrypt_with_key("hello", &legacy_key),
                    "[]",
                    i as i64,
                    i as i64,
                    0,
                ],
            )
            .unwrap();
        }

        let result = migrate_account_encryption(&mut conn, &legacy_key, &new_key, &pkey);
        assert!(
            result.is_err(),
            "migration should refuse over-large accounts"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("exceeding the automatic migration limit"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn migration_repairs_half_migrated_account_with_version_2_flag() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let salt = generate_salt();
        let new_key = derive_key_from_salt(password, &salt);

        let pkey = encrypt_with_key("nsec1secret", &legacy_key);
        let evm_pkey = encrypt_with_key("0xdeadbeef", &legacy_key);
        let seed = encrypt_with_key("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", &legacy_key);

        set_setting(&conn, "pkey", &pkey).unwrap();
        set_setting(&conn, "evm_pkey", &evm_pkey).unwrap();
        set_setting(&conn, "seed", &seed).unwrap();
        set_key_derivation_version(&conn, 2).unwrap();
        set_key_derivation_migration_in_progress(&conn, true).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();

        let reencrypted =
            migrate_account_encryption(&mut conn, &legacy_key, &new_key, &pkey).unwrap();
        assert_eq!(reencrypted, 3, "all legacy rows should be re-encrypted");

        let version = get_key_derivation_version(&conn).unwrap();
        assert_eq!(
            version, 2,
            "version should remain 2 after successful repair"
        );
        let in_progress = get_key_derivation_migration_in_progress(&conn).unwrap();
        assert!(!in_progress, "in_progress flag should be cleared");

        for (key, expected) in [
            ("pkey", "nsec1secret"),
            ("evm_pkey", "0xdeadbeef"),
            ("seed", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"),
        ] {
            let ciphertext = get_setting(&conn, key).unwrap().unwrap();
            assert_eq!(
                decrypt_with_key(&ciphertext, &new_key).unwrap(),
                expected,
                "{} should decrypt with new key",
                key
            );
        }
    }

    #[test]
    fn migration_does_not_advance_version_until_success() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "1234";
        let legacy_key = derive_legacy_key(password);
        let salt = generate_salt();
        let new_key = derive_key_from_salt(password, &salt);

        let pkey = encrypt_with_key("nsec1secret", &legacy_key);
        set_setting(&conn, "pkey", &pkey).unwrap();
        set_key_derivation_version(&conn, 1).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();

        // Insert too many rows for automatic migration, causing the scan to fail.
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES ('test-chat', 0, '[]', 0)",
            [],
        )
        .unwrap();
        for i in 0..MIGRATION_ROW_LIMIT + 1 {
            conn.execute(
                "INSERT INTO events (id, kind, chat_id, content, tags, created_at, received_at, mine) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    format!("ev-{}", i),
                    event_kind::PRIVATE_DIRECT_MESSAGE as i64,
                    1,
                    encrypt_with_key("hello", &legacy_key),
                    "[]",
                    i as i64,
                    i as i64,
                    0,
                ],
            )
            .unwrap();
        }

        let result = migrate_account_encryption(&mut conn, &legacy_key, &new_key, &pkey);
        assert!(result.is_err(), "migration should fail");
        let version = get_key_derivation_version(&conn).unwrap();
        assert_eq!(
            version, 1,
            "version should not advance to 2 when migration fails"
        );
    }

    #[test]
    fn decrypt_seed_fallback_returns_nsec_with_current_key() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "123456";
        let salt = generate_salt();
        let key = derive_key_from_salt(password, &salt);
        let seed_phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let encrypted_seed = encrypt_with_key(seed_phrase, &key);
        set_setting(&conn, "seed", &encrypted_seed).unwrap();

        let nsec = decrypt_seed_fallback(&conn, password, &salt).unwrap();
        assert!(
            nsec.starts_with("nsec1"),
            "fallback should return a bech32 nsec"
        );
    }

    #[test]
    fn decrypt_seed_fallback_falls_back_to_legacy_key() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "123456";
        let salt = generate_salt();
        let legacy_key = derive_legacy_key(password);
        let seed_phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let encrypted_seed = encrypt_with_key(seed_phrase, &legacy_key);
        set_setting(&conn, "seed", &encrypted_seed).unwrap();

        let nsec = decrypt_seed_fallback(&conn, password, &salt).unwrap();
        assert!(
            nsec.starts_with("nsec1"),
            "fallback should decode seed with legacy key"
        );
    }

    #[test]
    fn decrypt_seed_fallback_fails_when_seed_missing() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let salt = generate_salt();
        let result = decrypt_seed_fallback(&conn, "123456", &salt);
        assert!(
            result.is_err(),
            "fallback should fail when no seed is stored"
        );
    }

    #[test]
    fn diagnose_key_derivation_state_reports_expected_decrypt_flags() {
        let mut conn = in_memory_conn();
        create_schema(&mut conn);

        let password = "123456";
        let salt = generate_salt();
        let key = derive_key_from_salt(password, &salt);
        let seed_phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let encrypted_seed = encrypt_with_key(seed_phrase, &key);
        let encrypted_pkey = encrypt_with_key("nsec1secret", &key);

        set_setting(&conn, "pkey", &encrypted_pkey).unwrap();
        set_setting(&conn, "seed", &encrypted_seed).unwrap();
        set_key_derivation_salt(&conn, &salt).unwrap();
        set_key_derivation_version(&conn, 2).unwrap();

        let diag = diagnose_key_derivation_state(&conn, password).unwrap();
        assert_eq!(diag.version, 2);
        assert!(!diag.migration_in_progress);
        assert!(diag.has_salt);
        assert!(diag.has_pkey);
        assert!(diag.has_seed);
        assert!(diag.pkey_decrypts_new);
        assert!(!diag.pkey_decrypts_legacy);
        assert!(diag.seed_decrypts_new);
        assert!(!diag.seed_decrypts_legacy);
    }
}
