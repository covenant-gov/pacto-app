-- Squad bot identity tables.
CREATE TABLE squad_bot_meta (
    parent_id TEXT PRIMARY KEY NOT NULL,
    bot_npub TEXT NOT NULL,
    holders_json TEXT NOT NULL,
    key_epoch INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE squad_bot_secret (
    parent_id TEXT PRIMARY KEY NOT NULL,
    key_epoch INTEGER NOT NULL,
    bot_npub TEXT NOT NULL,
    encrypted_nsec TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
