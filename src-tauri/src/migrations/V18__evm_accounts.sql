-- EVM accounts (phrase-derived + imported).
CREATE TABLE evm_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    scheme TEXT NOT NULL,
    hd_index INTEGER,
    address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    imported_enc TEXT,
    purpose TEXT NOT NULL DEFAULT 'squad'
);
CREATE INDEX idx_evm_accounts_scheme_hd ON evm_accounts(scheme, hd_index);
