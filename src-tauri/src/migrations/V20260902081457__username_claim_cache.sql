-- Local cache of the account's Username NFT claim (one row per account npub).
CREATE TABLE username_claims (
    npub TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL,
    npub_hash TEXT NOT NULL,
    token_id TEXT NOT NULL,
    link_event_id TEXT,
    policy_version INTEGER NOT NULL,
    network TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
