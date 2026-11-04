-- Squad docs shelf replica and children (update/remove) that arrived before their add.
CREATE TABLE squad_docs (
    doc_id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL,
    mls_group_id TEXT NOT NULL,
    url TEXT NOT NULL,                    -- raw, fragment included
    title TEXT NOT NULL,
    provider TEXT NOT NULL,               -- cryptpad | google | zoho | notion | etherpad | other
    channel_id TEXT,
    note TEXT,
    author_npub TEXT NOT NULL,            -- MLS signer of the add
    add_rumor_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    updated_by_npub TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0     -- sticky once removed
);
CREATE INDEX idx_squad_docs_parent ON squad_docs(parent_id);

CREATE TABLE squad_doc_pending_ops (
    rumor_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    mls_group_id TEXT NOT NULL,
    author_npub TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_squad_doc_pending_doc ON squad_doc_pending_ops(doc_id);
