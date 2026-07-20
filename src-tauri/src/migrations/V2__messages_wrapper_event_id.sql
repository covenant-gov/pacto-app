-- Add wrapper_event_id to messages for gift-wrap deduplication.
ALTER TABLE messages ADD COLUMN wrapper_event_id TEXT;
CREATE INDEX idx_messages_wrapper ON messages(wrapper_event_id);
