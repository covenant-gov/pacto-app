export type ChecklistItemState = 'not_started' | 'pending' | 'done';

export function checklistGlyph(state: ChecklistItemState): string {
  if (state === 'done') return '✓';
  if (state === 'pending') return '⏳';
  return '○';
}

/** Whether every MLS member has a shared roster EVM address for this parent. */
export function allMembersShareEvmAddress(
  channelMembers: string[],
  squadMemberEvmByNpub: Record<string, string>,
): boolean {
  return allMembersShareEvmState(channelMembers, squadMemberEvmByNpub) === 'done';
}

export function allMembersShareEvmState(
  channelMembers: string[],
  squadMemberEvmByNpub: Record<string, string>,
): ChecklistItemState {
  if (channelMembers.length === 0) return 'not_started';
  let shared = 0;
  for (const npub of channelMembers) {
    if (squadMemberEvmByNpub[npub]?.trim()) shared += 1;
  }
  if (shared === 0) return 'not_started';
  if (shared < channelMembers.length) return 'pending';
  return 'done';
}

/** Binary infra row: done or not started. */
export function binaryInfraState(deployed: boolean): ChecklistItemState {
  return deployed ? 'done' : 'not_started';
}

/**
 * Crew/captain hat coverage for members who shared an EVM.
 * Captain hat counts as covered (exempt from needing a crew hat).
 */
export function mintCrewHatsState(params: {
  hasGovernance: boolean;
  channelMembers: string[];
  squadMemberEvmByNpub: Record<string, string>;
  captainWearers: string[];
  crewWearers: string[];
}): ChecklistItemState {
  if (!params.hasGovernance) return 'not_started';

  const covered = new Set(
    [...params.captainWearers, ...params.crewWearers]
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  );

  const sharedAddrs: string[] = [];
  for (const npub of params.channelMembers) {
    const addr = params.squadMemberEvmByNpub[npub]?.trim().toLowerCase();
    if (addr) sharedAddrs.push(addr);
  }
  if (sharedAddrs.length === 0) return 'not_started';

  let withHat = 0;
  for (const addr of sharedAddrs) {
    if (covered.has(addr)) withHat += 1;
  }
  if (withHat === 0) return 'not_started';
  if (withHat < sharedAddrs.length) return 'pending';
  return 'done';
}

/** Permitted lookup keyed by lowercase address. */
export function permittedByAddressFromExtStatus(
  memberPermits: { address: string; permitted: boolean }[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const row of memberPermits) {
    const key = row.address.trim().toLowerCase();
    if (!key) continue;
    out[key] = row.permitted;
  }
  return out;
}

/** Hats-path sponsorship: captain or crew wearer is eligible. */
export function isHatsSponsoredAddress(
  address: string | undefined,
  captainWearers: string[],
  crewWearers: string[],
): boolean {
  const key = address?.trim().toLowerCase();
  if (!key) return false;
  const covered = new Set(
    [...captainWearers, ...crewWearers].map((a) => a.trim().toLowerCase()).filter(Boolean),
  );
  return covered.has(key);
}
