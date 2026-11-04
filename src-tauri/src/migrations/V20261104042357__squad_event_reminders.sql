-- Device-local reminder settings and fire bookkeeping for squad events. Never replicated.
CREATE TABLE squad_event_reminder_prefs (
    event_id TEXT PRIMARY KEY,
    lead_minutes INTEGER NOT NULL DEFAULT 15,
    muted INTEGER NOT NULL DEFAULT 0
);

-- One row per (event, fire time) so each fire is handled once.
CREATE TABLE squad_event_reminders (
    event_id TEXT NOT NULL,
    fire_at_ms INTEGER NOT NULL,
    start_at_ms INTEGER NOT NULL,
    state TEXT NOT NULL,                  -- scheduled | fired | missed | dropped
    PRIMARY KEY (event_id, fire_at_ms)
);
CREATE INDEX idx_squad_event_reminders_state ON squad_event_reminders(state);
