# On-chain read pattern (DMs, Squads, Networks)

Short **convention** for anything that shows chain-derived data: avoid mount-only fetches that flash empty UI; reuse the same lifecycle across features.

## Principles

1. **Persist** a last-good snapshot where it fits the product (per account / per parent id), with a **version or fingerprint** when the query inputs can change (e.g. watched token list vs balance response).
2. **Hydrate early** on login — typically inside **`loadAccountState(npub)`** (or the same account-unlock path) so memory is warm before the user opens the surface.
3. **Background refresh** after the session is usable (throttled / deduped) so RPC runs **without** requiring the exact UI to be open.
4. **Surface open** — show hydrated or cached data **immediately**, **revalidate** in the background, and on failure **keep** the last-known snapshot with clear **stale** or error messaging; keep an explicit **Refresh** where it helps.
5. New features should hook these stages instead of adding one-off timers per screen.

## Wallet summary (DMs / WalletBar)

| Stage | Behavior | Primary code |
|-------|----------|----------------|
| Persist | Last successful `get_wallet_summary` per `npub`, tied to watched-token fingerprint | `src/lib/wallet/wallet-summary-cache.ts` (`pacto_wallet_summary_cache_v1_<npub>`) |
| Hydrate | Read snapshot into store on account load | `hydrateWalletSummaryCacheFromDisk` from `loadAccountState` in `src/stores/app.ts` |
| Background | Throttled prefetch after auth | `scheduleWalletSummaryBackgroundPrefetch` in `src/lib/wallet/wallet-summary-prefetch.ts`, invoked from `src/routes/+page.svelte` |
| Surface | Stale-while-revalidate when WalletBar is open; manual Refresh | `src/components/wallet/WalletBar.svelte` |
| Logout | Clear in-memory store and scoped storage | `src/lib/utils/clear-account-state.ts` |

Watched ERC-20 rows: `src/lib/wallet/watched-tokens.ts`. Chain and asset registry: [CHAIN_CONFIG.md](./CHAIN_CONFIG.md).

## Safe address (Squads / Networks dashboard)

| Stage | Behavior | Primary code |
|-------|----------|----------------|
| Memory | Parent id → Safe address map | `safeByParentId` writable in `src/stores/app.ts` |
| Dashboard open | Best-effort `getSafe(parentId)` when the dashboard channel is active | Reactive block on `dashboardParentId` in `src/routes/+page.svelte` |
| App-ready | Background prefetch for all known squad/network parent ids once lists exist | Same file (`initialSafePrefetchDone` + `getSafe` loop) |
| Updates | Announcements and confirm flow merge new addresses into the map | `message_update` / `mls_message_new` listeners and `onConfirmSetSafe` in `+page.svelte` |

There is **no** separate versioned localStorage blob for Safe today; the map is in-memory and refilled from backend when parents are known. If product later persists Safe per account, follow the same **hydrate on `loadAccountState`** rule.

## Squads / Networks context

Parent and channel models, MLS ids, and invite flows: **[`docs/communities/`](../communities/)**. This note only ties **when** to read on-chain data relative to account and hub lifecycle.

## Related

- DM wallet messages: [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md)  
- Pricing / RPC constraints: [USD_PRICING.md](./USD_PRICING.md), [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md)
