# Squad catalog (SQLite)

Per-account squad and squad-pair rows live in **`squads`** (`vector.db`), not `localStorage`. Identity rules match [`DESIGN.md`](./DESIGN.md): **`id`** = announcements MLS `groupId`.

## Table

| Column | Notes |
|--------|--------|
| `id` | Primary key; announcements MLS group id |
| `name` | Display name |
| `kind` | `squad` or `squad-pair` |
| `visibility` | Wire: `private` (Commons off) or `public` (Commons on). MLS squad is always private; this flag only enables discovery broadcasts. |
| `commons_tags` | Optional last-used tag defaults (exactly 3 when set). Tags for an active broadcast are on the Nostr event. |
| `paired_squads` | JSON `[{id,name},{id,name}]` when squad-pair |
| `channels` | JSON `[{name, groupId, order}]` |
| `icon_url` | Optional |
| `created_at_ms` / `updated_at_ms` | Unix ms |

## Tauri commands

| Command | Role |
|---------|------|
| `list_squads` | Hydrate frontend `squads` store on login |
| `upsert_squad` | Create or update one row |
| `get_squad` | Lookup by `parentId` |
| `delete_squad` | Exit squad: remove row + roster bindings for `parent_id` |

Implementation: `src-tauri/src/squad_catalog.rs`.

## Exit squad (`delete_squad`)

Deletes:

- `squads` row
- `squad_member_evm_account` and `squad_member_evm` for that `parent_id`

Does **not** delete:

- `evm_accounts` (keys may hold funds or bind elsewhere)
- `squad_infra` / `parent_treasury_safe` (on-chain history; see future MLS vs on-chain exit work)

MLS leave is separate (frontend `exit-parent-flow`).

## Navigation prefs (still local)

Last-opened squad/channel keys remain npub-scoped `localStorage` — see [`DESIGN.md`](./DESIGN.md) §5.
