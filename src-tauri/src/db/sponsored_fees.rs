use serde::Serialize;
use tauri::{command, AppHandle, Runtime};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsoredFeeUsageRow {
    pub id: String,
    pub parent_id: String,
    pub chain: String,
    pub chain_id: u64,
    pub actor_npub: String,
    pub actor_evm: String,
    pub amount_wei: String,
    pub selector: String,
    pub action: String,
    pub target: String,
    pub user_op_hash: String,
    pub tx_hash: String,
    pub created_at_ms: i64,
}

/// Fields required to persist a successful sponsored UserOp spend.
pub struct SquadSponsoredFeeUsageInsert {
    pub parent_id: String,
    pub chain: String,
    pub chain_id: u64,
    pub actor_npub: String,
    pub actor_evm: String,
    pub amount_wei: String,
    pub selector: String,
    pub action: String,
    pub target: String,
    pub user_op_hash: String,
    pub tx_hash: String,
}

pub fn sponsored_fee_usage_row_id(user_op_hash: &str) -> String {
    let h = user_op_hash.trim();
    if h.is_empty() {
        return "sfee-unknown".to_string();
    }
    format!("sfee-{h}")
}

const SPONSORED_FEE_USAGE_LIST_DEFAULT: u32 = 50;
const SPONSORED_FEE_USAGE_LIST_MAX: u32 = 200;

fn clamp_sponsored_fee_usage_limit(limit: Option<u32>) -> u32 {
    limit
        .unwrap_or(SPONSORED_FEE_USAGE_LIST_DEFAULT)
        .clamp(1, SPONSORED_FEE_USAGE_LIST_MAX)
}

