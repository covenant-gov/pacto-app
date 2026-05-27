# Chain & asset config (single source)

## JSON

**`src/lib/wallet/wallet-assets.json`** defines, per network key (`arbitrum`, `gnosis`, `mainnet`, `optimism`, `sepolia`):

- Display name, viem chain key (frontend), explorer tx URL prefix
- Native ETH symbol + decimals
- USDC / USDT contract addresses + decimals

The Svelte layer imports this via `src/lib/wallet/assets.ts` (`WALLET_ASSETS`).

## Rust

**`src-tauri/src/evm/wallet_chain_config.rs`** embeds the **same** JSON at compile time with `include_str!(…/wallet-assets.json)`. It maps network keys to numeric **chain IDs** (not stored in JSON) and resolves **RPC URLs**:

- Env: `ALCHEMY_RPC_KEY` → `https://{host}.g.alchemy.com/v2/{key}` per network (see `wallet_rpc_providers.rs`)
- Without a key: curated public defaults aligned with `src/lib/wallet/rpc-catalog.ts`

Wallet send/balance code should use **`wallet_chain_config`** helpers (`wallet_networks`, `network_by_key`, `rpc_urls_for`, etc.) and must not duplicate token addresses.

## Frontend RPC (read-only viem)

Browser-side reads use `getEffectiveRpcUrlsForChain` in `chains.ts` — operator key, then Settings RPC prefs, then curated public URLs. See [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md).

**Arbitrum** is the product-default preferred network in Settings → EVM. For production-like use, set **`ALCHEMY_RPC_KEY`** in `.env` (one key covers all supported chains). Until then, the app uses public RPC fallbacks or personal RPC URLs from Settings.

## Changing a network

1. Edit **`wallet-assets.json`** (and `chains.ts` if chain id or viem mapping changes).
2. Add Alchemy host mapping in `rpc-providers.ts` and `wallet_rpc_providers.rs` if the chain is new.
3. Run `cargo check` in `src-tauri` so the embedded JSON parse is exercised.

## Logging and RPC URL safety

RPC URLs in env may include API keys (query string, userinfo, or provider path segments). The backend **must not** echo full URLs in returned errors or logs. Use `src-tauri/src/wallet_security.rs` when formatting RPC-related errors. **Never** log decrypted EVM private key hex or signer secrets (see the comment at the decrypt site in `wallet_ops.rs`).
