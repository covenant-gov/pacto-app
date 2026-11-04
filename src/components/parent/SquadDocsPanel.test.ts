// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { SquadDocDto } from '../../lib/api/squad-docs';
import type { SquadContentPolicyView } from '../../lib/api/squad-content-policy';

const state = vi.hoisted(() => ({
  docs: [] as unknown[],
  policy: null as unknown,
  invoke: vi.fn(),
  openExternalUrl: vi.fn(),
  copyTextToClipboard: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../../lib/utils/open-external', () => ({ openExternalUrl: state.openExternalUrl }));
vi.mock('../../lib/utils/clipboard-copy', () => ({ copyTextToClipboard: state.copyTextToClipboard }));

import SquadDocsPanel from './SquadDocsPanel.svelte';
import { docsFocus } from '../../stores/docs-navigation';
import { squads, type Squad } from '../../stores/squads';

const PAD = 'https://cryptpad.fr/pad/#/2/pad/edit/secret';

function doc(id: string, title: string, overrides: Partial<SquadDocDto> = {}): SquadDocDto {
  return {
    id,
    parentId: 'p',
    mlsGroupId: 'g',
    url: `https://example.com/${id}`,
    title,
    provider: 'other',
    channelId: null,
    note: null,
    authorNpub: 'npub1a',
    createdAtMs: 1,
    updatedAtMs: 1,
    updatedByNpub: 'npub1a',
    canEdit: false,
    ...overrides,
  };
}

function policy(overrides: Partial<SquadContentPolicyView> = {}): SquadContentPolicyView {
  return {
    restrictEventCreate: false,
    restrictEventCreateUpdatedAtMs: 0,
    restrictDocAdd: false,
    restrictDocAddUpdatedAtMs: 0,
    callerIsAdmin: false,
    adminIsMember: true,
    ...overrides,
  };
}

function titles(): string[] {
  return screen.getAllByRole('button', { name: /^Open .* in your browser$/ }).map((b) => b.textContent?.trim() ?? '');
}

beforeEach(() => {
  state.invoke.mockReset().mockImplementation((command: string) => {
    if (command === 'list_squad_docs') return Promise.resolve(state.docs);
    if (command === 'get_squad_content_policy') return Promise.resolve(state.policy);
    return Promise.resolve(null);
  });
  state.openExternalUrl.mockReset();
  state.copyTextToClipboard.mockReset().mockResolvedValue(true);
  state.policy = policy();
  squads.set([
    {
      id: 'p',
      name: 'Crew',
      channels: [
        { name: 'announcements', groupId: 'g', order: 0 },
        { name: 'general', groupId: 'g-gen', order: 4 },
      ],
      kind: 'squad',
    } as unknown as Squad,
  ]);
});

afterEach(() => {
  cleanup();
  docsFocus.set(null);
  squads.set([]);
});

describe('SquadDocsPanel', () => {
  it('lists the newest updated row first', async () => {
    state.docs = [doc('d1', 'Old', { updatedAtMs: 10 }), doc('d2', 'New', { updatedAtMs: 20 })];
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText('New');
    expect(titles()).toEqual(['New', 'Old']);
  });

  it('filters Untagged to rows without a channel and excludes a tagged row', async () => {
    state.docs = [doc('d1', 'Tagged', { channelId: 'g-gen' }), doc('d2', 'Loose')];
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText('Tagged');
    await fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'untagged' } });
    expect(titles()).toEqual(['Loose']);
  });

  it('opens pre-filtered to one channel from a channel shortcut', async () => {
    state.docs = [doc('d1', 'Tagged', { channelId: 'g-gen' }), doc('d2', 'Loose')];
    docsFocus.set({ parentId: 'p', docId: null, channelId: 'g-gen' });
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText('Tagged');
    expect(titles()).toEqual(['Tagged']);
    expect((screen.getByLabelText('Show') as HTMLSelectElement).value).toBe('channel:g-gen');
  });

  it('opens the raw URL from the title, reveals the masked URL in place, and copies the raw URL', async () => {
    state.docs = [doc('d1', 'Pad', { url: PAD, provider: 'cryptpad' })];
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    const masked = await screen.findByRole('button', { name: 'Show the full link' });
    expect(masked.textContent?.trim()).toBe('https://cryptpad.fr/pad/#••••');

    await fireEvent.click(masked);
    expect(masked.textContent?.trim()).toBe(PAD);
    expect(state.openExternalUrl).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Open Pad in your browser' }));
    expect(state.openExternalUrl).toHaveBeenCalledWith(PAD);

    await fireEvent.click(screen.getByRole('button', { name: 'Copy the full link for Pad' }));
    expect(state.copyTextToClipboard).toHaveBeenCalledWith(PAD);
    expect(state.invoke.mock.calls.map(([c]) => c)).not.toContain('fetch_msg_metadata');
  });

  it('shows the note, provider, and channel tag', async () => {
    state.docs = [doc('d1', 'Pad', { provider: 'cryptpad', channelId: 'g-gen', note: 'Weekly notes' })];
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    const card = (await screen.findByText('Pad')).closest('li') as HTMLElement;
    expect(within(card).getByText('CryptPad')).toBeTruthy();
    expect(within(card).getByText('#general')).toBeTruthy();
    expect(within(card).getByText('Weekly notes')).toBeTruthy();
  });

  it('has no edit or remove control for a non-author non-admin', async () => {
    state.docs = [doc('d1', 'Pad', { canEdit: false })];
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText('Pad');
    expect(screen.queryByRole('button', { name: 'Edit Pad' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Pad' })).toBeNull();
  });

  it('removes only after the confirm for the author or an admin', async () => {
    state.docs = [doc('d1', 'Pad', { canEdit: true })];
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    expect(await screen.findByRole('button', { name: 'Edit Pad' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Pad' }));
    expect(state.invoke).not.toHaveBeenCalledWith('send_squad_doc_remove', expect.anything());
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(state.invoke).toHaveBeenCalledWith('send_squad_doc_remove', { mlsGroupId: 'g', parentId: 'p', docId: 'd1' })
    );
  });

  it('has no add button when restricted and the caller is not an admin', async () => {
    state.docs = [];
    state.policy = policy({ restrictDocAdd: true });
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText('Only squad admins can add docs.');
    expect(screen.queryByRole('button', { name: 'Add doc' })).toBeNull();
  });

  it('says nobody can add when no admin is still a member', async () => {
    state.policy = policy({ restrictDocAdd: true, adminIsMember: false });
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText(/Nobody can add docs/);
    expect(screen.queryByRole('button', { name: 'Add doc' })).toBeNull();
  });

  it('shows the add button and the join-history empty copy when open', async () => {
    state.docs = [];
    render(SquadDocsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add doc' })).toBeTruthy());
    expect(screen.getByText(/before you joined/)).toBeTruthy();
  });
});
