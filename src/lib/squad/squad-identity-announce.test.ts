import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Squad } from '../../stores/squads';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(() => ({
    name: 'announcements',
    groupId: 'ann-gid',
    order: 0,
  })),
}));

vi.mock('./squad-catalog', () => ({
  persistSquadPatch: vi.fn(async (parentId: string, patch: (s: Squad) => Squad) => {
    const { squads } = await import('../../stores/squads');
    const current = get(squads).find((s) => s.id === parentId);
    if (!current) return null;
    const next = patch(current);
    squads.update((list) => list.map((s) => (s.id === parentId ? next : s)));
    return next;
  }),
}));

vi.mock('../../stores/squads', async () => {
  const { writable } = await import('svelte/store');
  const parent: Squad = {
    id: 'ann-gid',
    name: 'Alpha',
    channels: [{ name: 'announcements', groupId: 'ann-gid', order: 0 }],
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    squads: writable<Squad[]>([parent]),
  };
});

import { sendDmMessage } from '../api/nostr';
import { persistSquadPatch } from './squad-catalog';
import { squads } from '../../stores/squads';
import {
  SQUAD_IDENTITY_UPDATED_TYPE,
  applySquadIdentityUpdated,
  formatSquadIdentityUpdated,
  parseSquadIdentityUpdated,
  publishSquadIdentityUpdated,
} from './squad-identity-announce';

const parentFixture = (): Squad => ({
  id: 'ann-gid',
  name: 'Alpha',
  iconUrl: 'https://cdn.example/a.jpg',
  channels: [{ name: 'announcements', groupId: 'ann-gid', order: 0 }],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
});

describe('squad identity announce', () => {
  beforeEach(() => {
    squads.set([parentFixture()]);
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(persistSquadPatch).mockClear();
  });

  afterEach(() => {
    squads.set([parentFixture()]);
  });

  it('formats and parses icon_url', () => {
    const raw = formatSquadIdentityUpdated({
      parent_id: 'ann-gid',
      icon_url: 'https://cdn.example/a.jpg',
    });
    expect(JSON.parse(raw)).toMatchObject({
      type: SQUAD_IDENTITY_UPDATED_TYPE,
      pacto_virtual_bucket: 'announcements',
      payload: { parent_id: 'ann-gid', icon_url: 'https://cdn.example/a.jpg' },
    });
    expect(parseSquadIdentityUpdated(raw)).toEqual({
      parent_id: 'ann-gid',
      icon_url: 'https://cdn.example/a.jpg',
    });
  });

  it('treats blank icon_url as clear', () => {
    const raw = formatSquadIdentityUpdated({ parent_id: 'ann-gid', icon_url: '  ' });
    expect(parseSquadIdentityUpdated(raw)?.icon_url).toBeNull();
    expect(parseSquadIdentityUpdated(JSON.stringify({ type: SQUAD_IDENTITY_UPDATED_TYPE, payload: { parent_id: 'ann-gid', icon_url: null } }))?.icon_url).toBeNull();
  });

  it('rejects non-https icon_url', () => {
    expect(
      parseSquadIdentityUpdated(
        JSON.stringify({
          type: SQUAD_IDENTITY_UPDATED_TYPE,
          payload: { parent_id: 'ann-gid', icon_url: 'http://cdn.example/a.jpg' },
        }),
      )?.icon_url,
    ).toBeNull();
    expect(
      parseSquadIdentityUpdated(
        JSON.stringify({
          type: SQUAD_IDENTITY_UPDATED_TYPE,
          payload: { parent_id: 'ann-gid', icon_url: 'data:image/png;base64,abcd' },
        }),
      )?.icon_url,
    ).toBeNull();
    expect(
      formatSquadIdentityUpdated({ parent_id: 'ann-gid', icon_url: 'http://evil.example/x' }),
    ).toContain('"icon_url":null');
  });

  it('rejects bad envelopes', () => {
    expect(parseSquadIdentityUpdated(null)).toBeNull();
    expect(parseSquadIdentityUpdated('plain')).toBeNull();
    expect(parseSquadIdentityUpdated(JSON.stringify({ type: 'other', payload: { parent_id: 'x' } }))).toBeNull();
    expect(parseSquadIdentityUpdated(JSON.stringify({ type: SQUAD_IDENTITY_UPDATED_TYPE, payload: {} }))).toBeNull();
  });

  it('apply writes iconUrl and clear removes it', async () => {
    applySquadIdentityUpdated(
      formatSquadIdentityUpdated({ parent_id: 'ann-gid', icon_url: 'https://cdn.example/b.jpg' }),
      'ann-gid',
    );
    await vi.waitFor(() => {
      expect(get(squads)[0]?.iconUrl).toBe('https://cdn.example/b.jpg');
    });
    applySquadIdentityUpdated(
      formatSquadIdentityUpdated({ parent_id: 'ann-gid', icon_url: null }),
      'ann-gid',
    );
    await vi.waitFor(() => {
      expect(get(squads)[0]?.iconUrl).toBeUndefined();
    });
  });

  it('apply ignores parent_id mismatch', () => {
    applySquadIdentityUpdated(
      formatSquadIdentityUpdated({ parent_id: 'other', icon_url: 'https://cdn.example/x.jpg' }),
      'ann-gid',
    );
    expect(persistSquadPatch).not.toHaveBeenCalled();
  });

  it('publish sends announcements bucket message', async () => {
    await publishSquadIdentityUpdated(parentFixture());
    expect(sendDmMessage).toHaveBeenCalledWith(
      'ann-gid',
      expect.stringContaining(SQUAD_IDENTITY_UPDATED_TYPE),
      '',
      { virtualBucket: 'announcements' },
    );
  });
});
