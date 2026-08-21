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

  it('calls onCopy with message id and text', async () => {
    const onCopy = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-2', text: 'copy me', onCopy },
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy message' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith('msg-2', 'copy me');
  });

  it('calls onReply with message id', async () => {
    const onReply = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-3', text: 'reply to me', onReply },
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Reply to message' }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith('msg-3');
  });
});
