# USD pricing (Chainlink Data Feeds)

## Approach

Pacto reads **public Chainlink price feed contracts** using standard JSON-RPC `eth_call` on the **same network family** as the wallet balances being labeled. This matches Chainlink’s documented pattern ([Using Data Feeds](https://docs.chain.link/data-feeds/using-data-feeds)): call `latestRoundData()` on the aggregator proxy and interpret the `answer` with the feed’s `decimals()`.

There are **no static or guessed USD prices**. If every RPC candidate fails, the response is malformed, or decoding fails, the backend returns an error (spot-price command) or omits USD lines (wallet summary) — never a fabricated rate.

## Network → feed resolution

| Wallet network key | Feed network (RPC + proxies) |
|--------------------|------------------------------|
| `mainnet` | Ethereum mainnet |
| `arbitrum` | Arbitrum One |
| `sepolia` | Sepolia |
| `local` (Anvil) | **Sepolia** (same feeds + Sepolia RPC) |

`feedNetwork` on successful responses is `ethereum-mainnet` | `arbitrum` | `sepolia`.

## Feeds (standard proxies)

Verify on [Chainlink feed addresses](https://docs.chain.link/data-feeds/price-feeds/addresses) / [data.chain.link](https://data.chain.link) if migrating.

### Ethereum mainnet

| Pair | Proxy |
|------|-------|
| ETH / USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |
| USDC / USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` |
| USDT / USD | `0x3E7d1eAB13ad0104d2750B8863b489D65364e32D` |

### Arbitrum One

| Pair | Proxy |
|------|-------|
| ETH / USD | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` |
| USDC / USD | `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` |
| USDT / USD | `0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7` |

### Sepolia (also used for `local`)

| Pair | Proxy |
|------|-------|
| ETH / USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| USDC / USD | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` |
| USDT / USD | same as USDC / USD (no separate Sepolia USDT feed in the standard list) |

## RPC configuration (backend)

For each feed network, candidates are tried in order until feeds succeed:

1. `ALCHEMY_RPC_KEY` → Alchemy host for that network (`eth-mainnet`, `arb-mainnet`, `eth-sepolia`) when set.
2. Curated public RPCs for that chain (see `wallet_prices.rs` / frontend `rpc-catalog.ts`).

A Sepolia-only Alchemy app no longer needs Ethereum Mainnet enabled just for USD labels.

## Wallet summary

`get_wallet_summary` loads prices **per enabled network** (deduped by feed key). Oracle failure on a network leaves balances intact with `usdValue: null` for priced assets and does **not** fail the whole summary. Top-level `prices` is the first successfully priced enabled network (optional); per-asset `usdValue` on each network row is authoritative for that chain.

## Caching

Successful reads are cached **per feed network** in the Rust process for **90 seconds**. Failed reads are **not** cached.

## API

- **Tauri:** `wallet_get_usd_spot_prices(networkKey)` → `{ ethUsd, usdcUsd, usdtUsd, source, feedNetwork, fetchedAtMsEpoch }` on success, or an error string.
- **TypeScript:** `getWalletUsdSpotPrices(networkKey)` in `src/lib/wallet/pricing.ts` returns `{ ok: true, prices }` or `{ ok: false, message }`.

## Operations and compliance

- Follow Chainlink’s [Selecting Quality Data Feeds](https://docs.chain.link/data-feeds/selecting-data-feeds) and monitor feed status for production.
- Fiat figures are **UX estimates** from oracles, not settlement or tax advice.
- L2 sequencer-uptime gating is out of scope for display-only wallet labels.
- Re-validate proxy addresses if Chainlink migrates a feed; update `wallet_prices.rs` when needed.

---

## See also

- [README.md](./README.md) — index of wallet docs.
- [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md) — RPC resolution.
