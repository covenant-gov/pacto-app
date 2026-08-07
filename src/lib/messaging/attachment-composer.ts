import { writable } from 'svelte/store';
import type { Attachment } from '../../stores/dm';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, true> = {
  jpg: true,
  jpeg: true,
  png: true,
  gif: true,
  webp: true,
  bmp: true,
  svg: true,
  ico: true,
  avif: true,
};

const MIME_TYPE_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

/** Attachment enriched with composer-only metadata needed to render a preview and send bytes. */
export interface PendingFileAttachment extends Attachment {
  /** Display name derived from the original file. */
  fileName: string;
  /** The raw File object when selected via web/Android input. */
  file?: File;
  /** Desktop-only local path when selected via the Tauri dialog. */
  filePath?: string;
  /** Local preview URL (object URL for web files, base64 data URL for desktop images). */
  previewUrl?: string;
  /** MIME type hint for preview and upload metadata. */
  mimeType?: string;
}

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : '';
}

export function generatePendingId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getMimeTypeForExtension(extension: string): string {
  return MIME_TYPE_MAP[extension.toLowerCase()] ?? 'application/octet-stream';
}

export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS[extensionOf(fileName)] === true;
}

export function shouldCompressImage(fileName: string): boolean {
  const ext = extensionOf(fileName);
  if (!isImageFile(fileName)) return false;
  // Leave SVGs and GIFs alone; everything else can be compressed/resized by the backend.
  return ext !== 'svg' && ext !== 'gif';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      const decimals = value < 10 ? 1 : 0;
      return `${Number(value.toFixed(decimals)).toString()} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

export function isAttachmentOversized(size: number): boolean {
  return size > MAX_ATTACHMENT_BYTES;
}

/** True when the native Tauri file dialog should be used instead of a hidden file input. */
export function isDesktopFilePickerAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as { __TAURI__?: unknown };
  const isTauri = !!tauriWindow.__TAURI__;
  return isTauri && typeof navigator !== 'undefined' && !/android/i.test(navigator.userAgent);
}

/** Currently selected attachment waiting to be sent. In-memory only. */
export const pendingFilePreview = writable<PendingFileAttachment | null>(null);

/** Drop the pending attachment and revoke any object URL created for a web preview. */
export function clearPendingAttachment(): void {
  pendingFilePreview.update((current) => {
    if (current?.previewUrl && typeof URL !== 'undefined') {
      try {
        URL.revokeObjectURL(current.previewUrl);
      } catch {
        // Ignore invalid URLs; object URLs should always be valid, but revoking is best-effort.
      }
    }
    return null;
  });
}

/** Build a pending attachment from a web/Android File selected via a hidden input. */
export function buildPendingFile(file: File): PendingFileAttachment {
  const extension = extensionOf(file.name);
  const previewUrl = isImageFile(file.name)
    ? typeof URL !== 'undefined'
      ? URL.createObjectURL(file)
      : undefined
    : undefined;

  return {
    id: generatePendingId(),
    key: '',
    nonce: '',
    extension,
    url: previewUrl ?? '',
    path: '',
    size: file.size,
    fileName: file.name,
    file,
    previewUrl,
    mimeType: getMimeTypeForExtension(extension),
  };
}
