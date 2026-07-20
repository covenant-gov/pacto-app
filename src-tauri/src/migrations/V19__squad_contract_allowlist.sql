-- Explicit squad contract allowlist (Phase I).
CREATE TABLE squad_contract_allowlist (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    added_by_npub TEXT NOT NULL,
    abi_ref TEXT,
    notes TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_squad_allowlist_unique ON squad_contract_allowlist(parent_id, chain, contract_address);
CREATE INDEX idx_squad_allowlist_parent ON squad_contract_allowlist(parent_id, created_at_ms);
