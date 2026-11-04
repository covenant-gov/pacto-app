import { listSquadEvents, type SquadEventDto } from '../api/squad-events';

/** One in-flight replica read per parent and nonce, shared by every event card in the feed. */
const loads = new Map<string, { nonce: number; rows: Promise<SquadEventDto[] | null> }>();

/** Replica rows for card overlays; null when the read fails (cards fall back to the stored payload). */
export function squadEventRowsForCards(parentId: string, nonce: number): Promise<SquadEventDto[] | null> {
  const cached = loads.get(parentId);
  if (cached && cached.nonce === nonce) return cached.rows;
  const rows = listSquadEvents(parentId).catch(() => {
    if (loads.get(parentId)?.rows === rows) loads.delete(parentId);
    return null;
  });
  loads.set(parentId, { nonce, rows });
  return rows;
}

/** Drops cached rows (they include member-only `location`); called on logout and account switch. */
export function clearSquadEventCardRowsCache(): void {
  loads.clear();
}
