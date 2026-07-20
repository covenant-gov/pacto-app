-- Squad/network parent id + member npub -> EVM payout address.
CREATE TABLE squad_member_evm (
    parent_id TEXT NOT NULL,
    member_npub TEXT NOT NULL,
    evm_address TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (parent_id, member_npub)
);
CREATE INDEX idx_squad_member_evm_parent ON squad_member_evm(parent_id);
