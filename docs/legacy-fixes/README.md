# Legacy fixes (pre–public v1)

This folder catalogs **code paths that exist only for dev / alpha users** who already have local data or relay-published state from older builds.

**Goal:** Before **beta** or **public v1** (greenfield users), review **[CATALOG.md](./CATALOG.md)** and **remove or gate** these paths so the codebase does not carry permanent repair or migration logic for populations that no longer exist.

## How to use before launch

1. Open **[CATALOG.md](./CATALOG.md)**.
2. For each row, open the linked note; confirm no production cohort still needs it.
3. Remove code, update **[docs/wallet/](../wallet/)** or related user docs, run full QA.
4. Remove or archive the note here.

## What belongs here

| Include | Do not include |
|--------|----------------|
| One-off **repairs** (recompute stored field from ciphertext) | The **correct** algorithm going forward |
| **Migrations** only for existing alpha DBs | Schema required for every new install |
| Temporary **feature flags** | Normal product behavior |

## Adding an entry

1. Add a row to **[CATALOG.md](./CATALOG.md)**.
2. Add **`LF-NNN-short-name.md`** using **[TEMPLATE.md](./TEMPLATE.md)**.

## Related

- **[`docs/wallet/`](../wallet/)** — user-facing wallet behavior tied to some repairs  
- **[`docs/storage-layout/`](../storage-layout/)** — SQLite and encryption
