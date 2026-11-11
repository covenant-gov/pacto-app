/**
 * Open-channel catalog announce on #announcements (late-joiner catch-up).
 */

import { sendDmMessage } from '../api/nostr';
import { getAnnouncementsChannel } from '../parent-navbar';
import { catalogChannelsForAnnounce, type ChannelAccess } from '../parent/channel-access';
import { persistSquadPatch } from './squad-catalog';
import type { Channel, Squad } from '../../stores/squads';
import { get } from 'svelte/store';
import { squads } from '../../stores/squads';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  DOCS_CHANNEL_NAME,
  EVENTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from './hub-channel-names';
import { requireMySquadPrivilege } from '../governance/squad-privilege-enforce';
import {
  forgetPendingOpenChannelJoinsNotListed,
  upsertPendingOpenChannelJoin,
} from './pending-open-channel-joins';
import { tryCompleteOpenChannelJoins } from './open-channel-join';

export const SQUAD_CHANNELS_CATALOG_TYPE = 'squad_channels_catalog';

export type SquadChannelsCatalogPayload = {
  parent_id: string;
  channels: Array<{ name: string; groupId: string; order: number; access: ChannelAccess }>;
};

export function formatSquadChannelsCatalog(payload: SquadChannelsCatalogPayload): string {
  return JSON.stringify({
    type: SQUAD_CHANNELS_CATALOG_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadChannelsCatalog(
  content: string | null | undefined,
): SquadChannelsCatalogPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_CHANNELS_CATALOG_TYPE) return null;
    const p = root.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
    if (!parent_id || !Array.isArray(p.channels)) return null;
    const channels: SquadChannelsCatalogPayload['channels'] = [];
    for (const raw of p.channels) {
      if (!raw || typeof raw !== 'object') continue;
      const c = raw as Record<string, unknown>;
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      const groupId = typeof c.groupId === 'string' ? c.groupId.trim() : '';
      const order = typeof c.order === 'number' ? c.order : channels.length;
      const access = c.access === 'closed' ? 'closed' : 'open';
      if (!name || !groupId) continue;
      if (
        name === ANNOUNCEMENTS_CHANNEL_NAME ||
        name === POLLS_CHANNEL_NAME ||
        name === EVENTS_CHANNEL_NAME ||
        name === DOCS_CHANNEL_NAME
      ) {
        continue;
      }
      channels.push({ name, groupId, order, access });
    }
    return { parent_id, channels };
  } catch {
    return null;
  }
}

export async function publishSquadChannelsCatalog(parent: Squad): Promise<boolean> {
  const announcements = getAnnouncementsChannel(parent);
  const gid = announcements.groupId?.trim();
  if (!gid) return false;
  const priv = await requireMySquadPrivilege(gid, 'createChannel');
  if (!priv.ok) return false;
  const channels = catalogChannelsForAnnounce(parent.channels);
  const json = formatSquadChannelsCatalog({ parent_id: gid, channels });
  try {
    return await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
  } catch (e) {
    console.warn('[channels-catalog] publish failed', e);
    return false;
  }
}

function sameGroupId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Merge open-channel catalog metadata; new rows join only after Welcome accept. */
export function applySquadChannelsCatalog(content: string, groupId: string): void {
  const parsed = parseSquadChannelsCatalog(content);
  if (!parsed) return;
  if (!sameGroupId(parsed.parent_id, groupId)) return;
  const parent = get(squads).find(
    (s) => sameGroupId(s.id, parsed.parent_id) || sameGroupId(s.id, groupId),
  );
  if (!parent) return;

  void (async () => {
    await persistSquadPatch(parent.id, (squad) => {
      let changed = false;
      const next: Channel[] = [...squad.channels];
      for (const row of parsed.channels) {
        if (row.access === 'closed') continue;
        const existing = next.find((c) => sameGroupId(c.groupId, row.groupId));
        if (!existing) continue;
        if (existing.access !== row.access || existing.name !== row.name) {
          Object.assign(existing, { name: row.name, access: row.access, order: row.order });
          changed = true;
        }
      }
      if (!changed) return squad;
      return { ...squad, channels: next };
    });
    const listed = parsed.channels.filter((row) => row.access !== 'closed');
    forgetPendingOpenChannelJoinsNotListed(
      parent.id,
      listed.map((row) => row.groupId),
    );
    const attached = get(squads).find((s) => s.id === parent.id)?.channels ?? [];
    for (const row of listed) {
      if (attached.some((c) => sameGroupId(c.groupId, row.groupId))) continue;
      upsertPendingOpenChannelJoin({
        parentId: parent.id,
        groupId: row.groupId,
        name: row.name,
        access: row.access,
      });
    }
    await tryCompleteOpenChannelJoins();
  })();
}
