// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import DmThread from './DmThread.svelte';
import type { DmMessage } from '../../stores/dm';
import { invoke } from '@tauri-apps/api/core';

vi.mock('../../icons/smile-face.svg', () => ({ default: '/smile-face.svg' }));
vi.mock('../../icons/attachment.svg', () => ({ default: '/attachment.svg' }));
vi.mock('../../icons/image.svg', () => ({ default: '/image.svg' }));
vi.mock('../../icons/file.svg', () => ({ default: '/file.svg' }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockOnDragDropEvent = vi.fn(() => Promise.resolve(() => {}));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mockOnDragDropEvent }),
}));

function makeMessage(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: 'm1',
    content: 'hello',
    at: Date.now(),
    mine: false,
    ...overrides,
  } as DmMessage;
}

afterEach(() => {
  cleanup();
});

describe('DmThread read receipts', () => {
  it('marks the thread read once on open and does not refire on an unrelated re-render', async () => {
    const onMarkReadUpTo = vi.fn();
    render(DmThread, {
      props: {
        npub: 'npub1peer',
        messages: [makeMessage({ id: 'm1' })],
        onMarkReadUpTo,
      },
    });

    await waitFor(() => {
      expect(onMarkReadUpTo).toHaveBeenCalledTimes(1);
    });
    expect(onMarkReadUpTo).toHaveBeenCalledWith('m1');

    // Opening the options dropdown only flips local `menuOpen` state — the
    // read-receipt effect is keyed on `npub`/`messages`/the container ref and
    // must not refire just because something else in the component re-rendered.
    await fireEvent.click(screen.getByTitle('Options'));
    expect(onMarkReadUpTo).toHaveBeenCalledTimes(1);
  });
});

type Scroller = { scrollHeight: number; clientHeight: number; scrollTop: number };

/** jsdom has no layout; drive the scroller geometry explicitly. */
function stubScroller(el: HTMLElement, metrics: Scroller): Scroller {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => metrics.clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => metrics.scrollTop,
    set: (value: number) => {
      metrics.scrollTop = Math.max(0, Math.min(value, metrics.scrollHeight - metrics.clientHeight));
    },
  });
  return metrics;
}

