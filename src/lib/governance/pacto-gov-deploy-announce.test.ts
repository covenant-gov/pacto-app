import { describe, expect, it } from 'vitest';
import {
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  buildAnnounceContent,
  isAnnouncementsGovernanceAnnounce,
  isPactoGovGovernanceAnnounce,
  parseAnnouncement,
} from '../announcements';
import {
  announceCardAllowedForTimelineBucket,
  deriveVirtualBucketFromMessageContent,
} from '../mls/virtual-channel-bucket';
import { explorerAddressUrl, SUPPORTED_CHAINS } from '../wallet/chains';
import { getExplorerTxUrl } from '../wallet/assets';
import { hatsTreeExplorerUrl } from '../dashboard/structure-summary';
import {
  buildPactoGovGovernanceAnnouncePayload,
  pactoGovInfraId,
} from './api';
import {
  pactoGovDeployAnnounceRows,
  txHashFromPactoGovProviderPayload,
  withPactoGovProviderPayloadTxHash,
} from './pacto-gov-payload';

const PARENT = 'smoke-squad-alpha';
const TX_HASH = '0x5763efe47f615aece488a751cbcfb77f671d637996b9a4dc0c1fc45bac69a2aa';

const MODULE_ADDRESSES = {
  safe: '0xB63B0DB5cbb54077f5bB7E98E3705A46544cC33c',
  squadAdminProxy: '0xcdC1D4f82ACa9b7Bb2531507a7a51b7830A8e029',
  quartermaster: '0x7bED19Fb66c0Dd91f21053A51C4cFDA0548F2Df2',
  mutinyModule: '0x91917422D467ea9fd372884Eff11154118fe13C9',
  treasuryAuthority: '0x5412b91D05101D3BD802E4E8D4c576f0e525AeDa',
};

describe('pacto gov deploy announce wire', () => {
  it('posts governance_updated to announcements with txHash and explorer-ready rows', () => {
    const entryId = pactoGovInfraId(PARENT);
    const topHatId = '3519';
    const providerPayload = withPactoGovProviderPayloadTxHash(
      JSON.stringify({ v: 1, parentId: PARENT, ...MODULE_ADDRESSES }),
      TX_HASH,
    );

    const governancePayload = buildPactoGovGovernanceAnnouncePayload({
      parentId: PARENT,
      topHatId,
      chain: 'sepolia',
      providerPayload,
      entryId,
      txHash: TX_HASH,
    });
    expect(txHashFromPactoGovProviderPayload(governancePayload.provider_payload)).toBe(TX_HASH);

    const content = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: governancePayload,
    });
    const wire = JSON.parse(content) as { pacto_virtual_bucket?: string };
    expect(wire.pacto_virtual_bucket).toBe('announcements');
    expect(deriveVirtualBucketFromMessageContent(content)).toBe('announcements');

    const parsed = parseAnnouncement(content);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(isPactoGovGovernanceAnnounce(parsed)).toBe(true);
    expect(isAnnouncementsGovernanceAnnounce(parsed)).toBe(true);
    expect(
      announceCardAllowedForTimelineBucket(parsed, {
        content,
        virtual_bucket: 'announcements',
      }),
    ).toBe(true);

    const rows = pactoGovDeployAnnounceRows({
      providerPayload: governancePayload.provider_payload,
      topHatId,
    });
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      if (row.kind === 'address') {
        expect(explorerAddressUrl('sepolia', row.address)).toMatch(/^https:\/\//);
      } else {
        expect(hatsTreeExplorerUrl(SUPPORTED_CHAINS.sepolia.id, row.hatId)).toContain(
          `/trees/${SUPPORTED_CHAINS.sepolia.id}/3519`,
        );
      }
    }
    expect(getExplorerTxUrl('sepolia', TX_HASH)).toMatch(/^https:\/\//);
  });
});
