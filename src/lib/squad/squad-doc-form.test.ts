import { describe, expect, it } from 'vitest';
import type { SquadDocDto } from '../api/squad-docs';
import { extractMessageDocLinks } from '../docs/message-links';
import {
  needsWholeSquadConfirm,
  saveToDocsStep,
  squadDocFormValues,
  squadDocInputFromForm,
  validateSquadDocForm,
} from './squad-doc-form';

const PAD = 'https://cryptpad.fr/pad/#/2/pad/edit/secret';

function doc(overrides: Partial<SquadDocDto> = {}): SquadDocDto {
  return {
    id: 'd1',
    parentId: 'p',
    mlsGroupId: 'g',
    url: PAD,
    title: 'Pad',
    provider: 'cryptpad',
    channelId: null,
    note: null,
    authorNpub: 'npub1author',
    createdAtMs: 1,
    updatedAtMs: 1,
    updatedByNpub: 'npub1author',
    canEdit: false,
    ...overrides,
  };
}

describe('squad doc form', () => {
  it('requires an http(s) URL and a title', () => {
    expect(validateSquadDocForm(squadDocFormValues({ url: 'ftp://x', title: 't', channelId: null, note: null }))).toBe('url');
    expect(validateSquadDocForm(squadDocFormValues({ url: 'https://x.org', title: ' ', channelId: null, note: null }))).toBe(
      'title'
    );
    expect(validateSquadDocForm(squadDocFormValues({ url: 'http://x.org', title: 't', channelId: null, note: null }))).toBeNull();
  });

  it('maps an empty channel to untagged and a blank note to null', () => {
    expect(squadDocInputFromForm({ url: ' https://x.org ', title: ' T ', channelId: '', note: '  ' })).toEqual({
      url: 'https://x.org',
      title: 'T',
      channelId: null,
      note: null,
    });
  });
});

describe('needsWholeSquadConfirm', () => {
  it('asks only when the message group is not the announcements group', () => {
    expect(needsWholeSquadConfirm('g-ann', 'g-ann')).toBe(false);
    expect(needsWholeSquadConfirm('g-leads', 'g-ann')).toBe(true);
  });
});

describe('saveToDocsStep', () => {
  it('has no step for text without a link', () => {
    expect(saveToDocsStep(extractMessageDocLinks('no links here'), [], 'g')).toBeNull();
  });

  it('prefills one link with the hostname title and the rendered channel', () => {
    const step = saveToDocsStep(extractMessageDocLinks(`notes ${PAD}`), [], 'g-ops');
    expect(step).toEqual({
      kind: 'add',
      initial: { url: PAD, title: 'cryptpad.fr', channelId: 'g-ops', note: null },
    });
  });

  it('uses the markdown link text as the title', () => {
    const step = saveToDocsStep(extractMessageDocLinks('[Agenda](https://example.com/a)'), [], 'g');
    expect(step).toMatchObject({ kind: 'add', initial: { title: 'Agenda' } });
  });

  it('asks for a pick when the message has two links, and adds only the chosen one', () => {
    const links = extractMessageDocLinks('https://a.example/x and https://b.example/y');
    expect(saveToDocsStep(links, [], 'g')).toEqual({ kind: 'pick', links });
    expect(saveToDocsStep(links, [], 'g', links[1])).toMatchObject({
      kind: 'add',
      initial: { url: 'https://b.example/y' },
    });
  });

  it('opens the existing row for a non-author non-admin instead of sending', () => {
    const existing = doc({ canEdit: false });
    expect(saveToDocsStep(extractMessageDocLinks(PAD), [existing], 'g')).toEqual({ kind: 'openExisting', doc: existing });
  });

  it('reuses the existing id for the author or an admin and tags this channel', () => {
    const existing = doc({ canEdit: true, note: 'keep me' });
    expect(saveToDocsStep(extractMessageDocLinks(PAD), [existing], 'g-ops')).toEqual({
      kind: 'edit',
      doc: existing,
      initial: { url: PAD, title: 'Pad', channelId: 'g-ops', note: 'keep me' },
    });
  });

  it('treats a different fragment as a new doc', () => {
    const step = saveToDocsStep(extractMessageDocLinks('https://cryptpad.fr/pad/#/2/pad/edit/other'), [doc()], 'g');
    expect(step?.kind).toBe('add');
  });
});
