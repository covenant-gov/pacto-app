import type { SquadVisibility } from '../../stores/squads';
import { showToast } from '../../stores/toast';
import { publishSquadCommonsBroadcast } from './squad-broadcast';
import { COMMONS_NEW_TAG } from './tags';

export type { SquadVisibility };

export interface PublicSquadBroadcastTarget {
  id: string;
  name: string;
  kind: 'squad' | 'squad-pair';
  iconUrl?: string;
  visibility?: SquadVisibility;
  commonsTags?: string[];
}

export function isPublicSquadForCommonsBroadcast(squad: PublicSquadBroadcastTarget): boolean {
  return squad.visibility === 'public';
}

export function defaultPublicSquadBroadcastMessage(name: string): string {
  return `New squad: ${name}`;
}

export async function publishPublicSquadCreateBroadcast(
  squad: PublicSquadBroadcastTarget
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPublicSquadForCommonsBroadcast(squad)) {
    return { ok: true };
  }
  const result = await publishSquadCommonsBroadcast(squad, {
    message: defaultPublicSquadBroadcastMessage(squad.name),
    durationHours: 72,
    skipIfActive: true,
    extraTags: [COMMONS_NEW_TAG],
  });
  if (!result.ok) return result;
  return { ok: true };
}

function toastFailedBroadcast(squad: PublicSquadBroadcastTarget, error: string): void {
  showToast(`Commons broadcast failed for ${squad.name}. ${error}`, undefined, {
    label: 'Retry broadcast',
    action: () => {
      void publishPublicSquadCreateBroadcast(squad).then((result) => {
        if (!result.ok) toastFailedBroadcast(squad, result.error);
      });
    },
  });
}

/** Fire-and-forget 72 h `#new` squad broadcast after MLS group id is final. */
export function schedulePublicSquadCreateBroadcast(
  squadId: string,
  resolveSquad: () => PublicSquadBroadcastTarget | undefined
): void {
  void (async () => {
    const squad = resolveSquad();
    if (!squad || squad.id !== squadId || !isPublicSquadForCommonsBroadcast(squad)) {
      return;
    }
    const result = await publishPublicSquadCreateBroadcast(squad);
    if (!result.ok) {
      toastFailedBroadcast(squad, result.error);
    }
  })();
}
