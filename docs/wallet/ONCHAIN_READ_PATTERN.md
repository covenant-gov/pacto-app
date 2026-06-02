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
| Hydrate | Read snapshot into store on account load | `hydrateWalletSummaryCacheFromDisk` from `loadAccountState` in `src/stores/persistence.ts` |
| Background | Throttled prefetch after auth | `scheduleWalletSummaryBackgroundPrefetch` in `src/lib/wallet/wallet-summary-prefetch.ts`, invoked from `src/routes/+page.svelte` |
| Surface | Stale-while-revalidate when WalletBar is open; manual Refresh | `src/components/wallet/WalletBar.svelte` |
| Logout | Clear in-memory store and scoped storage | `src/lib/utils/clear-account-state.ts` |

Watched ERC-20 rows: `src/lib/wallet/watched-tokens.ts`. Chain and asset registry: [CHAIN_CONFIG.md](./CHAIN_CONFIG.md).

## Safe address (Squads dashboard)

| Stage | Behavior | Primary code |
|-------|----------|----------------|
| Persist | Treasury Safe list, squad infra rows, member EVM map, governance snapshots, Safe on-chain state (short TTL) per `npub` | `src/lib/dashboard/treasury-safes-cache.ts`, `squad-infra-cache.ts`, `squad-member-evm-cache.ts`, `governance-snapshot-cache.ts`, `safe-state-disk-cache.ts` |
| Hydrate | Read snapshots into stores on account load | `loadAccountState` in `src/stores/persistence.ts` |
| Memory | Parent id → linked treasury Safe entries / infra rows / member EVM | `treasurySafesByParentId`, `squadInfraByParentId`, `squadMemberEvmByParentId` in `src/stores/squads.ts` |
| Background | Refresh on hub / `#dashboard` intent and after login squad warmup | `scheduleHubParentPrefetch` / `scheduleDashboardPrefetch` in `src/lib/app/`; `syncTreasurySafesForParent` in `src/lib/dashboard/dashboard-data-sync.ts` |
| Surface | Show hydrated rows immediately; “Refreshing…” while revalidate; keep snapshot on fetch error | Dashboard tabs under `src/components/parent/dashboard/` |
| On-chain Safe state | Balance, owners, nonce per linked entry (30s in-memory SWR + 15 min disk TTL) | `refreshSafeStateForTreasuryEntry` / `refreshAllSafeStates` in `src/stores/safe.ts`; concurrency via `src/lib/evm/read-plane-limiter.ts` (default 3) |
| Updates | Realtime events and deploy/import flows refresh stores + disk | `subscribeAppEvents` in `src/lib/app/tauri-subscriptions.ts`; Safe import/deploy via `ParentDashboard` → `onConfirmImportSafe` in `+page.svelte` |
| Logout | Clear in-memory stores and npub-scoped cache keys | `src/lib/utils/clear-account-state.ts` |

Shell layout map: [`docs/shell/LAYOUT.md`](../shell/LAYOUT.md).

## Squads context

Parent and channel models, MLS ids, and invite flows: **[`docs/communities/`](../communities/)**. This note only ties **when** to read on-chain data relative to account and hub lifecycle.

## Related

- DM wallet messages: [DM_WALLET_MESSAGE_SCHEMA.md](./DM_WALLET_MESSAGE_SCHEMA.md)  
- Shell layout (dashboard tabs, store slices): [../shell/LAYOUT.md](../shell/LAYOUT.md)  
- Pricing / RPC constraints: [USD_PRICING.md](./USD_PRICING.md), [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md)
