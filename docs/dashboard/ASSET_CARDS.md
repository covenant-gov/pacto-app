# Dashboard asset cards

Squad Sponsor, Treasury Safe, and other vault Safes share one chrome: [`DashboardAssetCard.svelte`](../../src/components/parent/dashboard/DashboardAssetCard.svelte).

## Layout

1. **Header** — title left, optional action right (`RefreshIconButton` or a deploy control).
2. **Rows** — `<dl class="asset-dl">`: muted labels, primary/`<strong>` values. Addresses and external links sit on a labeled row (`Safe`, `Sponsor`), not loose under the title. Use `asset-dd-inline` when a value has a chip or a second link.
3. **Actions** — primary (brand fill) then secondary (bordered), below the rows.
4. **Footer** — divider + secondary detail (sponsored fee usage, add tracked token). Omit the footer when there is nothing to show (`showFooter={false}`).

Do not invent a second card shell for new treasury or sponsor surfaces. Keep fetch and write logic in the panel; the card is layout only.
