-- Per-squad content restrictions; per-flag last-timestamp-wins.
CREATE TABLE squad_content_policy (
    parent_id TEXT PRIMARY KEY,
    restrict_event_create INTEGER NOT NULL DEFAULT 0,
    restrict_event_create_updated_at_ms INTEGER NOT NULL DEFAULT 0,
    restrict_event_create_by_npub TEXT,
    restrict_doc_add INTEGER NOT NULL DEFAULT 0,
    restrict_doc_add_updated_at_ms INTEGER NOT NULL DEFAULT 0,
    restrict_doc_add_by_npub TEXT
);
