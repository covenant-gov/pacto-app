# UI components

| Folder | Role |
|--------|------|
| `auth/` | Login, PIN, key import, welcome |
| `announcements/` | Squad/network announce cards (`AnnounceCard`, Safe bodies) |
| `channel/` | MLS channel view, channel row, channel modals |
| `dm/` | Direct messages: thread shell, `DmMessageRouter`, messenger sidebar, messages, invites |
| `layout/` | Navbar, top tabs, parent (squad) chrome + sidebar |
| `parent/` | Dashboard (`dashboard/*` tabs, modals) & “setting up” for a squad |
| `profile/` | User profile / settings surface |
| `ui/` | Shared primitives: `Modal`, `Toast`, `Tab`, `ResizableSidebar` |
| `wallet/` | WalletBar, `ChainIdSelect`, DM wallet modals, tx request/announcement cards |

Routes import from here with explicit subpaths, e.g. `../components/dm/DmThread.svelte`. Shell layout map: [`docs/shell/LAYOUT.md`](../../docs/shell/LAYOUT.md).
