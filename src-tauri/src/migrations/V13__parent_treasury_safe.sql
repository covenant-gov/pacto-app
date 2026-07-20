-- Treasury Safes per parent (multiple rows per parent).
CREATE TABLE parent_treasury_safe (
    id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL,
    safe_address TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'sepolia',
    label TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_parent_treasury_unique ON parent_treasury_safe(parent_id, safe_address, chain);
CREATE INDEX idx_parent_treasury_parent ON parent_treasury_safe(parent_id, created_at_ms);

-- Migrate existing squad_safe rows into the new parent_treasury_safe table.
INSERT INTO parent_treasury_safe (id, parent_id, safe_address, chain, label, created_at_ms)
SELECT lower(hex(randomblob(16))), squad_id, safe_address, 'sepolia', '', (strftime('%s', 'now') * 1000)
FROM squad_safe;
