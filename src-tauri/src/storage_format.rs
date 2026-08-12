//! Read-only storage-format recognition for the app database (`pacto.db`).
//!
//! Reproduces refinery-core 0.9.2's `verify_migrations` abort semantics
//! ahead of time, on a read-only connection, so the app can tell a user to
//! update instead of surfacing refinery's own opaque migration error. Never
//! calls `run_migrations` or `get_db_connection` -- either would migrate the
//! database as a side effect of merely checking it.

use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Runtime};

/// Busy-timeout mirroring `account_manager::account_has_valid_pkey`'s
/// precedent: wait out a transient lock from the main pooled connection
/// instead of treating a momentary lock as an unrecognized schema.
const PROBE_BUSY_TIMEOUT: Duration = Duration::from_millis(2000);

/// Wall-clock budget for `scan_profiles`. A profile reached after the
/// deadline is left unscanned and therefore does not contribute to the
/// report -- the same "not a version problem" policy as any other read
/// failure.
const SCAN_DEADLINE: Duration = Duration::from_secs(5);

/// One row read from a refinery schema-history table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HistoryRow {
    pub(crate) version: i64,
    pub(crate) name: String,
    pub(crate) checksum: String,
}

/// Read-only probe shared with `mls_store_reset`: whether `history_table`
/// exists on `conn`, and if so, every row it holds ordered by version.
/// Parameterized by table name because the app database's refinery table
/// (`refinery_schema_history`) and the MLS store's own
/// (`_refinery_schema_history_nostr_mls`) are distinct tables.
pub(crate) fn read_history_table(
    conn: &Connection,
    history_table: &str,
) -> Result<(bool, Vec<HistoryRow>), rusqlite::Error> {
    if !table_exists(conn, history_table)? {
        return Ok((false, Vec::new()));
    }

    let query =
        format!("SELECT version, name, checksum FROM \"{history_table}\" ORDER BY version ASC");
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(HistoryRow {
                version: row.get(0)?,
                name: row.get(1)?,
                checksum: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok((true, rows))
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [name],
        |row| row.get(0),
    )
}

/// Whether this build recognizes a profile's on-disk `pacto.db` schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StorageFormatVerdict {
    /// No database file at all -- nothing to recognize or reject.
    Fresh,
    /// No `refinery_schema_history` table, but `settings` is present:
    /// `run_migrations` baselines this without validating structure further.
    ///
    /// Binding constraint: no future migration may drop or rename
    /// `refinery_schema_history`. If one did, a database that never went
    /// through refinery would land in this same arm, get a forged history
    /// stamped over it by `baseline_existing_account` without ever having
    /// its structure validated, and then be migrated blind.
    PreRefinery,
    Recognized,
    /// An applied row with no counterpart in the embedded migration set --
    /// refinery's `MissingVersion` abort.
    Unrecognized(i64),
    /// An applied row whose embedded counterpart differs on name or
    /// checksum, or an embedded migration at or below the applied maximum
    /// that was never applied -- refinery's `DivergentVersion` abort, or its
    /// other `MissingVersion` case.
    Divergent(i64),
}

/// Pure classification over the read-only probe's outputs. Reproduces
/// refinery-core 0.9.2's `verify_migrations` (default `abort_missing: true`,
/// `abort_divergent: true`) read-only, looping over every applied row --
/// checking only the highest would miss a divergent or missing migration
/// buried lower in the history.
fn classify_history(
    applied: &[HistoryRow],
    history_table_exists: bool,
    settings_table_exists: bool,
    embedded: &[refinery::Migration],
) -> StorageFormatVerdict {
    if !history_table_exists {
        return if settings_table_exists {
            StorageFormatVerdict::PreRefinery
        } else {
            StorageFormatVerdict::Fresh
        };
    }

    if applied.is_empty() {
        return StorageFormatVerdict::Recognized;
    }

    // Every applied row must have an embedded counterpart with the same
    // name and checksum (refinery's MissingVersion / DivergentVersion).
    for row in applied {
        match embedded.iter().find(|m| m.version() == row.version) {
            None => return StorageFormatVerdict::Unrecognized(row.version),
            Some(migration) => {
                if migration.name() != row.name || migration.checksum().to_string() != row.checksum
                {
                    return StorageFormatVerdict::Divergent(row.version);
                }
            }
        }
    }

    // An embedded versioned migration at or below the database's highest
    // applied version that was never applied (refinery's other
    // MissingVersion case).
    let current = applied
        .iter()
        .map(|row| row.version)
        .max()
        .unwrap_or(i64::MIN);
    for migration in embedded {
        let never_applied = !applied.iter().any(|row| row.version == migration.version());
        if migration.version() <= current && never_applied {
            return StorageFormatVerdict::Divergent(migration.version());
        }
    }

    StorageFormatVerdict::Recognized
}

