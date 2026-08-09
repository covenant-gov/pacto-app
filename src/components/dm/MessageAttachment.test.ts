// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import MessageAttachment from './MessageAttachment.svelte';
import { downloadAttachment, decodeBlurhash, saveAttachmentAs } from '../../lib/api/nostr';
import { fetchGifMedia } from '../../lib/api/klipy';
import type { Attachment } from '../../stores/dm';

vi.mock('../../icons/file.svg', () => ({ default: '/file.svg' }));
vi.mock('../../icons/play.svg', () => ({ default: '/play.svg' }));
vi.mock('../../icons/cloud-download.svg', () => ({ default: '/cloud-download.svg' }));
vi.mock('../../icons/download.svg', () => ({ default: '/download.svg' }));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('../../lib/api/nostr', () => ({
  downloadAttachment: vi.fn().mockResolvedValue(undefined),
  decodeBlurhash: vi.fn().mockResolvedValue('data:image/png;base64,blur'),
  saveAttachmentAs: vi.fn().mockResolvedValue('/dest/saved-path'),
}));

vi.mock('../../lib/api/klipy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/klipy')>();
  return { ...actual, fetchGifMedia: vi.fn() };
});

vi.mock('../../lib/utils/reveal-in-folder', () => ({
  canRevealInFolder: vi.fn().mockReturnValue(false),
  revealInFolder: vi.fn(),
}));

const mockedDownload = vi.mocked(downloadAttachment);
const mockedDecodeBlurhash = vi.mocked(decodeBlurhash);
const mockedSaveAttachmentAs = vi.mocked(saveAttachmentAs);
const mockedFetchGifMedia = vi.mocked(fetchGifMedia);