/// Best-effort insert; duplicates on `user_op_hash` are ignored.
pub fn insert_squad_sponsored_fee_usage_conn(
    conn: &rusqlite::Connection,
    row: &SquadSponsoredFeeUsageInsert,
) -> Result<(), String> {
    let user_op = row.user_op_hash.trim();
    if user_op.is_empty() {
        return Err("user_op_hash is required".to_string());
    }
    let parent = row.parent_id.trim();
    if parent.is_empty() {
        return Err("parent_id is required".to_string());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = sponsored_fee_usage_row_id(user_op);
    conn.execute(
        "INSERT OR IGNORE INTO squad_sponsored_fee_usage (
            id, parent_id, chain, chain_id, actor_npub, actor_evm, amount_wei,
            selector, action, target, user_op_hash, tx_hash, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            id,
            parent,
            row.chain.trim(),
            row.chain_id as i64,
            row.actor_npub.trim(),
            row.actor_evm.trim(),
            row.amount_wei.trim(),
            row.selector.trim(),
            row.action.trim(),
            row.target.trim(),
            user_op,
            row.tx_hash.trim(),
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert squad_sponsored_fee_usage: {e}"))?;
    Ok(())
}

pub fn insert_squad_sponsored_fee_usage<R: Runtime>(
    handle: &AppHandle<R>,
    row: &SquadSponsoredFeeUsageInsert,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = insert_squad_sponsored_fee_usage_conn(&conn, row);
    crate::account_manager::return_db_connection(conn);
    result
}

fn list_squad_sponsored_fee_usage_conn(
    conn: &rusqlite::Connection,
    parent_id: &str,
    limit: u32,
) -> Result<Vec<SquadSponsoredFeeUsageRow>, String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, chain, chain_id, actor_npub, actor_evm, amount_wei,
                    selector, action, target, user_op_hash, tx_hash, created_at_ms
             FROM squad_sponsored_fee_usage
             WHERE parent_id = ?1
             ORDER BY created_at_ms DESC, user_op_hash DESC
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to list squad_sponsored_fee_usage: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![pid, limit as i64], |row| {
            Ok(SquadSponsoredFeeUsageRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                chain: row.get(2)?,
                chain_id: row.get::<_, i64>(3)? as u64,
                actor_npub: row.get(4)?,
                actor_evm: row.get(5)?,
                amount_wei: row.get(6)?,
                selector: row.get(7)?,
                action: row.get(8)?,
                target: row.get(9)?,
                user_op_hash: row.get(10)?,
                tx_hash: row.get(11)?,
                created_at_ms: row.get(12)?,
            })
        })
        .map_err(|e| format!("Failed to query squad_sponsored_fee_usage: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[command]
pub fn list_squad_sponsored_fee_usage<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
    limit: Option<u32>,
) -> Result<Vec<SquadSponsoredFeeUsageRow>, String> {
    let cap = clamp_sponsored_fee_usage_limit(limit);
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let result = list_squad_sponsored_fee_usage_conn(&conn, &parent_id, cap);
    crate::account_manager::return_db_connection(conn);
    result
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSponsoredFeeUsageRow {
    pub id: String,
    pub lane: String,
    pub parent_id: Option<String>,
    pub chain: String,
    pub chain_id: u64,
    pub actor_npub: String,
    pub actor_evm: String,
    pub amount_wei: String,
    pub selector: String,
    pub action: String,
    pub target: String,
    pub user_op_hash: String,
    pub tx_hash: String,
    pub created_at_ms: i64,
}

/// Fields required to persist a successful global paymaster UserOp spend.
pub struct GlobalSponsoredFeeUsageInsert {
    pub lane: String,
    pub parent_id: Option<String>,
    pub chain: String,
    pub chain_id: u64,
    pub actor_npub: String,
    pub actor_evm: String,
    pub amount_wei: String,
    pub selector: String,
    pub action: String,
    pub target: String,
    pub user_op_hash: String,
    pub tx_hash: String,
}

pub fn global_sponsored_fee_usage_row_id(user_op_hash: &str) -> String {
    let h = user_op_hash.trim();
    if h.is_empty() {
        return "gfee-unknown".to_string();
    }
    format!("gfee-{h}")
}

/// Best-effort insert; duplicates on `user_op_hash` are ignored.
pub fn insert_global_sponsored_fee_usage_conn(
    conn: &rusqlite::Connection,
    row: &GlobalSponsoredFeeUsageInsert,
) -> Result<(), String> {
    let user_op = row.user_op_hash.trim();
    if user_op.is_empty() {
        return Err("user_op_hash is required".to_string());
    }
    let lane = row.lane.trim();
    if lane.is_empty() {
        return Err("lane is required".to_string());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = global_sponsored_fee_usage_row_id(user_op);
    let parent_id = row
        .parent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    conn.execute(
        "INSERT OR IGNORE INTO global_sponsored_fee_usage (
            id, lane, parent_id, chain, chain_id, actor_npub, actor_evm, amount_wei,
            selector, action, target, user_op_hash, tx_hash, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            id,
            lane,
            parent_id,
            row.chain.trim(),
            row.chain_id as i64,
            row.actor_npub.trim(),
            row.actor_evm.trim(),
            row.amount_wei.trim(),
            row.selector.trim(),
            row.action.trim(),
            row.target.trim(),
            user_op,
            row.tx_hash.trim(),
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert global_sponsored_fee_usage: {e}"))?;
    Ok(())
}

pub fn insert_global_sponsored_fee_usage<R: Runtime>(
    handle: &AppHandle<R>,
    row: &GlobalSponsoredFeeUsageInsert,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let result = insert_global_sponsored_fee_usage_conn(&conn, row);
    crate::account_manager::return_db_connection(conn);
    result
}

fn list_global_sponsored_fee_usage_conn(
    conn: &rusqlite::Connection,
    actor_npub: &str,
    limit: u32,
) -> Result<Vec<GlobalSponsoredFeeUsageRow>, String> {
    let npub = actor_npub.trim();
    if npub.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, lane, parent_id, chain, chain_id, actor_npub, actor_evm, amount_wei,
                    selector, action, target, user_op_hash, tx_hash, created_at_ms
             FROM global_sponsored_fee_usage
             WHERE actor_npub = ?1
             ORDER BY created_at_ms DESC, user_op_hash DESC
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to list global_sponsored_fee_usage: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![npub, limit as i64], |row| {
            Ok(GlobalSponsoredFeeUsageRow {
                id: row.get(0)?,
                lane: row.get(1)?,
                parent_id: row.get(2)?,
                chain: row.get(3)?,
                chain_id: row.get::<_, i64>(4)? as u64,
                actor_npub: row.get(5)?,
                actor_evm: row.get(6)?,
                amount_wei: row.get(7)?,
                selector: row.get(8)?,
                action: row.get(9)?,
                target: row.get(10)?,
                user_op_hash: row.get(11)?,
                tx_hash: row.get(12)?,
                created_at_ms: row.get(13)?,
            })
        })
        .map_err(|e| format!("Failed to query global_sponsored_fee_usage: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[command]
pub fn list_global_sponsored_fee_usage<R: Runtime>(
    handle: AppHandle<R>,
    limit: Option<u32>,
) -> Result<Vec<GlobalSponsoredFeeUsageRow>, String> {
    let cap = clamp_sponsored_fee_usage_limit(limit);
    let actor_npub = crate::account_manager::get_current_account()?;
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let result = list_global_sponsored_fee_usage_conn(&conn, &actor_npub, cap);
    crate::account_manager::return_db_connection(conn);
    result
}

#[cfg(test)]
mod sponsored_fee_usage_tests {
    use super::{
        clamp_sponsored_fee_usage_limit, insert_squad_sponsored_fee_usage_conn,
        list_squad_sponsored_fee_usage_conn, sponsored_fee_usage_row_id,
        SquadSponsoredFeeUsageInsert,
    };

    fn sample_row(user_op_hash: &str) -> SquadSponsoredFeeUsageInsert {
        SquadSponsoredFeeUsageInsert {
            parent_id: "parent-1".to_string(),
            chain: "sepolia".to_string(),
            chain_id: 11155111,
            actor_npub: "npub1alice".to_string(),
            actor_evm: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            amount_wei: "7000000000000000".to_string(),
            selector: "0x01234567".to_string(),
            action: "castVote".to_string(),
            target: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
            user_op_hash: user_op_hash.to_string(),
            tx_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
                .to_string(),
        }
    }

    #[test]
    fn row_id_prefixes_user_op_hash() {
        assert_eq!(sponsored_fee_usage_row_id("0xabc"), "sfee-0xabc");
    }

    #[test]
    fn list_limit_clamps() {
        assert_eq!(clamp_sponsored_fee_usage_limit(None), 50);
        assert_eq!(clamp_sponsored_fee_usage_limit(Some(0)), 1);
        assert_eq!(clamp_sponsored_fee_usage_limit(Some(999)), 200);
    }

    #[test]
    fn insert_list_and_idempotent_on_user_op_hash() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        insert_squad_sponsored_fee_usage_conn(&conn, &sample_row("0xop1")).expect("insert");
        insert_squad_sponsored_fee_usage_conn(&conn, &sample_row("0xop1")).expect("dup ignore");
        insert_squad_sponsored_fee_usage_conn(&conn, &sample_row("0xop2")).expect("second");

        let listed = list_squad_sponsored_fee_usage_conn(&conn, "parent-1", 50).expect("list");
        assert_eq!(listed.len(), 2);
        let hashes: std::collections::HashSet<_> =
            listed.iter().map(|r| r.user_op_hash.as_str()).collect();
        assert_eq!(hashes, ["0xop1", "0xop2"].into_iter().collect());
        assert_eq!(listed[0].action, "castVote");
        assert_eq!(listed[0].amount_wei, "7000000000000000");
        // Same-ms inserts still have a deterministic order (user_op_hash DESC).
        assert!(listed[0].user_op_hash > listed[1].user_op_hash);

        let empty = list_squad_sponsored_fee_usage_conn(&conn, "other", 50).expect("empty");
        assert!(empty.is_empty());
    }
}

#[cfg(test)]
mod global_sponsored_fee_usage_tests {
    use super::{
        global_sponsored_fee_usage_row_id, insert_global_sponsored_fee_usage_conn,
        list_global_sponsored_fee_usage_conn, GlobalSponsoredFeeUsageInsert,
    };

    fn sample_row(user_op_hash: &str, lane: &str) -> GlobalSponsoredFeeUsageInsert {
        GlobalSponsoredFeeUsageInsert {
            lane: lane.to_string(),
            parent_id: Some("parent-1".to_string()),
            chain: "sepolia".to_string(),
            chain_id: 11155111,
            actor_npub: "npub1alice".to_string(),
            actor_evm: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            amount_wei: "7000000000000000".to_string(),
            selector: "0x01234567".to_string(),
            action: "bootstrapCrew".to_string(),
            target: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
            user_op_hash: user_op_hash.to_string(),
            tx_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
                .to_string(),
        }
    }

    #[test]
    fn row_id_prefixes_user_op_hash() {
        assert_eq!(global_sponsored_fee_usage_row_id("0xabc"), "gfee-0xabc");
    }

    #[test]
    fn insert_list_and_idempotent_on_user_op_hash() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");

        insert_global_sponsored_fee_usage_conn(&conn, &sample_row("0xop1", "gov_module"))
            .expect("insert");
        insert_global_sponsored_fee_usage_conn(&conn, &sample_row("0xop1", "gov_module"))
            .expect("dup ignore");
        insert_global_sponsored_fee_usage_conn(&conn, &sample_row("0xop2", "factory"))
            .expect("second");

        let listed =
            list_global_sponsored_fee_usage_conn(&conn, "npub1alice", 50).expect("list");
        assert_eq!(listed.len(), 2);
        let lanes: std::collections::HashSet<_> = listed.iter().map(|r| r.lane.as_str()).collect();
        assert!(lanes.contains("gov_module"));
        assert!(lanes.contains("factory"));
        assert_eq!(listed[0].parent_id.as_deref(), Some("parent-1"));
    }

    #[test]
    fn username_lane_allows_null_parent() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        let row = GlobalSponsoredFeeUsageInsert {
            lane: "username_bootstrap".to_string(),
            parent_id: None,
            chain: "sepolia".to_string(),
            chain_id: 11155111,
            actor_npub: "npub1bob".to_string(),
            actor_evm: "0xdddddddddddddddddddddddddddddddddddddddd".to_string(),
            amount_wei: "1".to_string(),
            selector: "0x98".to_string(),
            action: "claimUsername".to_string(),
            target: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee".to_string(),
            user_op_hash: "0xop3".to_string(),
            tx_hash: "0xtx3".to_string(),
        };
        insert_global_sponsored_fee_usage_conn(&conn, &row).expect("insert");
        let listed = list_global_sponsored_fee_usage_conn(&conn, "npub1bob", 50).expect("list");
        assert_eq!(listed.len(), 1);
        assert!(listed[0].parent_id.is_none());
    }
}

