-- Per-UserOp global paymaster spend ledger (account-scoped).
CREATE TABLE global_sponsored_fee_usage (
    id TEXT PRIMARY KEY NOT NULL,
    lane TEXT NOT NULL,
    parent_id TEXT,
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
CREATE UNIQUE INDEX idx_global_sponsored_fee_usage_user_op
    ON global_sponsored_fee_usage(user_op_hash);
CREATE INDEX idx_global_sponsored_fee_usage_actor
    ON global_sponsored_fee_usage(actor_npub, created_at_ms DESC);