const baseAttachment: Attachment = {
  id: 'abc123',
  key: 'k',
  nonce: 'n',
  extension: 'png',
  url: 'https://example.com/abc123.png',
  path: '',
  size: 1024,
  img_meta: { blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', width: 32, height: 32 },
  downloaded: false,
  downloading: false,
};

describe('MessageAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDecodeBlurhash.mockResolvedValue('data:image/png;base64,blur');
    mockedSaveAttachmentAs.mockResolvedValue('/dest/saved-path');
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {};
  });

  it('renders a file card for non-image attachments, using the kind label when there is no sender file name', () => {
    const attachment: Attachment = { ...baseAttachment, extension: 'pdf', img_meta: null };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    expect(screen.queryByLabelText('Download Document.pdf')).not.toBeNull();
    expect(screen.queryByText('Document.pdf')).not.toBeNull();
    expect(screen.queryByText('Document · 1 KB')).not.toBeNull();
  });

  it('uses the local file path for an already-downloaded image', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      path: '/cache/abc123.png',
      downloaded: true,
    };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await waitFor(() => {
      const img = screen.queryByAltText('Image.png') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('asset:///cache/abc123.png');
    });
  });

  it('never renders the remote blob URL, because the blob is ciphertext', async () => {
    render(MessageAttachment, { props: { attachment: baseAttachment, chatId: 'npub1abc', messageId: 'm1' } });

    await waitFor(() => {
      expect(screen.queryByAltText('Image.png')).not.toBeNull();
    });
    const img = screen.getByAltText('Image.png') as HTMLImageElement;
    expect(img.getAttribute('src')).not.toBe(baseAttachment.url);
    expect(img.getAttribute('src')).toBe('data:image/png;base64,blur');
  });

  it('downloads and decrypts when an undownloaded image is clicked', async () => {
    render(MessageAttachment, { props: { attachment: baseAttachment, chatId: 'npub1abc', messageId: 'm1' } });

    await fireEvent.click(screen.getByLabelText('Download Image.png'));
    expect(mockedDownload).toHaveBeenCalledWith('npub1abc', 'm1', 'abc123');
  });

  it('swaps the blurhash for the local file once the download lands', async () => {
    const { rerender } = render(MessageAttachment, {
      props: { attachment: baseAttachment, chatId: 'npub1abc', messageId: 'm1' },
    });

    await waitFor(() => {
      const img = screen.getByAltText('Image.png') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('data:image/png;base64,blur');
    });

    await rerender({
      attachment: { ...baseAttachment, path: '/dl/vector/abc123.png', downloaded: true },
      chatId: 'npub1abc',
      messageId: 'm1',
    });

    await waitFor(() => {
      const img = screen.getByAltText('Image.png') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('asset:///dl/vector/abc123.png');
    });
  });

  it('falls back to a blurhash placeholder when there is no URL', async () => {
    const attachment: Attachment = { ...baseAttachment, url: '', path: '' };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await waitFor(() => {
      expect(mockedDecodeBlurhash).toHaveBeenCalledWith(attachment.img_meta?.blurhash, 32, 32);
      const img = screen.queryByAltText('Image.png') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('data:image/png;base64,blur');
    });
  });

  it('opens the image viewer when the thumbnail is clicked', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      path: '/cache/abc123.png',
      downloaded: true,
    };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await waitFor(() => {
      expect(screen.queryByAltText('Image.png')).not.toBeNull();
    });

    await fireEvent.click(screen.getByLabelText('Open Image.png'));
    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).not.toBeNull();
  });

  it('threads sender identity into the image viewer sender bar', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      path: '/cache/abc123.png',
      downloaded: true,
    };
    render(MessageAttachment, {
      props: {
        attachment,
        chatId: 'npub1abc',
        messageId: 'm1',
        authorName: 'Alice',
        avatarSrc: 'https://example.com/avatar.png',
        timestamp: '2024-05-26T23:09:00.000Z',
      },
    });

    await waitFor(() => {
      expect(screen.queryByAltText('Image.png')).not.toBeNull();
    });

    await fireEvent.click(screen.getByLabelText('Open Image.png'));
    expect(screen.queryByText('Alice')).not.toBeNull();
  });

  it('forwards the image viewer showMessage event as its own', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      path: '/cache/abc123.png',
      downloaded: true,
    };
    const onShowMessage = vi.fn();
    render(MessageAttachment, {
      props: { attachment, chatId: 'npub1abc', messageId: 'm1' },
      events: { showMessage: onShowMessage },
    });

    await waitFor(() => {
      expect(screen.queryByAltText('Image.png')).not.toBeNull();
    });
    await fireEvent.click(screen.getByLabelText('Open Image.png'));

    await fireEvent.click(screen.getByLabelText('More options'));
    await fireEvent.click(screen.getByLabelText('Show message'));

    expect(onShowMessage).toHaveBeenCalledTimes(1);
    expect(onShowMessage.mock.calls[0][0].detail).toEqual({ messageId: 'm1' });
  });

  it('downloads a non-image attachment when the file card is clicked', async () => {
    const attachment: Attachment = { ...baseAttachment, extension: 'pdf', img_meta: null };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await fireEvent.click(screen.getByLabelText('Download Document.pdf'));
    expect(mockedDownload).toHaveBeenCalledWith('npub1abc', 'm1', 'abc123');
  });

  it('renders the sender-supplied file name, never the hash', () => {
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'pdf',
      img_meta: null,
      file_name: 'quarterly-report.pdf',
    };
    const { container } = render(MessageAttachment, {
      props: { attachment, chatId: 'npub1abc', messageId: 'm1' },
    });

    expect(screen.queryByText('quarterly-report.pdf')).not.toBeNull();
    expect(container.innerHTML).not.toContain('abc123');
  });

  it('renders the kind label with extension for an audio attachment with no file name, never the hash', () => {
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'mp3',
      img_meta: null,
      file_name: undefined,
    };
    const { container } = render(MessageAttachment, {
      props: { attachment, chatId: 'npub1abc', messageId: 'm1' },
    });

    expect(screen.queryByText('Audio.mp3')).not.toBeNull();
    expect(container.innerHTML).not.toContain('abc123');
  });

  it('renders an inline audio player from the local path once an audio attachment is downloaded', () => {
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'mp3',
      img_meta: null,
      url: 'https://example.com/abc123.mp3',
      path: '/cache/abc123.mp3',
      downloaded: true,
    };
    const { container } = render(MessageAttachment, {
      props: { attachment, chatId: 'npub1abc', messageId: 'm1' },
    });

    const audioEl = container.querySelector('audio');
    expect(audioEl).not.toBeNull();
    expect(audioEl?.getAttribute('src')).toBe('asset:///cache/abc123.mp3');
    expect(audioEl?.getAttribute('src')).not.toBe(attachment.url);
  });

  it('saves the attachment to the chosen destination when Save as… succeeds', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'pdf',
      img_meta: null,
      file_name: 'quarterly-report.pdf',
      path: '/cache/quarterly-report.pdf',
      downloaded: true,
    };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await fireEvent.click(screen.getByLabelText('Save as…'));

    await waitFor(() => {
      expect(mockedSaveAttachmentAs).toHaveBeenCalledWith('npub1abc', 'm1', 'abc123');
    });
  });

  it('does nothing when the native save dialog is cancelled', async () => {
    mockedSaveAttachmentAs.mockResolvedValueOnce('');
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'pdf',
      img_meta: null,
      path: '/cache/abc123.pdf',
      downloaded: true,
    };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await fireEvent.click(screen.getByLabelText('Save as…'));

    await waitFor(() => {
      expect(mockedSaveAttachmentAs).toHaveBeenCalledWith('npub1abc', 'm1', 'abc123');
    });
  });

  it('does not offer Save as… on a file card until the attachment is on disk', () => {
    const attachment: Attachment = { ...baseAttachment, extension: 'pdf', img_meta: null };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    expect(screen.queryByLabelText('Save as…')).toBeNull();
  });

  it('offers Save as… from the row corner button once a downloaded audio attachment is on disk', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'mp3',
      img_meta: null,
      path: '/cache/abc123.mp3',
      downloaded: true,
    };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await fireEvent.click(screen.getByLabelText('Save as…'));

    await waitFor(() => {
      expect(mockedSaveAttachmentAs).toHaveBeenCalledWith('npub1abc', 'm1', 'abc123');
    });
  });

  it('shows a decorative cloud-download icon on the tile corner until the file is on disk, replacing it with a Save as… button once local', async () => {
    const { rerender } = render(MessageAttachment, {
      props: { attachment: baseAttachment, chatId: 'npub1abc', messageId: 'm1' },
    });

    const pending = document.querySelector('.corner-action');
    expect(pending?.tagName).toBe('SPAN');
    expect(pending?.getAttribute('aria-hidden')).toBe('true');
    expect(pending?.querySelector('img')?.getAttribute('src')).toBe('/cloud-download.svg');

    await rerender({
      attachment: { ...baseAttachment, path: '/dl/vector/abc123.png', downloaded: true },
      chatId: 'npub1abc',
      messageId: 'm1',
    });

    await waitFor(() => {
      const action = document.querySelector('.corner-action');
      expect(action?.tagName).toBe('BUTTON');
      expect(action?.querySelector('img')?.getAttribute('src')).toBe('/download.svg');
    });
  });

  it('saves the attachment when the tile corner button is clicked, once it is on disk', async () => {
    const attachment: Attachment = { ...baseAttachment, path: '/dl/vector/abc123.png', downloaded: true };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await fireEvent.click(screen.getByLabelText('Save as…'));

    await waitFor(() => {
      expect(mockedSaveAttachmentAs).toHaveBeenCalledWith('npub1abc', 'm1', 'abc123');
    });
  });

  it('never shows a separate Save as… button below an image or video tile, because the corner action replaces it', () => {
    render(MessageAttachment, { props: { attachment: baseAttachment, chatId: 'npub1abc', messageId: 'm1' } });

    expect(document.querySelector('.save-as-btn')).toBeNull();
  });

  it('shows the cloud-download badge on an undownloaded file card', () => {
    const attachment: Attachment = { ...baseAttachment, extension: 'pdf', img_meta: null };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    const lead = document.querySelector('.lead-badge');
    expect(lead?.classList.contains('pending')).toBe(true);
    expect(lead?.querySelector('img')?.getAttribute('src')).toBe('/cloud-download.svg');
  });

  it('treats a video with poster metadata as video, not image', () => {
    const attachment: Attachment = { ...baseAttachment, extension: 'mp4' };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    // A poster blurhash must not demote the attachment to a plain image: it
    // still needs a play affordance.
    expect(document.querySelector('.play-badge')).not.toBeNull();
    expect(screen.queryByLabelText('Download Video.mp4')).not.toBeNull();
  });

  it('downloads then plays when an undownloaded video tile is clicked', async () => {
    const attachment: Attachment = { ...baseAttachment, extension: 'mp4' };
    const { rerender } = render(MessageAttachment, {
      props: { attachment, chatId: 'npub1abc', messageId: 'm1' },
    });

    await fireEvent.click(screen.getByLabelText('Download Video.mp4'));
    expect(mockedDownload).toHaveBeenCalledWith('npub1abc', 'm1', 'abc123');
    expect(document.querySelector('video')).toBeNull();

    // The decrypted path arrives as a prop update; the player mounts then.
    await rerender({
      attachment: { ...attachment, path: '/dl/vector/abc123.mp4', downloaded: true },
      chatId: 'npub1abc',
      messageId: 'm1',
    });

    await waitFor(() => {
      const video = document.querySelector('video');
      expect(video).not.toBeNull();
      expect(video?.getAttribute('src')).toBe('asset:///dl/vector/abc123.mp4');
    });
  });

  it('offers play, not open, for a downloaded video', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'mp4',
      path: '/dl/vector/abc123.mp4',
      downloaded: true,
    };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    expect(screen.queryByLabelText('Play Video.mp4')).not.toBeNull();
    expect(screen.queryByLabelText('Open Video.mp4')).toBeNull();
  });

  it('still shows a poster for a downloaded video, because a video element is not a poster', async () => {
    const attachment: Attachment = {
      ...baseAttachment,
      extension: 'mp4',
      path: '/dl/vector/abc123.mp4',
      downloaded: true,
    };
    render(MessageAttachment, { props: { attachment, chatId: 'npub1abc', messageId: 'm1' } });

    await waitFor(() => {
      const poster = document.querySelector('.tile-poster') as HTMLImageElement;
      expect(poster).not.toBeNull();
      expect(poster.getAttribute('src')).toBe('data:image/png;base64,blur');
    });
    expect(document.querySelector('.tile-placeholder')).toBeNull();
  });

  describe('Klipy GIF attachment (remote plaintext: empty key/nonce)', () => {
    const klipyAttachment: Attachment = {
      id: 'gif-slug-1',
      key: '',
      nonce: '',
      extension: 'gif',
      url: 'https://static.klipy.com/hd.gif?ext=gif&itemid=abc123',
      path: '',
      size: 0,
      img_meta: null,
      downloaded: false,
      downloading: false,
    };

    beforeEach(() => {
      mockedFetchGifMedia.mockReset();
      URL.createObjectURL = vi.fn(() => 'blob://mock-gif');
      URL.revokeObjectURL = vi.fn();
    });

    it('fetches through klipy_fetch_media and renders the bytes as an image, never the generic download path', async () => {
      mockedFetchGifMedia.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
      render(MessageAttachment, {
        props: { attachment: klipyAttachment, chatId: 'npub1abc', messageId: 'm1' },
      });

      await waitFor(() => {
        expect(mockedFetchGifMedia).toHaveBeenCalledWith(klipyAttachment.url);
        const img = screen.queryByAltText('Image.gif') as HTMLImageElement;
        expect(img).not.toBeNull();
        expect(img.getAttribute('src')).toBe('blob://mock-gif');
      });
      expect(mockedDownload).not.toHaveBeenCalled();
    });

    it('degrades to the unavailable state on a fetch failure, instead of throwing into the thread', async () => {
      mockedFetchGifMedia.mockRejectedValueOnce(new Error('Refusing to fetch: not a Klipy media URL'));
      render(MessageAttachment, {
        props: { attachment: klipyAttachment, chatId: 'npub1abc', messageId: 'm1' },
      });

      await waitFor(() => {
        expect(screen.queryByText('GIF unavailable')).not.toBeNull();
      });
      expect(screen.queryByAltText('Image.gif')).toBeNull();
      expect(mockedDownload).not.toHaveBeenCalled();
    });

    it('retries the fetch when the unavailable state is clicked', async () => {
      mockedFetchGifMedia.mockRejectedValueOnce(new Error('network error'));
      render(MessageAttachment, {
        props: { attachment: klipyAttachment, chatId: 'npub1abc', messageId: 'm1' },
      });
      await waitFor(() => {
        expect(screen.queryByText('GIF unavailable')).not.toBeNull();
      });

      mockedFetchGifMedia.mockResolvedValueOnce(new Uint8Array([1]));
      await fireEvent.click(screen.getByLabelText('GIF unavailable'));

      await waitFor(() => {
        expect(screen.queryByAltText('Image.gif')).not.toBeNull();
      });
    });

    it('never offers Save as… for a Klipy GIF, because its bytes are never written to disk', async () => {
      mockedFetchGifMedia.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
      render(MessageAttachment, {
        props: { attachment: klipyAttachment, chatId: 'npub1abc', messageId: 'm1' },
      });

      await waitFor(() => {
        expect(screen.queryByAltText('Image.gif')).not.toBeNull();
      });
      expect(screen.queryByLabelText('Save as…')).toBeNull();
      expect(mockedSaveAttachmentAs).not.toHaveBeenCalled();
    });
  });
});
