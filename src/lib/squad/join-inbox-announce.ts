import {
  JOIN_INBOX_KEY_ROTATED_SCHEMA,
  JOIN_INBOX_META_SCHEMA,
} from './join-inbox';

export interface JoinInboxMetaPayload {
  squadId: string;
  inboxNpub: string;
  holders: string[];
  keyEpoch: number;
  updatedAt: number;
}

export interface JoinInboxKeyRotatedPayload {
  squadId: string;
  inboxNpub: string;
  keyEpoch: number;
  rotatedByNpub: string;
  updatedAt: number;
}

export type JoinInboxAnnounceMessage =
  | { kind: 'meta'; payload: JoinInboxMetaPayload }
  | { kind: 'key_rotated'; payload: JoinInboxKeyRotatedPayload };

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function readEpoch(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readNpubList(obj: Record<string, unknown>, key: string): string[] | null {
  const v = obj[key];
  if (!Array.isArray(v)) return null;
  const out = v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out;
}

/** Parse Join inbox MLS JSON for #announcements timeline cards. */
export function parseJoinInboxAnnounceMessage(content: string): JoinInboxAnnounceMessage | null {
  const trimmed = content?.trim();
  if (!trimmed?.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  const schema = readString(rec, 'schema');
  if (!schema) return null;

  const squadId = readString(rec, 'squadId') ?? readString(rec, 'squad_id');
  const inboxNpub = readString(rec, 'inboxNpub') ?? readString(rec, 'inbox_npub');
  const keyEpoch = readEpoch(rec, 'keyEpoch') ?? readEpoch(rec, 'key_epoch');
  const updatedAt = readEpoch(rec, 'updatedAt') ?? readEpoch(rec, 'updated_at');

  if (schema === JOIN_INBOX_META_SCHEMA) {
    const holders = readNpubList(rec, 'holders');
    if (!squadId || !inboxNpub || holders == null || keyEpoch == null || updatedAt == null) return null;
    return {
      kind: 'meta',
      payload: { squadId, inboxNpub, holders, keyEpoch, updatedAt },
    };
  }

  if (schema === JOIN_INBOX_KEY_ROTATED_SCHEMA) {
    const rotatedByNpub =
      readString(rec, 'rotatedByNpub') ?? readString(rec, 'rotated_by_npub');
    if (!squadId || !inboxNpub || keyEpoch == null || !rotatedByNpub || updatedAt == null) return null;
    return {
      kind: 'key_rotated',
      payload: { squadId, inboxNpub, keyEpoch, rotatedByNpub, updatedAt },
    };
  }

  return null;
}

export function shortNpub(npub: string): string {
  const n = npub.trim();
  if (n.length <= 16) return n;
  return `${n.slice(0, 12)}…${n.slice(-8)}`;
}
