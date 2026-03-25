# Chain & asset config (single source)

## JSON

**`src/lib/wallet/wallet-assets.json`** defines, per network key (`mainnet`, `optimism`, `sepolia`):

- Display name, viem chain key (frontend), explorer tx URL prefix
- Native ETH symbol + decimals
- USDC / USDT contract addresses + decimals

The Svelte layer imports this via `src/lib/wallet/assets.ts` (`WALLET_ASSETS`).

## Rust

**`src-tauri/src/wallet_chain_config.rs`** embeds the **same** JSON at compile time with `include_str!(…/wallet-assets.json)`. It maps network keys to numeric **chain IDs** (not stored in JSON) and resolves **RPC URLs**:

- Env: `PACTO_WALLET_RPC_MAINNET`, `PACTO_WALLET_RPC_OPTIMISM`, `PACTO_WALLET_RPC_SEPOLIA` (comma-separated fallbacks)
- Defaults match `src/lib/wallet/chains.ts` `DEFAULT_RPC_URLS`

Wallet send/balance code should use **`wallet_chain_config`** helpers (`wallet_networks`, `network_by_key`, `rpc_urls_for`, etc.) and must not duplicate token addresses.

## Frontend RPC (read-only viem)

Browser-side reads still use `VITE_WALLET_RPC_*` and `getEffectiveRpcUrlsForChain` in `chains.ts` — see [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md).

## Changing a network

1. Edit **`wallet-assets.json`** (and `chains.ts` if chain id or viem mapping changes).
2. Run `cargo check` in `src-tauri` so the embedded JSON parse is exercised.

## Logging and RPC URL safety

RPC URLs in env may include API keys (query string, userinfo, or provider path segments). The backend **must not** echo full URLs in returned errors or logs. Use `src-tauri/src/wallet_security.rs` when formatting RPC-related errors. **Never** log decrypted EVM private key hex or signer secrets (see the comment at the decrypt site in `wallet_ops.rs`).
