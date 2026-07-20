-- Fix DM chats that were created with an empty participants list.
UPDATE chats
SET participants = json_array(chat_identifier)
WHERE chat_type = 0 AND participants = '[]';
