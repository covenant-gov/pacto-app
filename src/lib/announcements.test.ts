import { describe, expect, it } from 'vitest';
import {
  ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
  buildAnnounceContent,
} from './announcements';

describe('buildAnnounceContent', () => {
  it('sets pacto_virtual_bucket inbox for governance-safe automation', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'gnosis_safe', canonical_ref: '0x1' },
    });
    const o = JSON.parse(s) as { pacto_virtual_bucket?: string };
    expect(o.pacto_virtual_bucket).toBe('inbox');
  });

  it('sets pacto_virtual_bucket announcements for squad sponsor deploy', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'sponsor', canonical_ref: '0x1' },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('sets pacto_virtual_bucket announcements for pacto_gov deploy', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'pacto_gov', canonical_ref: '3519' },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('sets pacto_virtual_bucket announcements for dashboard_poll_created', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
      payload: {
        parent_id: 'p',
        poll_id: 'poll',
        title: 'T',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('preserves type and payload', () => {
    const payload = { squad_id: 's', safe_address: '0xabc' };
    const s = buildAnnounceContent({ type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED, payload });
    expect(JSON.parse(s)).toMatchObject({ type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED, payload });
  });
});
