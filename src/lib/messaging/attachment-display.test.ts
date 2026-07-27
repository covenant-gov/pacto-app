import { describe, it, expect } from 'vitest';
import { attachmentKind, attachmentDisplayName } from './attachment-display';

const t = (key: string): string => {
  const labels: Record<string, string> = {
    'messaging.attachment.image': 'Image',
    'messaging.attachment.video': 'Video',
    'messaging.attachment.audio': 'Audio',
    'messaging.attachment.document': 'Document',
    'messaging.attachment.spreadsheet': 'Spreadsheet',
    'messaging.attachment.archive': 'Archive',
    'messaging.attachment.file': 'File',
  };
  return labels[key] ?? key;
};

describe('attachmentKind', () => {
  it('classifies images by extension', () => {
    expect(attachmentKind('png', false)).toBe('image');
  });

  it('falls back to img_meta only when the extension is unknown', () => {
    expect(attachmentKind('bin', true)).toBe('image');
  });

  it('lets the extension win over img_meta, because a video carries a poster blurhash', () => {
    expect(attachmentKind('mp4', true)).toBe('video');
  });

  it('classifies videos', () => {
    expect(attachmentKind('mp4', false)).toBe('video');
  });

  it('classifies audio', () => {
    expect(attachmentKind('mp3', false)).toBe('audio');
  });

  it('classifies documents', () => {
    expect(attachmentKind('pdf', false)).toBe('document');
  });

  it('classifies spreadsheets', () => {
    expect(attachmentKind('csv', false)).toBe('spreadsheet');
  });

  it('classifies archives', () => {
    expect(attachmentKind('zip', false)).toBe('archive');
  });

  it('falls back to file for unknown extensions', () => {
    expect(attachmentKind('xyz', false)).toBe('file');
  });

  it('is case-insensitive', () => {
    expect(attachmentKind('MP3', false)).toBe('audio');
  });
});

describe('attachmentDisplayName', () => {
  it('prefers the sender-supplied file name', () => {
    const name = attachmentDisplayName(
      { file_name: 'quarterly-report.pdf', extension: 'pdf', id: 'abc123', img_meta: null },
      t,
    );
    expect(name).toBe('quarterly-report.pdf');
  });

  it('falls back to "<Kind>.<ext>" when there is no file name', () => {
    const name = attachmentDisplayName(
      { file_name: undefined, extension: 'mp3', id: 'abc123', img_meta: null },
      t,
    );
    expect(name).toBe('Audio.mp3');
  });

  it('omits the extension suffix when the extension is empty', () => {
    const name = attachmentDisplayName(
      { file_name: undefined, extension: '', id: 'abc123', img_meta: null },
      t,
    );
    expect(name).toBe('File');
  });

  it('treats an empty string file name as missing', () => {
    const name = attachmentDisplayName(
      { file_name: '', extension: 'png', id: 'abc123', img_meta: null },
      t,
    );
    expect(name).toBe('Image.png');
  });

  it('never returns or embeds the hash id', () => {
    const name = attachmentDisplayName(
      { file_name: undefined, extension: 'bin', id: 'abc123deadbeef', img_meta: null },
      t,
    );
    expect(name).not.toContain('abc123deadbeef');
  });
});
