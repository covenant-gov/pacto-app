// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { SquadDocDto } from '../../lib/api/squad-docs';

const mocks = vi.hoisted(() => ({
  docs: [] as unknown[],
  invoke: vi.fn(),
  openSquadDocs: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../../stores/docs-navigation', () => ({ openSquadDocs: mocks.openSquadDocs }));

import SaveToDocsDialog from './SaveToDocsDialog.svelte';

const PAD = 'https://cryptpad.fr/pad/#/2/pad/edit/secret';

function existing(canEdit: boolean): SquadDocDto {
  return {
    id: 'd1',
    parentId: 'p',
    mlsGroupId: 'g-ann',
    url: PAD,
    title: 'Pad',
    provider: 'cryptpad',
    channelId: null,
    note: null,
    authorNpub: 'npub1author',
    createdAtMs: 1,
    updatedAtMs: 1,
    updatedByNpub: 'npub1author',
    canEdit,
  };
}

function sends(): string[] {
  return mocks.invoke.mock.calls.map(([c]) => c as string).filter((c) => c.startsWith('send_squad_doc_'));
}

beforeEach(() => {
  mocks.docs = [];
  mocks.invoke.mockReset().mockImplementation((command: string) => {
    if (command === 'list_squad_docs') return Promise.resolve(mocks.docs);
    return Promise.resolve(null);
  });
  mocks.openSquadDocs.mockReset();
});

afterEach(() => cleanup());

describe('SaveToDocsDialog', () => {
  it('opens the add form prefilled from a single link', async () => {
    render(SaveToDocsDialog, {
      props: { parentId: 'p', announcementsGroupId: 'g-ann', text: `see ${PAD}`, channelGroupId: 'g-ann', onclose: vi.fn() },
    });
    expect(((await screen.findByLabelText('Link')) as HTMLInputElement).value).toBe(PAD);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('cryptpad.fr');
    expect(mocks.invoke.mock.calls.map(([c]) => c)).not.toContain('fetch_msg_metadata');
  });

  it('asks which link when there are two and sends nothing until one is chosen', async () => {
    render(SaveToDocsDialog, {
      props: {
        parentId: 'p',
        announcementsGroupId: 'g-ann',
        text: 'https://a.example/x and https://b.example/y',
        channelGroupId: 'g-ann',
        onclose: vi.fn(),
      },
    });
    await screen.findByText('Save which link?');
    expect(screen.getByText('https://a.example/x')).toBeTruthy();
    expect(sends()).toEqual([]);
    await fireEvent.click(screen.getByText('https://b.example/y'));
    expect(((await screen.findByLabelText('Link')) as HTMLInputElement).value).toBe('https://b.example/y');
    expect(sends()).toEqual([]);
  });

  it('requires the whole-squad confirm for a link from a private channel', async () => {
    render(SaveToDocsDialog, {
      props: { parentId: 'p', announcementsGroupId: 'g-ann', text: PAD, channelGroupId: 'g-leads', onclose: vi.fn() },
    });
    expect(await screen.findByRole('checkbox', { name: /Everyone in the squad/ })).toBeTruthy();
  });

  it('opens the existing row and sends nothing when the caller cannot edit it', async () => {
    mocks.docs = [existing(false)];
    const onclose = vi.fn();
    render(SaveToDocsDialog, {
      props: { parentId: 'p', announcementsGroupId: 'g-ann', text: PAD, channelGroupId: 'g-ann', onclose },
    });
    await waitFor(() => expect(mocks.openSquadDocs).toHaveBeenCalledWith('p', { docId: 'd1' }));
    expect(onclose).toHaveBeenCalled();
    expect(sends()).toEqual([]);
    expect(screen.queryByLabelText('Link')).toBeNull();
  });

  it('edits the existing row for its author, reusing the id', async () => {
    mocks.docs = [existing(true)];
    render(SaveToDocsDialog, {
      props: { parentId: 'p', announcementsGroupId: 'g-ann', text: PAD, channelGroupId: 'g-ann', onclose: vi.fn() },
    });
    await screen.findByText('Edit doc');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('send_squad_doc_update', expect.objectContaining({ docId: 'd1' }))
    );
  });
});
