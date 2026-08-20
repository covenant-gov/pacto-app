import type { NostrProfile } from '../api/nostr';
import type { Squad } from '../../stores/squads';
import { getProfileDisplayName, getProfileAvatarSrc } from '../utils/profile';
import { commonsJoinRequestBlockReason, isJoinRequestInFlight, squadIdFromBroadcast } from './commons-join-request';
import type { CommonsBroadcastDto } from './types';

export interface BroadcastPresentation {
  isSquad: boolean;
  isUser: boolean;
  title: string;
  subtitle: string;
  coverImage: string | null;
  coverSeed: string;
  squadLabel: string;
  joinBlockReason: string | null;
  joinInFlight: boolean;
  canMessage: boolean;
  canJoin: boolean;
  greetingName: string;
}

/**
 * Derives the shared title/subtitle/cover/join-action presentation for a Commons broadcast.
 * Pure - callers own reactivity (Svelte stores, `commonsJoinRequestRevision`, etc.).
 */
export function computeBroadcastPresentation(
  broadcast: CommonsBroadcastDto,
  profileRecord: Record<string, NostrProfile>,
  squadList: Squad[],
  currentNpub: string | undefined,
  tFn: (key: string, opts?: Record<string, unknown>) => string
): BroadcastPresentation {
  const isSquad = broadcast.subject === 'squad';
  const isUser = broadcast.subject === 'user';
  const userProfile = isUser ? profileRecord[broadcast.authorNpub] : null;
  const userLabel =
    isUser && userProfile
      ? getProfileDisplayName(userProfile) || broadcast.authorNpub.slice(0, 16) + '…'
      : isUser
        ? broadcast.authorNpub.slice(0, 16) + '…'
        : '';
  const squadLabel = broadcast.squadName ?? tFn('commons.card.squadDefault');
  const title = isSquad ? squadLabel : userLabel;
  const coverImage = getProfileAvatarSrc(userProfile);
  const coverSeed = isSquad ? broadcast.squadId ?? squadLabel : broadcast.authorNpub;
  const subtitle = (() => {
    if (isUser && broadcast.audience) {
      return broadcast.audience === 'new_user' ? tFn('commons.card.newUser') : tFn('commons.card.activeUser');
    }
    if (isSquad) {
      return broadcast.squadKind === 'squad-pair' ? tFn('commons.card.partnerSquad') : tFn('commons.card.squadDefault');
    }
    return tFn('commons.card.user');
  })();
  const localSquadIds = squadList.map((s) => s.id);
  const myNpub = currentNpub;
  const joinBlockReason = isSquad ? commonsJoinRequestBlockReason(broadcast, myNpub, localSquadIds) : null;
  const joinInFlight = isSquad && isJoinRequestInFlight(squadIdFromBroadcast(broadcast));
  const canMessage = isUser && !!myNpub && broadcast.authorNpub !== myNpub;
  const canJoin = isSquad && !joinBlockReason && !!myNpub;
  const profileName = userProfile ? getProfileDisplayName(userProfile) : '';
  const greetingName = profileName && !profileName.startsWith('npub1') ? profileName : '';

  return {
    isSquad,
    isUser,
    title,
    subtitle,
    coverImage,
    coverSeed,
    squadLabel,
    joinBlockReason,
    joinInFlight,
    canMessage,
    canJoin,
    greetingName,
  };
}
