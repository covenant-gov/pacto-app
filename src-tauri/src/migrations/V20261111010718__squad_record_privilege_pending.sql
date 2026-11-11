-- Squad event/doc rumors whose create/add privilege check was undecided (RPC failure or no roster binding yet).
CREATE TABLE squad_record_privilege_pending (
    rumor_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,                   -- event | doc
    parent_id TEXT NOT NULL,
    mls_group_id TEXT NOT NULL,
    author_npub TEXT NOT NULL,            -- MLS signer
    payload_json TEXT NOT NULL,           -- rumor content
    received_ms INTEGER NOT NULL
);
CREATE INDEX idx_squad_record_privilege_pending_parent ON squad_record_privilege_pending(parent_id, author_npub);
