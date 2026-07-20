-- Per-squad preferred squad-purpose EVM account (local roster signing identity).
CREATE TABLE squad_member_evm_account (
    parent_id TEXT NOT NULL,
    member_npub TEXT NOT NULL,
    evm_account_id TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (parent_id, member_npub),
    FOREIGN KEY (evm_account_id) REFERENCES evm_accounts(id)
);
CREATE INDEX idx_squad_member_evm_account_parent ON squad_member_evm_account(parent_id);
