/**
 * Background Join inbox fan-out for holders while the app is signed in.
 */

import { get } from 'svelte/store';
import { currentUser } from '../../stores/auth';
import { squads } from '../../stores/squads';
import { getSquadBotState } from './squad-bot';
import { syncJoinRequestsForSquad } from '../../stores/squad-join-requests';
import { drainPendingAdmitQueue } from '../parent/pending-admit';

const HOLDER_FANOUT_INTERVAL_MS = 60_000;

let fanoutTimer: ReturnType<typeof setInterval> | null = null;
let fanoutInFlight = false;

export async function syncJoinInboxForHolderSquads(): Promise<void> {
  if (fanoutInFlight) return;
  const me = get(currentUser)?.npub;
  if (!me) return;
  fanoutInFlight = true;
  try {
    const list = get(squads);
    for (const squad of list) {
      try {
        const state = await getSquadBotState(squad.id);
        if (!state?.iAmHolder || !state.hasLocalSecret) continue;
        await syncJoinRequestsForSquad(squad.id);
      } catch (e) {
        console.warn('[join-inbox] holder sync failed', squad.id.slice(0, 12), e);
      }
    }
    await drainPendingAdmitQueue();
  } finally {
    fanoutInFlight = false;
  }
}

export function startJoinInboxHolderSync(): void {
  if (fanoutTimer != null) return;
  void syncJoinInboxForHolderSquads();
  fanoutTimer = setInterval(() => {
    void syncJoinInboxForHolderSquads();
  }, HOLDER_FANOUT_INTERVAL_MS);
}

export function stopJoinInboxHolderSync(): void {
  if (fanoutTimer != null) {
    clearInterval(fanoutTimer);
    fanoutTimer = null;
  }
}
