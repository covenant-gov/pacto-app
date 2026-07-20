-- Commons discovery broadcasts.
CREATE TABLE commons_broadcasts (
    event_id TEXT PRIMARY KEY NOT NULL,
    author_pubkey TEXT NOT NULL,
    author_npub TEXT NOT NULL,
    subject TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    message TEXT NOT NULL,
    duration_hours INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    tags_json TEXT NOT NULL,
    audience TEXT,
    squad_id TEXT,
    squad_name TEXT,
    squad_kind TEXT,
    squad_icon_url TEXT,
    created_at INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_commons_broadcasts_expires ON commons_broadcasts(expires_at);
CREATE INDEX idx_commons_broadcasts_subject ON commons_broadcasts(subject_id, created_at);
