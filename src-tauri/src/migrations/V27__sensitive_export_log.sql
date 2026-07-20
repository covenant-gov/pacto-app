-- Sensitive export audit log (rate-limiting and forensics).
CREATE TABLE sensitive_export_log (
    id TEXT PRIMARY KEY NOT NULL,
    account_npub TEXT NOT NULL,
    export_type TEXT NOT NULL,
    attempted_at INTEGER NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    error_code TEXT
);
CREATE INDEX idx_sensitive_export_log_account_time ON sensitive_export_log(account_npub, attempted_at);
