# UI components

| Folder | Role |
|--------|------|
| `auth/` | Login, PIN, key import, welcome |
| `announcements/` | Squad/network announce cards (`AnnounceCard`, Safe bodies) |
| `channel/` | MLS channel view, channel row, channel modals |
| `dm/` | Direct messages: thread, messenger sidebar, messages, invites |
| `layout/` | Navbar, top tabs, parent (squad/network) chrome + sidebar |
| `parent/` | Dashboard & “setting up” for a squad/network |
| `profile/` | User profile / settings surface |
| `ui/` | Shared primitives: `Modal`, `Toast`, `Tab`, `ResizableSidebar` |
| `wallet/` | WalletBar, DM wallet modals, tx request/announcement cards |

Routes import from here with explicit subpaths, e.g. `../components/dm/DmThread.svelte`.
