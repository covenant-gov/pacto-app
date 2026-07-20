-- Dashboard polls replica (MLS sync; Tauri only).
CREATE TABLE dashboard_polls (
    poll_id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT NOT NULL,
    announcements_group_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    options_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    created_by_npub TEXT NOT NULL,
    create_event_id TEXT NOT NULL,
    content_hash TEXT NOT NULL
);
CREATE INDEX idx_dashboard_polls_parent ON dashboard_polls(parent_id, created_at_ms);
CREATE TABLE dashboard_poll_votes (
    poll_id TEXT NOT NULL,
    voter_npub TEXT NOT NULL,
    option_id TEXT NOT NULL,
    vote_event_id TEXT NOT NULL,
    voted_at_ms INTEGER NOT NULL,
    PRIMARY KEY (poll_id, voter_npub)
);
CREATE INDEX idx_dashboard_poll_votes_poll ON dashboard_poll_votes(poll_id);
