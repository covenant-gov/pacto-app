-- Npubs already added to an mls_groups row's engine group whose welcome delivery
-- has not yet succeeded (JSON array of npub strings). See MlsGroupMetadata::pending_welcomes.
ALTER TABLE mls_groups ADD COLUMN pending_welcomes TEXT NOT NULL DEFAULT '[]';
