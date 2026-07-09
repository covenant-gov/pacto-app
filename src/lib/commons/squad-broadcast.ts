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
import { normalizeSquadBroadcastTags } from './tags';
import { ensureSquadBot } from '../squad/squad-bot';

async function requireBotHolder(squadId: string): Promise<string | null> {
  const state = await ensureSquadBot(squadId);
  if (!state) return 'Squad bot is not initialized. Open Join inbox settings first.';
  if (!state.iAmHolder || !state.hasLocalSecret) {
    return 'Only bot key holders with a local secret can publish or cancel squad Commons broadcasts.';
  }
  return null;
}

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
  const gate = await requireBotHolder(squadId);
  if (gate) return { ok: false, error: gate };
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
    return { ok: false, error: 'Turn Commons on for this squad before broadcasting.' };
  }

  const message = options.message.trim();
  if (!message) {
    return { ok: false, error: 'Message is required.' };
  }

  const gate = await requireBotHolder(squad.id);
  if (gate) return { ok: false, error: gate };

  const active = await fetchActiveSquadCommonsBroadcast(squad.id);
  if (active) {
    if (options.skipIfActive) return { ok: true, skipped: true };
    return { ok: false, error: 'A broadcast is still active for this squad.' };
  }

  const normalized = normalizeSquadBroadcastTags(options.tags ?? squad.commonsTags ?? []);
  if (!normalized) {
    return { ok: false, error: 'Choose exactly 3 valid tags.' };
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
