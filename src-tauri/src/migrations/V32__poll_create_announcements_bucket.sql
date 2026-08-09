-- Rewrite mis-bucketed dashboard poll creates into announcements.
UPDATE events
SET virtual_bucket = 'announcements'
WHERE virtual_bucket = 'polls'
  AND content LIKE '%"type":"dashboard_poll_created"%';
