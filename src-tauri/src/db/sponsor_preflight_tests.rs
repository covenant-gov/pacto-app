use super::mls::parent_exists_in_groups_conn;
use super::squad::parent_has_sponsor_infra_conn;

fn mls_groups_schema(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "CREATE TABLE mls_groups (
                group_id TEXT PRIMARY KEY,
                engine_group_id TEXT NOT NULL DEFAULT '',
                evicted INTEGER NOT NULL DEFAULT 0
            );",
    )
    .expect("schema");
}

fn insert_group(
    conn: &rusqlite::Connection,
    group_id: &str,
    engine_group_id: &str,
    evicted: bool,
) {
    conn.execute(
        "INSERT INTO mls_groups (group_id, engine_group_id, evicted) VALUES (?1, ?2, ?3)",
        rusqlite::params![group_id, engine_group_id, evicted as i32],
    )
    .expect("insert");
}

#[test]
fn parent_exists_matches_group_id_or_engine_group_id() {
    let conn = rusqlite::Connection::open_in_memory().expect("db");
    mls_groups_schema(&conn);
    insert_group(&conn, "squad-1", "engine-1", false);
    assert!(parent_exists_in_groups_conn(&conn, "squad-1").unwrap());
    assert!(parent_exists_in_groups_conn(&conn, "engine-1").unwrap());
    assert!(!parent_exists_in_groups_conn(&conn, "squad-2").unwrap());
}

#[test]
fn parent_exists_excludes_evicted_groups() {
    let conn = rusqlite::Connection::open_in_memory().expect("db");
    mls_groups_schema(&conn);
    insert_group(&conn, "squad-1", "engine-1", true);
    assert!(!parent_exists_in_groups_conn(&conn, "squad-1").unwrap());
    assert!(!parent_exists_in_groups_conn(&conn, "engine-1").unwrap());
}

fn squad_infra_schema(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "CREATE TABLE squad_infra (
                id TEXT PRIMARY KEY NOT NULL,
                parent_id TEXT NOT NULL,
                infra_type TEXT NOT NULL,
                chain TEXT NOT NULL,
                canonical_ref TEXT NOT NULL,
                pacto_gov_revision TEXT,
                provider_payload TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );",
    )
    .expect("schema");
}

fn insert_infra(conn: &rusqlite::Connection, id: &str, parent: &str, kind: &str) {
    conn.execute(
            "INSERT INTO squad_infra (id, parent_id, infra_type, chain, canonical_ref, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, 'sepolia', 'ref', 1, 1)",
            rusqlite::params![id, parent, kind],
        )
        .expect("insert");
}

#[test]
fn parent_has_sponsor_infra_only_counts_sponsor_rows() {
    let conn = rusqlite::Connection::open_in_memory().expect("db");
    squad_infra_schema(&conn);
    assert!(!parent_has_sponsor_infra_conn(&conn, "parent-1").unwrap());

    insert_infra(&conn, "sponsor-parent-1", "parent-1", "sponsor");
    assert!(parent_has_sponsor_infra_conn(&conn, "parent-1").unwrap());
    assert!(!parent_has_sponsor_infra_conn(&conn, "parent-2").unwrap());

    // A non-sponsor infra row must not trip the duplicate-deploy guard.
    insert_infra(&conn, "pacto-gov-parent-2", "parent-2", "pacto_gov");
    assert!(!parent_has_sponsor_infra_conn(&conn, "parent-2").unwrap());
}
