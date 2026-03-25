# EVM address vs exported private key

## Expected behavior

The embedded EVM key is **derived** from the Nostr secret (`SHA256(nostr_secret || "pacto-evm-derivation-v1")`). The **Ethereum address** is the standard one for that 32-byte secp256k1 key:

`address = last 20 bytes of keccak256(x || y)`

where `x` and `y` are the 32-byte coordinates of the **uncompressed** public point. The SEC1 prefix byte `0x04` must **not** be included in the hash (same rule as MetaMask, Ledger, etc.).

Importing the exported `0x…` private key into MetaMask should therefore show **the same address** as Pacto’s **EVM address** row.

## Legacy bug (fixed)

Older builds hashed `0x04 || x || y` (65 bytes) instead of `x || y` (64 bytes). That produced a **different** address in settings than wallets derive from the same key.

**Fix in app:** On `get_evm_address` and when loading the wallet summary, Pacto decrypts the stored EVM key (when the session allows), recomputes the canonical address, and **updates** `settings.evm_address` and the current account row in `profiles` if they were wrong.

If you published `evm_address` in Nostr profile metadata while the wrong value was stored, you may need to **update your profile** so relays show the corrected address for contacts.

---

**Maintainers:** The auto-repair path is catalogued for pre–v1 removal — see [`docs/legacy-fixes/LF-001-evm-address-repair.md`](../legacy-fixes/LF-001-evm-address-repair.md).
