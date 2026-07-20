-- Mark existing accounts as using the legacy hard-coded key-derivation salt.
INSERT INTO settings (key, value) VALUES ('key_derivation_version', '1');
