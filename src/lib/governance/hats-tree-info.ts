import type { HatTreeNodeDto } from './api';

/** Open max-supply threshold (same as HatsTreeNode card). */
export const HAT_SUPPLY_UNLIMITED_THRESHOLD = 0xffffffff;

export type HatsTreeInfoKey =
  | 'topHat'
  | 'captain'
  | 'crew'
  | 'mutiny'
  | 'quartermaster'
  | 'treasuryAuthority'
  | 'squadAdmin'
  | 'unknown';

export type HatsTreeWearerKind = 'user' | 'contract' | 'userOrContract' | 'unknown';

export type HatsTreeInfoFunctionDef = {
  nameKey: string;
  descKey: string;
};

export type HatsTreeInfoStatic = {
  nameKey: string;
  defaultWearerKind: HatsTreeWearerKind;
  functions: HatsTreeInfoFunctionDef[];
  purposeKey: string;
};

export type HatsTreeInfoQuantity = {
  count: number;
  unlimited: boolean;
  max: number;
};

export type HatsTreeInfoViewModel = {
  infoKey: HatsTreeInfoKey;
  nameKey: string;
  /** When set, prefer over translating nameKey (unknown / on-chain details). */
  displayName?: string;
  quantity: HatsTreeInfoQuantity;
  wearerKind: HatsTreeWearerKind;
  functions: HatsTreeInfoFunctionDef[];
  purposeKey: string;
};

export const HATS_TREE_INFO_KEY = Symbol('hats-tree-info');

export type HatsTreeInfoOpenPayload = {
  node: HatTreeNodeDto;
  roleLabel: string;
};

export type HatsTreeInfoApi = {
  open: (payload: HatsTreeInfoOpenPayload) => void;
};

const INFO_BY_ROLE_LABEL: Record<string, HatsTreeInfoKey> = {
  'Top hat': 'topHat',
  Captain: 'captain',
  Crew: 'crew',
  'Mutiny Role': 'mutiny',
  'Quartermaster Role': 'quartermaster',
  'Treasury Authority Role': 'treasuryAuthority',
  'Squad Admin': 'squadAdmin',
};

const STATIC: Record<Exclude<HatsTreeInfoKey, 'unknown'>, HatsTreeInfoStatic> = {
  topHat: {
    nameKey: 'governance.hats.info.name.topHat',
    defaultWearerKind: 'contract',
    functions: [],
    purposeKey: 'governance.hats.info.purpose.topHat',
  },
  captain: {
    nameKey: 'governance.hats.info.name.captain',
    defaultWearerKind: 'userOrContract',
    functions: [],
    purposeKey: 'governance.hats.info.purpose.captain',
  },
  crew: {
    nameKey: 'governance.hats.info.name.crew',
    defaultWearerKind: 'user',
    functions: [],
    purposeKey: 'governance.hats.info.purpose.crew',
  },
  mutiny: {
    nameKey: 'governance.hats.info.name.mutiny',
    defaultWearerKind: 'contract',
    functions: [
      {
        nameKey: 'governance.hats.info.fn.mutiny.mutiny.name',
        descKey: 'governance.hats.info.fn.mutiny.mutiny.desc',
      },
      {
        nameKey: 'governance.hats.info.fn.mutiny.resign.name',
        descKey: 'governance.hats.info.fn.mutiny.resign.desc',
      },
    ],
    purposeKey: 'governance.hats.info.purpose.mutiny',
  },
  quartermaster: {
    nameKey: 'governance.hats.info.name.quartermaster',
    defaultWearerKind: 'contract',
    functions: [
      {
        nameKey: 'governance.hats.info.fn.quartermaster.addCrew.name',
        descKey: 'governance.hats.info.fn.quartermaster.addCrew.desc',
      },
      {
        nameKey: 'governance.hats.info.fn.quartermaster.removeCrew.name',
        descKey: 'governance.hats.info.fn.quartermaster.removeCrew.desc',
      },
      {
        nameKey: 'governance.hats.info.fn.quartermaster.proposeOffboard.name',
        descKey: 'governance.hats.info.fn.quartermaster.proposeOffboard.desc',
      },
    ],
    purposeKey: 'governance.hats.info.purpose.quartermaster',
  },
  treasuryAuthority: {
    nameKey: 'governance.hats.info.name.treasuryAuthority',
    defaultWearerKind: 'contract',
    functions: [
      {
        nameKey: 'governance.hats.info.fn.treasury.submitProposal.name',
        descKey: 'governance.hats.info.fn.treasury.submitProposal.desc',
      },
      {
        nameKey: 'governance.hats.info.fn.treasury.voteMode.name',
        descKey: 'governance.hats.info.fn.treasury.voteMode.desc',
      },
    ],
    purposeKey: 'governance.hats.info.purpose.treasuryAuthority',
  },
  squadAdmin: {
    nameKey: 'governance.hats.info.name.squadAdmin',
    defaultWearerKind: 'contract',
    functions: [],
    purposeKey: 'governance.hats.info.purpose.squadAdmin',
  },
};

