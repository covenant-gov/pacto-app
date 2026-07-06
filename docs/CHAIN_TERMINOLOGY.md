# Chain terminology

Canonical network identifiers, so the same chain is never written two ways.

## Rule

Use the **`SupportedChainId`** key as the single identifier for a network in code, wire payloads, stored rows, and config. Never introduce a second spelling or alias for the same chain.

| Canonical key | Chain            | Chain ID |
|---------------|------------------|----------|
| `mainnet`     | Ethereum mainnet | 1        |
| `arbitrum`    | Arbitrum One     | 42161    |
| `sepolia`     | Ethereum Sepolia | 11155111 |
| `local`       | Local Anvil      | 31337    |

Source of truth: `src/lib/wallet/chains.ts` (`SupportedChainId`) mirrored by rows in `src/lib/wallet/wallet-assets.json` and `src-tauri/src/evm/wallet_chain_config.rs`.

## Local devnet: it is `local`, not `anvil`

The local devnet key is **`local`**. `anvil` is **not** an accepted identifier or wire alias — inputs of `"anvil"` are unknown and fall back to `sepolia` (frontend `parseSupportedChainId`) or are rejected (`network_by_key`, DM message parsing).

`Anvil` survives only as **human-readable text**:

- the display label `"Local Anvil"` / chain name `"Anvil"`, and
- the viem `anvil` chain import (aliased `anvilChain` in `chains.ts`).

These are descriptive wording and a library symbol, not identifiers. Do not reintroduce an `anvil` key or alias branch.

## Why (greenfield)

No public alpha has shipped, so nothing emits `anvil` on the wire that we must tolerate. A single identifier keeps parsing, storage, and comparisons on one path — consistent with `.cursor/rules/greenfield-no-legacy.mdc` (no dual-read / just-in-case alias branches).
