-- Add evm_address column to profiles (legacy; payouts use dm_peer_evm).
ALTER TABLE profiles ADD COLUMN evm_address TEXT NOT NULL DEFAULT '';
