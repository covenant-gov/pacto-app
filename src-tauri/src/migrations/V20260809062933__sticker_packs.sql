-- Squad-owned sticker packs, announced over MLS as `sticker_pack_updated`
-- (mirrors `governance_updated`). Rows are keyed per squad + pack so every
-- member's local table converges independently; conflicts resolve
-- last-write-wins on `updated_at`. `deleted` is a tombstone, not a delete,
-- so a stale announce can never resurrect a removed pack.
CREATE TABLE sticker_packs (
    squad_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    name TEXT NOT NULL,
    entries TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (squad_id, pack_id)
);
CREATE INDEX idx_sticker_packs_deleted ON sticker_packs(deleted);
