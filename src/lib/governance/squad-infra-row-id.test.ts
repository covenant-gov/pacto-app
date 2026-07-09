import { describe, expect, it } from 'vitest';
import {
  SQUAD_INFRA_ID_MAX,
  pactoGovInfraId,
  pactoGovTreasuryEntryId,
  squadAdminInfraId,
  squadSponsorInfraId,
} from './squad-infra-row-id';

const SHORT_PARENT = 'smoke-squad-alpha';
/** Typical MLS announcements group id length. */
const LONG_PARENT = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('squad infra row ids', () => {
  it('uses direct prefix for short parent ids', () => {
    expect(pactoGovInfraId(SHORT_PARENT)).toBe(`pacto-gov-${SHORT_PARENT}`);
    expect(pactoGovTreasuryEntryId(SHORT_PARENT)).toBe(`pacto-gov-treasury-${SHORT_PARENT}`);
    expect(squadSponsorInfraId(SHORT_PARENT)).toBe(`sponsor-${SHORT_PARENT}`);
    expect(squadAdminInfraId(SHORT_PARENT)).toBe(`squad-admin-${SHORT_PARENT}`);
  });

  it('hashes long parent ids to stay within SQLite limit', () => {
    expect(LONG_PARENT).toHaveLength(64);
    expect(`pacto-gov-${LONG_PARENT}`.length).toBeGreaterThan(SQUAD_INFRA_ID_MAX);

    const govId = pactoGovInfraId(LONG_PARENT);
    const treasuryId = pactoGovTreasuryEntryId(LONG_PARENT);
    const sponsorId = squadSponsorInfraId(LONG_PARENT);
    const adminId = squadAdminInfraId(LONG_PARENT);

    for (const id of [govId, treasuryId, sponsorId, adminId]) {
      expect(id.length).toBeLessThanOrEqual(SQUAD_INFRA_ID_MAX);
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }

    expect(govId).toMatch(/^pg-[a-f0-9]{64}$/);
    expect(treasuryId).toMatch(/^pgt-[a-f0-9]{64}$/);
    expect(sponsorId).toBe(`sponsor-${LONG_PARENT}`);
    expect(adminId).toMatch(/^sa-[a-f0-9]{64}$/);
  });

  it('is stable for the same parent id', () => {
    expect(pactoGovInfraId(LONG_PARENT)).toBe(pactoGovInfraId(LONG_PARENT));
    expect(pactoGovInfraId(`  ${LONG_PARENT}  `)).toBe(pactoGovInfraId(LONG_PARENT));
  });
});