const UNKNOWN_STATIC: HatsTreeInfoStatic = {
  nameKey: 'governance.hats.untitled',
  defaultWearerKind: 'unknown',
  functions: [],
  purposeKey: 'governance.hats.info.purpose.unknown',
};

export function hatsTreeInfoKey(roleLabel: string): HatsTreeInfoKey {
  const key = INFO_BY_ROLE_LABEL[roleLabel.trim()];
  return key ?? 'unknown';
}

export function formatHatQuantity(supply: number, maxSupply: number): HatsTreeInfoQuantity {
  const unlimited = maxSupply >= HAT_SUPPLY_UNLIMITED_THRESHOLD;
  return {
    count: supply,
    unlimited,
    max: unlimited ? 0 : maxSupply,
  };
}

/**
 * Infer wearer kind from current addresses.
 * Protocol module labels → contract; roster npub → user; mix → userOrContract.
 */
export function inferWearerKind(
  addresses: string[],
  knownWearerLabels: Record<string, string>,
  npubByAddress: Record<string, string>,
): HatsTreeWearerKind | null {
  if (addresses.length === 0) return null;

  let sawContract = false;
  let sawUser = false;
  let sawUnknown = false;

  for (const raw of addresses) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    if (knownWearerLabels[key]) {
      sawContract = true;
      continue;
    }
    if (npubByAddress[key]) {
      sawUser = true;
      continue;
    }
    sawUnknown = true;
  }

  if (sawContract && sawUser) return 'userOrContract';
  if (sawContract && !sawUser && !sawUnknown) return 'contract';
  if (sawUser && !sawContract && !sawUnknown) return 'user';
  if (sawContract && sawUnknown && !sawUser) return 'contract';
  if (sawUser && sawUnknown && !sawContract) return 'user';
  if (sawContract || sawUser) return 'userOrContract';
  return null;
}

function humanHatDetails(raw: string | null | undefined): string {
  const t = raw?.trim() ?? '';
  if (!t || t.includes('://')) return '';
  return t;
}

export function buildHatsTreeInfoViewModel(params: {
  node: HatTreeNodeDto;
  roleLabel: string;
  wearerAddresses?: string[];
  knownWearerLabels?: Record<string, string>;
  npubByAddress?: Record<string, string>;
}): HatsTreeInfoViewModel {
  const infoKey = hatsTreeInfoKey(params.roleLabel);
  const staticInfo = infoKey === 'unknown' ? UNKNOWN_STATIC : STATIC[infoKey];
  const quantity = formatHatQuantity(params.node.supply, params.node.maxSupply);

  const inferred = inferWearerKind(
    params.wearerAddresses ?? [],
    params.knownWearerLabels ?? {},
    params.npubByAddress ?? {},
  );
  const wearerKind = inferred ?? staticInfo.defaultWearerKind;

  const details = humanHatDetails(params.node.details);
  const displayName = infoKey === 'unknown' && details ? details : undefined;

  return {
    infoKey,
    nameKey: staticInfo.nameKey,
    displayName,
    quantity,
    wearerKind,
    functions: staticInfo.functions,
    purposeKey: staticInfo.purposeKey,
  };
}
