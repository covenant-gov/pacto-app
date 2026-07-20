-- Events table: flat, protocol-aligned storage for all Nostr events.
-- Also migrates existing messages (and their reactions) into the events table.
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    kind INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    user_id INTEGER,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    reference_id TEXT,
    created_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    mine INTEGER NOT NULL DEFAULT 0,
    pending INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    wrapper_event_id TEXT,
    npub TEXT,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_events_chat_time ON events(chat_id, created_at DESC);
CREATE INDEX idx_events_kind ON events(kind);
CREATE INDEX idx_events_reference ON events(reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX idx_events_wrapper ON events(wrapper_event_id) WHERE wrapper_event_id IS NOT NULL;
CREATE INDEX idx_events_user ON events(user_id);

-- Migrate text messages and file attachments from messages.
INSERT INTO events (
    id, kind, chat_id, user_id, content, tags, reference_id,
    created_at, received_at, mine, pending, failed, wrapper_event_id, npub
)
SELECT
    m.id,
    CASE
        WHEN m.attachments != '[]' AND m.attachments IS NOT NULL THEN 15
        ELSE 14
    END AS kind,
    m.chat_id,
    m.user_id,
    m.content_encrypted,
    CASE
        WHEN m.replied_to != '' THEN json_array(json_array('e', m.replied_to, '', 'reply'))
        ELSE '[]'
    END AS tags,
    NULL AS reference_id,
    m.at / 1000 AS created_at,
    m.at AS received_at,
    m.mine,
    0 AS pending,
    0 AS failed,
    m.wrapper_event_id,
    p.npub
FROM messages m
LEFT JOIN profiles p ON p.id = m.user_id;

-- Extract reactions from the messages.reactions JSON array into separate kind=7 events.
INSERT OR IGNORE INTO events (
    id, kind, chat_id, user_id, content, tags, reference_id,
    created_at, received_at, mine, pending, failed, wrapper_event_id, npub
)
SELECT
    json_extract(r.value, '$.id'),
    7,
    m.chat_id,
    NULL,
    json_extract(r.value, '$.emoji'),
    json_array(json_array('e', m.id)),
    m.id,
    m.at / 1000,
    m.at,
    0,
    0,
    0,
    NULL,
    json_extract(r.value, '$.author_id')
FROM messages m
JOIN json_each(m.reactions) AS r
WHERE m.reactions != '[]' AND m.reactions IS NOT NULL
  AND json_extract(r.value, '$.id') IS NOT NULL
  AND json_extract(r.value, '$.emoji') IS NOT NULL;

INSERT OR REPLACE INTO settings (key, value) VALUES ('storage_version', '2');
