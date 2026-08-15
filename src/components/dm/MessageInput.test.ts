// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { get } from 'svelte/store';
import MessageInput from './MessageInput.svelte';
import { pendingFilePreview, clearPendingAttachment, type PendingFileAttachment } from '../../lib/messaging/attachment-composer';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import { stickerPacks } from '../../stores/stickers';
import type { StickerPack } from '../../lib/api/stickers';
import { invoke, type InvokeArgs } from '@tauri-apps/api/core';

vi.mock('../../icons/smile-face.svg', () => ({ default: '/smile-face.svg' }));
vi.mock('../../icons/attachment.svg', () => ({ default: '/attachment.svg' }));
vi.mock('../../icons/image.svg', () => ({ default: '/image.svg' }));
vi.mock('../../icons/file.svg', () => ({ default: '/file.svg' }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedOpen = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockedOpen(...args),
}));

const mockedReadFile = vi.fn();
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: (...args: unknown[]) => mockedReadFile(...args),
}));

const mockOnDragDropEvent = vi.fn(() => Promise.resolve(() => {}));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mockOnDragDropEvent }),
}));

type IOEntry = { isIntersecting: boolean; target: Element };
type IOCallback = (entries: IOEntry[]) => void;

/** Records every IntersectionObserver the sticker-tile `use:stickerVisible` action creates,
 * so a test can simulate a tile scrolling into view without a real layout engine. */
class FakeIntersectionObserver {
  callback: IOCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: IOCallback) {
    this.callback = callback;
    ioInstances.push(this);
  }
}
let ioInstances: FakeIntersectionObserver[] = [];

beforeEach(() => {
  cleanup();
  clearPendingAttachment();
  mockedOpen.mockReset();
  (window as Window & { __TAURI__?: unknown }).__TAURI__ = {};
  setCurrentNpubForPersistence('npub1test');
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob://mock-preview'),
    revokeObjectURL: vi.fn(),
  });
  ioInstances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  // Unmount while the URL stub is still active: a GIF thumbnail fetch in flight can
  // resolve during teardown and call revokeObjectURL, which jsdom's real URL lacks.
  cleanup();
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  localStorage.clear();
  stickerPacks.set([]);
});

