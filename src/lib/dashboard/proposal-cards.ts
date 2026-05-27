import type { ParentGovernanceDto } from '$lib/governance/api';
import type { TreasurySafeEntry } from '$lib/treasury/treasury-safes';

/** Unified dashboard proposal feed; vote and eligibility wiring stay per-tool. */
export type DashboardProposalTool = 'pacto_gov' | 'safe' | 'nostr_poll';

export interface DashboardProposalCard {
  tool: DashboardProposalTool;
  ref: string;
  chain?: string;
  /** Present when `tool === 'safe'` — ties the row to treasury state / explorer actions. */
  treasuryEntryId?: string;
  title?: string;
}

export function dashboardProposalToolLabel(tool: DashboardProposalTool): string {
  switch (tool) {
    case 'pacto_gov':
      return 'Pacto Gov';
    case 'safe':
      return 'Safe';
    case 'nostr_poll':
      return 'Poll';
  }
}

/**
 * Scaffold list from hooks already on the parent dashboard (treasury Safes + governance row).
 * Nostr polls remain primary in `#polls` until this feed aggregates them.
 */
export function buildDashboardProposalCards(params: {
  treasurySafes: TreasurySafeEntry[];
  governanceConfig: ParentGovernanceDto | null | undefined;
}): DashboardProposalCard[] {
  const out: DashboardProposalCard[] = [];
  const gov = params.governanceConfig;
  if (gov?.provider === 'pacto_gov' && gov.canonicalRef?.trim()) {
    out.push({
      tool: 'pacto_gov',
      ref: gov.canonicalRef.trim(),
      chain: gov.chain?.trim() || undefined,
      title: 'Pacto Gov deployment',
    });
  }
  for (const e of params.treasurySafes ?? []) {
    const addr = e.safeAddress?.trim();
    if (!addr) continue;
    out.push({
      tool: 'safe',
      ref: addr,
      chain: e.chain?.trim() || undefined,
      treasuryEntryId: e.id,
      title: e.label?.trim() || 'Safe multisig',
    });
  }
  return out;
}
