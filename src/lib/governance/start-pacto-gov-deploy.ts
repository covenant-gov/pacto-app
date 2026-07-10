import { deployNavePirataForParent } from './api';
import { runOnChainInBackground } from '../evm/on-chain-background';
import type { SupportedChainId } from '../wallet/chains';
import { getAddress, isAddress } from 'viem';
import { showToast } from '../../stores/toast';

export type PactoGovDeployComplete = {
  txHash: string;
  chain: string;
  topHatId: string;
  safeAddress: string;
  providerPayload: string;
  infraRowId: string;
};

export type PactoGovCaptainOption = {
  npub: string;
  address: string;
  label: string;
};

function normalizeCaptainAddress(raw: string): string | null {
  const t = raw.trim();
  if (!t || !isAddress(t as `0x${string}`)) return null;
  try {
    return getAddress(t as `0x${string}`);
  } catch {
    return null;
  }
}

/** Captain picker options from persisted squad roster rows (not MLS member list). */
export function buildCaptainMemberOptions(
  squadMemberEvmByNpub: Record<string, string>,
  currentUserNpub: string | null | undefined,
  displayNameForNpub: (npub: string) => string,
): PactoGovCaptainOption[] {
  const me = currentUserNpub?.trim() ?? '';
  const rows = Object.entries(squadMemberEvmByNpub)
    .map(([npub, rawAddr]) => {
      const address = normalizeCaptainAddress(rawAddr);
      if (!address) return null;
      const name = displayNameForNpub(npub)?.trim() || `${npub.slice(0, 12)}…`;
      const isMe = npub === me;
      return { npub, address, label: isMe ? `${name} (you)` : name };
    })
    .filter((row): row is PactoGovCaptainOption => row != null);
  rows.sort((a, b) => {
    if (me && a.npub === me) return -1;
    if (me && b.npub === me) return 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  return rows;
}

/** Submit Pacto Gov deploy using squad network and the chosen captain address. Returns false when validation fails. */
export function startPactoGovDeploy(params: {
  parentId: string;
  squadNetwork: SupportedChainId | null;
  captain: string;
  onComplete: (out: PactoGovDeployComplete) => void | Promise<void>;
  onReject?: (message: string) => void;
  onError?: (message: string) => void;
}): boolean {
  const parentId = params.parentId.trim();
  if (!parentId) return false;

  const network = params.squadNetwork;
  if (!network) {
    const message = 'Set the squad network in Settings before deploying Pacto Gov.';
    if (params.onReject) {
      params.onReject(message);
    } else {
      showToast(message);
    }
    return false;
  }

  const captain = normalizeCaptainAddress(params.captain);
  if (!captain) {
    const message = 'Pick a valid captain EVM address.';
    if (params.onReject) {
      params.onReject(message);
    } else {
      showToast(message);
    }
    return false;
  }

  runOnChainInBackground({
    startedToast: 'Pacto Gov deploy submitted. Confirmation continues in the background.',
    subject: 'Pacto Gov deploy',
    job: () =>
      deployNavePirataForParent({
        network,
        parentId,
        captain,
        // Hats metadata URI; captain modal has no field yet — stable placeholder until product adds one.
        metadataUri: `pacto://squad/${parentId}`,
      }),
    onSuccess: async (result) => {
      await params.onComplete({
        txHash: result.txHash,
        chain: result.chain,
        topHatId: result.topHatId,
        safeAddress: result.safeAddress,
        providerPayload: result.providerPayload,
        infraRowId: result.infraRowId,
      });
    },
    onError: params.onError,
  });
  return true;
}
