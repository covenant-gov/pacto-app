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

/** Submit Pacto Gov deploy using squad network and the chosen captain address. */
export function startPactoGovDeploy(params: {
  parentId: string;
  squadNetwork: SupportedChainId | null;
  captain: string;
  onComplete: (out: PactoGovDeployComplete) => void | Promise<void>;
}): void {
  const parentId = params.parentId.trim();
  if (!parentId) return;

  const network = params.squadNetwork;
  if (!network) {
    showToast('Set the squad network in Settings before deploying Pacto Gov.');
    return;
  }

  const captain = normalizeCaptainAddress(params.captain);
  if (!captain) {
    showToast('Pick a valid captain EVM address.');
    return;
  }

  runOnChainInBackground({
    startedToast: 'Pacto Gov deploy submitted. Confirmation continues in the background.',
    subject: 'Pacto Gov deploy',
    job: () =>
      deployNavePirataForParent({
        network,
        parentId,
        captain,
      }),
    onSuccess: async (result) => {
      await params.onComplete({
        txHash: result.txHash,
        chain: result.chain,
        topHatId: result.topHatId,
        safeAddress: result.safeAddress,
        providerPayload: result.providerPayload,
      });
    },
  });
}
