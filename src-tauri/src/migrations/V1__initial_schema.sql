-- Initial Pacto per-account schema.
-- This is the reconstructed earliest schema state before any incremental migrations.
-- Newly created databases will run V1 through the latest migration; existing databases
-- are baselined to the latest version so refinery only applies future migrations.

-- Profiles table (plaintext - public data)
CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT '',
    lud06 TEXT NOT NULL DEFAULT '',
    lud16 TEXT NOT NULL DEFAULT '',
    banner TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    nip05 TEXT NOT NULL DEFAULT '',
    status_content TEXT NOT NULL DEFAULT '',
    status_url TEXT NOT NULL DEFAULT '',
    muted INTEGER NOT NULL DEFAULT 0,
    bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_profiles_npub ON profiles(npub);
CREATE INDEX idx_profiles_name ON profiles(name);

-- Chats table (plaintext - metadata)
CREATE TABLE chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_identifier TEXT UNIQUE NOT NULL,
    chat_type INTEGER NOT NULL,
    participants TEXT NOT NULL,
    last_read TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    muted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_chats_identifier ON chats(chat_identifier);
CREATE INDEX idx_chats_created ON chats(created_at DESC);

-- Messages table (content encrypted, metadata plaintext)
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    content_encrypted TEXT NOT NULL,
    replied_to TEXT NOT NULL DEFAULT '',
    preview_metadata TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    reactions TEXT NOT NULL DEFAULT '[]',
    at INTEGER NOT NULL,
    mine INTEGER NOT NULL,
    user_id INTEGER,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_messages_chat ON messages(chat_id, at);
CREATE INDEX idx_messages_time ON messages(at DESC);
CREATE INDEX idx_messages_user ON messages(user_id);

-- Settings table (key-value pairs)
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- MLS Groups table
CREATE TABLE mls_groups (
    group_id TEXT PRIMARY KEY,
    engine_group_id TEXT NOT NULL DEFAULT '',
    creator_pubkey TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    avatar_ref TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    evicted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_mls_groups_evicted_updated ON mls_groups(evicted, updated_at DESC);
CREATE INDEX idx_mls_groups_creator ON mls_groups(creator_pubkey);

-- MLS Key Packages table
CREATE TABLE mls_keypackages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_pubkey TEXT NOT NULL,
    device_id TEXT NOT NULL,
    keypackage_ref TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX idx_keypackages_owner ON mls_keypackages(owner_pubkey);

-- MLS Event Cursors table
CREATE TABLE mls_event_cursors (
    group_id TEXT PRIMARY KEY,
    last_seen_event_id TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL
);
