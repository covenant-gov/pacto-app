-- Local copy of pre-welcome channel chat. Existing MLS rows stay 0.
ALTER TABLE events ADD COLUMN history_import INTEGER NOT NULL DEFAULT 0;
