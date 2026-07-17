import { getSquadSponsorVariant, type SquadSponsorVariant } from './api';

/**
 * Sponsor variant for dashboard surfaces. Deploy results carry top-level `'ext' | 'hats'`,
 * but persisted `providerPayload.variant` keeps the on-chain label: `'ext'` for the Ext
 * clone, `'sponsor'` for the hats-linked clone. Resolves both onto the typed variant.
 */
export function resolveSquadSponsorVariant(
  source: { variant?: string | null; providerPayload?: string | null } | null | undefined,
): SquadSponsorVariant | null {
  const variant = getSquadSponsorVariant(source);
  if (variant) return variant;
  const raw = source?.providerPayload?.trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'variant' in parsed) {
      const payloadVariant = parsed.variant;
      if (
        typeof payloadVariant === 'string' &&
        payloadVariant.trim().toLowerCase() === 'sponsor'
      ) {
        return 'hats';
      }
    }
    return null;
  } catch {
    return null;
  }
}
