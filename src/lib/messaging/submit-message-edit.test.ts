import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  editMessage: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../api/nostr', () => ({ editMessage: mocks.editMessage }));
vi.mock('../../stores/toast', () => ({ showToast: mocks.showToast }));

import { submitMessageEdit } from './submit-message-edit';
import type { DmMessage } from '../../stores/dm';

const msg: DmMessage = { id: 'm1', content: 'helo', at: Date.now(), mine: true };

beforeEach(() => {
  mocks.editMessage.mockReset();
  mocks.showToast.mockReset();
});

describe('submitMessageEdit', () => {
  it('sends the edit for the chat and closes the editor', async () => {
    mocks.editMessage.mockResolvedValue('edit-id');
    await expect(submitMessageEdit('npub1peer', msg, 'hello')).resolves.toBe(true);
    expect(mocks.editMessage).toHaveBeenCalledWith('m1', 'npub1peer', 'hello');
  });

  it('closes without sending when nothing changed', async () => {
    await expect(submitMessageEdit('npub1peer', msg, 'helo')).resolves.toBe(true);
    expect(mocks.editMessage).not.toHaveBeenCalled();
  });

  it('keeps the editor open on an empty draft or missing message', async () => {
    await expect(submitMessageEdit('npub1peer', msg, '  ')).resolves.toBe(false);
    await expect(submitMessageEdit('npub1peer', undefined, 'hello')).resolves.toBe(false);
    expect(mocks.editMessage).not.toHaveBeenCalled();
  });

  it('toasts and keeps the editor open when the backend rejects', async () => {
    mocks.editMessage.mockRejectedValue('edit window closed');
    await expect(submitMessageEdit('group1', msg, 'hello')).resolves.toBe(false);
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Messages can only be edited for 1 minute after sending'
    );
  });
});
