-- Squad-tracked ERC-20s for Treasury Safe / shared balance reads.
CREATE TABLE squad_tracked_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    token_address TEXT NOT NULL,
    symbol TEXT NOT NULL DEFAULT '',
    decimals INTEGER NOT NULL DEFAULT 18,
    added_by_npub TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_squad_tracked_tokens_unique ON squad_tracked_tokens(parent_id, chain, token_address);
CREATE INDEX idx_squad_tracked_tokens_parent ON squad_tracked_tokens(parent_id, created_at_ms);
