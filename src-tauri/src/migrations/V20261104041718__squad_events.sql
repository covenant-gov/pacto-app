-- Squad events replica (NIP-52 shaped), RSVPs, and children that arrived before their create.
CREATE TABLE squad_events (
    event_id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL,
    mls_group_id TEXT NOT NULL,
    series_id TEXT,
    nip52_kind INTEGER NOT NULL,          -- 31922 all-day, 31923 timed
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    start_unix INTEGER,                   -- timed
    end_unix INTEGER,
    start_date TEXT,                      -- all-day, end exclusive
    end_date TEXT,
    start_tzid TEXT NOT NULL,
    place_kind TEXT NOT NULL,             -- online | offline
    location TEXT NOT NULL DEFAULT '',    -- member-only
    channel_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',-- active | cancelled
    author_npub TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    updated_by_npub TEXT NOT NULL,
    content_hash TEXT NOT NULL
);
CREATE INDEX idx_squad_events_parent ON squad_events(parent_id);
CREATE INDEX idx_squad_events_series ON squad_events(series_id);

CREATE TABLE squad_event_rsvps (
    event_id TEXT NOT NULL,
    member_npub TEXT NOT NULL,
    status TEXT NOT NULL,                 -- accepted | tentative | declined
    updated_at_ms INTEGER NOT NULL,
    rumor_id TEXT NOT NULL,
    PRIMARY KEY (event_id, member_npub)
);

CREATE TABLE squad_event_pending_ops (
    rumor_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    mls_group_id TEXT NOT NULL,
    author_npub TEXT NOT NULL,
    op TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_squad_event_pending_event ON squad_event_pending_ops(event_id);
