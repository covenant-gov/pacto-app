use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Migrations before 2026-08-08 are numbered sequentially (`V1`, `V2`, ...).
/// New migrations must instead use a UTC timestamp version
/// (`V<YYYYMMDDHHMMSS>__snake_case_name.sql`, e.g.
/// `date -u +V%Y%m%d%H%M%S`) so two branches authored in parallel can never
/// pick the same next integer and collide on refinery's
/// `refinery_schema_history.version` primary key when both merge. Requires
/// `SchemaVersion = i64` (the `int8-versions` feature on the `refinery`
/// dependency in `Cargo.toml`) -- a 14-digit timestamp overflows the
/// default `i32`. Existing sequential versions are untouched; the two
/// schemes coexist because ordering stays purely numeric either way.
mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("src/migrations");
}

/// Highest migration version that existed when refinery replaced the
/// hand-rolled migration runner (commit 6542130, "adopt refinery for SQLite
/// migrations", src-tauri/src/migrations/ as of that commit: V1..V27).
/// Hard-coded, not derived from the embedded set — deriving it from
/// `get_migrations()` would silently raise the ceiling every time a new
/// migration is added, reintroducing the defect this constant exists to fix.
pub(crate) const PRE_REFINERY_CEILING: i64 = 27;

/// Highest version in the embedded migration set. Derived at compile time
/// from `embed_migrations!`, unlike `PRE_REFINERY_CEILING` which is pinned
/// to a historical commit: this ceiling is meant to move every time a
/// migration file is added, because it exists to recognize a database
/// written by a *newer* build than the one running, not to gate the
/// baseline-detection behavior `PRE_REFINERY_CEILING` protects.
pub(crate) fn embedded_ceiling() -> i64 {
    embedded::migrations::runner()
        .get_migrations()
        .iter()
        .map(|m| m.version())
        .max()
        .unwrap_or(0)
}

/// The full embedded migration set (version, name, checksum), for read-only
/// parity comparison against a database's applied history without running
/// anything.
pub(crate) fn embedded_migration_set() -> Vec<refinery::Migration> {
    embedded::migrations::runner().get_migrations().clone()
}

/// Run all refinery migrations on the supplied connection.
///
/// Existing pre-refinery databases are detected by the absence of
/// `refinery_schema_history` and the presence of `settings`, and are
/// baselined by stamping the full migration history without re-running it.
pub fn run_migrations(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let history_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'refinery_schema_history'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !history_exists {
        let has_settings: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if has_settings {
            baseline_existing_account(conn)?;
        }
    }

    embedded::migrations::runner()
        .run(conn)
        .map_err(|e| format!("Migration failed: {}", e))?;

    Ok(())
}

/// Select the subset of `migrations` at or below `ceiling`. Extracted so the
/// filtering logic — the actual fix — is unit-testable independent of a
/// database connection.
fn migrations_to_baseline(
    migrations: &[refinery::Migration],
    ceiling: i64,
) -> Vec<&refinery::Migration> {
    migrations
        .iter()
        .filter(|m| m.version() <= ceiling)
        .collect()
}

