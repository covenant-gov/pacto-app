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

function normalizeCaptain(raw: string): string | null {
  const t = raw.trim();
  if (!t || !isAddress(t as `0x${string}`)) return null;
  try {
    return getAddress(t as `0x${string}`);
  } catch {
    return null;
  }
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

  const captain = normalizeCaptain(params.captain);
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
