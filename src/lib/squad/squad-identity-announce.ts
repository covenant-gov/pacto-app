/**
 * Squad PFP sync on #announcements. Last received wins; catalog `icon_url` is the local copy.
 */

import { get } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import { persistSquadPatch } from './squad-catalog';
import { getAnnouncementsChannel } from '../parent-navbar';
import { squads, type Squad } from '../../stores/squads';
import { dmError } from '../utils/dm-debug';
import { isHttpsUrl } from '../utils/profile';

export const SQUAD_IDENTITY_UPDATED_TYPE = 'squad_identity_updated';

export type SquadIdentityUpdatedPayload = {
  parent_id: string;
  icon_url: string | null;
};

export function formatSquadIdentityUpdated(payload: SquadIdentityUpdatedPayload): string {
  return JSON.stringify({
    type: SQUAD_IDENTITY_UPDATED_TYPE,
    payload: {
      parent_id: payload.parent_id.trim(),
      icon_url: normalizeIconUrl(payload.icon_url),
    },
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadIdentityUpdated(
  content: string | null | undefined,
): SquadIdentityUpdatedPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_IDENTITY_UPDATED_TYPE) return null;
    const p = root.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
    if (!parent_id) return null;
    return { parent_id, icon_url: normalizeIconUrl(p.icon_url) };
  } catch {
    return null;
  }
}

function normalizeIconUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && isHttpsUrl(trimmed) ? trimmed : null;
}

function sameGroupId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function publishSquadIdentityUpdated(parent: Squad): Promise<boolean> {
  const announcements = getAnnouncementsChannel(parent);
  const gid = announcements?.groupId?.trim() || parent.id.trim();
  if (!gid) return false;
  const json = formatSquadIdentityUpdated({
    parent_id: gid,
    icon_url: parent.iconUrl ?? null,
  });
  try {
    return await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
  } catch (e) {
    dmError('publishSquadIdentityUpdated', e);
    return false;
  }
}

export function applySquadIdentityUpdated(content: string, groupId: string): void {
  const parsed = parseSquadIdentityUpdated(content);
  if (!parsed) return;
  if (!sameGroupId(parsed.parent_id, groupId)) return;
  const parent = get(squads).find(
    (s) => sameGroupId(s.id, parsed.parent_id) || sameGroupId(s.id, groupId),
  );
  if (!parent) return;
  const nextUrl = parsed.icon_url ?? undefined;
  const current = parent.iconUrl?.trim() || undefined;
  if (current === nextUrl) return;
  void persistSquadPatch(parent.id, (squad) => ({ ...squad, iconUrl: nextUrl }));
}
