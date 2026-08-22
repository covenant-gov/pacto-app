import { getSquadSponsorVariant, type SquadSponsorVariant } from './api';

/**
 * Sponsor variant for dashboard surfaces. Deploy results carry top-level `'ext' | 'hats'`,
 * but persisted `providerPayload.variant` keeps the on-chain label: `'ext'` for the Ext
 * clone, `'sponsor'` for the hats-linked clone. Resolves both onto the typed variant.
 * Wargame round clones (`infraType: pacto_gov_wargame`) are always hats-native.
 */
export function resolveSquadSponsorVariant(
  source:
    | {
        variant?: string | null;
        providerPayload?: string | null;
        infraType?: string | null;
      }
    | null
    | undefined,
): SquadSponsorVariant | null {
  if (source?.infraType?.trim() === 'pacto_gov_wargame') return 'hats';
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
