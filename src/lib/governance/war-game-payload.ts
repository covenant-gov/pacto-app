import type { SquadInfraDto } from './api';
import { WAR_GAME_SQUAD_PARAMS } from './squad-params';

export type WarGameStackStatus = 'active' | 'retired';

export type WarGamePriorRound = {
  round: string;
  gameSquadId?: string;
  sponsor?: string;
};

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function asRecord(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const p = JSON.parse(raw) as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function roundFromUnknown(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Round-clone sponsor address from a `pacto_gov_wargame` provider payload. */
export function parseWarGameSponsorAddress(raw: string | null | undefined): string {
  const p = asRecord(raw);
  if (!p) return '';
  const sponsor = typeof p.sponsor === 'string' ? p.sponsor.trim() : '';
  return EVM_ADDRESS.test(sponsor) ? sponsor : '';
}

/** In-memory Treasury row for the round clone. Never persist as live `sponsor`. */
export function warGameRoundSponsorRow(
  row: SquadInfraDto | null | undefined,
): SquadInfraDto | null {
  if (!row || row.infraType !== 'pacto_gov_wargame') return null;
  const sponsor = parseWarGameSponsorAddress(row.providerPayload);
  if (!sponsor) return null;
  return {
    ...row,
    canonicalRef: sponsor,
    chain: row.chain?.trim() || 'sepolia',
  };
}

export function parseWarGameStackMeta(raw: string | null | undefined): {
  status: WarGameStackStatus;
  round: string;
} {
  let status: WarGameStackStatus = 'active';
  let round = '';
  const p = asRecord(raw);
  if (!p) return { status, round };
  if (typeof p.status === 'string' && p.status.trim().toLowerCase() === 'retired') {
    status = 'retired';
  }
  round = roundFromUnknown(p.round);
  return { status, round };
}

export function parseWarGameRoundNumber(raw: string | null | undefined): number {
  const n = Number.parseInt(parseWarGameStackMeta(raw).round, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parseWarGamePriorRounds(raw: string | null | undefined): WarGamePriorRound[] {
  const p = asRecord(raw);
  const arr = Array.isArray(p?.priorRounds) ? p.priorRounds : [];
  const out: WarGamePriorRound[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const round = roundFromUnknown(rec.round);
    if (!round) continue;
    const gameSquadId = typeof rec.gameSquadId === 'string' ? rec.gameSquadId.trim() : '';
    const sponsor = typeof rec.sponsor === 'string' ? rec.sponsor.trim() : '';
    out.push({
      round,
      ...(gameSquadId ? { gameSquadId } : {}),
      ...(sponsor ? { sponsor } : {}),
    });
  }
  return out;
}

/** `1..=activeRound` so pager arrows work before history exists. */
export function warGameVisibleRounds(raw: string | null | undefined): number[] {
  const max = Math.max(1, parseWarGameRoundNumber(raw));
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function isWarGameArchiveView(viewedRound: number, activeRound: number): boolean {
  return viewedRound > 0 && activeRound > 0 && viewedRound !== activeRound;
}

export function parseWarGameDelaySecs(raw: string | null | undefined): number {
  const p = asRecord(raw);
  const n = p?.crewChangeDelaySecs;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  return WAR_GAME_SQUAD_PARAMS.crewChangeDelaySecs;
}

export function warGameDelayMinutes(raw: string | null | undefined): number {
  return Math.max(1, Math.round(parseWarGameDelaySecs(raw) / 60));
}
