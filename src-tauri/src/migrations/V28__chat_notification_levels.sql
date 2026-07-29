-- Per-chat notification level replaces the binary mute flag (R4, R10).
-- The default alone gives existing and new chats Mentions-only behavior;
-- no data carries over from the old `muted` boolean (KTD5).
ALTER TABLE chats ADD COLUMN notification_level TEXT NOT NULL DEFAULT 'mentions';
ALTER TABLE chats DROP COLUMN muted;

-- The profile-level mute path is deleted end to end (KTD6); DM muting now
-- lives on the chat level via notification_level above.
ALTER TABLE profiles DROP COLUMN muted;
