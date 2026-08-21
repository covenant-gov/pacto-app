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
///
/// A database that already has a history table goes through
/// `reconcile_legacy_checksums_for_table` first: a pre-0.6.0 build stamped
/// it with checksums computed under a narrower `SchemaVersion` type, which
/// `embedded::migrations::runner().run` below -- refinery's own
/// checksum-verifying apply -- would otherwise reject as divergent. See
/// `reconcile_legacy_checksums_for_table` for why.
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
    } else {
        reconcile_legacy_checksums_for_table(
            conn,
            "refinery_schema_history",
            &embedded::migrations::runner().get_migrations().clone(),
        )?;
    }

    embedded::migrations::runner()
        .run(conn)
        .map_err(|e| format!("Migration failed: {}", e))?;

    Ok(())
}

/// Idempotent repair for a database whose refinery history table's
/// `checksum` values were stamped by a build compiled without the
/// `int8-versions` Cargo feature -- every Pacto release before 0.6.0, for
/// `refinery_schema_history` in `pacto.db`; every release before
/// `int8-versions` propagated through Cargo's unified feature resolution,
/// for `_refinery_schema_history_nostr_mls` in the MLS store (see
/// `mls_store_reset::reconcile_mls_store_legacy_checksums`, the other
/// caller). Enabling that feature changed `refinery::SchemaVersion` from
/// `i32` to `i64` (needed so a 14-digit UTC-timestamp migration version
/// fits); refinery hashes `(name, version, sql)` together, and hashing an
/// `i32` vs an `i64` for the identical numeric value feeds a different
/// byte width into the hasher -- silently changing the checksum of every
/// migration a pre-`int8-versions` build had already applied, even though
/// nothing about the migration's content changed. Left unreconciled, the
/// refinery `Runner::run` that follows this call for either table aborts
/// with `DivergentVersion` on the first such row.
///
/// Rewrites the stored checksum to this build's current value wherever it
/// exactly matches the legacy (i32-schema-version) checksum for that
/// migration, via raw SQL rather than the refinery API, so a row is only
/// ever touched by an exact legacy-checksum match. A row that matches
/// neither checksum is a genuine divergence and is left alone --
/// `Runner::run` (and `storage_format::classify_history`'s read-only
/// probe, which tolerates the same legacy checksum for `pacto.db`) still
/// catch that for real.
pub(crate) fn reconcile_legacy_checksums_for_table(
    conn: &rusqlite::Connection,
    table_name: &str,
    migrations: &[refinery::Migration],
) -> Result<(), String> {
    for migration in migrations {
        let Some(sql) = migration.sql() else {
            continue;
        };
        let current_checksum = migration.checksum().to_string();
        let legacy_checksum =
            crate::storage_format::legacy_i32_checksum(migration.name(), migration.version(), sql)
                .to_string();
        if legacy_checksum == current_checksum {
            continue;
        }
        conn.execute(
            &format!(
                "UPDATE \"{table_name}\" \
                 SET checksum = ?1 \
                 WHERE version = ?2 AND name = ?3 AND checksum = ?4"
            ),
            rusqlite::params![
                current_checksum,
                migration.version(),
                migration.name(),
                legacy_checksum
            ],
        )
        .map_err(|e| {
            format!(
                "Failed to reconcile legacy checksum for {} in {table_name}: {}",
                migration, e
            )
        })?;
    }
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

/// Minimal V1–V27 tables for baseline tests. Real accounts had `squad_infra` from V14.
#[cfg(test)]
pub(crate) fn seed_pre_v28_schema(conn: &rusqlite::Connection) {
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
        );
        CREATE TABLE mls_keypackages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_pubkey TEXT NOT NULL,
            device_id TEXT NOT NULL,
            keypackage_ref TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX idx_keypackages_owner ON mls_keypackages(owner_pubkey);
        CREATE TABLE events (
            id TEXT PRIMARY KEY,
            kind INTEGER NOT NULL,
            chat_id INTEGER NOT NULL,
            user_id INTEGER,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            reference_id TEXT,
            created_at INTEGER NOT NULL,
            received_at INTEGER NOT NULL,
            mine INTEGER NOT NULL DEFAULT 0,
            pending INTEGER NOT NULL DEFAULT 0,
            failed INTEGER NOT NULL DEFAULT 0,
            wrapper_event_id TEXT,
            npub TEXT,
            virtual_bucket TEXT
        );
        CREATE TABLE squad_infra (
            id TEXT PRIMARY KEY NOT NULL,
            parent_id TEXT NOT NULL,
            infra_type TEXT NOT NULL,
            chain TEXT NOT NULL,
            canonical_ref TEXT NOT NULL,
            pacto_gov_revision TEXT,
            provider_payload TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX idx_squad_infra_parent ON squad_infra(parent_id, created_at_ms);
        CREATE UNIQUE INDEX idx_squad_infra_pacto_gov_singleton
            ON squad_infra(parent_id, infra_type) WHERE infra_type = 'pacto_gov';",
    )
    .expect("seed pre-V28 schema");
}

#[cfg(test)]
mod tests {
    use super::*;
    use refinery::Migration;

    fn stamp_migration(conn: &mut rusqlite::Connection, migration: &Migration) {
        stamp_migration_with_checksum(conn, migration, &migration.checksum().to_string());
    }

    /// Like `stamp_migration`, but with an explicit checksum -- used to
    /// simulate a row stamped by a pre-0.6.0 build (a legacy i32-schema-
    /// version checksum) instead of this build's own.
    fn stamp_migration_with_checksum(
        conn: &mut rusqlite::Connection,
        migration: &Migration,
        checksum: &str,
    ) {
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
            rusqlite::params![migration.version(), migration.name(), &applied_on, checksum],
        )
        .expect("stamp migration");
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
        assert_eq!(last_version, embedded_ceiling());

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

