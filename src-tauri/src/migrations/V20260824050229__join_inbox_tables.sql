CREATE TABLE IF NOT EXISTS join_inbox_meta (
    parent_id TEXT PRIMARY KEY NOT NULL,
    inbox_npub TEXT NOT NULL,
    holders_json TEXT NOT NULL,
    key_epoch INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS join_inbox_secret (
    parent_id TEXT PRIMARY KEY NOT NULL,
    key_epoch INTEGER NOT NULL,
    inbox_npub TEXT NOT NULL,
    encrypted_nsec TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
