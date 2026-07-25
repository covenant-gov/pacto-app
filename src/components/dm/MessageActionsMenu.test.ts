// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MessageActionsMenu from './MessageActionsMenu.svelte';

describe('MessageActionsMenu', () => {
  it('renders copy and reply actions', () => {
    render(MessageActionsMenu, { props: { messageId: 'msg-1', text: 'hello' } });
    expect(screen.getByRole('menuitem', { name: 'Copy message' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reply to message' })).toBeTruthy();
  });

  it('dispatches copy with message id and text', async () => {
    const onCopy = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-2', text: 'copy me' },
      events: { copy: onCopy },
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy message' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    const event = onCopy.mock.calls[0][0];
    expect(event.detail).toEqual({ messageId: 'msg-2', text: 'copy me' });
  });

  it('dispatches reply with message id', async () => {
    const onReply = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-3', text: 'reply to me' },
      events: { reply: onReply },
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Reply to message' }));
    expect(onReply).toHaveBeenCalledTimes(1);
    const event = onReply.mock.calls[0][0];
    expect(event.detail).toEqual({ messageId: 'msg-3' });
  });
});