        let cutoff_table: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'dm_deletion_cutoffs'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);
        assert!(cutoff_table, "dm_deletion_cutoffs table should exist");
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
            count as usize,
            embedded_migration_set().len(),
            "every embedded migration is either baselined or actually run"
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
            last_version,
            embedded_ceiling(),
            "an existing history table means every migration actually runs, never gets stamped"
        );
    }

    /// The V1 schema (`profiles`, `chats`, `messages`, `settings`,
    /// `mls_groups`, `mls_keypackages`, `mls_event_cursors`) as it existed
    /// before any migration ran, for simulating an account created at that
    /// version.
    fn seed_v1_schema(conn: &rusqlite::Connection) {
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
    }

    #[test]
    fn v1_database_migrates_to_latest() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        // Apply the V1 schema manually to simulate an account created at that version.
        seed_v1_schema(&conn);

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
        assert_eq!(last_version, embedded_ceiling());

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

    /// Regression test for the checksum break the `int8-versions` Cargo
    /// feature introduced (see `reconcile_legacy_checksums_for_table`): a V1 row
    /// stamped with the *legacy* i32-schema-version checksum -- what every
    /// pre-0.6.0 build actually wrote -- must still let `run_migrations`
    /// proceed instead of refinery aborting with `DivergentVersion`, and
    /// the stored checksum must come out reconciled to this build's
    /// current value afterward.
    #[test]
    fn v1_database_with_legacy_checksum_reconciles_and_migrates() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        seed_v1_schema(&conn);

        let runner = embedded::migrations::runner();
        let migrations = runner.get_migrations();
        let v1 = migrations
            .iter()
            .find(|m| m.version() == 1)
            .expect("V1 migration should be embedded");
        let legacy_checksum = crate::storage_format::legacy_i32_checksum(
            v1.name(),
            v1.version(),
            v1.sql().expect("embedded migration has sql"),
        )
        .to_string();
        assert_ne!(
            legacy_checksum,
            v1.checksum().to_string(),
            "test fixture must actually exercise a checksum mismatch"
        );
        stamp_migration_with_checksum(&mut conn, v1, &legacy_checksum);

        run_migrations(&mut conn).expect("legacy checksum should not block migration");

        let reconciled_checksum: String = conn
            .query_row(
                "SELECT checksum FROM refinery_schema_history WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .expect("V1 history row should exist");
        assert_eq!(
            reconciled_checksum,
            v1.checksum().to_string(),
            "legacy checksum should be rewritten to this build's current checksum"
        );

        let last_version: i64 = conn
            .query_row(
                "SELECT MAX(version) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(last_version, embedded_ceiling());
    }

    /// `v1_database_with_legacy_checksum_reconciles_and_migrates` above only
    /// stamps a single row with a legacy checksum. A real 0.5.x history has
    /// every applied migration on the legacy digest, so this proves the
    /// reconciliation loop rewrites all of them, not just the first --
    /// while leaving a row that matches neither checksum untouched.
    #[test]
    fn reconcile_legacy_checksums_for_table_rewrites_every_stamped_row() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE refinery_schema_history (
                version INTEGER PRIMARY KEY,
                name VARCHAR(255),
                applied_on VARCHAR(255),
                checksum VARCHAR(255)
            );",
        )
        .expect("create history table");

        let runner = embedded::migrations::runner();
        let all_migrations = runner.get_migrations();
        let sample: Vec<&Migration> = all_migrations
            .iter()
            .filter(|m| m.sql().is_some())
            .take(5)
            .collect();
        assert!(
            sample.len() >= 2,
            "need at least two real migrations to prove the loop, not just the first"
        );

        let applied_on = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .expect("format timestamp");
        for migration in &sample {
            let legacy_checksum = crate::storage_format::legacy_i32_checksum(
                migration.name(),
                migration.version(),
                migration
                    .sql()
                    .expect("sample only has migrations with sql"),
            )
            .to_string();
            conn.execute(
                "INSERT INTO refinery_schema_history (version, name, applied_on, checksum) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![migration.version(), migration.name(), &applied_on, legacy_checksum],
            )
            .expect("stamp legacy row");
        }
        // A genuinely divergent row -- neither legacy nor current -- must be left alone.
        let last = all_migrations.last().expect("embedded set is non-empty");
        let divergent_version = last.version() + 1_000_000;
        conn.execute(
            "INSERT INTO refinery_schema_history (version, name, applied_on, checksum) VALUES (?1, 'divergent-fixture', ?2, 'not-a-real-checksum')",
            rusqlite::params![divergent_version, &applied_on],
        )
        .expect("stamp divergent row");

        reconcile_legacy_checksums_for_table(&conn, "refinery_schema_history", all_migrations)
            .expect("reconciliation should not error");

        for migration in &sample {
            let stored: String = conn
                .query_row(
                    "SELECT checksum FROM refinery_schema_history WHERE version = ?1",
                    [migration.version()],
                    |row| row.get(0),
                )
                .expect("row should exist");
            assert_eq!(
                stored,
                migration.checksum().to_string(),
                "version {} should be rewritten to the current checksum",
                migration.version()
            );
        }

        let divergent_checksum: String = conn
            .query_row(
                "SELECT checksum FROM refinery_schema_history WHERE version = ?1",
                [divergent_version],
                |row| row.get(0),
            )
            .expect("divergent row should exist");
        assert_eq!(
            divergent_checksum, "not-a-real-checksum",
            "a row matching neither checksum must be left alone"
        );
    }
}
