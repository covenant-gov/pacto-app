-- Add virtual bucket column for MLS single-group routing.
ALTER TABLE events ADD COLUMN virtual_bucket TEXT;
CREATE INDEX idx_events_chat_vbucket ON events(chat_id, virtual_bucket);
