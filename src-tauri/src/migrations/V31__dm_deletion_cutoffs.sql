-- Per-peer DM deletion cutoffs: after delete, gift wraps with created_at <= deleted_at
-- are ignored so relay replay cannot restore purged history or re-friend the peer.
CREATE TABLE dm_deletion_cutoffs (
    peer_npub TEXT PRIMARY KEY NOT NULL,
    deleted_at INTEGER NOT NULL
);
