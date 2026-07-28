-- Catch up entry store (R13, R20, R21, R24; KD1, KTD8): a references-only
-- index of events admitted by U2's `earns_catch_up_entry` predicate. Rows
-- carry source ids and a resolution timestamp, never message content or a
-- sender name, so the table cannot become a second store of record — the
-- absence of a content column is what makes that enforced, not aspirational.
CREATE TABLE catch_up_entries (
    id TEXT PRIMARY KEY NOT NULL,
    source_event_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
);

-- The dedup mechanism (Approach #7): an `ON CONFLICT(source_event_id) DO
-- NOTHING` insert, not a read-then-write check, so two arrival paths for
-- the same event race safely down to one row. This is also what replaces
-- the in-memory `NOTIFIED_WELCOMES` set — a `welcome`-kind row already
-- existing for a wrapper_event_id survives a restart because it is here.
CREATE UNIQUE INDEX idx_catch_up_entries_source_event ON catch_up_entries(source_event_id);

-- Orphan cleanup (Approach #4) and squad-scoped filtering key off chat_id;
-- a squad's member chat ids come from the squads catalog rather than a
-- redundant squad_id column on this table.
CREATE INDEX idx_catch_up_entries_chat ON catch_up_entries(chat_id);

-- Unresolved-by-kind listing (R25) — the list command's primary access path.
CREATE INDEX idx_catch_up_entries_kind_resolved ON catch_up_entries(kind, resolved_at);