describe('DmThread scroll-to-bottom effect', () => {
  it('does not touch scrollTop on an unrelated re-render, only when the message list actually changes', async () => {
    const onMarkReadUpTo = vi.fn();
    const { rerender } = render(DmThread, {
      props: {
        npub: 'npub1peer',
        messages: [makeMessage({ id: 'm1' })],
        onMarkReadUpTo,
      },
    });

    await waitFor(() => {
      expect(onMarkReadUpTo).toHaveBeenCalledTimes(1);
    });

    const container = document.querySelector('.dm-thread-messages') as HTMLDivElement;
    expect(container).not.toBeNull();
    const scrollTopSetter = vi.fn();
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: scrollTopSetter,
    });

    // Unrelated re-render: toggling the options menu must not re-run the
    // scroll-to-bottom effect (it depends on `dmMessagesContainer`/`messages`/
    // `npub` only).
    await fireEvent.click(screen.getByTitle('Options'));
    expect(scrollTopSetter).not.toHaveBeenCalled();

    // A genuine message-list change (same conversation) must still scroll.
    await rerender({
      npub: 'npub1peer',
      messages: [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2', content: 'second' })],
      onMarkReadUpTo,
    });
    await waitFor(() => {
      expect(scrollTopSetter).toHaveBeenCalled();
    });
  });

  it('follows an incoming message taller than the near-bottom threshold', async () => {
    const { rerender } = render(DmThread, {
      props: { npub: 'npub1peer', messages: [makeMessage({ id: 'm1' })] },
    });
    const container = document.querySelector('.dm-thread-messages') as HTMLDivElement;
    // Reader is parked at the bottom of a full viewport.
    const metrics = stubScroller(container, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });

    // A 400px-tall message lands: the post-append gap is far past the 100px
    // near-bottom threshold, so gap-based pinning would wrongly stay put.
    metrics.scrollHeight = 1400;
    await rerender({
      npub: 'npub1peer',
      messages: [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2', content: 'tall' })],
    });

    await waitFor(() => {
      expect(metrics.scrollTop).toBe(1000);
    });
    expect(document.querySelector('.dm-thread-jump')).toBeNull();
  });

  it('leaves a reader who scrolled up alone and offers a jump-to-latest pill', async () => {
    const { rerender } = render(DmThread, {
      props: { npub: 'npub1peer', messages: [makeMessage({ id: 'm1' })] },
    });
    const container = document.querySelector('.dm-thread-messages') as HTMLDivElement;
    const metrics = stubScroller(container, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    await fireEvent.scroll(container);

    metrics.scrollHeight = 1200;
    await rerender({
      npub: 'npub1peer',
      messages: [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2', content: 'incoming' })],
    });

    const jump = await screen.findByRole('button', { name: /1 new message/ });
    expect(metrics.scrollTop).toBe(0);

    await fireEvent.click(jump);
    expect(metrics.scrollTop).toBe(800);
    await waitFor(() => {
      expect(document.querySelector('.dm-thread-jump')).toBeNull();
    });
  });

  it('scrolls to the message the reader just sent even when scrolled up', async () => {
    const { rerender } = render(DmThread, {
      props: { npub: 'npub1peer', messages: [makeMessage({ id: 'm1' })] },
    });
    const container = document.querySelector('.dm-thread-messages') as HTMLDivElement;
    const metrics = stubScroller(container, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    await fireEvent.scroll(container);

    metrics.scrollHeight = 1200;
    await rerender({
      npub: 'npub1peer',
      messages: [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2', content: 'mine', mine: true })],
    });

    await waitFor(() => {
      expect(metrics.scrollTop).toBe(800);
    });
  });
});


describe('DmThread Up Arrow editing', () => {
  it('opens the latest eligible own text, focuses it and returns focus on cancel', async () => {
    render(DmThread, { props: { npub: 'npub1peer', messages: [
      makeMessage({ id: 'own', content: 'last eligible', mine: true, at: Date.now() - 2000 }),
      makeMessage({ id: 'older', content: 'older own', mine: true, at: Date.now() - 10000 }),
      makeMessage({ id: 'pending', content: 'pending own', mine: true, pending: true }),
      makeMessage({ id: 'theirs', content: 'incoming' }),
    ] } });
    const composer = screen.getByPlaceholderText(/Message #/);
    composer.focus();
    await fireEvent.keyDown(composer, { key: 'ArrowUp' });
    const editor = await screen.findByRole('textbox', { name: 'Edit message' });
    expect((editor as HTMLTextAreaElement).value).toBe('last eligible');
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(composer));
    await fireEvent.keyDown(composer, { key: 'ArrowUp' });
    expect(await screen.findByRole('textbox', { name: 'Edit message' })).toBeTruthy();
  });

  it('saves a shortcut edit through the existing edit command and restores composer focus', async () => {
    vi.mocked(invoke).mockResolvedValue('edit-id');
    const onSend = vi.fn();
    render(DmThread, { props: { npub: 'npub1peer', messages: [makeMessage({ id: 'own', content: 'typo', mine: true })], onSend } });
    const composer = screen.getByPlaceholderText(/Message #/);
    await fireEvent.keyDown(composer, { key: 'ArrowUp' });
    const editor = await screen.findByRole('textbox', { name: 'Edit message' });
    await fireEvent.input(editor, { target: { value: 'fixed' } });
    await fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('edit_message', { messageId: 'own', chatId: 'npub1peer', newContent: 'fixed' }));
    await waitFor(() => expect(document.activeElement).toBe(composer));
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not edit expired messages or keep a shortcut editor across a conversation switch', async () => {
    const { rerender } = render(DmThread, { props: { npub: 'npub1peer', messages: [
      makeMessage({ id: 'own', content: 'old text', mine: true, at: Date.now() - 120000 }),
    ] } });
    await fireEvent.keyDown(screen.getByPlaceholderText(/Message #/), { key: 'ArrowUp' });
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    await rerender({ npub: 'npub1peer', messages: [makeMessage({ id: 'own', content: 'recent', mine: true })] });
    await fireEvent.keyDown(screen.getByPlaceholderText(/Message #/), { key: 'ArrowUp' });
    expect(await screen.findByRole('textbox', { name: 'Edit message' })).toBeTruthy();
    await rerender({ npub: 'npub1other', messages: [makeMessage({ id: 'other-own', content: 'other chat', mine: true })] });
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    await fireEvent.keyDown(screen.getByPlaceholderText(/Message #/), { key: 'ArrowUp' });
    expect((await screen.findByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement).value).toBe('other chat');
  });
});
