# Settings page layout

Open **Settings** from the sidebar (`activeView === 'profile'`). One scrollable page replaces the old Profile / Wallet / Settings tabs.

## Sections (top to bottom)

| Anchor | Section | Contents |
|--------|---------|----------|
| `#settings-profile` | Profile | Kind 0 edit, npub copy, logout |
| `#settings-nostr` | Nostr | Relay list, add/remove custom relays |
| `#settings-evm` | EVM | Default EVM account, squad EVM accounts, enabled chains, tokens, RPC, external wallet disclaimer, Advanced panel |
| `#settings-evm-dash-gas` | EVM — gas | **Temporary / Username NFT holders only** — personal `global_sponsored_fee_usage` list + Sepolia global pool spendable read for live testing; will move into the full wallet |
| `#settings-app` | App | Theme selector |

A sticky sidebar lists the same anchors. **EVM — gas** appears when this account's Username NFT record shows a holder. If that chain read fails, the last cached claim still lists the section. The sidebar highlights the section in view while scrolling.

## EVM highlights

- **Default EVM account** — preferred network, signer, and receiver; **Edit** on the summary card.
- **Squad EVM accounts** — one row per derived squad key; **Squads** block lists squad ids assigned to that key; links open the squad dashboard.
- **Enabled chains** — grouped L1 / L2 / testnet; at least one chain must stay on.
- **RPC endpoints** — personal RPC URLs, default endpoint picker, provider signup links.

Send / Receive / Buy crypto are **not** on Settings; use the **DM wallet bar** for transfers.

Implementation shell: `src/components/settings/SettingsPage.svelte`, composed from `Profile.svelte`.
