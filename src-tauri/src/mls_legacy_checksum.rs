//! Vendored copy of `mdk-sqlite-storage` 0.8.0's own migration set
//! (`src/mls_migrations/*.sql`, copied byte-for-byte from that crate's
//! `migrations/` directory), used only to compute this build's current and
//! legacy (pre-`int8-versions`) checksums for the MLS store's
//! `_refinery_schema_history_nostr_mls` history table.
//!
//! `mdk_sqlite_storage::run_migrations` owns its own refinery `Runner`
//! (default `abort_divergent: true`) over that table, independent of
//! `crate::migrations::run_migrations`'s `pacto.db` runner -- but both
//! runners resolve to the *same* `refinery-core`, and Cargo unifies feature
//! flags per dependency across the whole build, so enabling `int8-versions`
//! for `pacto` also enables it for `mdk-sqlite-storage`. `mdk-sqlite-storage`
//! 0.8.0 was already pinned before Pacto added that feature (shipped
//! unchanged in 0.5.4 and 0.5.5), so every account that opened its MLS
//! store under a pre-0.6.0 build stamped `_refinery_schema_history_nostr_mls`
//! with the same narrower-`SchemaVersion` checksums `pacto.db` had --
//! see `crate::storage_format::legacy_i32_checksum` for the mechanism.
//! Left unreconciled, `MdkSqliteStorage::new_with_key` (called from
//! `MlsService::new_persistent_inner`, right after
//! `mls_store_reset::ensure_store_ready` classifies the store as `Current`
//! and does nothing further) aborts with `DivergentVersion` on every such
//! account, even after the `pacto.db` gate and migration are fixed.
//!
//! `mdk_sqlite_storage` doesn't expose its embedded migration set publicly,
//! so this is a deliberate vendored copy, not a shared source of truth --
//! `mdk_sqlite_storage_version_matches_vendored_migrations` below fails
//! loudly if `Cargo.lock` ever pins a different `mdk-sqlite-storage`
//! version than the one these files were copied from, so a version bump
//! that adds or changes migrations can't silently go stale here.

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("src/mls_migrations");
}

/// The migration-table name `mdk_sqlite_storage::run_migrations` hard-codes
/// via `set_migration_table_name` -- kept in sync manually since it's not
/// part of that crate's public API either.
pub(crate) const MLS_HISTORY_TABLE_NAME: &str = "_refinery_schema_history_nostr_mls";

pub(crate) fn embedded_migration_set() -> Vec<refinery::Migration> {
    embedded::migrations::runner().get_migrations().clone()
}

#[cfg(test)]
mod tests {

    /// The `mdk-sqlite-storage` version `src/mls_migrations/*.sql` was
    /// copied from. Keep in sync with `Cargo.lock`'s pinned version.
    const VENDORED_MDK_SQLITE_STORAGE_VERSION: &str = "0.8.0";

    /// Fails loudly if `Cargo.lock` pins a `mdk-sqlite-storage` version
    /// other than the one `src/mls_migrations/*.sql` was copied from --
    /// silently drifting would leave a version bump's new/changed
    /// migrations unreconciled with no compile error and no test failure
    /// anywhere else.
    #[test]
    fn mdk_sqlite_storage_version_matches_vendored_migrations() {
        let lock = include_str!("../Cargo.lock");
        let name_idx = lock
            .find("name = \"mdk-sqlite-storage\"")
            .expect("mdk-sqlite-storage package present in Cargo.lock");
        let after_name = &lock[name_idx..];
        let version_line = after_name
            .lines()
            .nth(1)
            .expect("version line immediately follows the name line");
        assert!(
            version_line.contains(VENDORED_MDK_SQLITE_STORAGE_VERSION),
            "Cargo.lock pins a different mdk-sqlite-storage version ({version_line}) than the \
             vendored src/mls_migrations/ copy (expected {VENDORED_MDK_SQLITE_STORAGE_VERSION}) \
             -- re-copy that crate's migrations/ directory byte-for-byte, update \
             VENDORED_MDK_SQLITE_STORAGE_VERSION, and re-verify \
             mls_store_reset::reconcile_mls_store_legacy_checksums still applies, or a version \
             bump's migrations silently stop being checksum-reconciled"
        );
    }
}
