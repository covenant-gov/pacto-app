/** Discord-style squad rail order: stable ids, new at bottom, manual drag. */

export type SquadNavSortable = { id: string; createdAt: number };

function byCreatedThenId(a: SquadNavSortable, b: SquadNavSortable): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

export function seedSquadNavOrder(squads: SquadNavSortable[]): string[] {
  return [...squads].sort(byCreatedThenId).map((s) => s.id);
}

export function orderSquads<T extends SquadNavSortable>(squads: T[], orderIds: string[]): T[] {
  const byId = new Map(squads.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of orderIds) {
    const s = byId.get(id);
    if (!s || seen.has(id)) continue;
    out.push(s);
    seen.add(id);
  }
  const rest = squads.filter((s) => !seen.has(s.id)).sort(byCreatedThenId);
  return [...out, ...rest];
}

export function appendSquadNavId(order: string[], id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed || order.includes(trimmed)) return order;
  return [...order, trimmed];
}

export function removeSquadNavId(order: string[], id: string): string[] {
  if (!order.includes(id)) return order;
  return order.filter((x) => x !== id);
}

/** Swap a temp create id for the finalized MLS group id. */
export function replaceSquadNavId(order: string[], fromId: string, toId: string): string[] {
  if (!fromId || !toId || fromId === toId) return order;
  const idx = order.indexOf(fromId);
  if (idx === -1) return appendSquadNavId(order, toId);
  if (order.includes(toId)) return removeSquadNavId(order, fromId);
  const next = [...order];
  next[idx] = toId;
  return next;
}

/** Insert `fromId` before `beforeId`, or at end when `beforeId` is null. */
export function moveSquadNavId(order: string[], fromId: string, beforeId: string | null): string[] {
  if (!order.includes(fromId)) return order;
  if (beforeId === fromId) return order;
  const without = order.filter((id) => id !== fromId);
  if (beforeId === null) return [...without, fromId];
  const idx = without.indexOf(beforeId);
  if (idx === -1) return [...without, fromId];
  const next = [...without];
  next.splice(idx, 0, fromId);
  return next;
}

/**
 * Move `fromId` so it lands at visual gap index `toIndex` in the current rail
 * (`0` = before first, `order.length` = after last). Adjusts for removal.
 */
export function moveSquadNavIdToGapIndex(order: string[], fromId: string, toIndex: number): string[] {
  const from = order.indexOf(fromId);
  if (from < 0) return order;
  let gap = Math.max(0, Math.min(toIndex, order.length));
  if (from < gap) gap -= 1;
  if (gap === from) return order;
  const without = order.filter((id) => id !== fromId);
  const next = [...without];
  next.splice(Math.max(0, Math.min(gap, next.length)), 0, fromId);
  return next;
}

/** Empty → seed by age; else prune missing and append newcomers at end. */
export function reconcileSquadNavOrder(order: string[], squads: SquadNavSortable[]): string[] {
  if (order.length === 0) return seedSquadNavOrder(squads);
  const ids = new Set(squads.map((s) => s.id));
  const pruned = order.filter((id) => ids.has(id));
  const present = new Set(pruned);
  const newcomers = squads
    .filter((s) => !present.has(s.id))
    .sort(byCreatedThenId)
    .map((s) => s.id);
  return [...pruned, ...newcomers];
}

export function parseSquadNavOrder(raw: string | null): string[] {
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}
