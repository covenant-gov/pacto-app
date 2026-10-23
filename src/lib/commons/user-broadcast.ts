import {
  cancelCommonsBroadcast,
  getLocalActiveCommonsBroadcast,
  publishCommonsBroadcast,
} from '../api/commons';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import type { CommonsBroadcastAudience, CommonsBroadcastDurationHours, CommonsBroadcastLocalState } from './types';
import {
  clearCommonsBroadcastLocalState,
  getActiveCommonsBroadcastLocalState,
  localStateFromDto,
  recordCommonsBroadcastLocalState,
} from './local-broadcast-state';
import { COMMONS_NEW_TAG } from './tags';
import { hasEverBroadcast, markHasEverBroadcast } from './first-broadcast';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

/** First broadcast ever → new user; any later one → active user. */
export function commonsAudienceForFirstBroadcast(firstEver: boolean): CommonsBroadcastAudience {
  return firstEver ? 'new_user' : 'active_user';
}

export async function fetchActiveUserCommonsBroadcast(
  npub: string
): Promise<CommonsBroadcastLocalState | null> {
  const local = getActiveCommonsBroadcastLocalState('user', npub);
  if (local) return local;
  try {
    const dto = await getLocalActiveCommonsBroadcast('user', npub);
    if (!dto) return null;
    recordCommonsBroadcastLocalState(dto);
    return localStateFromDto(dto);
  } catch (e) {
    console.warn('[commons] fetchActiveUserCommonsBroadcast failed', e);
    return null;
  }
}

/**
 * Retract the user's active broadcast. Publishes a `#cancelled` tombstone so
 * other clients drop it from the feed, then clears the local cooldown so the
 * user can immediately rebroadcast.
 */
export async function cancelUserCommonsBroadcast(
  npub: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cancelCommonsBroadcast('user', npub);
    clearCommonsBroadcastLocalState('user', npub);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, get(t)('commons.errors.cancelBroadcastFailed')) };
  }
}

export async function publishUserCommonsBroadcast(input: {
  npub: string;
  message: string;
  durationHours: CommonsBroadcastDurationHours;
  tags: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = input.message.trim();
  if (!message) {
    return { ok: false, error: get(t)('commons.errors.messageRequired') };
  }
  if (input.tags.length === 0) {
    return { ok: false, error: get(t)('commons.errors.tagRequired') };
  }

  const active = await fetchActiveUserCommonsBroadcast(input.npub);
  if (active) {
    return { ok: false, error: get(t)('commons.errors.personalBroadcastStillActive') };
  }

  // Audience is implicit: first broadcast ever is a new user (+ reserved `#new`
  // tag); any later broadcast is an active user.
  const firstEver = !hasEverBroadcast(input.npub);
  const audience = commonsAudienceForFirstBroadcast(firstEver);
  const tags = firstEver ? [...input.tags, COMMONS_NEW_TAG] : input.tags;

  try {
    const dto = await publishCommonsBroadcast({
      subject: 'user',
      message,
      durationHours: input.durationHours,
      tags,
      audience,
    });
    recordCommonsBroadcastLocalState(dto);
    markHasEverBroadcast(input.npub);
    return { ok: true };
  } catch (e: unknown) {
    return {
      ok: false,
      error: getInvokeErrorMessage(e, get(t)('commons.errors.publishPersonalBroadcastFailed')),
    };
  }
}
