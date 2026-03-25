# RPC configuration and viem usage

This document describes **RPC endpoints** (frontend and future backend) and **where viem runs** relative to signing. It is design reference for implementers.

---

## 1. RPC URLs (environment and defaults)

### Frontend (Svelte + Vite)

- **Variables:** `VITE_WALLET_RPC_MAINNET`, `VITE_WALLET_RPC_OPTIMISM`, `VITE_WALLET_RPC_SEPOLIA`.
- **Format:** One or more URLs separated by commas. The first entry is the primary endpoint; additional entries are used as fallbacks (same semantics as viem `fallback` transport in `createWalletPublicClient`).
- **Unset:** Built-in public RPC lists in `src/lib/wallet/chains.ts` apply.
- **Resolution:** `getEffectiveRpcUrlsForChain(chainId)` in `chains.ts` is the single place that merges env and defaults.

Copy `.env.example` to `.env` for local overrides. Never commit secrets; API keys in URLs belong in `.env` (gitignored).

### Backend (Rust, future send and balance commands)

When the Tauri backend performs JSON-RPC (transaction broadcast, balance reads, nonce), it should use the **same logical endpoints** as the UI:

- **Preferred:** Read RPC URLs from process environment at runtime, using names aligned with the frontend intent, e.g. `PACTO_WALLET_RPC_MAINNET`, `PACTO_WALLET_RPC_OPTIMISM`, `PACTO_WALLET_RPC_SEPOLIA`, with the same comma-separated multi-URL rule. A launcher or installer can set these alongside user-specific keys without embedding them in the bundle.
- **Alternative:** A small config file under the app data directory, managed by settings UI later, still mapping to the same per-chain URL lists.

Private keys remain in existing encrypted storage (PIN-derived); RPC URLs are not secrets in the same class as keys, but URLs that embed provider API keys should still be treated as sensitive and not logged.

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
| RPC URL selection (UI reads) | Frontend | `VITE_WALLET_*` + `getEffectiveRpcUrlsForChain` |
| RPC URL selection (backend sends) | Backend | Env (or config file) mirroring the same per-chain lists |
| Read-only JSON-RPC | Frontend | viem `createPublicClient` + `fallback` |
| WalletBar send / raw tx | Backend | Rust (Alloy): encode, sign, `eth_sendRawTransaction` |
| USD spot display | Backend + TS | `wallet_get_usd_spot_prices` + `src/lib/wallet/pricing.ts` |
| Wallet send “done” + DM card | Backend policy | Wait for **successful receipt** before return; see [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md) |

---

## 3. USD spot pricing

Spot USD rates for ETH, USDC, and USDT (wallet UI only) come from **Chainlink on-chain feeds** on Ethereum mainnet (`eth_call` via JSON-RPC). Details, proxy addresses, and env vars (`PACTO_CHAINLINK_PRICE_RPC_URL`, `PACTO_WALLET_RPC_MAINNET`) are in [USD_PRICING.md](./USD_PRICING.md). There are no static price fallbacks; failures return an error for the UI. The frontend calls `wallet_get_usd_spot_prices`.

---

## 4. Operational notes

- **Rate limits:** Public defaults are convenient for development; production builds should assume dedicated providers and monitored quotas.
- **Testnets vs mainnet:** Restrict which chains are offered in UI by product flags separately from RPC configuration if you need to disable mainnet in certain builds.

---

## See also

- [README.md](./README.md) — index of wallet docs.
