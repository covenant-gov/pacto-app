import type { Attachment } from '../../stores/dm';

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'spreadsheet' | 'archive' | 'file';

const EXTENSION_KIND: Record<string, AttachmentKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image', heic: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio', oga: 'audio', weba: 'audio',
  pdf: 'document', doc: 'document', docx: 'document', txt: 'document', md: 'document', rtf: 'document', odt: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet', ods: 'spreadsheet',
  zip: 'archive', tar: 'archive', gz: 'archive', '7z': 'archive', rar: 'archive',
};

const KIND_LABEL_KEYS: Record<AttachmentKind, string> = {
  image: 'messaging.attachment.image',
  video: 'messaging.attachment.video',
  audio: 'messaging.attachment.audio',
  document: 'messaging.attachment.document',
  spreadsheet: 'messaging.attachment.spreadsheet',
  archive: 'messaging.attachment.archive',
  file: 'messaging.attachment.file',
};

/**
 * Classifies an attachment by extension for display purposes.
 *
 * The extension wins: a video carries `img_meta` for its poster blurhash, so
 * treating image metadata as proof of an image would misfile every video with a
 * thumbnail and deny it a player. Image metadata only breaks ties for an
 * extension we do not recognise.
 */
export function attachmentKind(extension: string, hasImgMeta: boolean): AttachmentKind {
  const known = EXTENSION_KIND[extension.toLowerCase()];
  if (known) return known;
  return hasImgMeta ? 'image' : 'file';
}

/**
 * Human label. Prefers the sender's file_name; otherwise "<Kind>.<ext>". NEVER the hash id.
 */
export function attachmentDisplayName(
  attachment: Pick<Attachment, 'file_name' | 'extension' | 'id' | 'img_meta'>,
  translate: (key: string) => string,
): string {
  if (typeof attachment.file_name === 'string' && attachment.file_name.length > 0) {
    return attachment.file_name;
  }
  const kind = attachmentKind(attachment.extension, attachment.img_meta != null);
  const label = translate(KIND_LABEL_KEYS[kind]);
  return attachment.extension ? `${label}.${attachment.extension}` : label;
}
