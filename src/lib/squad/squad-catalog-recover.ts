import { get } from 'svelte/store';
import { getMlsGroupMetadata, parseSquadInviteMessage, type MlsGroupMetadataItem } from '../api/nostr';
import { sameMlsGroupId } from '../invites/accept-invite';
import { defaultChannelRowsForGroupId } from './hub-channel-rows';
import { ANNOUNCEMENTS_CHANNEL_NAME, normalizeHubChannelName } from './hub-channel-names';
import { persistSquad, persistSquadPatch } from './squad-catalog';
import { maybeAutoRequestSquadStateSyncAfterJoin } from './squad-state-sync';
import { backendDmMessages } from '../../stores/dm';
import { squads, type Squad } from '../../stores/squads';
import type { PairedSquads, SquadKind } from '../squad-pair';
import { dmError } from '../utils/dm-debug';

export interface SquadInviteHint {
  groupId: string;
  squadName: string;
  kind?: SquadKind;
  pairedSquads?: PairedSquads;
  iconUrl?: string;
}

export function fallbackRecoveredSquadName(groupId: string): string {
  const id = groupId.trim();
  if (!id) return '';
  if (id.length <= 12) return id;
  return `${id.slice(0, 12)}…`;
}

export function isFallbackRecoveredSquadName(name: string, groupId: string): boolean {
  return name === fallbackRecoveredSquadName(groupId);
}

function hintFromInvite(content: string | undefined): SquadInviteHint | null {
  const parsed = parseSquadInviteMessage(content ?? '');
  if (!parsed?.groupId?.trim() || !parsed.squadName.trim()) return null;
  const kind: SquadKind | undefined =
    parsed.kind === 'squad-pair' && parsed.pairedSquads ? 'squad-pair' : parsed.kind === 'squad' ? 'squad' : undefined;
  return {
    groupId: parsed.groupId.trim(),
    squadName: parsed.squadName.trim(),
    kind,
    pairedSquads: kind === 'squad-pair' ? parsed.pairedSquads : undefined,
    iconUrl: parsed.iconUrl,
  };
}

/** Invite DMs are metadata only — never a membership signal. */
export function collectInviteHintsFromMessages(
  dmMessagesByNpub: Record<string, { content?: string }[]>,
): Map<string, SquadInviteHint> {
  const out = new Map<string, SquadInviteHint>();
  for (const messages of Object.values(dmMessagesByNpub)) {
    for (const msg of messages) {
      const hint = hintFromInvite(msg.content);
      if (!hint) continue;
      const key = hint.groupId.toLowerCase();
      const prev = out.get(key);
      if (!prev || (!prev.iconUrl && hint.iconUrl) || (prev.kind !== 'squad-pair' && hint.kind === 'squad-pair')) {
        out.set(key, hint);
      }
    }
  }
  return out;
}

function hintForGroupId(hints: Map<string, SquadInviteHint>, groupId: string): SquadInviteHint | undefined {
  const direct = hints.get(groupId) ?? hints.get(groupId.toLowerCase());
  if (direct) return direct;
  for (const hint of hints.values()) {
    if (sameMlsGroupId(hint.groupId, groupId)) return hint;
  }
  return undefined;
}

function isLiveAnnouncementsGroup(group: Pick<MlsGroupMetadataItem, 'name' | 'evicted'>): boolean {
  if (group.evicted) return false;
  const hub = normalizeHubChannelName(group.name);
  return hub?.toLowerCase() === ANNOUNCEMENTS_CHANNEL_NAME;
}

export function planSquadCatalogRecovery(opts: {
  listedIds: Iterable<string>;
  mlsGroups: Array<Pick<MlsGroupMetadataItem, 'group_id' | 'name' | 'evicted'>>;
  inviteHints: Map<string, SquadInviteHint> | SquadInviteHint[];
}): Squad[] {
  const listed = new Set(
    [...opts.listedIds].map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0),
  );
  const hints = new Map<string, SquadInviteHint>();
  const rawHints = opts.inviteHints instanceof Map ? [...opts.inviteHints.values()] : opts.inviteHints;
  for (const hint of rawHints) {
    const id = hint.groupId.trim();
    if (id) hints.set(id.toLowerCase(), hint);
  }

  const now = Date.now();
  const planned: Squad[] = [];
  const seen = new Set<string>();
  for (const group of opts.mlsGroups) {
    const groupId = group.group_id.trim();
    if (!groupId || seen.has(groupId.toLowerCase())) continue;
    if (listed.has(groupId.toLowerCase())) continue;
    if (!isLiveAnnouncementsGroup(group)) continue;
    seen.add(groupId.toLowerCase());
    const hint = hintForGroupId(hints, groupId);
    const kind: SquadKind = hint?.kind === 'squad-pair' && hint.pairedSquads ? 'squad-pair' : 'squad';
    planned.push({
      id: groupId,
      name: hint?.squadName || fallbackRecoveredSquadName(groupId),
      iconUrl: hint?.iconUrl,
      channels: defaultChannelRowsForGroupId(groupId),
      kind,
      pairedSquads: kind === 'squad-pair' ? hint?.pairedSquads : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }
  return planned;
}

/** Insert catalog rows for live announcements MLS groups missing from `squads`. */
export async function recoverMissingSquadCatalog(): Promise<number> {
  let meta: MlsGroupMetadataItem[];
  try {
    meta = await getMlsGroupMetadata();
  } catch (e) {
    dmError('get_mls_group_metadata for catalog recover', e);
    return 0;
  }
  const planned = planSquadCatalogRecovery({
    listedIds: get(squads).map((s) => s.id),
    mlsGroups: meta,
    inviteHints: collectInviteHintsFromMessages(get(backendDmMessages)),
  });
  let inserted = 0;
  for (const squad of planned) {
    try {
      await persistSquad(squad);
      inserted += 1;
      void maybeAutoRequestSquadStateSyncAfterJoin(squad.id);
    } catch (e) {
      dmError('persist recovered squad', e);
    }
  }
  return inserted;
}

/** Names/icons only — never insert a catalog row from an invite DM. */
export async function enrichRecoveredSquadNamesFromInvites(): Promise<void> {
  const hints = collectInviteHintsFromMessages(get(backendDmMessages));
  if (hints.size === 0) return;
  for (const squad of get(squads)) {
    const hint = hintForGroupId(hints, squad.id);
    if (!hint) continue;
    const needsName = isFallbackRecoveredSquadName(squad.name, squad.id) && !!hint.squadName;
    const needsIcon = !squad.iconUrl && !!hint.iconUrl;
    const needsKind = squad.kind !== 'squad-pair' && hint.kind === 'squad-pair' && !!hint.pairedSquads;
    if (!needsName && !needsIcon && !needsKind) continue;
    try {
      await persistSquadPatch(squad.id, (s) => ({
        ...s,
        name: needsName ? hint.squadName : s.name,
        iconUrl: needsIcon ? hint.iconUrl : s.iconUrl,
        kind: needsKind ? 'squad-pair' : s.kind,
        pairedSquads: needsKind ? hint.pairedSquads : s.pairedSquads,
      }));
    } catch (e) {
      dmError('enrich recovered squad from invite', e);
    }
  }
}
