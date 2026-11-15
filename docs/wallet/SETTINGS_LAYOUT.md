# Profile vs Settings

The left rail has two account destinations. **Profile** (`activeView === 'profile'`) is identity plus a light personal wallet. **Settings** (`activeView === 'settings'`) is infra: relays, chains, tokens, RPC, backup, and danger.

The DM **WalletBar** stays peer-context send. It is not this page.

## Profile (no section sidebar)

`AccountProfileView` is one scroll column. Implementation: `src/components/profile/AccountProfileView.svelte`.

| Block | Contents |
|--------|----------|
| Identity | Kind 0 edit, npub copy, username claim / verified (`ProfileUsernameBlock`, `#settings-profile-username`). No bound-EVM rotate form here; compact claim/cancel only when an address rotation is already pending |
| Pacto NFT strip | Known Pacto contracts only (catalog from `pacto-protocol-addresses.json`). v1: Username NFT when claimed with a non-zero token id (bound EVM + rotate ownership modal); otherwise an empty slot |
| Wallet hero | Selected squad `0x` as plain text (chevron menu to switch when multiple accounts; viewing-only), network filter over enabled chains (same options as DM WalletBar: all + each enabled), balances for the viewed `0x`, Send (any `0x`), Receive (share address; no QR). Token send only — not Username NFT address rotation |
| Squad EVM | Default signer/receiver (`DefaultWalletConfig`) and squad account rows (add/edit/label/export key) |
| Sponsored gas | Disclosure (`EvmDashGasSection`) — personal `global_sponsored_fee_usage` plus Sepolia global pool spendable |

Viewing another squad account in the picker does **not** change the app-wide signer. Send calls `setActiveEvmAccount` first, then `WalletHomeSendModal`. Profile balance fetches pass `getWalletSummary(..., address)` and stay in memory; they do not write the WalletBar summary cache.

Enabled chains, watched tokens, and RPC are **read-only** on Profile. Edit them in Settings.

## Settings (sidebar)

`AccountSettingsView` uses `SettingsPage` plus a sticky section list.

| Anchor | Section | Contents |
|--------|---------|----------|
| `#settings-nostr` | Nostr | nPub (copy + ⋮ export key), relay list, add/remove custom relays |
| `#settings-evm` | EVM | Preferred network, enabled chains, tokens, RPC |
| `#settings-app` | App | Theme selector |
| `#settings-notifications` | Notifications | App notification prefs |
| `#settings-commons` | Commons | Hidden Commons tags |
| `#settings-backup` | Backup | Export seed and export all secrets (not on Profile) |
| `#settings-dangerzone` | Dangerzone | Logout |

Sections default to expanded. Unknown persisted collapse keys are ignored.

## EVM highlights (Settings)

- **Preferred network** — default filter network; lives with enabled chains in `EvmWalletExtras`.
- **Enabled chains** — grouped L1 / L2 / testnet; at least one chain must stay on.
- **RPC endpoints** — personal RPC URLs, default endpoint picker, provider signup links.

Squad keys are managed on Profile.

## Wallet summary address

`get_wallet_summary` optional `address` must be a **squad-purpose** key on this account (fail closed). Omit it for DM WalletBar and prefetch (active signer).
