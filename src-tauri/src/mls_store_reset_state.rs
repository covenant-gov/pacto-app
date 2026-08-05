//! Settings-table read/mutate API for MLS store reset state: keypackage
//! refresh flag, pending welcome wrapper ids, and per-group "state lost"
//! bookkeeping. Consumed by the Tauri command layer; `mls_store_reset`
//! (the reset-execution machinery) writes the initial values through these
//! same primitives during its harvest transaction.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

pub(crate) const LOST_GROUPS_KEY: &str = "mls_store_reset_lost_groups";
pub(crate) const PENDING_WRAPPERS_KEY: &str = "mls_store_reset_pending_wrappers";
pub(crate) const KEYPACKAGE_REFRESH_KEY: &str = "mls_store_keypackage_refresh_required";
/// Unix seconds when this account's MLS store reset harvested/archived (generation floor).
pub(crate) const RESET_AT_KEY: &str = "mls_store_reset_at";

pub(crate) fn setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|e| format!("Failed to read MLS reset setting {key}: {e}"))
}

pub(crate) fn put_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("Failed to write MLS reset setting {key}: {e}"))?;
    Ok(())
}

pub(crate) fn json_setting<T: serde::de::DeserializeOwned + Default>(
    conn: &Connection,
    key: &str,
) -> Result<T, String> {
    match setting(conn, key)? {
        Some(value) => serde_json::from_str(&value)
            .map_err(|e| format!("Invalid MLS reset setting {key}: {e}")),
        None => Ok(T::default()),
    }
}

pub(crate) fn put_json_setting<T: Serialize>(conn: &Connection, key: &str, value: &T) -> Result<(), String> {
    let encoded = serde_json::to_string(value)
        .map_err(|e| format!("Failed to encode MLS reset setting {key}: {e}"))?;
    put_setting(conn, key, &encoded)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub(crate) struct LostGroups(pub(crate) Vec<String>);

fn with_account_connection<R: Runtime, T>(
    handle: &AppHandle<R>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = f(&conn);
    crate::account_manager::return_db_connection(conn);
    result
}

pub(crate) fn keypackage_refresh_required<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<bool, String> {
    with_account_connection(handle, |conn| {
        Ok(setting(conn, KEYPACKAGE_REFRESH_KEY)?.as_deref() == Some("true"))
    })
}

pub(crate) fn mark_keypackage_refreshed<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    with_account_connection(handle, |conn| {
        put_setting(conn, KEYPACKAGE_REFRESH_KEY, "false")
    })
}

pub(crate) fn store_reset_at_secs<R: Runtime>(handle: &AppHandle<R>) -> Result<Option<u64>, String> {
    with_account_connection(handle, |conn| {
        Ok(setting(conn, RESET_AT_KEY)?
            .and_then(|v| v.parse::<u64>().ok()))
    })
}

pub(crate) fn pending_wrapper_ids<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<String>, String> {
    with_account_connection(handle, |conn| json_setting(conn, PENDING_WRAPPERS_KEY))
}

pub(crate) fn retain_pending_wrapper_ids<R: Runtime>(
    handle: &AppHandle<R>,
    ids: &[String],
) -> Result<(), String> {
    with_account_connection(handle, |conn| {
        put_json_setting(conn, PENDING_WRAPPERS_KEY, &ids)
    })
}

pub(crate) fn lost_group_ids<R: Runtime>(handle: &AppHandle<R>) -> Result<Vec<String>, String> {
    with_account_connection(handle, |conn| {
        Ok(json_setting::<LostGroups>(conn, LOST_GROUPS_KEY)?.0)
    })
}

pub(crate) fn is_group_state_lost<R: Runtime>(
    handle: &AppHandle<R>,
    group_id: &str,
) -> Result<bool, String> {
    Ok(lost_group_ids(handle)?.iter().any(|id| id == group_id))
}

pub(crate) fn mark_group_restored<R: Runtime>(
    handle: &AppHandle<R>,
    group_id: &str,
) -> Result<(), String> {
    with_account_connection(handle, |conn| {
        let mut lost = json_setting::<LostGroups>(conn, LOST_GROUPS_KEY)?;
        lost.0.retain(|id| id != group_id);
        put_json_setting(conn, LOST_GROUPS_KEY, &lost)
    })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MlsStoreResetGroupState {
    pub group_id: String,
    pub state_lost: bool,
    pub admin_npubs: Vec<String>,
    pub single_admin: bool,
}

pub(crate) fn reset_group_states_conn(conn: &Connection) -> Result<Vec<MlsStoreResetGroupState>, String> {
    let lost = json_setting::<LostGroups>(conn, LOST_GROUPS_KEY)?;
    let all_admins = crate::mls_store_reset::load_all_legacy_group_admins_conn(conn)?;
    let mut states = Vec::with_capacity(lost.0.len());
    for group_id in lost.0 {
        let admin_npubs = all_admins.get(&group_id).cloned().unwrap_or_default();
        let single_admin = admin_npubs.len() == 1;
        states.push(MlsStoreResetGroupState {
            group_id,
            state_lost: true,
            admin_npubs,
            single_admin,
        });
    }
    Ok(states)
}

pub(crate) fn reset_group_states<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<MlsStoreResetGroupState>, String> {
    with_account_connection(handle, reset_group_states_conn)
}

pub(crate) fn emit_reset_state<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let groups = reset_group_states(handle)?;
    handle
        .emit("mls_store_reset", groups)
        .map_err(|e| format!("Failed to emit MLS reset state: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE mls_legacy_admins (group_id TEXT NOT NULL, admin_npub TEXT NOT NULL, harvested_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn reset_state_distinguishes_multiple_single_and_no_admin_records() {
        let conn = app_db();
        put_json_setting(
            &conn,
            LOST_GROUPS_KEY,
            &LostGroups(vec!["multi".into(), "single".into(), "missing".into()]),
        )
        .unwrap();
        for (group, admin) in [
            ("multi", "npub-a"),
            ("multi", "npub-b"),
            ("single", "npub-a"),
        ] {
            conn.execute(
                "INSERT INTO mls_legacy_admins(group_id, admin_npub, harvested_at) VALUES (?1, ?2, 1)",
                rusqlite::params![group, admin],
            )
            .unwrap();
        }

        let states = reset_group_states_conn(&conn).unwrap();
        let multi = states
            .iter()
            .find(|state| state.group_id == "multi")
            .unwrap();
        let single = states
            .iter()
            .find(|state| state.group_id == "single")
            .unwrap();
        let missing = states
            .iter()
            .find(|state| state.group_id == "missing")
            .unwrap();
        assert_eq!(multi.admin_npubs, vec!["npub-a", "npub-b"]);
        assert!(!multi.single_admin);
        assert!(single.single_admin);
        assert!(missing.admin_npubs.is_empty());
        assert!(!missing.single_admin);
    }
}
