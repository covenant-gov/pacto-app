-- Pairwise wallet address exchange for DM peers.
CREATE TABLE dm_peer_evm (
    my_npub TEXT NOT NULL,
    peer_npub TEXT NOT NULL,
    evm_address TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (my_npub, peer_npub)
);
