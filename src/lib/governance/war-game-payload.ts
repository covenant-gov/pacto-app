import type { SquadInfraDto } from './api';

export type WarGameStackStatus = 'active' | 'retired';

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Round-clone sponsor address from a `pacto_gov_wargame` provider payload. */
export function parseWarGameSponsorAddress(raw: string | null | undefined): string {
  if (!raw?.trim()) return '';
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const sponsor = typeof p.sponsor === 'string' ? p.sponsor.trim() : '';
    return EVM_ADDRESS.test(sponsor) ? sponsor : '';
  } catch {
    return '';
  }
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
