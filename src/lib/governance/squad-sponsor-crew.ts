/** Whether every MLS member has a shared roster EVM address for this parent. */
export function allMembersShareEvmAddress(
  channelMembers: string[],
  squadMemberEvmByNpub: Record<string, string>,
): boolean {
  if (channelMembers.length === 0) return false;
  return channelMembers.every((npub) => {
    const addr = squadMemberEvmByNpub[npub]?.trim();
    return !!addr;
  });
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
