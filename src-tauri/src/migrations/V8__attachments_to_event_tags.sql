-- Backfill attachment metadata from messages into event tags for kind=15 events.
UPDATE events
SET tags = (
    SELECT json_insert(events.tags, '$[#]', json_array('attachments', m.attachments))
    FROM messages m
    WHERE m.id = events.id
)
WHERE kind = 15
  AND id IN (
      SELECT e.id FROM events e
      JOIN messages m ON e.id = m.id
      WHERE e.kind = 15
        AND m.attachments IS NOT NULL
        AND m.attachments != '[]'
        AND NOT EXISTS (
            SELECT 1 FROM json_each(e.tags)
            WHERE json_extract(value, '$[0]') = 'attachments'
        )
  );

INSERT OR REPLACE INTO settings (key, value) VALUES ('storage_version', '3');
