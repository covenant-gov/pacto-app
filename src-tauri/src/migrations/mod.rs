use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("src/migrations");
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

/// Stamp an existing database as already migrated to the latest version.
///
/// Every existing account has had `run_migrations` applied on each unlock, so
/// it is already at the final schema state. We insert history records with the
/// same checksums as the embedded migrations so refinery treats them as applied.
fn baseline_existing_account(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let runner = embedded::migrations::runner();
    let migrations = runner.get_migrations();
    let applied_on = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| format!("Failed to format baseline timestamp: {}", e))?;

    let tx = conn.transaction().map_err(|e| format!("Failed to start baseline transaction: {}", e))?;
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

    #[test]
    fn fresh_database_runs_all_migrations() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        run_migrations(&mut conn).expect("migrations should run");

        let last_version: i32 = conn
            .query_row(
                "SELECT MAX(version) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(last_version, 27);

        let events_table: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'events'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);
        assert!(events_table, "events table should exist");
    }

    #[test]
    fn existing_database_is_baselined() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .expect("create settings");

        run_migrations(&mut conn).expect("baseline should run");

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(count, 27, "all migrations should be baselined");

        // Running migrations again should be idempotent.
        run_migrations(&mut conn).expect("baseline should be idempotent");
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

        let last_version: i32 = conn
            .query_row(
                "SELECT MAX(version) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .expect("history should exist");
        assert_eq!(last_version, 27);

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
            .query_row(
                "SELECT COUNT(*) FROM events WHERE id = 'msg1'",
                [],
                |row| row.get(0),
            )
            .expect("count events");
        assert_eq!(migrated_event, 1, "V1 message should be migrated to events");
    }
}
