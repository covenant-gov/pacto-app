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

Viewing another squad account in the picker does **not** change the app-wide signer. `WalletHomeSendModal` loads balances for the viewed address and calls `setActiveEvmAccount` on confirm. Closing the modal without confirm leaves the signer unchanged. Profile balance fetches pass `getWalletSummary(..., address)` and stay in memory; they do not write the WalletBar summary cache.

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

## Building blocks (Settings / Profile)

Normative cookbook for account chrome. Interaction taste also lives in [docs/design-system/UI.md](../design-system/UI.md). CI ratchet: `pnpm check:settings-profile-ui` (scoped to `src/components/settings/**` and `src/components/profile/**`).

### Where UI belongs

| Put it on… | When |
|------------|------|
| **Profile** | Identity, username NFT, personal/squad wallet viewing, squad EVM account management, sponsored-gas disclosure |
| **Settings** | Relays, preferred/enabled chains, tracked tokens, personal RPC, app prefs, notifications, backup exports, logout |
| **Neither** | DM WalletBar send/request (peer chat), squad governance / dashboard — follow-up work outside this doc |

Some Profile blocks still live under `src/components/settings/` (`ProfileSection`, `EvmAccountsSection`, `DefaultWalletConfig`, `EvmDashGasSection`). Prefer importing those shared pieces over inventing a parallel tree; do not re-home them without an explicit migration.

### Required primitives

| Need | Use |
|------|-----|
| Settings section shell | `SettingsPage` + `SettingsCollapsibleSection` |
| Add / edit form modal | `SettingsFormModal` + fields from `src/styles/form-controls.css` (`.ui-field`, `.ui-select`, `.ui-input`, `.ui-textarea`) |
| Section `h3` | `SettingsSubheading` |
| Labeled row + trailing actions | `SettingsActionRow` |
| Overflow / secondary row actions | `MoreActionsMenu` (⋮), even for a single item |
| Tips / disclaimers / trademark | `InfoTip` — never an always-visible hint paragraph under a toggle or heading |
| Refresh / Edit | `RefreshIconButton` / `EditIconButton` (icon-only) |
| Public key (npub or `0x`) | `CopyableKeyPill` — label or account name above; shortened key and copy control inside one pill. Copy writes the full value. Hover `title` is the full key. |
| Copy icon (inside that pill) | `CopyIconButton` — do not place a second copy control beside a raw key |
| Crypto amounts | `formatAssetAmount` (`src/lib/evm/format-token-amount.ts`) — 6 display decimals |
| Short key text | `shortPublicKey` (`src/lib/governance/hats-tree-annotations.ts`); `shortEvmAddress` is the same cut for `0x` |

### Modal rule

- Settings **add/edit** forms → `SettingsFormModal`.
- **Destructive confirm** (e.g. logout) and **sensitive-export PIN** flows may use `Modal` or dedicated export modals (`EvmAccountKeyExportModal`, `ExportAllSecretsModal`).

### Pickers vs overflow

Account / network **pickers** (e.g. Profile wallet account switcher) are dedicated controls. Do **not** reuse `MoreActionsMenu` for selection pickers; that component is for secondary actions (export, edit name, backup).

### Adding a Settings section

1. Add a stable `settings-*` id to `SETTINGS_SECTION_IDS` in `src/lib/settings/settings-section-collapse.ts`.
2. Mount a `SettingsCollapsibleSection` from `AccountSettingsView`.
3. Add a sidebar entry in `SettingsPage`.
4. Use the primitives above; run `pnpm check:settings-profile-ui` before finish.
