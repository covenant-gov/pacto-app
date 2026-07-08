import {
  cancelCommonsBroadcast,
  getLocalActiveCommonsBroadcast,
  publishCommonsBroadcast,
} from '../api/commons';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import type { CommonsBroadcastDurationHours, CommonsBroadcastLocalState } from './types';
import {
  clearCommonsBroadcastLocalState,
  getActiveCommonsBroadcastLocalState,
  localStateFromDto,
  recordCommonsBroadcastLocalState,
} from './local-broadcast-state';
import {
  isPublicSquadForCommonsBroadcast,
  type PublicSquadBroadcastTarget,
} from './squad-create-broadcast';
import { normalizeCommonsTags } from './tags';

export async function fetchActiveSquadCommonsBroadcast(
  squadId: string
): Promise<CommonsBroadcastLocalState | null> {
  const local = getActiveCommonsBroadcastLocalState('squad', squadId);
  if (local) return local;
  try {
    const dto = await getLocalActiveCommonsBroadcast('squad', squadId);
    if (!dto) return null;
    recordCommonsBroadcastLocalState(dto);
    return localStateFromDto(dto);
  } catch (e) {
    console.warn('[commons] fetchActiveSquadCommonsBroadcast failed', e);
    return null;
  }
}

export function formatBroadcastCooldownRemaining(
  expiresAtSecs: number,
  nowSecs = Math.floor(Date.now() / 1000)
): string {
  const remaining = expiresAtSecs - nowSecs;
  if (remaining <= 0) return '';
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return 'under 1m';
}

export async function cancelSquadCommonsBroadcast(
  squadId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cancelCommonsBroadcast('squad', squadId);
    clearCommonsBroadcastLocalState('squad', squadId);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Failed to cancel broadcast.') };
  }
}

export async function publishSquadCommonsBroadcast(
  squad: PublicSquadBroadcastTarget,
  options: {
    message: string;
    durationHours: CommonsBroadcastDurationHours;
    skipIfActive?: boolean;
    /** Reserved tags applied by the app (e.g. `#new` at creation). */
    extraTags?: string[];
    /** Author-selected tags; falls back to squad.commonsTags when omitted. */
    tags?: string[];
  }
): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  if (!isPublicSquadForCommonsBroadcast(squad)) {
    return { ok: false, error: 'Only public squads can broadcast.' };
  }

  const message = options.message.trim();
  if (!message) {
    return { ok: false, error: 'Message is required.' };
  }

  const active = await fetchActiveSquadCommonsBroadcast(squad.id);
  if (active) {
    if (options.skipIfActive) return { ok: true, skipped: true };
    return { ok: false, error: 'A broadcast is still active for this squad.' };
  }

  const normalized = normalizeCommonsTags(options.tags ?? squad.commonsTags ?? []);
  if (!normalized) {
    return { ok: false, error: 'Add 1–3 valid tags.' };
  }
  const tags = [...normalized, ...(options.extraTags ?? [])];

  try {
    const dto = await publishCommonsBroadcast({
      subject: 'squad',
      message,
      durationHours: options.durationHours,
      tags,
      squad: {
        id: squad.id,
        name: squad.name,
        kind: squad.kind,
        iconUrl: squad.iconUrl,
      },
    });
    recordCommonsBroadcastLocalState(dto);
    return { ok: true };
  } catch (e: unknown) {
    return {
      ok: false,
      error: getInvokeErrorMessage(e, 'Failed to publish Commons broadcast.'),
    };
  }
}