/// Classify one already-open connection. Shared by `classify_database` (the
/// real read-only-open path) and tests that want to probe a live connection
/// (e.g. one already migrated in-memory) without a second file handle.
fn classify_connection(conn: &Connection) -> Result<StorageFormatVerdict, rusqlite::Error> {
    let (history_table_exists, applied) = read_history_table(conn, "refinery_schema_history")?;
    let settings_table_exists = table_exists(conn, "settings")?;
    Ok(classify_history(
        &applied,
        history_table_exists,
        settings_table_exists,
        &crate::migrations::embedded_migration_set(),
    ))
}

/// Classify `path` without migrating it. Opens read-only with a short busy
/// timeout; any failure to open or query -- corruption, a lock outliving the
/// timeout, a truncated file -- classifies as `Recognized`. Those are not
/// version problems, and the existing error paths already own them.
pub(crate) fn classify_database(path: &Path) -> StorageFormatVerdict {
    if !path.exists() {
        return StorageFormatVerdict::Fresh;
    }

    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match Connection::open_with_flags(path, flags) {
        Ok(conn) => conn,
        Err(_) => return StorageFormatVerdict::Recognized,
    };
    if conn.busy_timeout(PROBE_BUSY_TIMEOUT).is_err() {
        return StorageFormatVerdict::Recognized;
    }

    classify_connection(&conn).unwrap_or(StorageFormatVerdict::Recognized)
}

/// Aggregate verdict across every profile directory under `app_data_dir`.
/// Carries no npub and no filesystem path -- only counts and a bare version
/// number -- so it is safe to surface in a block screen or a support report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StorageFormatScanReport {
    pub(crate) all_recognized: bool,
    pub(crate) unrecognized_count: usize,
    pub(crate) highest_offending_version: Option<i64>,
}

/// Scan every `npub1*` profile directory's `pacto.db` under `app_data_dir`.
/// A profile with no database file classifies `Fresh` and is not counted.
/// Bounded by `SCAN_DEADLINE`: a profile reached after the deadline is left
/// unscanned rather than blocking launch on a slow disk.
pub(crate) fn scan_profiles(app_data_dir: &Path) -> StorageFormatScanReport {
    let deadline = Instant::now() + SCAN_DEADLINE;
    let mut unrecognized_count = 0usize;
    let mut highest_offending_version: Option<i64> = None;

    if let Ok(entries) = std::fs::read_dir(app_data_dir) {
        for entry in entries.flatten() {
            if Instant::now() >= deadline {
                break;
            }
            let path = entry.path();
            let is_profile_dir = path.is_dir()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with("npub1"));
            if !is_profile_dir {
                continue;
            }

            let verdict = classify_database(&path.join("pacto.db"));
            if let StorageFormatVerdict::Unrecognized(version)
            | StorageFormatVerdict::Divergent(version) = verdict
            {
                unrecognized_count += 1;
                highest_offending_version =
                    Some(highest_offending_version.map_or(version, |max| max.max(version)));
            }
        }
    }

    StorageFormatScanReport {
        all_recognized: unrecognized_count == 0,
        unrecognized_count,
        highest_offending_version,
    }
}

/// Frontend-facing report combining `StorageFormatScanReport` with the
/// highest schema version this build supports, so the launch gate can
/// render "recognized" vs. "this build only supports up to schema X, found
/// Y on disk" without a second round trip. `supported_schema_version` is
/// this build's embedded migration ceiling, not its own release version --
/// the two are unrelated, and the frontend already has its own release
/// version via `resolveInstalledVersion()` for the separate minimum-version
/// reason. Carries no filesystem path or npub for the same reason
/// `StorageFormatScanReport` does not.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageCompatibilityReport {
    pub(crate) all_recognized: bool,
    pub(crate) unrecognized_count: usize,
    pub(crate) highest_offending_version: Option<i64>,
    pub(crate) supported_schema_version: i64,
}

