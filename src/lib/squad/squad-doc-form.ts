import type { SquadDocDto, SquadDocInput } from '../api/squad-docs';
import { isHttpUrl } from '../docs/mask-url';
import { defaultDocTitle, findExistingDoc, type MessageDocLink } from '../docs/message-links';

/** `channelId` is `''` for untagged so it binds to a `<select>`. */
export interface SquadDocFormValues {
  url: string;
  title: string;
  channelId: string;
  note: string;
}

export type SquadDocFormError = 'url' | 'title';

export function squadDocFormValues(input: SquadDocInput | null | undefined): SquadDocFormValues {
  return {
    url: input?.url ?? '',
    title: input?.title ?? '',
    channelId: input?.channelId ?? '',
    note: input?.note ?? '',
  };
}

export function squadDocInputFromDoc(doc: SquadDocDto): SquadDocInput {
  return { url: doc.url, title: doc.title, channelId: doc.channelId, note: doc.note };
}

export function validateSquadDocForm(values: SquadDocFormValues): SquadDocFormError | null {
  if (!isHttpUrl(values.url.trim())) return 'url';
  if (!values.title.trim()) return 'title';
  return null;
}

export function squadDocInputFromForm(values: SquadDocFormValues): SquadDocInput {
  return {
    url: values.url.trim(),
    title: values.title.trim(),
    channelId: values.channelId.trim() || null,
    note: values.note.trim() || null,
  };
}

/** Custom channels are separate MLS groups with a subset of members; the shelf rides the announcements group. */
export function needsWholeSquadConfirm(messageGroupId: string, announcementsGroupId: string): boolean {
  return messageGroupId.trim() !== announcementsGroupId.trim();
}

/**
 * Next Save to Docs step for a message's links. Several links need a pick first. A link already on the
 * shelf reuses that row: authors and admins edit it (tagged with this channel); anyone else only sees it.
 */
export type SaveToDocsStep =
  | { kind: 'pick'; links: MessageDocLink[] }
  | { kind: 'openExisting'; doc: SquadDocDto }
  | { kind: 'edit'; doc: SquadDocDto; initial: SquadDocInput }
  | { kind: 'add'; initial: SquadDocInput };

export function saveToDocsStep(
  links: MessageDocLink[],
  rows: SquadDocDto[],
  channelId: string,
  picked: MessageDocLink | null = null,
): SaveToDocsStep | null {
  const link = picked ?? (links.length === 1 ? links[0] : null);
  if (!link) return links.length > 1 ? { kind: 'pick', links } : null;
  const existing = findExistingDoc(rows, link.url);
  if (existing) {
    return existing.canEdit
      ? { kind: 'edit', doc: existing, initial: { ...squadDocInputFromDoc(existing), channelId } }
      : { kind: 'openExisting', doc: existing };
  }
  return { kind: 'add', initial: { url: link.url, title: defaultDocTitle(link), channelId, note: null } };
}
