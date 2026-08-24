import { uniqueRosterAddresses, type MemberEvmOption } from './war-game-captain';

export type { MemberEvmOption };

export type GovMemberPreset = 'crewWearers' | 'squadRoster' | 'squadNotCrew';

export type GovMemberHatLabel = 'Crew' | 'Captain';

/** Crew-tab hat column: address → "Captain, Crew". */
export function addressesWithHatLabel(
  memberHatByAddress: Record<string, string>,
  label: GovMemberHatLabel,
): string[] {
  const want = label.trim();
  if (!want) return [];
  const out: string[] = [];
  for (const [addr, raw] of Object.entries(memberHatByAddress)) {
    const parts = raw.split(',').map((p) => p.trim());
    if (parts.includes(want)) out.push(addr);
  }
  return uniqueRosterAddresses(out);
}

/** Checksummed first-seen union of wearer address lists. */
export function mergeWearerAddresses(...lists: string[][]): string[] {
  return uniqueRosterAddresses(lists.flat());
}

function uniqueRosterOptions(roster: MemberEvmOption[]): MemberEvmOption[] {
  const seen = new Set<string>();
  const out: MemberEvmOption[] = [];
  for (const o of roster) {
    const [addr] = uniqueRosterAddresses([o.address]);
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address: addr, label: o.label });
  }
  return out;
}

function excludeKeys(excludeAddresses?: string[]): Set<string> {
  return new Set(uniqueRosterAddresses(excludeAddresses ?? []).map((a) => a.toLowerCase()));
}

/** Roster-labeled options for a governance action. Crew presets intersect Status EVM ∩ hat wear. */
export function govMemberOptions(input: {
  roster: MemberEvmOption[];
  crewWearers?: string[];
  captainWearers?: string[];
  excludeAddresses?: string[];
  preset: GovMemberPreset;
}): MemberEvmOption[] {
  const roster = uniqueRosterOptions(input.roster);
  const excluded = excludeKeys(input.excludeAddresses);
  const kept = roster.filter((o) => !excluded.has(o.address.toLowerCase()));
  if (input.preset === 'squadRoster') return kept;

  const crewKeys = new Set(uniqueRosterAddresses(input.crewWearers ?? []).map((a) => a.toLowerCase()));
  if (input.preset === 'crewWearers') {
    return kept.filter((o) => crewKeys.has(o.address.toLowerCase()));
  }
  return kept.filter((o) => !crewKeys.has(o.address.toLowerCase()));
}

/** Label wearers then drop addresses that are not on the Status roster. */
export function labeledRosterWearerOptions(
  wearerAddresses: string[],
  roster: MemberEvmOption[] = [],
): MemberEvmOption[] {
  return govMemberOptions({
    roster,
    crewWearers: wearerAddresses,
    preset: 'crewWearers',
  });
}
