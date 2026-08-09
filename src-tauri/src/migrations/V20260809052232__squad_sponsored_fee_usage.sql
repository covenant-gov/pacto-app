-- Per-UserOp sponsored gas spend ledger for Treasury usage history.
CREATE TABLE squad_sponsored_fee_usage (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    actor_npub TEXT NOT NULL,
    actor_evm TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    selector TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    user_op_hash TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_squad_sponsored_fee_usage_user_op
    ON squad_sponsored_fee_usage(user_op_hash);
CREATE INDEX idx_squad_sponsored_fee_usage_parent
    ON squad_sponsored_fee_usage(parent_id, created_at_ms DESC);
