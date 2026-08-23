/** Delay before one refetch when wearer lists disagree with the ACL snapshot. */
export const ACL_SNAPSHOT_RETRY_MS = 2000;

export function fingerprintWearerAddresses(addresses: string[] | null | undefined): string {
  const seen = new Set<string>();
  for (const raw of addresses ?? []) {
    if (typeof raw !== 'string') continue;
    const addr = raw.trim().toLowerCase();
    if (addr) seen.add(addr);
  }
  return [...seen].sort().join(',');
}

export function aclSnapshotLoadKey(params: {
  parentId: string;
  network: string;
  warGameStack: boolean;
  processNonce: number;
  archiveView: boolean;
  myAddress?: string | null;
  captainWearers?: string[] | null;
  crewWearers?: string[] | null;
}): string {
  return [
    params.parentId.trim(),
    params.network,
    params.warGameStack ? 'wargame' : 'nave',
    String(params.processNonce),
    params.archiveView ? 'archive' : 'live',
    (params.myAddress ?? '').trim().toLowerCase(),
    `c:${fingerprintWearerAddresses(params.captainWearers)}`,
    `r:${fingerprintWearerAddresses(params.crewWearers)}`,
  ].join('|');
}

export function addressInWearerList(
  address: string | null | undefined,
  wearers: string[] | null | undefined,
): boolean {
  const mine = (address ?? '').trim().toLowerCase();
  if (!mine) return false;
  return (wearers ?? []).some(
    (a) => typeof a === 'string' && a.trim().toLowerCase() === mine,
  );
}

/** True when the tree lists this address as a hat wearer but the snapshot does not. */
export function aclSnapshotShouldRetry(params: {
  snapshot: { wearsCaptain: boolean; wearsCrew: boolean } | null | undefined;
  myAddress?: string | null;
  captainWearers?: string[] | null;
  crewWearers?: string[] | null;
}): boolean {
  const snap = params.snapshot;
  if (!snap) return false;
  const mine = params.myAddress ?? '';
  if (addressInWearerList(mine, params.crewWearers) && !snap.wearsCrew) return true;
  if (addressInWearerList(mine, params.captainWearers) && !snap.wearsCaptain) return true;
  return false;
}
