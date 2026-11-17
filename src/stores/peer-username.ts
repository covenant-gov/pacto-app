import { get, writable } from 'svelte/store';
import { usernameRecordForNpub } from '../lib/api/username';
import { chainUsernameFromRecord } from '../lib/username/shown-name';
import { currentUser } from './auth-session';
import { USERNAME_NETWORK } from './username';

export type PeerUsernameClaim = {
  /** Null when the npub has no minted username. */
  name: string | null;
};

const MAX_IN_FLIGHT = 4;

export const peerUsernameClaims = writable<Record<string, PeerUsernameClaim>>({});

const inflight = new Map<string, Promise<void>>();
const waiting: string[] = [];
let active = 0;

function remember(npub: string, name: string | null): void {
  peerUsernameClaims.update((rows) => ({ ...rows, [npub]: { name } }));
}

function finish(npub: string): void {
  inflight.delete(npub);
  active = Math.max(0, active - 1);
  pump();
}

function start(npub: string): void {
  active += 1;
  const job = usernameRecordForNpub(USERNAME_NETWORK, npub)
    .then((record) => {
      remember(npub, chainUsernameFromRecord(record.name, record.tokenId));
    })
    .catch(() => {
      remember(npub, null);
    })
    .finally(() => finish(npub));
  inflight.set(npub, job);
}

function pump(): void {
  while (active < MAX_IN_FLIGHT && waiting.length > 0) {
    const npub = waiting.shift();
    if (!npub || inflight.has(npub)) continue;
    start(npub);
  }
}

/** Session cache of other accounts' username records. The signed-in account uses usernameState. */
export function ensurePeerUsername(npub: string): void {
  const key = npub.trim();
  if (!key) return;
  const me = get(currentUser)?.npub;
  if (me && me === key) return;
  if (Object.prototype.hasOwnProperty.call(get(peerUsernameClaims), key)) return;
  if (inflight.has(key) || waiting.includes(key)) return;
  waiting.push(key);
  pump();
}
