// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ImageViewer from './ImageViewer.svelte';
import { canRevealInFolder, revealInFolder } from '../../lib/utils/reveal-in-folder';
import { saveAttachmentAs } from '../../lib/api/nostr';
import { formatMessageTimestamp } from '../../lib/utils/message-formatting';

vi.mock('../../lib/utils/reveal-in-folder', () => ({
  canRevealInFolder: vi.fn().mockReturnValue(false),
  revealInFolder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/api/nostr', () => ({
  saveAttachmentAs: vi.fn().mockResolvedValue('/dest/saved-path'),
}));

const mockedCanReveal = vi.mocked(canRevealInFolder);
const mockedReveal = vi.mocked(revealInFolder);
const mockedSaveAttachmentAs = vi.mocked(saveAttachmentAs);

describe('ImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCanReveal.mockReturnValue(false);
    mockedSaveAttachmentAs.mockResolvedValue('/dest/saved-path');
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {};
  });

  it('does not render when closed', () => {
    render(ImageViewer, { props: { open: false, src: 'https://example.com/img.png', alt: 'test' } });
    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).toBeNull();
  });

  it('renders the image with the given alt text when open', () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'A cat' } });

    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).not.toBeNull();
    const img = document.querySelector('.viewer-image') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://example.com/img.png');
    expect(img.getAttribute('alt')).toBe('A cat');
  });

  it('closes when the backdrop is clicked', async () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'test' } });
    const dialog = screen.getByRole('dialog', { name: 'Image viewer' });
    await fireEvent.click(dialog);
    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).toBeNull();
  });

  it('zooms in and out', async () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'test' } });

    expect(screen.queryByText('100%')).not.toBeNull();

    await fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(screen.queryByText('125%')).not.toBeNull();

    await fireEvent.click(screen.getByLabelText('Zoom out'));
    await fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(screen.queryByText('75%')).not.toBeNull();
  });

  it('rotates the image in 90-degree increments and wraps at 360', async () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'test' } });
    const img = document.querySelector('.viewer-image') as HTMLImageElement;

    await fireEvent.click(screen.getByLabelText('Rotate'));
    expect(img.style.transform).toContain('rotate(90deg)');

    await fireEvent.click(screen.getByLabelText('Rotate'));
    expect(img.style.transform).toContain('rotate(180deg)');

    await fireEvent.click(screen.getByLabelText('Rotate'));
    await fireEvent.click(screen.getByLabelText('Rotate'));
    expect(img.style.transform).toContain('rotate(0deg)');
  });

  it('renders the bottom-left sender bar with avatar image, name, and formatted timestamp', () => {
    render(ImageViewer, {
      props: {
        open: true,
        src: 'https://example.com/img.png',
        alt: 'test',
        authorName: 'Alice',
        avatarSrc: 'https://example.com/avatar.png',
        timestamp: '2024-05-26T23:09:00.000Z',
      },
    });

    expect(screen.queryByText('Alice')).not.toBeNull();
    const avatarImg = document.querySelector('.sender-avatar img') as HTMLImageElement;
    expect(avatarImg).not.toBeNull();
    expect(avatarImg.getAttribute('src')).toBe('https://example.com/avatar.png');
    expect(screen.queryByText(formatMessageTimestamp('2024-05-26T23:09:00.000Z'))).not.toBeNull();
  });

  it('falls back to a first-letter avatar placeholder when no avatar is given', () => {
    render(ImageViewer, {
      props: {
        open: true,
        src: 'https://example.com/img.png',
        alt: 'test',
        authorName: 'Bob',
        timestamp: '2024-05-26T23:09:00.000Z',
      },
    });

    expect(document.querySelector('.sender-avatar img')).toBeNull();
    const placeholder = document.querySelector('.sender-avatar-placeholder');
    expect(placeholder?.textContent).toBe('B');
  });

  it('omits the sender bar entirely when no author name is provided', () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'test' } });
    expect(document.querySelector('.viewer-sender')).toBeNull();
  });

  it('saves the image via the download control', async () => {
    render(ImageViewer, {
      props: {
        open: true,
        src: 'https://example.com/img.png',
        alt: 'A cat',
        chatId: 'npub1abc',
        messageId: 'm1',
        attachmentId: 'att1',
      },
    });

    await fireEvent.click(screen.getByLabelText('Download'));

    await waitFor(() => {
      expect(mockedSaveAttachmentAs).toHaveBeenCalledWith('npub1abc', 'm1', 'att1');
    });
  });

  it('does nothing on download when the native save dialog is cancelled', async () => {
    mockedSaveAttachmentAs.mockResolvedValueOnce('');
    render(ImageViewer, {
      props: {
        open: true,
        src: 'https://example.com/img.png',
        alt: 'A cat',
        chatId: 'npub1abc',
        messageId: 'm1',
        attachmentId: 'att1',
      },
    });

    await fireEvent.click(screen.getByLabelText('Download'));

    await waitFor(() => {
      expect(mockedSaveAttachmentAs).toHaveBeenCalledWith('npub1abc', 'm1', 'att1');
    });
  });

  it('opens and closes the "..." menu', async () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'test' } });

    expect(document.querySelector('.viewer-menu')).toBeNull();

    await fireEvent.click(screen.getByLabelText('More options'));
    expect(document.querySelector('.viewer-menu')).not.toBeNull();

    await fireEvent.click(screen.getByLabelText('More options'));
    expect(document.querySelector('.viewer-menu')).toBeNull();
  });

  it('closes the "..." menu on an outside click', async () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'test' } });

    await fireEvent.click(screen.getByLabelText('More options'));
    expect(document.querySelector('.viewer-menu')).not.toBeNull();

    await fireEvent.pointerDown(document.body);
    expect(document.querySelector('.viewer-menu')).toBeNull();
  });

  it('calls onShowMessage with the message id and closes the viewer when "Show message" is selected', async () => {
    const onShowMessage = vi.fn();
    render(ImageViewer, {
      props: {
        open: true,
        src: 'https://example.com/img.png',
        alt: 'test',
        messageId: 'm42',
        onShowMessage,
      },
    });

    await fireEvent.click(screen.getByLabelText('More options'));
    await fireEvent.click(screen.getByLabelText('Show message'));

    expect(onShowMessage).toHaveBeenCalledTimes(1);
    expect(onShowMessage).toHaveBeenCalledWith('m42');
    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).toBeNull();
  });

  it('shows the reveal-in-folder button inside the "..." menu on desktop and calls the utility', async () => {
    mockedCanReveal.mockReturnValue(true);
    render(ImageViewer, {
      props: {
        open: true,
        src: 'https://example.com/img.png',
        alt: 'test',
        localPath: '/home/user/Downloads/img.png',
      },
    });

    await fireEvent.click(screen.getByLabelText('More options'));

    const revealBtn = screen.queryByLabelText('Show in folder');
    expect(revealBtn).not.toBeNull();

    await fireEvent.click(revealBtn!);
    expect(mockedReveal).toHaveBeenCalledWith('/home/user/Downloads/img.png');
    // Selecting a menu action closes the menu, but not the whole viewer.
    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).not.toBeNull();
  });

  it('hides the reveal-in-folder button when unavailable', async () => {
    mockedCanReveal.mockReturnValue(false);
    render(ImageViewer, {
      props: {
        open: true,
        src: 'https://example.com/img.png',
        alt: 'test',
        localPath: '/home/user/Downloads/img.png',
      },
    });

    await fireEvent.click(screen.getByLabelText('More options'));
    expect(screen.queryByLabelText('Show in folder')).toBeNull();
  });

  it('removes window pointer listeners on destroy even mid-drag', async () => {
    const { unmount } = render(ImageViewer, {
      props: { open: true, src: 'https://example.com/img.png', alt: 'test' },
    });
    const img = document.querySelector('.viewer-image') as HTMLImageElement;
    await fireEvent.pointerDown(img, { clientX: 10, clientY: 10 });

    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('focuses the first control on open and restores focus to the previously focused element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open viewer';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    try {
      const { rerender } = render(ImageViewer, {
        props: { open: true, src: 'https://example.com/img.png', alt: 'test' },
      });

      const closeBtn = screen.getByLabelText('Close image viewer');
      await waitFor(() => {
        expect(document.activeElement).toBe(closeBtn);
      });

      await rerender({ open: false, src: 'https://example.com/img.png', alt: 'test' });

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    } finally {
      trigger.remove();
    }
  });

  it('wraps Tab focus at the dialog boundaries instead of escaping to the rest of the page', async () => {
    render(ImageViewer, { props: { open: true, src: 'https://example.com/img.png', alt: 'test' } });

    const closeBtn = screen.getByLabelText('Close image viewer');
    const moreOptionsBtn = screen.getByLabelText('More options');
    await waitFor(() => expect(document.activeElement).toBe(closeBtn));

    moreOptionsBtn.focus();
    await fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    closeBtn.focus();
    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(moreOptionsBtn);
  });

});
