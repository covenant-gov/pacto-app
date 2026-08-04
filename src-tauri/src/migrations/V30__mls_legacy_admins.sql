-- Admin keys harvested from a legacy (pre-0.8.0) MDK store by direct SQL,
-- one row per (group, admin key), so a reset explanation can still name who
-- to trust after the legacy store itself has been archived away.
CREATE TABLE mls_legacy_admins (
    group_id TEXT NOT NULL,
    admin_npub TEXT NOT NULL,
    harvested_at INTEGER NOT NULL
);

-- Uniqueness on the group-and-key pair is what makes re-running the harvest
-- idempotent: an `INSERT OR IGNORE` replay produces no duplicate rows.
CREATE UNIQUE INDEX idx_mls_legacy_admins_group_admin ON mls_legacy_admins(group_id, admin_npub);

-- Primary access path: every admin harvested for one group.
CREATE INDEX idx_mls_legacy_admins_group ON mls_legacy_admins(group_id);