/// Stamp an existing database as already migrated to the pre-refinery
/// ceiling.
///
/// Every existing account has had `run_migrations` applied on each unlock,
/// so it is already at the schema state that existed when refinery was
/// introduced. We insert history records only for migrations up to
/// `PRE_REFINERY_CEILING`, with the same checksums as the embedded
/// migrations, so refinery treats them as applied. Migrations above the
/// ceiling are left un-stamped and run normally on the call to
/// `embedded::migrations::runner().run(conn)` that follows in
/// `run_migrations` — stamping the whole embedded set here would mark a
/// migration added after this baseline was written as applied without ever
/// running it.
fn baseline_existing_account(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let runner = embedded::migrations::runner();
    let migrations = migrations_to_baseline(runner.get_migrations(), PRE_REFINERY_CEILING);
    let applied_on = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| format!("Failed to format baseline timestamp: {}", e))?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start baseline transaction: {}", e))?;
    tx.execute_batch(
        "CREATE TABLE refinery_schema_history (
            version INTEGER PRIMARY KEY,
            name VARCHAR(255),
            applied_on VARCHAR(255),
            checksum VARCHAR(255)
        );",
    )
    .map_err(|e| format!("Failed to create refinery_schema_history: {}", e))?;

    for migration in migrations {
        tx.execute(
            "INSERT INTO refinery_schema_history (version, name, applied_on, checksum) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                migration.version(),
                migration.name(),
                &applied_on,
                migration.checksum().to_string()
            ],
        )
        .map_err(|e| format!("Failed to baseline migration {}: {}", migration, e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit baseline transaction: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use refinery::Migration;

    fn stamp_migration(conn: &mut rusqlite::Connection, migration: &Migration) {
        let applied_on = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .expect("format baseline timestamp");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS refinery_schema_history (
                version INTEGER PRIMARY KEY,
                name VARCHAR(255),
                applied_on VARCHAR(255),
                checksum VARCHAR(255)
            );",
        )
        .expect("create history table");
        conn.execute(
            "INSERT INTO refinery_schema_history (version, name, applied_on, checksum) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                migration.version(),
                migration.name(),
                &applied_on,
                migration.checksum().to_string()
            ],
        )
        .expect("stamp migration");
    }

    /// Seed the `chats` and `profiles` tables as they existed immediately
    /// before V28 (the first migration above `PRE_REFINERY_CEILING`), so a
    /// baselined connection has real tables for V28's `ALTER TABLE`
    /// statements to run against — matching a real existing account, which
    /// has these tables from `run_migrations` on every prior unlock.
    fn seed_pre_v28_schema(conn: &rusqlite::Connection) {
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                npub TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                display_name TEXT NOT NULL DEFAULT '',
                nickname TEXT NOT NULL DEFAULT '',
                lud06 TEXT NOT NULL DEFAULT '',
                lud16 TEXT NOT NULL DEFAULT '',
                banner TEXT NOT NULL DEFAULT '',
                avatar TEXT NOT NULL DEFAULT '',
                about TEXT NOT NULL DEFAULT '',
                website TEXT NOT NULL DEFAULT '',
                nip05 TEXT NOT NULL DEFAULT '',
                status_content TEXT NOT NULL DEFAULT '',
                status_url TEXT NOT NULL DEFAULT '',
                muted INTEGER NOT NULL DEFAULT 0,
                bot INTEGER NOT NULL DEFAULT 0,
                avatar_cached TEXT NOT NULL DEFAULT '',
                banner_cached TEXT NOT NULL DEFAULT '',
                evm_address TEXT NOT NULL DEFAULT '',
                blocked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_identifier TEXT UNIQUE NOT NULL,
                chat_type INTEGER NOT NULL,
                participants TEXT NOT NULL,
                last_read TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                muted INTEGER NOT NULL DEFAULT 0
            );",
        )
        .expect("seed pre-V28 schema");
    }

    #[test]
    fn fresh_database_runs_all_migrations() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        run_migrations(&mut conn).expect("migrations should run");

        let last_version: i64 = conn
            .query_row(
                "SELECT MAX(version) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(last_version, 30);

        let events_table: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'events'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);
        assert!(events_table, "events table should exist");

        let catch_up_table: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'catch_up_entries'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);
        assert!(catch_up_table, "catch_up_entries table should exist");
    }

    #[test]
    fn existing_database_is_baselined() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        seed_pre_v28_schema(&conn);

        run_migrations(&mut conn).expect("baseline should run");

        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |row| {
                row.get(0)
            })
            .expect("history should exist");
        assert_eq!(
            count, 30,
            "27 pre-refinery migrations baselined plus V28, V29, and V30 actually run"
        );

        // Running migrations again should be idempotent.
        run_migrations(&mut conn).expect("baseline should be idempotent");
    }

    #[test]
    fn migrations_to_baseline_excludes_versions_above_ceiling() {
        let runner = embedded::migrations::runner();
        let all_migrations = runner.get_migrations();
        // The production ceiling currently equals the highest embedded
        // version, so exercising the exclusion boundary needs a synthetic,
        // lower ceiling here. Without the filter (the pre-fix behavior),
        // `baselined.len()` would equal `all_migrations.len()` and this
        // assertion would fail.
        let synthetic_ceiling = 10;
        let baselined = migrations_to_baseline(all_migrations, synthetic_ceiling);

        assert!(!baselined.is_empty());
        assert!(
            baselined.iter().all(|m| m.version() <= synthetic_ceiling),
            "no baselined migration may exceed the ceiling"
        );
        assert!(
            baselined.len() < all_migrations.len(),
            "the filter must exclude migrations above the ceiling, not return everything"
        );
    }

    #[test]
    fn baseline_stamps_up_to_ceiling_only() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        seed_pre_v28_schema(&conn);

        run_migrations(&mut conn).expect("baseline should run");

        let baselined_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM refinery_schema_history WHERE version <= ?1",
                [PRE_REFINERY_CEILING],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(
            baselined_count, PRE_REFINERY_CEILING,
            "every pre-ceiling migration must be baselined, no more and no fewer"
        );

        let ran_above_ceiling: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM refinery_schema_history WHERE version > ?1",
                [PRE_REFINERY_CEILING],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert!(
            ran_above_ceiling > 0,
            "a migration above the ceiling must actually run, not be silently absent or stamped"
        );
    }

    #[test]
    fn database_with_history_table_is_never_baselined() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE refinery_schema_history (
                version INTEGER PRIMARY KEY,
                name VARCHAR(255),
                applied_on VARCHAR(255),
                checksum VARCHAR(255)
            );",
        )
        .expect("create empty history table");

        run_migrations(&mut conn).expect("migrations should run from scratch");

        let last_version: i64 = conn
            .query_row(
                "SELECT MAX(version) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(
            last_version, 30,
            "an existing history table means every migration actually runs, never gets stamped"
        );
    }

    #[test]
    fn v1_database_migrates_to_latest() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        // Apply the V1 schema manually to simulate an account created at that version.
        conn.execute_batch(
            r#"
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                npub TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                display_name TEXT NOT NULL DEFAULT '',
                nickname TEXT NOT NULL DEFAULT '',
                lud06 TEXT NOT NULL DEFAULT '',
                lud16 TEXT NOT NULL DEFAULT '',
                banner TEXT NOT NULL DEFAULT '',
                avatar TEXT NOT NULL DEFAULT '',
                about TEXT NOT NULL DEFAULT '',
                website TEXT NOT NULL DEFAULT '',
                nip05 TEXT NOT NULL DEFAULT '',
                status_content TEXT NOT NULL DEFAULT '',
                status_url TEXT NOT NULL DEFAULT '',
                muted INTEGER NOT NULL DEFAULT 0,
                bot INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_identifier TEXT UNIQUE NOT NULL,
                chat_type INTEGER NOT NULL,
                participants TEXT NOT NULL,
                last_read TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                muted INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                chat_id INTEGER NOT NULL,
                content_encrypted TEXT NOT NULL,
                replied_to TEXT NOT NULL DEFAULT '',
                preview_metadata TEXT,
                attachments TEXT NOT NULL DEFAULT '[]',
                reactions TEXT NOT NULL DEFAULT '[]',
                at INTEGER NOT NULL,
                mine INTEGER NOT NULL,
                user_id INTEGER
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE mls_groups (group_id TEXT PRIMARY KEY);
            CREATE TABLE mls_keypackages (id INTEGER PRIMARY KEY AUTOINCREMENT);
            CREATE TABLE mls_event_cursors (group_id TEXT PRIMARY KEY);
            "#,
        )
        .expect("v1 schema");

        // Seed V1 with a message so the V7 migration path has real data to transform.
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at) VALUES ('chat1', 0, '[]', 1)",
            [],
        )
        .expect("insert chat");
        conn.execute(
            "INSERT INTO messages (id, chat_id, content_encrypted, at, mine) VALUES ('msg1', 1, 'enc', 1, 0)",
            [],
        )
        .expect("insert message");

        // Stamp V1 as applied so refinery runs V2..V27 instead of trying to re-create V1 tables.
        let runner = embedded::migrations::runner();
        let migrations = runner.get_migrations();
        let v1 = migrations
            .iter()
            .find(|m| m.version() == 1)
            .expect("V1 migration should be embedded");
        stamp_migration(&mut conn, v1);

        run_migrations(&mut conn).expect("migrations should run");

        let last_version: i64 = conn
            .query_row(
                "SELECT MAX(version) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(last_version, 30);

        let has_virtual_bucket: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('events') WHERE name = 'virtual_bucket'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);
        assert!(has_virtual_bucket, "events should have virtual_bucket");

        let migrated_event: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE id = 'msg1'", [], |row| {
                row.get(0)
            })
            .expect("count events");
        assert_eq!(migrated_event, 1, "V1 message should be migrated to events");
    }
}
