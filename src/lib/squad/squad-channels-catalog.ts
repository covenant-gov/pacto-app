/**
 * Open-channel catalog announce on #announcements (late-joiner catch-up).
 */

import {
  acceptMlsWelcome,
  listPendingMlsWelcomes,
  sendDmMessage,
} from '../api/nostr';
import { getAnnouncementsChannel } from '../parent-navbar';
import { catalogChannelsForAnnounce, type ChannelAccess } from '../parent/channel-access';
import { persistSquadPatch } from './squad-catalog';
import type { Channel, Squad } from '../../stores/squads';
import { get } from 'svelte/store';
import { squads } from '../../stores/squads';
import { ANNOUNCEMENTS_CHANNEL_NAME, POLLS_CHANNEL_NAME } from './hub-channel-names';
import { dmError } from '../utils/dm-debug';

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
      if (name === ANNOUNCEMENTS_CHANNEL_NAME || name === POLLS_CHANNEL_NAME) continue;
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

/** Accept pending MLS welcomes that match open-channel catalog rows. */
async function acceptPendingWelcomesForCatalog(
  parentId: string,
  channels: SquadChannelsCatalogPayload['channels'],
): Promise<void> {
  let welcomes;
  try {
    welcomes = await listPendingMlsWelcomes();
  } catch (e) {
    dmError('listPendingMlsWelcomes after channels catalog', e);
    return;
  }
  for (const row of channels) {
    if (row.access === 'closed') continue;
    const welcome = welcomes.find((w) => sameGroupId(w.nostr_group_id, row.groupId));
    if (!welcome) continue;
    try {
      await acceptMlsWelcome(welcome.id);
    } catch (e) {
      dmError('acceptMlsWelcome after channels catalog', e);
    }
  }
  // Ensure sidebar rows exist even if welcome accept is still in flight.
  void persistSquadPatch(parentId, (squad) => {
    let changed = false;
    const next: Channel[] = [...squad.channels];
    for (const row of channels) {
      if (row.access === 'closed') continue;
      const existing = next.find((c) => sameGroupId(c.groupId, row.groupId));
      if (existing) {
        if (existing.access !== row.access || existing.name !== row.name) {
          Object.assign(existing, {
            name: row.name,
            access: row.access,
            order: row.order,
            groupId: existing.groupId || row.groupId,
          });
          changed = true;
        }
        continue;
      }
      next.push({
        name: row.name,
        groupId: row.groupId,
        order: row.order,
        access: row.access,
      });
      changed = true;
    }
    if (!changed) return squad;
    return { ...squad, channels: next };
  });
}

/** Merge open-channel catalog rows into local squad (does not remove closed-only local rows). */
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
        if (existing) {
          if (existing.access !== row.access || existing.name !== row.name) {
            Object.assign(existing, { name: row.name, access: row.access, order: row.order });
            changed = true;
          }
          continue;
        }
        next.push({
          name: row.name,
          groupId: row.groupId,
          order: row.order,
          access: row.access,
        });
        changed = true;
      }
      if (!changed) return squad;
      return { ...squad, channels: next };
    });
    await acceptPendingWelcomesForCatalog(parent.id, parsed.channels);
  })();
}
