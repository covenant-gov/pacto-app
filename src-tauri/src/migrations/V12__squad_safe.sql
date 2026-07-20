-- Squad/network id -> Safe address (for multisig).
CREATE TABLE squad_safe (
    squad_id TEXT PRIMARY KEY,
    safe_address TEXT NOT NULL
);
