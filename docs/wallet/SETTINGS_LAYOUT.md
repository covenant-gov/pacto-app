# Settings page layout

Open **Settings** from the sidebar (`activeView === 'profile'`). One scrollable page replaces the old Profile / Wallet / Settings tabs.

## Sections (top to bottom)

| Anchor | Section | Contents |
|--------|---------|----------|
| `#settings-profile` | Profile | Kind 0 edit, npub copy, logout |
| `#settings-nostr` | Nostr | Relay list, add/remove custom relays |
| `#settings-evm` | EVM | Default wallet config, EVM accounts, enabled chains, tokens, RPC, external wallet disclaimer, Advanced panel |
| `#settings-app` | App | Theme selector |

A sticky sidebar lists the same four anchors and highlights the section in view while scrolling.

## EVM highlights

- **Default wallet config** — preferred network, signer, and receiver; **Edit** on the summary card.
- **EVM accounts** — derived squad keys and advanced imports; per-row export (PIN + reveal); squad linkage links to squad dashboard.
- **Enabled chains** — grouped L1 / L2 / testnet; at least one chain must stay on.
- **RPC endpoints** — personal RPC URLs, default endpoint picker, provider signup links.

Send / Receive / Buy crypto are **not** on Settings; use the **DM wallet bar** for transfers.

Implementation shell: `src/components/settings/SettingsPage.svelte`, composed from `Profile.svelte`.
