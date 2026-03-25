# LF-002 — WalletBar token dropdown → watched ERC-20 list (localStorage migration)

## Symptom (alpha / dev only)

- Older builds stored **which balance rows to show** using a **global** WalletBar **Tokens** `<select>`:
  - `pacto_wallet_bar_token_filter` — string modes: `all_tokens`, `native_only`, `native_usdc`, `native_usdt`.
  - `pacto_wallet_bar_token_visibility` — legacy JSON `{ USDC?: boolean; USDT?: boolean }` (superseded by the string filter).

## Root cause

The interim dropdown was replaced by **Import tokens** and a per-account **watched ERC-20** list under `pacto_wallet_watched_erc20_v1_<npub>`. Alpha users still had only the old keys, so a one-time migration maps old modes to catalog rows (or empty for native-only).

## What we shipped

- **Permanent (keep after beta):** `loadWatchedErc20Rows` / `saveWatchedErc20Rows`, `pacto_wallet_watched_erc20_v1_*`, default USDC+USDT when nothing is stored.
- **Legacy only (candidate to remove):** `legacyModeToRows`, reads of `pacto_wallet_bar_token_filter` and `pacto_wallet_bar_token_visibility`, and the branch in `loadWatchedErc20Rows` that writes migrated data when the new key is absent.

## Code locations

- `src/lib/wallet/watched-tokens.ts` — `LEGACY_TOKEN_FILTER`, `LEGACY_TOKEN_VISIBILITY`, `legacyModeToRows`, migration branch inside `loadWatchedErc20Rows`.

## User-facing / relay impact

**Local only.** No Nostr or server fields. After migration, the new key is populated; old keys are left in place until removal (optional cleanup: delete legacy keys once migration is confirmed unnecessary).

## Removal checklist (before beta or public v1)

- [ ] Confirm no supported install still relies on the old keys (telemetry or support: zero reads of legacy keys in practice, or age-out alpha cohorts).
- [ ] Remove `legacyModeToRows` and legacy `localStorage` key constants; simplify `loadWatchedErc20Rows` to: read new key → else `defaultWatchedErc20Rows()`.
- [ ] Optionally one-time **cleanup** in app upgrade: `removeItem` for the two legacy keys (only if safe for all remaining users).
- [ ] Update **`docs/legacy-fixes/CATALOG.md`** (remove or mark row).
- [ ] Update **`docs/wallet/README.md`** (and any other **tracked** `docs/` notes that mention this migration) if they reference this note.
- [ ] QA: fresh install (no legacy keys) + optional manual test with legacy keys injected.
