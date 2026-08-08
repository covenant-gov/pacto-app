# RPC configuration and viem usage

This document describes **RPC endpoints** (frontend and backend) and **where viem runs** relative to signing. It is design reference for implementers.

---

## 1. RPC URLs (environment and defaults)

### Operator provider keys (frontend + backend)

One **Alchemy** API key builds per-chain URLs automatically:

```text
https://{host}.g.alchemy.com/v2/{ALCHEMY_RPC_KEY}
```

| Network key | Alchemy host |
|-------------|----------------|
| `mainnet` | `eth-mainnet` |
| `sepolia` | `eth-sepolia` |
| `arbitrum` | `arb-mainnet` |

`local` (Anvil, chain `31337`) has no provider host; it uses the curated `http://localhost:8545` fallback from `rpc-catalog.ts`.

- **Variable:** `ALCHEMY_RPC_KEY` in `.env` (see `.env.example`).
- **Frontend:** Vite exposes `ALCHEMY_*` via `envPrefix` in `vite.config.ts`; resolution in `src/lib/wallet/rpc-providers.ts`.
- **Backend:** Rust reads the same `ALCHEMY_RPC_KEY` at runtime in `src-tauri/src/evm/wallet_rpc_providers.rs`.
- **Fallbacks:** When a key is set, curated public RPCs from `rpc-catalog.ts` / `wallet_chain_config.rs` are appended after the provider URL.

Additional providers (e.g. Pocket) can be added by extending `RPC_PROVIDERS` (TS) and the Rust provider module — one env var per provider, same host-map pattern.

Copy `.env.example` to `.env` for local overrides. Never commit API keys.

### User preferences (Settings → EVM)

When no operator key is set, **personal RPC URLs** and the **default RPC picker** in Settings apply (`src/lib/wallet/rpc-prefs.ts`). Resolution order in `getEffectiveRpcUrlsForChain`:

1. Operator provider key URL + curated fallbacks (if `ALCHEMY_RPC_KEY` is set)
2. User default / personal RPC prefs
3. Curated public defaults

### Frontend resolution entry point

`getEffectiveRpcUrlsForChain(chainId)` in `chains.ts` is the single merge point for viem read clients (DM wallet / Settings).

### Squad-level dual RPC (parent-scoped Tauri)

Squad Status can set **two MLS-shared slots** (`src/lib/squad/squad-rpc.ts`, announce `squad_rpc_updated`):

| Event | RPC-1 | RPC-2 |
|-------|-------|-------|
| Create squad | curated public (`default_public`) | unset |
| Set primary custom | member URL | `default_public` |
| Set backup | unchanged custom | member URL (no public sentinel left) |

**Call failover** for parent-scoped governance/deploy Tauri commands (`buildSquadInvokeRpcUrls` → `rpcUrls` on invoke):

1. Squad RPC-1 (expand `default_public` → operator Alchemy if set + curated)
2. Squad RPC-2 if set
3. This member’s Settings **default** RPC for the chain only — **local, never MLS** — appended only when set and not already in the list

Rust uses the override list in order when non-empty (`gov_read::rpc_urls_or_default` / `connect_gov_read_provider`); otherwise curated/operator defaults. Applies to parent-scoped reads and writes (treasury, mutiny, quartermaster, hats, ACL, sponsor/deploy, allowlist, Safe deploy with `parentId`).

Operator `ALCHEMY_RPC_KEY` does not override an explicit custom squad URL. Squad RPC URLs (including API keys) are visible to all members who receive the announce.

---

## 2. Where viem runs (integration surface)

### Current and retained role of viem (TypeScript)

- **Read-only chain access** in the desktop shell: balances, contract reads, Safe reads, `waitForTransactionReceipt` when the UI waits for inclusion—all via viem **public** (and where applicable **wallet**) clients built from `chains.ts` RPC resolution.
- **No long-lived private key in the frontend** for production send flows: address and signing continue to be mediated by the Tauri layer where the EVM key is decrypted only for approved operations.

### Signing and broadcasting user-initiated transfers (WalletBar / DM send)

- **Decision:** Implement **build → sign → broadcast** in the **Rust backend** using a native Ethereum library (e.g. **Alloy**), not a Node viem subprocess.
- **Rationale:**
  - The EVM private key already lives and is decrypted in Rust; keeping serialization and signing there minimizes exposure and matches the security model described in the wallet overview.
  - Avoids shipping or spawning a JavaScript runtime solely to call viem for send.
  - Calldata for native transfers and standard **ERC-20 `transfer`** must match what viem would produce; use the canonical asset table (`wallet-assets.json` / backend mirror) for contract addresses and decimals.

### Parity with Safe-related flows

- Flows that only require **signing a hash** (e.g. Safe proposal signatures) may continue to use the pattern: frontend builds the hash with viem, backend exposes a narrow **sign this hash** command. That does not change the rule above for **full transaction** send from the WalletBar.

### Summary

| Concern | Layer | Mechanism |
|--------|--------|-----------|
| RPC URL selection (UI reads) | Frontend | `ALCHEMY_RPC_KEY` + user prefs + `getEffectiveRpcUrlsForChain` |
| RPC URL selection (squad Tauri) | Frontend → Backend | Squad slots 1–2 (+ local Settings default) via `rpcUrls` override |
| RPC URL selection (backend default) | Backend | `ALCHEMY_RPC_KEY` via `wallet_rpc_providers.rs` + curated fallbacks when no override |
| Read-only JSON-RPC | Frontend | viem `createPublicClient` + `fallback` via **`src/lib/evm/read-plane.ts`** |
| Generic contract reads (observation) | Frontend | `readContract` / `multicall` in **`read-plane.ts`** — not duplicated in Rust for ad-hoc ABIs |
| WalletBar send / raw tx | Backend | Rust (Alloy): encode, sign, `eth_sendRawTransaction` |
| Advanced opaque contract call | Backend | **`evm_send_advanced_contract_call`** — advanced-purpose signer only (`advanced_contract_call.rs`) |
| Squad curated deploy / gov writes | Backend | Typed Alloy commands + squad-purpose gate (unchanged) |
| USD spot display | Backend + TS | `wallet_get_usd_spot_prices` + `src/lib/wallet/pricing.ts` |
| Wallet send “done” + DM card | Backend policy | Wait for **successful receipt** before return; see [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md) |
| Advanced panel (Settings → EVM) | Frontend | **`WalletAdvancedPanel.svelte`** + `calldata-builder.ts`; simulate via viem `eth_call`, send via Tauri |

---

## 3. USD spot pricing

Spot USD rates for ETH, USDC, and USDT (wallet UI only) come from **Chainlink on-chain feeds** for the wallet network in use (`mainnet` / `arbitrum` / `sepolia`; `local` → Sepolia). Details, proxy addresses, and RPC candidate order are in [USD_PRICING.md](./USD_PRICING.md). There are no static price fallbacks; the spot-price command returns an error for the UI, while `get_wallet_summary` soft-fails USD lines and still returns balances. The frontend calls `wallet_get_usd_spot_prices` with a `networkKey`.

---

## 4. Operational notes

- **Rate limits:** Public defaults are convenient for development; production builds should assume dedicated providers and monitored quotas.
- **Testnets vs mainnet:** Restrict which chains are offered in UI by product flags separately from RPC configuration if you need to disable mainnet in certain builds.

---

## See also

- [README.md](./README.md) — index of wallet docs.
