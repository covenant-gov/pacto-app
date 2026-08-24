-- Display replica for Hats/roles and process-board slices, synced over MLS.
-- LWW by block_number per (parent, stack, round, kind). Not ACL truth.
CREATE TABLE squad_gov_replica (
    parent_id TEXT NOT NULL,
    stack TEXT NOT NULL,
    round TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    block_number INTEGER NOT NULL DEFAULT 0,
    tx_hash TEXT NOT NULL DEFAULT '',
    snapshot_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (parent_id, stack, round, kind)
);
CREATE INDEX idx_squad_gov_replica_parent ON squad_gov_replica(parent_id);