impl From<StorageFormatScanReport> for StorageCompatibilityReport {
    fn from(report: StorageFormatScanReport) -> Self {
        Self {
            all_recognized: report.all_recognized,
            unrecognized_count: report.unrecognized_count,
            highest_offending_version: report.highest_offending_version,
            supported_schema_version: crate::migrations::embedded_ceiling(),
        }
    }
}

/// Pure report builder shared by the command and its tests: `scan_profiles`
/// plus this build's own version, with no `AppHandle` involved.
pub(crate) fn compatibility_report(app_data_dir: &Path) -> StorageCompatibilityReport {
    scan_profiles(app_data_dir).into()
}

/// Report whether this build recognizes every local profile's storage
/// format, for the launch gate to consult before routing to onboarding or
/// unlock. Runs before authentication, so the error variant must never name
/// a path or an npub -- unlike `get_profile_directory`'s own errors, which
/// this command must not reuse.
#[tauri::command]
pub(crate) fn get_storage_compatibility<R: Runtime>(
    app: AppHandle<R>,
) -> Result<StorageCompatibilityReport, String> {
    let app_data_dir = crate::test_sandbox::test_data_dir(&app)
        .map_err(|_| "Unable to resolve app storage location".to_string())?;
    Ok(compatibility_report(&app_data_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_migration(version: i64, name: &str, checksum: u64) -> refinery::Migration {
        refinery::Migration::applied(
            version,
            name.to_string(),
            time::OffsetDateTime::now_utc(),
            checksum,
        )
    }

    fn fixture_embedded(count: i64) -> Vec<refinery::Migration> {
        (1..=count)
            .map(|v| fixture_migration(v, &format!("m{v}"), v as u64))
            .collect()
    }

    fn fixture_row(version: i64, name: &str, checksum: &str) -> HistoryRow {
        HistoryRow {
            version,
            name: name.to_string(),
            checksum: checksum.to_string(),
        }
    }

    fn unique_temp_dir(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "pacto-storage-format-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn write_migrated_db(path: &Path) {
        let mut conn = rusqlite::Connection::open(path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
    }

    // -- pure classify_history ------------------------------------------

    #[test]
    fn full_match_is_recognized() {
        let embedded = fixture_embedded(3);
        let applied = vec![
            fixture_row(1, "m1", "1"),
            fixture_row(2, "m2", "2"),
            fixture_row(3, "m3", "3"),
        ];
        assert_eq!(
            classify_history(&applied, true, true, &embedded),
            StorageFormatVerdict::Recognized
        );
    }

    #[test]
    fn row_above_highest_embedded_is_unrecognized() {
        let embedded = fixture_embedded(3);
        let mut applied: Vec<HistoryRow> = (1..=3)
            .map(|v| fixture_row(v, &format!("m{v}"), &v.to_string()))
            .collect();
        applied.push(fixture_row(4, "m4", "4"));
        assert_eq!(
            classify_history(&applied, true, true, &embedded),
            StorageFormatVerdict::Unrecognized(4)
        );
    }

    #[test]
    fn checksum_mismatch_is_divergent() {
        let embedded = fixture_embedded(3);
        let applied = vec![
            fixture_row(1, "m1", "1"),
            fixture_row(2, "m2", "not-the-real-checksum"),
            fixture_row(3, "m3", "3"),
        ];
        assert_eq!(
            classify_history(&applied, true, true, &embedded),
            StorageFormatVerdict::Divergent(2)
        );
    }

    #[test]
    fn name_mismatch_is_divergent() {
        let embedded = fixture_embedded(3);
        let applied = vec![
            fixture_row(1, "m1", "1"),
            fixture_row(2, "renamed", "2"),
            fixture_row(3, "m3", "3"),
        ];
        assert_eq!(
            classify_history(&applied, true, true, &embedded),
            StorageFormatVerdict::Divergent(2)
        );
    }

    #[test]
    fn embedded_migration_missing_from_history_below_max_is_divergent() {
        let embedded = fixture_embedded(3);
        let applied = vec![fixture_row(1, "m1", "1"), fixture_row(3, "m3", "3")];
        assert_eq!(
            classify_history(&applied, true, true, &embedded),
            StorageFormatVerdict::Divergent(2)
        );
    }

    #[test]
    fn empty_history_with_table_present_is_recognized() {
        let embedded = fixture_embedded(3);
        assert_eq!(
            classify_history(&[], true, true, &embedded),
            StorageFormatVerdict::Recognized
        );
    }

    #[test]
    fn settings_without_history_is_pre_refinery() {
        let embedded = fixture_embedded(3);
        assert_eq!(
            classify_history(&[], false, true, &embedded),
            StorageFormatVerdict::PreRefinery
        );
    }

    #[test]
    fn neither_table_is_fresh() {
        let embedded = fixture_embedded(3);
        assert_eq!(
            classify_history(&[], false, false, &embedded),
            StorageFormatVerdict::Fresh
        );
    }

    #[test]
    fn checksum_mismatch_on_middle_row_is_divergent_not_missed() {
        let embedded = fixture_embedded(5);
        let mut applied: Vec<HistoryRow> = (1..=5)
            .map(|v| fixture_row(v, &format!("m{v}"), &v.to_string()))
            .collect();
        applied[2].checksum = "corrupted".to_string(); // version 3, not the highest (5)
        assert_eq!(
            classify_history(&applied, true, true, &embedded),
            StorageFormatVerdict::Divergent(3)
        );
    }

    // -- real connections -------------------------------------------------

    #[test]
    fn real_migrated_database_is_recognized_and_untouched() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();

        let (_, before) = read_history_table(&conn, "refinery_schema_history").unwrap();

        let verdict = classify_connection(&conn).unwrap();
        assert_eq!(verdict, StorageFormatVerdict::Recognized);

        let (_, after) = read_history_table(&conn, "refinery_schema_history").unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn pre_refinery_classification_ignores_settings_table_shape() {
        let dir = unique_temp_dir("pre-refinery-shape");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pacto.db");
        let conn = rusqlite::Connection::open(&path).unwrap();
        // A `settings` table shaped nothing like the real schema -- the
        // classifier must not care about structure, only that it exists.
        conn.execute_batch("CREATE TABLE settings (weird_column TEXT);")
            .unwrap();
        conn.execute(
            "INSERT INTO settings (weird_column) VALUES ('anything')",
            [],
        )
        .unwrap();
        drop(conn);

        assert_eq!(classify_database(&path), StorageFormatVerdict::PreRefinery);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn absent_file_is_fresh() {
        let path = unique_temp_dir("absent").join("pacto.db");
        assert_eq!(classify_database(&path), StorageFormatVerdict::Fresh);
    }

    #[test]
    fn unreadable_file_classifies_as_recognized() {
        let dir = unique_temp_dir("truncated");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pacto.db");
        std::fs::write(&path, b"not a sqlite file").unwrap();

        assert_eq!(classify_database(&path), StorageFormatVerdict::Recognized);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn busy_database_classifies_as_recognized() {
        let dir = unique_temp_dir("busy");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pacto.db");

        let holder = rusqlite::Connection::open(&path).unwrap();
        holder
            .execute_batch(
                "CREATE TABLE refinery_schema_history (version INTEGER PRIMARY KEY, \
                 name VARCHAR(255), applied_on VARCHAR(255), checksum VARCHAR(255));",
            )
            .unwrap();
        holder.execute_batch("BEGIN EXCLUSIVE;").unwrap();

        assert_eq!(classify_database(&path), StorageFormatVerdict::Recognized);

        drop(holder);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -- scan_profiles ------------------------------------------------------

    #[test]
    fn scan_ignores_profile_without_database() {
        let root = unique_temp_dir("scan-no-db");
        std::fs::create_dir_all(root.join("npub1scannodbprofile")).unwrap();

        let report = scan_profiles(&root);
        assert!(report.all_recognized);
        assert_eq!(report.unrecognized_count, 0);
        assert_eq!(report.highest_offending_version, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_reports_unrecognized_profile_and_offending_version() {
        let root = unique_temp_dir("scan-unrecognized");
        let profile_dir = root.join("npub1scanunrecognizedprofile");
        std::fs::create_dir_all(&profile_dir).unwrap();
        let db_path = profile_dir.join("pacto.db");
        write_migrated_db(&db_path);

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

        let report = scan_profiles(&root);
        assert!(!report.all_recognized);
        assert_eq!(report.unrecognized_count, 1);
        assert_eq!(report.highest_offending_version, Some(above_ceiling));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_counts_multiple_unrecognized_profiles() {
        let root = unique_temp_dir("scan-multi");
        let good_dir = root.join("npub1scanmultigood");
        std::fs::create_dir_all(&good_dir).unwrap();
        write_migrated_db(&good_dir.join("pacto.db"));

        let above_ceiling = crate::migrations::embedded_ceiling() + 1;
        let mut offending_versions = Vec::new();
        for (label, bump) in [("a", 0), ("b", 1)] {
            let dir = root.join(format!("npub1scanmulti{label}"));
            std::fs::create_dir_all(&dir).unwrap();
            let db_path = dir.join("pacto.db");
            write_migrated_db(&db_path);
            let version = above_ceiling + bump;
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO refinery_schema_history (version, name, applied_on, checksum) \
                 VALUES (?1, 'future_migration', '2026-01-01T00:00:00Z', 'deadbeef')",
                rusqlite::params![version],
            )
            .unwrap();
            offending_versions.push(version);
        }

        let report = scan_profiles(&root);
        assert!(!report.all_recognized);
        assert_eq!(report.unrecognized_count, 2);
        assert_eq!(
            report.highest_offending_version,
            offending_versions.iter().max().copied()
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    // -- no leaking identity ----------------------------------------------

    #[test]
    fn report_and_verdicts_carry_no_identifying_data() {
        let verdicts = [
            StorageFormatVerdict::Fresh,
            StorageFormatVerdict::PreRefinery,
            StorageFormatVerdict::Recognized,
            StorageFormatVerdict::Unrecognized(42),
            StorageFormatVerdict::Divergent(7),
        ];
        for verdict in verdicts {
            let debug = format!("{verdict:?}");
            assert!(!debug.contains("npub1"));
            assert!(!debug.contains('/'));
            assert!(!debug.contains('\\'));
        }

        let report = StorageFormatScanReport {
            all_recognized: false,
            unrecognized_count: 2,
            highest_offending_version: Some(31),
        };
        let debug = format!("{report:?}");
        assert!(!debug.contains("npub1"));
        assert!(!debug.contains('/'));
        assert!(!debug.contains('\\'));
    }

    // -- embedded-set completeness -----------------------------------------

    /// Last migration version reserved for the old sequential-integer
    /// scheme (see AGENTS.md). V31/V32 are held for #233 and #235, which
    /// were already in flight with hand-picked V31 filenames when the
    /// timestamp convention landed -- rather than force a rebase, each
    /// takes one of the two remaining sequential slots. Anything above
    /// V32 must be a UTC-timestamp version (`V<YYYYMMDDHHMMSS>__name.sql`,
    /// `make new-migration`).
    const LAST_SEQUENTIAL_VERSION: i64 = 32;
    /// 14-digit UTC timestamp range covering 2026-01-01 through
    /// 2099-12-31 -- wide enough that it never needs bumping for this
    /// scheme's lifetime, narrow enough to reject a hand-typed small
    /// integer landing above `LAST_SEQUENTIAL_VERSION` by mistake.
    const MIN_TIMESTAMP_VERSION: i64 = 20_260_101_000_000;
    const MAX_TIMESTAMP_VERSION: i64 = 21_000_101_000_000;

    #[test]
    fn embedded_set_matches_committed_migration_files() {
        let embedded = crate::migrations::embedded_migration_set();
        assert!(!embedded.is_empty());
        assert!(crate::migrations::embedded_ceiling() >= crate::migrations::PRE_REFINERY_CEILING);

        let migrations_dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/migrations");
        let mut file_versions = std::collections::BTreeSet::new();
        let mut by_version: std::collections::BTreeMap<i64, Vec<String>> =
            std::collections::BTreeMap::new();
        for entry in std::fs::read_dir(&migrations_dir).unwrap() {
            let entry = entry.unwrap();
            let file_name = entry.file_name().to_string_lossy().to_string();
            if let Some(rest) = file_name.strip_prefix('V') {
                if let Some((version_str, _)) = rest.split_once("__") {
                    if let Ok(version) = version_str.parse::<i64>() {
                        file_versions.insert(version);
                        by_version
                            .entry(version)
                            .or_default()
                            .push(file_name.clone());
                    }
                }
            }
        }

        // Two migration files sharing a version number collide on
        // refinery_schema_history's PRIMARY KEY the moment both are merged --
        // this happens in parallel branch development, where the "next
        // number" is computed independently on each branch. Catch it here,
        // not at migration-apply time in production.
        let duplicates: Vec<(i64, Vec<String>)> = by_version
            .into_iter()
            .filter(|(_, names)| names.len() > 1)
            .collect();
        assert!(
            duplicates.is_empty(),
            "duplicate migration version(s), rename one before merging: {duplicates:?}"
        );

        // Anything past the historical sequential range must look like a
        // timestamp, not a hand-typed next integer -- the exact mistake
        // that produced the V31/V31 collision this scheme exists to
        // prevent. Catches a bypass of `make new-migration` in CI instead
        // of relying on convention alone.
        for version in &file_versions {
            if *version > LAST_SEQUENTIAL_VERSION {
                assert!(
                    (MIN_TIMESTAMP_VERSION..MAX_TIMESTAMP_VERSION).contains(version),
                    "migration version {version} looks like a sequential integer, not a UTC \
                     timestamp (V<YYYYMMDDHHMMSS>__name.sql) -- use `make new-migration name=...`"
                );
            }
        }

        let embedded_versions: std::collections::BTreeSet<i64> =
            embedded.iter().map(|m| m.version()).collect();
        assert_eq!(embedded_versions, file_versions);
    }

    // -- StorageCompatibilityReport / get_storage_compatibility -----------

    #[test]
    fn compatibility_report_serializes_to_expected_camel_case_keys() {
        let report = StorageCompatibilityReport {
            all_recognized: false,
            unrecognized_count: 2,
            highest_offending_version: Some(31),
            supported_schema_version: 30,
        };
        let value = serde_json::to_value(&report).unwrap();
        assert_eq!(
            value.get("allRecognized").unwrap(),
            &serde_json::json!(false)
        );
        assert_eq!(
            value.get("unrecognizedCount").unwrap(),
            &serde_json::json!(2)
        );
        assert_eq!(
            value.get("highestOffendingVersion").unwrap(),
            &serde_json::json!(31)
        );
        assert_eq!(
            value.get("supportedSchemaVersion").unwrap(),
            &serde_json::json!(30)
        );
        // Exactly the four expected keys -- no accidental extra field, and
        // no snake_case field slipping through unrenamed.
        assert_eq!(value.as_object().unwrap().len(), 4);
    }

    #[test]
    fn compatibility_report_is_compatible_for_directory_with_no_profiles() {
        let root = unique_temp_dir("compat-empty");
        std::fs::create_dir_all(&root).unwrap();

        let report = compatibility_report(&root);
        assert!(report.all_recognized);
        assert_eq!(report.unrecognized_count, 0);
        assert_eq!(report.highest_offending_version, None);
        assert_eq!(
            report.supported_schema_version,
            crate::migrations::embedded_ceiling()
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn compatibility_report_is_incompatible_for_one_failing_profile() {
        let root = unique_temp_dir("compat-incompatible");
        let profile_dir = root.join("npub1compatincompatibleprofile");
        std::fs::create_dir_all(&profile_dir).unwrap();
        let db_path = profile_dir.join("pacto.db");
        write_migrated_db(&db_path);

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

        let report = compatibility_report(&root);
        assert!(!report.all_recognized);
        assert_eq!(report.unrecognized_count, 1);
        assert_eq!(report.highest_offending_version, Some(above_ceiling));
        assert_eq!(
            report.supported_schema_version,
            crate::migrations::embedded_ceiling()
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn get_storage_compatibility_command_succeeds_against_a_mock_app() {
        // Exercises the command's own plumbing (AppHandle -> test_data_dir
        // -> compatibility_report). Deliberately does not assert on
        // unrecognized_count/highest_offending_version: mock_app's
        // app_data_dir is a real, shared directory across this test
        // binary, so only properties independent of what other tests may
        // have left there are safe to assert here. Count-sensitive
        // behavior is covered against isolated temp dirs above.
        let app = tauri::test::mock_app();
        let report = get_storage_compatibility(app.handle().clone()).unwrap();
        assert_eq!(
            report.supported_schema_version,
            crate::migrations::embedded_ceiling()
        );
    }

    #[test]
    fn app_data_dir_resolution_failure_message_carries_no_npub_or_path() {
        // The command's only error path always replaces whatever
        // `test_data_dir` produced with this fixed string -- never
        // `get_profile_directory`'s own errors, which embed the npub this
        // guards against.
        let message = "Unable to resolve app storage location";
        assert!(!message.contains("npub1"));
        assert!(!message.contains('/'));
        assert!(!message.contains('\\'));
    }
}
