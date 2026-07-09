import { normalizeSquadBroadcastTags } from './commons/tags';

export type SquadKind = 'squad' | 'squad-pair';

export type SquadVisibility = 'private' | 'public';

export type PairedSquadRef = { id: string; name: string };

/** Exactly two anchor squads when a squad-pair is fully specified. */
export type PairedSquads = [PairedSquadRef, PairedSquadRef];

export interface SquadChannelRow {
  name: string;
  groupId: string;
  order: number;
}

export interface StoredSquadRow {
  id: string;
  name: string;
  iconUrl?: string;
  channels: SquadChannelRow[];
  kind?: SquadKind;
  pairedSquads?: PairedSquadRef[] | PairedSquads;
  visibility?: SquadVisibility;
  commonsTags?: string[];
  createdAt: number;
  updatedAt: number;
}

function normalizeStoredCommonsTags(raw: string[] | undefined): string[] | undefined {
  if (!raw?.length) return undefined;
  // Last-used broadcast defaults only; incomplete sets are dropped.
  return normalizeSquadBroadcastTags(raw) ?? undefined;
}

export function isSquadPairKind(kind: SquadKind | undefined): boolean {
  return kind === 'squad-pair';
}

function normalizePairedSquads(raw: PairedSquadRef[] | undefined): PairedSquads | undefined {
  if (!raw || raw.length < 2) return undefined;
  const a = raw[0];
  const b = raw[1];
  if (typeof a?.id !== 'string' || typeof a?.name !== 'string') return undefined;
  if (typeof b?.id !== 'string' || typeof b?.name !== 'string') return undefined;
  return [{ id: a.id, name: a.name }, { id: b.id, name: b.name }];
}

/** Normalize a stored squad row; default kind is `squad`, visibility is `private`. */
export function normalizeStoredSquad(raw: StoredSquadRow): StoredSquadRow {
  const kind: SquadKind = raw.kind === 'squad-pair' ? 'squad-pair' : 'squad';
  const pairedSquads =
    kind === 'squad-pair' ? normalizePairedSquads(raw.pairedSquads) : undefined;
  const visibility: SquadVisibility = raw.visibility === 'public' ? 'public' : 'private';
  const commonsTags =
    visibility === 'public' ? normalizeStoredCommonsTags(raw.commonsTags) : undefined;
  return {
    id: raw.id,
    name: raw.name,
    iconUrl: raw.iconUrl,
    channels: raw.channels,
    kind,
    pairedSquads,
    visibility,
    commonsTags,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** Squad-pairs linked to an anchor squad (Partner Squads sidebar index). */
export function partnerSquadsForAnchor(allSquads: StoredSquadRow[], anchorSquadId: string): StoredSquadRow[] {
  return allSquads.filter(
    (s) =>
      s.kind === 'squad-pair' &&
      s.pairedSquads?.some((p) => p.id === anchorSquadId)
  );
}

/**
 * Partner squads to show in the sidebar for the active hub parent.
 * Regular squads: pairs anchored on that squad. Squad-pairs: union across both anchors (recursive nav).
 */
export function partnerSquadsForHubParent(
  allSquads: StoredSquadRow[],
  activeSquadId: string
): StoredSquadRow[] {
  const active = allSquads.find((s) => s.id === activeSquadId);
  if (!active) return [];

  if (active.kind === 'squad-pair' && active.pairedSquads?.length) {
    const seen = new Set<string>();
    const merged: StoredSquadRow[] = [];
    for (const anchor of active.pairedSquads) {
      for (const pair of partnerSquadsForAnchor(allSquads, anchor.id)) {
        if (pair.id === activeSquadId || seen.has(pair.id)) continue;
        seen.add(pair.id);
        merged.push(pair);
      }
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }

  return partnerSquadsForAnchor(allSquads, activeSquadId);
}
