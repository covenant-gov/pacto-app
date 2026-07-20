-- Squad / squad-pair catalog.
CREATE TABLE squads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon_url TEXT,
    kind TEXT NOT NULL DEFAULT 'squad',
    visibility TEXT NOT NULL DEFAULT 'private',
    commons_tags TEXT,
    paired_squads TEXT,
    channels TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_squads_updated ON squads(updated_at_ms DESC);
