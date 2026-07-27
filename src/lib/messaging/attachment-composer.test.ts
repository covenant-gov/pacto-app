import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  MAX_ATTACHMENT_BYTES,
  buildPendingFile,
  clearPendingAttachment,
  formatFileSize,
  isAttachmentOversized,
  isImageFile,
  pendingFilePreview,
  shouldCompressImage,
} from './attachment-composer';

describe('attachment-composer', () => {
  beforeEach(() => {
    pendingFilePreview.set(null);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob://mock-preview'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formats byte sizes across units', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('detects image files by extension', () => {
    expect(isImageFile('photo.jpg')).toBe(true);
    expect(isImageFile('animation.GIF')).toBe(true);
    expect(isImageFile('diagram.svg')).toBe(true);
    expect(isImageFile('report.pdf')).toBe(false);
    expect(isImageFile('archive')).toBe(false);
  });

  it('compresses raster images but not SVGs or GIFs', () => {
    expect(shouldCompressImage('photo.jpg')).toBe(true);
    expect(shouldCompressImage('shot.png')).toBe(true);
    expect(shouldCompressImage('frame.webp')).toBe(true);
    expect(shouldCompressImage('icon.svg')).toBe(false);
    expect(shouldCompressImage('animation.gif')).toBe(false);
    expect(shouldCompressImage('report.pdf')).toBe(false);
  });

  it('flags files over 25 MB as oversized', () => {
    expect(isAttachmentOversized(MAX_ATTACHMENT_BYTES)).toBe(false);
    expect(isAttachmentOversized(MAX_ATTACHMENT_BYTES + 1)).toBe(true);
    expect(isAttachmentOversized(0)).toBe(false);
  });

  it('builds a pending image attachment with an object URL preview', () => {
    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });
    const pending = buildPendingFile(file);

    expect(pending.fileName).toBe('photo.png');
    expect(pending.extension).toBe('png');
    expect(pending.size).toBe(file.size);
    expect(pending.mimeType).toBe('image/png');
    expect(pending.previewUrl).toBe('blob://mock-preview');
    expect(pending.url).toBe('blob://mock-preview');
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it('builds a pending document attachment without a preview URL', () => {
    const file = new File(['data'], 'report.pdf', { type: 'application/pdf' });
    const pending = buildPendingFile(file);

    expect(pending.fileName).toBe('report.pdf');
    expect(pending.extension).toBe('pdf');
    expect(pending.previewUrl).toBeUndefined();
    expect(pending.url).toBe('');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('revokes the object URL and clears the store', () => {
    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });
    pendingFilePreview.set(buildPendingFile(file));
    clearPendingAttachment();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob://mock-preview');
    expect(get(pendingFilePreview)).toBeNull();
  });
});
