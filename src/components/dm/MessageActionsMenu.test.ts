// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import MessageActionsMenu from './MessageActionsMenu.svelte';

describe('MessageActionsMenu', () => {
  it('renders copy and reply actions', () => {
    render(MessageActionsMenu, { props: { messageId: 'msg-1', text: 'hello' } });
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeTruthy();
  });

  it('calls onCopy with message id and text', async () => {
    const onCopy = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-2', text: 'copy me', onCopy },
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith('msg-2', 'copy me');
  });

  it('calls onReply with message id', async () => {
    const onReply = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-3', text: 'reply to me', onReply },
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith('msg-3');
  });

  it('hides Edit unless the message is editable', () => {
    render(MessageActionsMenu, { props: { messageId: 'msg-4', text: 'hi' } });
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  });

  it('omits Save to Docs without a callback, as in DMs', () => {
    render(MessageActionsMenu, { props: { messageId: 'msg-6', text: 'see https://example.com/a' } });
    expect(screen.queryByRole('menuitem', { name: 'Save to Docs' })).toBeNull();
  });

  it('omits Save to Docs when the text has no http(s) link', () => {
    render(MessageActionsMenu, {
      props: { messageId: 'msg-7', text: 'no link, ftp://x.example/y', onSaveToDocs: vi.fn() },
    });
    expect(screen.queryByRole('menuitem', { name: 'Save to Docs' })).toBeNull();
  });

  it('places Save to Docs after Copy and before Reply and calls back with the text', async () => {
    const onSaveToDocs = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-8', text: 'notes https://example.com/a', onSaveToDocs },
    });
    const labels = screen.getAllByRole('menuitem').map((el) => el.getAttribute('aria-label'));
    expect(labels.slice(0, 3)).toEqual(['Copy', 'Save to Docs', 'Reply']);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Save to Docs' }));
    expect(onSaveToDocs).toHaveBeenCalledWith('msg-8', 'notes https://example.com/a');
  });

  it('labels Save to Docs from the messaging.message.saveToDocs key', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'MessageActionsMenu.svelte'), 'utf8');
    expect(source).toContain("$t('messaging.message.saveToDocs')");
    expect(source).not.toMatch(/>\s*Save to Docs\s*</);
  });

  it('is not wired from the DM thread', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(join(here, 'DmThread.svelte'), 'utf8')).not.toContain('onSaveToDocs');
  });

  it('calls onEdit with message id when Edit is shown', async () => {
    const onEdit = vi.fn();
    render(MessageActionsMenu, {
      props: { messageId: 'msg-5', text: 'hi', canEdit: true, onEdit },
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith('msg-5');
  });
});
