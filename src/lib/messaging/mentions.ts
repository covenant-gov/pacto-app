/**
 * Squad mention envelope: v1 wire format for @ mentions inside MLS group messages.
 *
 * The envelope is client-side only: the backend receives it as the rumor `content`
 * string, encrypts it inside the MLS ciphertext, and never parses or stores the
 * `mentions` array. It may extract only `body` for OS notification text.
 */

export interface Mention {
  /** Canonical target identity (bech32 npub). */
  npub: string;
  /** Display handle used at send time (`@alias` form, without the leading `@`). */
  alias: string;
}

export interface SquadMessageEnvelope {
  kind: 'pacto.mentions.envelope.v1';
  /** Human-readable message text with literal `@alias` tokens. */
  body: string;
  /** Canonical mention targets bound to the aliases in `body`. */
  mentions: Mention[];
  /** Virtual bucket used by the active channel for routing. */
  pacto_virtual_bucket: string;
}

export interface ParsedMessage {
  /** Display body: envelope body, or the original content for non-envelopes. */
  body: string;
  /** Roster-filtered mentions are applied by the caller; this is the raw list. */
  mentions: Mention[];
  /** Virtual bucket hint when the content carried an envelope. */
  pacto_virtual_bucket: string | null;
  /** True when the input was a valid mention envelope. */
  isEnvelope: boolean;
}

const ENVELOPE_KIND = 'pacto.mentions.envelope.v1';

function isMention(value: unknown): value is Mention {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.npub === 'string' && typeof v.alias === 'string';
}

function isMentionArray(value: unknown): value is Mention[] {
  return Array.isArray(value) && value.every(isMention);
}

/** Filter mention targets to those whose npub is in the provided roster. */
export function filterMentionsByRoster(
  mentions: Mention[],
  rosterNpubs: string[] | Set<string>
): Mention[] {
  const set = rosterNpubs instanceof Set ? rosterNpubs : new Set(rosterNpubs);
  return mentions.filter((m) => set.has(m.npub));
}

/** Parse raw message content. Returns the envelope body/mentions/bucket when valid,
 * otherwise falls back to treating the whole string as plain text. */
export function parseMessageContent(content: string | null | undefined): ParsedMessage {
  const raw = content ?? '';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return { body: raw, mentions: [], pacto_virtual_bucket: null, isEnvelope: false };
  }
  let parsed: Record<string, unknown>;
  try {
    const v = JSON.parse(trimmed);
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { body: raw, mentions: [], pacto_virtual_bucket: null, isEnvelope: false };
    }
    parsed = v as Record<string, unknown>;
  } catch {
    return { body: raw, mentions: [], pacto_virtual_bucket: null, isEnvelope: false };
  }
  if (parsed.kind !== ENVELOPE_KIND) {
    return { body: raw, mentions: [], pacto_virtual_bucket: null, isEnvelope: false };
  }
  if (typeof parsed.body !== 'string' || !isMentionArray(parsed.mentions)) {
    return { body: raw, mentions: [], pacto_virtual_bucket: null, isEnvelope: false };
  }
  const bucket = typeof parsed.pacto_virtual_bucket === 'string' ? parsed.pacto_virtual_bucket : null;
  return {
    body: parsed.body,
    mentions: parsed.mentions,
    pacto_virtual_bucket: bucket,
    isEnvelope: true,
  };
}

/** Build the JSON mention envelope. */
export function buildMentionEnvelope(body: string, mentions: Mention[], virtualBucket: string): string {
  const envelope: SquadMessageEnvelope = {
    kind: ENVELOPE_KIND,
    body,
    mentions,
    pacto_virtual_bucket: virtualBucket,
  };
  return JSON.stringify(envelope);
}

/** True when content is the mention envelope kind. */
export function isMentionEnvelopeContent(content: string | null | undefined): boolean {
  const p = parseMessageContent(content);
  return p.isEnvelope;
}
