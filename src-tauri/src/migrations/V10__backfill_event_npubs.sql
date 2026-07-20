-- Backfill npub for events that have a user_id but no npub.
UPDATE events
SET npub = (SELECT p.npub FROM profiles p WHERE p.id = events.user_id)
WHERE npub IS NULL AND user_id IS NOT NULL;
