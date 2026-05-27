# Pacto HD EVM derivation (v1)

## Scope

This document defines how Pacto derives **Ethereum mainnet-style addresses** from the same **BIP-39 mnemonic** that backs the user’s **Nostr** identity (NIP-06 style via `nostr-sdk`).

## Path

- **Template:** `m/44'/60'/0'/0/{i}`  
- **Meaning:** Standard BIP-44 coin type **60** (Ethereum), account **0**, change **0**, address index **`i`** (0-based).  
- **Version tag in code/docs:** `pacto-hd-evm-v1` (table column `scheme` stores `bip44_v1`).

Index `i` is the **HD account index** shown in Settings → Wallet (“Add HD account” appends the next index).

## Address from private key

For any 32-byte secp256k1 private key:

`address = last 20 bytes of keccak256(x || y)`

where `x` and `y` are the 32-byte coordinates of the **uncompressed** public point. The SEC1 prefix **`0x04` must not** be included in the hash (same rule as MetaMask, Ledger, and other standard Ethereum wallets). Importing an exported `0x…` private key elsewhere should show **the same address** as Pacto for that key.

## Relationship to Nostr

- Nostr keys come from the mnemonic through the SDK’s NIP-06-compatible path (see NIP-06 and `Keys::from_mnemonic` usage in the app).  
- **EVM accounts are sibling derivations:** they do **not** use `SHA256(nostr_secret || domain)` (legacy formula below).

## Seed parity with other wallets

**Pacto does not claim seed parity with other wallets** (MetaMask, Rabby, etc.) for the same phrase. Users who need another wallet to show the same address should **export the private key** for that account. The recovery phrase remains the canonical backup for **Pacto Nostr + Pacto HD EVM indices**.

## Imported accounts

Keys added via **Import private key** are **not** derived from the mnemonic. They are stored encrypted per row (`imported_private_key` scheme). Treasury / Safe deployment in-app requires an **HD** account as the active signer.

## Legacy SHA256-of-nostr (retired for signing)

Earlier builds used:

`evm_secret = SHA256(nostr_secret || "pacto-evm-derivation-v1")`

That path is **not** used for new HD accounts. On first wallet use with a stored recovery phrase, account `bip44-v1-0` becomes primary and signing aligns to BIP-44 index 0. Installations with **only** encrypted legacy `evm_pkey` and **no** phrase get a single **imported** row until the user restores phrase-backed profile.

## Legacy address hash bug (historical)

Older builds hashed `0x04 || x || y` instead of `x || y`, producing a non-standard address for the same key. Repair path: [`docs/legacy-fixes/LF-001-evm-address-repair.md`](../legacy-fixes/LF-001-evm-address-repair.md).

## Reference test vector

Phrase: `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`, path `m/44'/60'/0'/0/0`:

`0x9858EfFD232B4033E47d90003D41EC34EcaEda94`

(Verified against Foundry `cast wallet address`.)

## Maintainer touchpoints

- Derivation: `src-tauri/src/evm.rs` (`derive_eth_bip44_v1_from_mnemonic_phrase`).  
- Persistence and active account: `src-tauri/src/evm_accounts.rs`, `src-tauri/src/wallet_ops.rs`.  
- **Kind 0 profile:** optional public **`evm_address`** is the **default-shared** account (`default_shared_evm_account_id`), not necessarily the **active** signer — see `docs/wallet/README.md`, `src-tauri/src/profile.rs`.
