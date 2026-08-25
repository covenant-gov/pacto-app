ALTER TABLE squad_member_evm ADD COLUMN issued_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE squad_member_evm ADD COLUMN bind_signature TEXT NOT NULL DEFAULT '';
