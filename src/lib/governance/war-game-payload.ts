export type WarGameStackStatus = 'active' | 'retired';

export function parseWarGameStackMeta(raw: string | null | undefined): {
  status: WarGameStackStatus;
  round: string;
} {
  let status: WarGameStackStatus = 'active';
  let round = '';
  if (!raw?.trim()) return { status, round };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p.status === 'string' && p.status.trim().toLowerCase() === 'retired') {
      status = 'retired';
    }
    if (typeof p.round === 'string' && p.round.trim()) {
      round = p.round.trim();
    } else if (typeof p.round === 'number' && Number.isFinite(p.round)) {
      round = String(p.round);
    }
  } catch {
    // ignore malformed payload
  }
  return { status, round };
}
