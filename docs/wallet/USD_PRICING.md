# USD pricing (Chainlink Data Feeds)

## Approach

Pacto reads **public Chainlink price feed contracts** on **Ethereum mainnet** using standard JSON-RPC `eth_call`. This matches Chainlink’s documented pattern ([Using Data Feeds](https://docs.chain.link/data-feeds/using-data-feeds)): call `latestRoundData()` on the aggregator proxy and interpret the `answer` with the feed’s `decimals()`.

There are **no static or guessed USD prices**. If RPC fails, the response is malformed, or decoding fails, the backend returns an error and the UI should tell the user that **live oracle data is unavailable** — not show a fabricated rate.

## Feeds (Ethereum mainnet, standard proxies)

| Pair     | Proxy (verify on [data.chain.link](https://data.chain.link)) |
|----------|----------------------------------------------------------------|
| ETH / USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |
| USDC / USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` |
| USDT / USD | `0x3E7d1eAB13ad0104d2750B8863b489D65364e32D` |

Addresses are **Ethereum mainnet** aggregator contracts. Display prices are **USD reference** values for ETH, USDC, and USDT regardless of which chain the user selects for sending (Arbitrum, Sepolia, Local Anvil, etc.); on-chain sends still use the correct chain’s RPC and assets from `wallet-assets.json`.

## RPC configuration (backend)

The Tauri command issues `eth_call` to an **Ethereum mainnet** endpoint. Resolution order:

1. `ALCHEMY_RPC_KEY` → `https://eth-mainnet.g.alchemy.com/v2/{key}` when set (same var as wallet RPC).
2. Built-in default: `https://ethereum.publicnode.com` (read-only; suitable for development only).

## Caching

Successful reads are cached in the Rust process for **90 seconds** to limit RPC load. Failed reads are **not** cached.

## API

- **Tauri:** `wallet_get_usd_spot_prices` → `{ ethUsd, usdcUsd, usdtUsd, source, feedNetwork, fetchedAtMsEpoch }` on success, or an error string.
- **TypeScript:** `getWalletUsdSpotPrices()` in `src/lib/wallet/pricing.ts` returns `{ ok: true, prices }` or `{ ok: false, message }`.

## Operations and compliance

- Follow Chainlink’s [Selecting Quality Data Feeds](https://docs.chain.link/data-feeds/selecting-data-feeds) and monitor feed status for production.
- Fiat figures are **UX estimates** from oracles, not settlement or tax advice.
- Re-validate proxy addresses if Chainlink migrates a feed; update `wallet_prices.rs` when needed.

---

## See also

- [README.md](./README.md) — index of wallet docs.
