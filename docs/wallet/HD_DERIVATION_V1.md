# Pacto HD EVM derivation (v1)

## Scope

This document defines how Pacto derives **Ethereum mainnet-style addresses** from the same **BIP-39 mnemonic** that backs the user’s **Nostr** identity (NIP-06 style via `nostr-sdk`).

## Path

- **Template:** `m/44'/60'/0'/0/{i}`  
- **Meaning:** Standard BIP-44 coin type **60** (Ethereum), account **0**, change **0**, address index **`i`** (0-based).  
- **Version tag in code/docs:** `pacto-hd-evm-v1` (described here; table column `scheme` stores `bip44_v1`).

Index `i` is the **HD account index** shown in Settings → Wallet (“Add HD account” appends the next index).

## Relationship to Nostr

- Nostr keys come from the mnemonic through the SDK’s NIP-06-compatible path (not re-documented here; see NIP-06 and `Keys::from_mnemonic` usage in the app).  
- **EVM accounts are sibling derivations:** they do **not** use `SHA256(nostr_secret || domain)` (that legacy formula is retired for new signing; see `EVM_ADDRESS_DERIVATION.md`).

## Seed parity with other wallets

**Pacto does not claim seed parity with other wallets, like MetaMask or Rabby, for the same phrase.** Users who need another wallet to show the same address should **export the private key** for that specific account (where the product exposes it). The recovery phrase remains the canonical backup for **Pacto Nostr + Pacto HD EVM indices**.

## Imported accounts

Keys added via **Import private key** are **not** derived from the mnemonic. They are stored encrypted per row (`imported_private_key` scheme). Treasury / Safe deployment in-app requires an **HD** account as the active signer.

## Reference test vector

For the phrase: `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`, path `m/44'/60'/0'/0/0`, the Ethereum address is:

`0x9858EfFD232B4033E47d90003D41EC34EcaEda94`

(Verified against Foundry `cast wallet address` with the same mnemonic and path.)

## Maintainer touchpoints

- Derivation: `src-tauri/src/evm.rs` (`derive_eth_bip44_v1_from_mnemonic_phrase`; BIP-39 seed path is internal to that module).  
- Persistence and active account: `src-tauri/src/evm_accounts.rs`.  
- Legacy SHA256-of-nostr documentation and cutover notes: `docs/wallet/EVM_ADDRESS_DERIVATION.md`.
