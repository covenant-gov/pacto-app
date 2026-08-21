//! Deletes local MDK engine groups with no corresponding `mls_groups` metadata row — state a
//! failed welcome delivery can leave behind mid `create_group`. `engine.delete_group` is
//! local-only (no protocol side effects), so this is safe cleanup, not a network operation.
//! `MLS_GROUPS_ENGINE_CREATE_LOCK` serializes the sweep against `create_group`'s
//! engine-commit-then-first-persist window and `do_accept_mls_welcome`'s
//! accept-then-persist window. Design details: `docs/mls/INVITES_AND_MEMBERSHIP.md`.

use crate::mls::{MlsError, MlsService};
use mdk_core::prelude::GroupId;

/// Serializes `create_group` and `do_accept_mls_welcome` engine-commit-then-first-persist
/// windows against the reap sweep. Global, not per-account: only one account's MLS store is
/// live in this process at a time.
pub(crate) static MLS_GROUPS_ENGINE_CREATE_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Minimum spacing between reap passes. The "sync all" trigger fires on every relay reconnect,
/// post-login sync, and squads-tab focus/wake, so this avoids repeating the sweep for no benefit.
const REAP_COOLDOWN_SECS: u64 = 30;

static LAST_REAP_AT_SECS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Pure so the cooldown window is unit-testable without real wall-clock delay. `last_reap_secs
/// == 0` means "never run yet", which is never in cooldown.
fn reap_cooldown_active(now_secs: u64, last_reap_secs: u64) -> bool {
    last_reap_secs != 0 && now_secs.saturating_sub(last_reap_secs) < REAP_COOLDOWN_SECS
}

/// Local MDK engine group ids that have no corresponding `mls_groups` metadata row. Matches
/// case-insensitively — both sides are hex-encoded `GroupId`s, and `db.rs`'s harvest persist
/// path folds case too, so a case mismatch here would be a destructive false positive. Returned
/// ids keep their original engine-side casing.
fn orphaned_engine_group_ids(
    known: &std::collections::HashSet<String>,
    engine_group_ids: &[String],
) -> Vec<String> {
    let known_lower: std::collections::HashSet<String> =
        known.iter().map(|id| id.to_lowercase()).collect();
    engine_group_ids
        .iter()
        .filter(|id| !known_lower.contains(&id.to_lowercase()))
        .cloned()
        .collect()
}

/// True when an empty `known` set would cause every engine group to be reaped as an orphan —
/// the signature of an unreadable/empty/just-migrated `mls_groups` table, not real orphans.
fn reap_would_wipe_every_group(known_len: usize, engine_len: usize) -> bool {
    known_len == 0 && engine_len > 0
}

impl MlsService {
    /// Deletes local MDK engine groups that have no corresponding `mls_groups` metadata row.
    /// Called from `sync_mls_groups_now`'s "sync all groups" branch (startup and relay
    /// reconnection). Returns the number of groups actually deleted.
    pub async fn reap_orphaned_engine_groups(&self) -> Result<usize, MlsError> {
        // See module docs: this lock is what keeps a reap pass from ever observing a
        // just-created group's engine state before `create_group` has persisted its metadata.
        let _create_lock_guard = MLS_GROUPS_ENGINE_CREATE_LOCK.lock().await;

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| MlsError::StorageError(format!("system time error: {}", e)))?
            .as_secs();
        if reap_cooldown_active(
            now_secs,
            LAST_REAP_AT_SECS.load(std::sync::atomic::Ordering::Relaxed),
        ) {
            return Ok(0);
        }

        // Every other read site that resolves a group's engine-side id (e.g.
        // `add_member_device`'s lookup, `get_mls_group_members`'s wire/engine id resolution)
        // falls back to `group_id` when `engine_group_id` is empty (`#[serde(default)]`, for
        // rows persisted before that field existed) — the real engine-side group for such a row
        // lives under `group_id`, not under an empty string. Match that fallback here so a
        // legacy row is never treated as unmatched.
        let known: std::collections::HashSet<String> = self
            .read_groups()
            .await?
            .into_iter()
            .map(|g| {
                if g.engine_group_id.is_empty() {
                    g.group_id
                } else {
                    g.engine_group_id
                }
            })
            .collect();

        let engine = self.engine()?;
        let engine_groups = engine
            .get_groups()
            .map_err(|e| MlsError::NostrMlsError(format!("get_groups: {}", e)))?;
        let engine_group_ids: Vec<String> = engine_groups
            .iter()
            .map(|g| hex::encode(g.mls_group_id.as_slice()))
            .collect();

