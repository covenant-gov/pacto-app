# Dashboard asset cards

Squad Sponsor, Treasury Safe, other vault Safes, and squad Settings cards share one chrome: [`DashboardAssetCard.svelte`](../../src/components/parent/dashboard/DashboardAssetCard.svelte).

## Layout

1. **Header** — title left, optional action right (`RefreshIconButton`, `EditIconButton`, or a deploy control).
2. **Hint** — optional muted line under the header (sponsored gas, bot holders).
3. **Rows** — `<dl class="asset-dl">`: muted labels, primary/`<strong>` values. Addresses and external links sit on a labeled row (`Safe`, `Sponsor`), not loose under the title. Use `asset-dd-inline` when a value has a chip, edit control, or a second link.
4. **Actions** — primary (brand fill) then secondary (bordered), below the rows.
5. **Footer** — divider + secondary detail (fee usage, provider links, add tracked token). Omit the footer when there is nothing to show (`showFooter={false}`).

Pass `id` when another surface scrolls to the card (`squad-settings-network`, `squad-settings-rpc`).

Do not invent a second card shell for treasury, sponsor, or Settings-tab surfaces. Keep fetch and write logic in the panel; the card is layout only.
