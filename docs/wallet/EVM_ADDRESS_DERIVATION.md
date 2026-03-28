# EVM address derivation in Pacto

## Current behavior (HD v1)

The embedded wallet uses **BIP-39** (recovery phrase) plus **BIP-32** path **`m/44'/60'/0'/0/{i}`** for account index `i`. See [`HD_DERIVATION_V1.md`](./HD_DERIVATION_V1.md) for the normative spec and a golden test vector.

The **Ethereum address** for a given 32-byte secp256k1 private key is:

`address = last 20 bytes of keccak256(x || y)`

where `x` and `y` are the 32-byte coordinates of the **uncompressed** public point. The SEC1 prefix byte `0x04` must **not** be included in the hash (same rule as MetaMask, Ledger, and other standard Ethereum wallets).

Importing an exported `0x…` private key into another wallet should show **the same address** as Pacto for that key.

## Legacy formula (removed for signing)

Earlier development builds derived a **single** EVM key as:

`evm_secret = SHA256(nostr_secret || "pacto-evm-derivation-v1")`

That path is **not** used for new **HD** accounts. Existing databases are **migrated on first wallet use** when a recovery phrase is available: account `bip44-v1-0` becomes the primary HD row and signing material is aligned to BIP-44 index 0. Installations with **only** an encrypted legacy `evm_pkey` and **no** stored phrase are represented as a single **imported** row wrapping the existing ciphertext until the user restores a phrase-backed profile.

## Legacy address hash bug (historical)

Older builds hashed `0x04 || x || y` (65 bytes) instead of `x || y` (64 bytes), producing a **different** address than standard wallets for the same private key. The app could repair `settings.evm_address` when decrypting the EVM key; see [`../legacy-fixes/LF-001-evm-address-repair.md`](../legacy-fixes/LF-001-evm-address-repair.md).

---

**Maintainers:** Signing resolution and multi-account storage live in `src-tauri/src/evm_accounts.rs` and `src-tauri/src/wallet_ops.rs`.

**Nostr Kind 0 (self):** Optional public **`evm_address`** on profile metadata is the **default-shared** account (`default_shared_evm_account_id`), not necessarily the **active** signer — see `docs/wallet/README.md` and `src-tauri/src/profile.rs`.
