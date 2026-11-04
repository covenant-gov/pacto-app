// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import AddDocModal from './AddDocModal.svelte';

const PREFILL = { url: 'https://cryptpad.fr/pad/#/2/pad/edit/k', title: 'Pad', channelId: 'g-leads', note: null };

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(null);
});

afterEach(() => cleanup());

function sendCalls(): unknown[][] {
  return invoke.mock.calls.filter(([c]) => c === 'send_squad_doc_add' || c === 'send_squad_doc_update');
}

describe('AddDocModal', () => {
  it('blocks a private-channel save until the whole-squad confirm is checked', async () => {
    const onclose = vi.fn();
    render(AddDocModal, {
      props: { open: true, mlsGroupId: 'g-ann', parentId: 'p', initial: PREFILL, requireSquadConfirm: true, onclose },
    });
    const submit = screen.getByRole('button', { name: 'Add doc' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await fireEvent.submit(submit.closest('form') as HTMLFormElement);
    expect(sendCalls()).toHaveLength(0);

    await fireEvent.click(screen.getByRole('checkbox', { name: /Everyone in the squad will be able to open it/ }));
    expect(submit.disabled).toBe(false);
    await fireEvent.click(submit);
    await waitFor(() => expect(sendCalls()).toHaveLength(1));
    expect(sendCalls()[0]).toEqual([
      'send_squad_doc_add',
      { mlsGroupId: 'g-ann', parentId: 'p', docId: expect.any(String), doc: PREFILL },
    ]);
    await waitFor(() => expect(onclose).toHaveBeenCalled());
  });

  it('sends without a confirm from the announcements group', async () => {
    render(AddDocModal, { props: { open: true, mlsGroupId: 'g-ann', parentId: 'p', initial: PREFILL, onclose: vi.fn() } });
    expect(screen.queryByRole('checkbox')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Add doc' }));
    await waitFor(() => expect(sendCalls()).toHaveLength(1));
  });

  it('rejects a non-http link without sending', async () => {
    render(AddDocModal, {
      props: { open: true, mlsGroupId: 'g-ann', parentId: 'p', initial: { ...PREFILL, url: 'ftp://x' }, onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add doc' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(sendCalls()).toHaveLength(0);
  });

  it('reuses the row id on edit', async () => {
    const editing = {
      id: 'd1',
      parentId: 'p',
      mlsGroupId: 'g-ann',
      url: 'https://example.com/a',
      title: 'A',
      provider: 'other' as const,
      channelId: null,
      note: 'n',
      authorNpub: 'npub1a',
      createdAtMs: 1,
      updatedAtMs: 1,
      updatedByNpub: 'npub1a',
      canEdit: true,
    };
    render(AddDocModal, { props: { open: true, mlsGroupId: 'g-ann', parentId: 'p', editing, onclose: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sendCalls()).toHaveLength(1));
    expect(sendCalls()[0]).toEqual([
      'send_squad_doc_update',
      {
        mlsGroupId: 'g-ann',
        parentId: 'p',
        docId: 'd1',
        doc: { url: 'https://example.com/a', title: 'A', channelId: null, note: 'n' },
      },
    ]);
  });
});