        if reap_would_wipe_every_group(known.len(), engine_group_ids.len()) {
            eprintln!(
                "[MLS] Refusing to reap: mls_groups metadata is empty but the engine holds {} group(s); declining to delete them",
                engine_group_ids.len()
            );
            // Still record the pass so the cooldown applies: a refused sweep retries on the
            // next "sync all" trigger like any other completed pass, not immediately.
            LAST_REAP_AT_SECS.store(now_secs, std::sync::atomic::Ordering::Relaxed);
            return Ok(0);
        }

        let orphaned = orphaned_engine_group_ids(&known, &engine_group_ids);
        let mut reaped = 0usize;
        for id_hex in &orphaned {
            let gid_bytes = match hex::decode(id_hex) {
                Ok(bytes) => bytes,
                Err(e) => {
                    eprintln!(
                        "[MLS] Skipping orphan reap for invalid hex id {}: {}",
                        id_hex, e
                    );
                    continue;
                }
            };
            let gid = GroupId::from_slice(&gid_bytes);
            match engine.delete_group(&gid) {
                Ok(()) => {
                    reaped += 1;
                    println!("[MLS] Reaped orphaned engine group {}", id_hex);
                }
                Err(e) => {
                    eprintln!(
                        "[MLS] Failed to reap orphaned engine group {}: {}",
                        id_hex, e
                    );
                }
            }
        }

        LAST_REAP_AT_SECS.store(now_secs, std::sync::atomic::Ordering::Relaxed);
        Ok(reaped)
    }
}

#[cfg(test)]
mod orphaned_engine_group_ids_tests {
    use super::orphaned_engine_group_ids;
    use std::collections::HashSet;

    #[test]
    fn fully_covered_engine_ids_yield_no_orphans() {
        let known: HashSet<String> = ["aa".to_string(), "bb".to_string()].into_iter().collect();
        let engine_ids = vec!["aa".to_string(), "bb".to_string()];
        assert!(orphaned_engine_group_ids(&known, &engine_ids).is_empty());
    }

    #[test]
    fn uncovered_engine_ids_are_returned_exactly() {
        let known: HashSet<String> = ["aa".to_string()].into_iter().collect();
        let engine_ids = vec!["aa".to_string(), "bb".to_string(), "cc".to_string()];
        let orphans = orphaned_engine_group_ids(&known, &engine_ids);
        assert_eq!(orphans, vec!["bb".to_string(), "cc".to_string()]);
    }

    #[test]
    fn empty_known_set_returns_every_engine_id() {
        let known: HashSet<String> = HashSet::new();
        let engine_ids = vec!["aa".to_string(), "bb".to_string()];
        let orphans = orphaned_engine_group_ids(&known, &engine_ids);
        assert_eq!(orphans, vec!["aa".to_string(), "bb".to_string()]);
    }

    #[test]
    fn matching_is_case_insensitive_both_ways() {
        // Destructive path (deletes engine groups): err permissive on `known` so a raw hex
        // case mismatch never looks like an orphan.
        let known_upper: HashSet<String> = ["AA".to_string()].into_iter().collect();
        let engine_ids_lower = vec!["aa".to_string()];
        assert!(orphaned_engine_group_ids(&known_upper, &engine_ids_lower).is_empty());

        let known_lower: HashSet<String> = ["bb".to_string()].into_iter().collect();
        let engine_ids_upper = vec!["BB".to_string()];
        assert!(orphaned_engine_group_ids(&known_lower, &engine_ids_upper).is_empty());
    }
}

#[cfg(test)]
mod reap_would_wipe_every_group_tests {
    use super::reap_would_wipe_every_group;

    #[test]
    fn empty_known_with_engine_groups_would_wipe() {
        assert!(reap_would_wipe_every_group(0, 3));
    }

    #[test]
    fn empty_known_with_no_engine_groups_is_an_ordinary_noop() {
        assert!(!reap_would_wipe_every_group(0, 0));
    }

    #[test]
    fn nonempty_known_never_triggers_the_guard() {
        assert!(!reap_would_wipe_every_group(2, 5));
    }
}

#[cfg(test)]
mod reap_cooldown_tests {
    use super::{reap_cooldown_active, REAP_COOLDOWN_SECS};

    #[test]
    fn never_run_before_is_not_in_cooldown() {
        assert!(!reap_cooldown_active(1_000, 0));
    }

    #[test]
    fn immediately_after_a_run_is_in_cooldown() {
        assert!(reap_cooldown_active(1_000, 1_000));
    }

    #[test]
    fn just_under_the_window_is_still_in_cooldown() {
        assert!(reap_cooldown_active(1_000 + REAP_COOLDOWN_SECS - 1, 1_000));
    }

    #[test]
    fn at_or_past_the_window_is_no_longer_in_cooldown() {
        assert!(!reap_cooldown_active(1_000 + REAP_COOLDOWN_SECS, 1_000));
    }
}