describe('MessageInput', () => {
  it('renders composer controls and disabled send when empty', () => {
    render(MessageInput, { props: { channelName: 'general' } });
    expect(screen.queryByLabelText(/Attach file/i)).not.toBeNull();
    expect(screen.queryByLabelText(/Insert emoji or GIF/i)).not.toBeNull();
    expect(screen.queryByPlaceholderText('Message #general')).not.toBeNull();
    expect((screen.getByLabelText(/Send message/i) as HTMLButtonElement).disabled).toBe(true);
  });

  it('types text and calls onSend when Enter is pressed', async () => {
    const onSend = vi.fn();
    render(MessageInput, { props: { channelName: 'general', onSend } });
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: 'hello world' } });
    await fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello world', undefined);
    });
    expect(input.value).toBe('');
  });

  it('forwards repliedTo to onSend when replying to a message', async () => {
    const onSend = vi.fn();
    render(MessageInput, { props: { channelName: 'general', onSend, repliedTo: 'msg-123' } });
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: 'hello world' } });
    await fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello world', 'msg-123');
    });
  });

  it('opens the attachment menu when paperclip is clicked', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    const attachBtn = screen.getByLabelText(/Attach file/i);
    await fireEvent.click(attachBtn);
    expect(screen.queryByRole('menu', { name: /Attachment options/i })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Photo or Video/i })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: /File/i })).not.toBeNull();
  });

  it('opens the emoji panel when emoji button is clicked', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    const emojiBtn = screen.getByLabelText(/Insert emoji or GIF/i);
    await fireEvent.click(emojiBtn);
    expect(screen.queryByRole('dialog', { name: /Insert emoji or GIF/i })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Emoji/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /GIFs/i }).getAttribute('aria-selected')).toBe('false');
  });

  it('gates the GIFs tab behind the disclosure until it is accepted', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    await fireEvent.click(screen.getByLabelText(/Insert emoji or GIF/i));
    await fireEvent.click(screen.getByRole('tab', { name: /GIFs/i }));
    expect(screen.getByRole('tab', { name: /GIFs/i }).getAttribute('aria-selected')).toBe('true');
    // Nothing may reach Klipy until the user accepts; the tab shows the disclosure.
    expect(screen.queryByRole('button', { name: /Enable GIF search/i })).not.toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('klipy_search_gifs', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('klipy_trending_gifs', expect.anything());
  });

  it('closes panels on Escape and refocuses the composer', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    await fireEvent.click(screen.getByLabelText(/Attach file/i));
    expect(screen.queryByRole('menu')).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('does not open panels when disabled', async () => {
    render(MessageInput, { props: { channelName: 'general', disabled: true } });
    const attachBtn = screen.getByLabelText(/Attach file/i) as HTMLButtonElement;
    expect(attachBtn.disabled).toBe(true);
    await fireEvent.click(attachBtn);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables send while an attachment is sending', async () => {
    let resolveSend: (() => void) | undefined;
    const onSendFile = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveSend = resolve;
      }),
    );
    render(MessageInput, {
      props: {
        channelName: 'general',
        onSendFile,
      },
    });
    pendingFilePreview.set({
      id: 'pending',
      key: '',
      nonce: '',
      extension: 'png',
      url: '',
      path: '',
      size: 1024,
      fileName: 'test.png',
      previewUrl: '',
      mimeType: 'image/png',
      file: new File(['bytes'], 'test.png', { type: 'image/png' }),
    } as PendingFileAttachment);
    const sendBtn = screen.getByLabelText(/Send message/i) as HTMLButtonElement;
    await fireEvent.click(sendBtn);
    expect(sendBtn.disabled).toBe(true);
    resolveSend?.();
    await waitFor(() => {
      expect(sendBtn.disabled).toBe(true);
    });
    expect(onSendFile).toHaveBeenCalled();
  });

  it('sets the pending attachment when an image is pasted', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [file] }, configurable: true });
    await fireEvent(input, pasteEvent);
    expect(get(pendingFilePreview)?.fileName).toBe('screenshot.png');
  });

  it('does nothing when pasting without files', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [] }, configurable: true });
    await fireEvent(input, pasteEvent);
    expect(get(pendingFilePreview)).toBeNull();
  });

  it('does not show a camera option when the desktop file picker is available', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    await fireEvent.click(screen.getByLabelText(/Attach file/i));
    expect(screen.queryByRole('menuitem', { name: /Take Photo/i })).toBeNull();
  });

  it('shows a camera option when the desktop file picker is unavailable', async () => {
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
    render(MessageInput, { props: { channelName: 'general' } });
    await fireEvent.click(screen.getByLabelText(/Attach file/i));
    expect(screen.queryByRole('menuitem', { name: /Take Photo/i })).not.toBeNull();
  });

  it('grows the textarea with content and caps at 240px', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 96 });
    await fireEvent.input(input, { target: { value: 'line one\nline two\nline three' } });
    expect(input.style.height).toBe('96px');

    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 400 });
    await fireEvent.input(input, { target: { value: 'a\n'.repeat(40) } });
    expect(input.style.height).toBe('240px');
  });

  it('clears inline height after send so the empty composer stays single-line', async () => {
    const onSend = vi.fn();
    render(MessageInput, { props: { channelName: 'general', onSend } });
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 120 });
    await fireEvent.input(input, { target: { value: 'hello\nworld' } });
    expect(input.style.height).toBe('120px');

    await fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(input.style.height).toBe('');
    });
  });

  it('leaves height unset when the draft is empty', async () => {
    render(MessageInput, { props: { channelName: 'general' } });
    const input = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 96 });
    await fireEvent.input(input, { target: { value: '' } });
    expect(input.style.height).toBe('');
  });

  it('sends a selected GIF through onSendGif with the byte-identical url and slug, and fires the share-trigger', async () => {
    const onSendGif = vi.fn().mockResolvedValue(undefined);
    const fullUrl = 'https://static.klipy.com/hd.gif?ext=gif&itemid=abc123';
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'klipy_is_configured') return Promise.resolve(true);
      if (cmd === 'klipy_trending_gifs') {
        return Promise.resolve({
          items: [
            {
              id: '1',
              slug: 'gif-1',
              title: 'Cat',
              previewUrl: 'https://static.klipy.com/sm.gif',
              fullUrl,
              width: 100,
              height: 100,
            },
          ],
          page: 1,
          perPage: 24,
          total: 1,
          hasMore: false,
        });
      }
      if (cmd === 'klipy_report_share') return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    render(MessageInput, { props: { channelName: 'general', onSendGif, repliedTo: 'msg-1' } });
    await fireEvent.click(screen.getByLabelText(/Insert emoji or GIF/i));
    await fireEvent.click(screen.getByRole('tab', { name: /GIFs/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Enable GIF search/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Cat')).not.toBeNull();
    });
    await fireEvent.click(screen.getByLabelText('Cat'));

    await waitFor(() => {
      expect(onSendGif).toHaveBeenCalledWith(fullUrl, 'gif-1', 'msg-1');
    });
    expect(invoke).toHaveBeenCalledWith('klipy_report_share', { slug: 'gif-1', query: null });
  });

  it('does nothing when a GIF is picked but no onSendGif handler is wired', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'klipy_is_configured') return Promise.resolve(true);
      if (cmd === 'klipy_trending_gifs') {
        return Promise.resolve({
          items: [
            {
              id: '1',
              slug: 'gif-1',
              title: 'Cat',
              previewUrl: 'https://static.klipy.com/sm.gif',
              fullUrl: 'https://static.klipy.com/hd.gif',
              width: 100,
              height: 100,
            },
          ],
          page: 1,
          perPage: 24,
          total: 1,
          hasMore: false,
        });
      }
      if (cmd === 'klipy_report_share') return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    render(MessageInput, { props: { channelName: 'general' } });
    await fireEvent.click(screen.getByLabelText(/Insert emoji or GIF/i));
    await fireEvent.click(screen.getByRole('tab', { name: /GIFs/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Enable GIF search/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Cat')).not.toBeNull();
    });
    // Reporting the share still fires (analytics), but nothing throws without onSendGif.
    await expect(fireEvent.click(screen.getByLabelText('Cat'))).resolves.not.toThrow();
  });

  it('routes GIF picker thumbnails through klipy_fetch_media and renders a blob URL, never the raw previewUrl', async () => {
    const previewUrl = 'https://static.klipy.com/sm.gif';
    const fullUrl = 'https://static.klipy.com/hd.gif';
    vi.mocked(invoke).mockImplementation((cmd: string, args?: InvokeArgs) => {
      if (cmd === 'klipy_is_configured') return Promise.resolve(true);
      if (cmd === 'klipy_trending_gifs') {
        return Promise.resolve({
          items: [{ id: '1', slug: 'gif-1', title: 'Cat', previewUrl, fullUrl, width: 100, height: 100 }],
          page: 1,
          perPage: 24,
          total: 1,
          hasMore: false,
        });
      }
      if (cmd === 'klipy_fetch_media') {
        expect(args).toEqual({ url: previewUrl });
        return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
      }
      return Promise.resolve(undefined);
    });

    render(MessageInput, { props: { channelName: 'general' } });
    await fireEvent.click(screen.getByLabelText(/Insert emoji or GIF/i));
    await fireEvent.click(screen.getByRole('tab', { name: /GIFs/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Enable GIF search/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Cat')).not.toBeNull();
    });
    // The tile starts blank (no <img>) until the thumbnail resolves through the chokepoint.
    expect(screen.getByLabelText('Cat').querySelector('img')).toBeNull();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('klipy_fetch_media', { url: previewUrl });
    });
    await waitFor(() => {
      const img = screen.getByLabelText('Cat').querySelector('img');
      expect(img?.getAttribute('src')).toBe('blob://mock-preview');
    });
  });

  it('does not eagerly prefetch every sticker on tab open; fetches lazily once a tile intersects', async () => {
    const entry = { shortcode: 'wave', url: 'https://blossom.example/wave.png', key: 'aa', nonce: 'bb', mime: 'image/png', size: 100 };
    stickerPacks.set([
      {
        squadId: 'squad1',
        packId: 'pack1',
        name: 'Pack One',
        entries: [entry],
        updatedAt: 0,
        updatedBy: 'npub1test',
        deleted: false,
      } as StickerPack,
    ]);
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'fetch_sticker_image') return Promise.resolve('/tmp/cached-wave.png');
      return Promise.resolve(undefined);
    });

    render(MessageInput, { props: { channelName: 'general' } });
    await fireEvent.click(screen.getByLabelText(/Insert emoji or GIF/i));
    await fireEvent.click(screen.getByRole('tab', { name: /Stickers/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Insert wave')).not.toBeNull();
    });

    // Opening the tab registers an observer per tile but must not download anything yet.
    expect(ioInstances.length).toBeGreaterThan(0);
    expect(invoke).not.toHaveBeenCalledWith('fetch_sticker_image', expect.anything());

    // Only once the tile's IntersectionObserver reports it on-screen does the fetch fire.
    const observer = ioInstances[0];
    const tileNode = observer.observe.mock.calls[0]?.[0] as Element;
    observer.callback([{ isIntersecting: true, target: tileNode }]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('fetch_sticker_image', {
        url: entry.url,
        key: entry.key,
        nonce: entry.nonce,
      });
    });
    expect(observer.unobserve).toHaveBeenCalledWith(tileNode);
  });
});
