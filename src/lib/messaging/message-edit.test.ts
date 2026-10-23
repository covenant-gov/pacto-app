import { describe, it, expect } from 'vitest';
import type { DmMessage } from '../../stores/dm';
import {
  EDIT_WINDOW_MS,
  buildEditedContent,
  canEditMessage,
  lastEditableMessage,
  editErrorMessage,
  editableBody,
  editableUntil,
  isMeaningfulEdit,
  lastEditedAt,
  historyVersions,
  diffMessageWords,
} from './message-edit';
import { buildMentionEnvelope, parseMessageContent } from './mentions';

const AT = 1_700_000_000_250;

function own(overrides: Partial<DmMessage> = {}): DmMessage {
  return { id: 'abc123', content: 'helo', at: AT, mine: true, ...overrides };
}

describe('editableUntil / canEditMessage', () => {
  it('opens a one-minute window on own sent text messages', () => {
    const until = editableUntil(own());
    expect(until).not.toBeNull();
    expect(canEditMessage(own(), AT + 1_000)).toBe(true);
    expect(canEditMessage(own(), AT + EDIT_WINDOW_MS - 1)).toBe(true);
    expect(canEditMessage(own(), AT + EDIT_WINDOW_MS + 1_000)).toBe(false);
  });

  it('never allows editing other people, unsent, failed, or attachment messages', () => {
    expect(editableUntil(own({ mine: false }))).toBeNull();
    expect(editableUntil(own({ pending: true }))).toBeNull();
    expect(editableUntil(own({ failed: true }))).toBeNull();
    expect(editableUntil(own({ id: 'opt-1-abc' }))).toBeNull();
    expect(editableUntil(own({ id: 'pending-1' }))).toBeNull();
    expect(
      editableUntil(own({ attachments: [{ id: 'f', key: '', nonce: '', extension: 'png', url: '', path: '', size: 1 }] }))
    ).toBeNull();
  });
});

describe('lastEditableMessage', () => {
  it('selects by send time while skipping non-text, unsent and non-own entries', () => {
    const recent = own({ id: 'recent', at: AT + 2000 });
    const attachment = { id: 'f', key: '', nonce: '', extension: 'png', url: '', path: '', size: 1 };
    expect(lastEditableMessage([
      recent,
      own({ id: 'older', at: AT }),
      own({ id: 'theirs', at: AT + 3000, mine: false }),
      own({ id: 'failed', at: AT + 4000, failed: true }),
      own({ id: 'pending', at: AT + 5000, pending: true }),
      own({ id: 'file', at: AT + 6000, attachments: [attachment] }),
      own({ id: 'notice', at: AT + 7000, content: JSON.stringify({ type: 'governance_updated' }) }),
      own({ id: 'local', at: AT + 8000, is_local_announcement: true }),
    ], AT + 10000)).toBe(recent);
    expect(lastEditableMessage([own()], AT + EDIT_WINDOW_MS + 1000)).toBeUndefined();
    expect(lastEditableMessage([], AT)).toBeUndefined();
  });
});

describe('buildEditedContent', () => {
  it('sends plain text as-is', () => {
    expect(buildEditedContent('helo', 'hello')).toBe('hello');
  });

  it('keeps the mention envelope and drops mentions whose alias was removed', () => {
    const original = buildMentionEnvelope(
      'hi @alice and @bob',
      [
        { npub: 'npub1alice', alias: 'alice' },
        { npub: 'npub1bob', alias: 'bob' },
      ],
      'general'
    );
    const parsed = parseMessageContent(buildEditedContent(original, 'hi @alice'));
    expect(parsed.isEnvelope).toBe(true);
    expect(parsed.body).toBe('hi @alice');
    expect(parsed.mentions).toEqual([{ npub: 'npub1alice', alias: 'alice' }]);
    expect(parsed.pacto_virtual_bucket).toBe('general');
  });
});

describe('isMeaningfulEdit / editableBody', () => {
  it('ignores empty and unchanged edits', () => {
    expect(isMeaningfulEdit('hello', 'hello')).toBe(false);
    expect(isMeaningfulEdit('hello', '   ')).toBe(false);
    expect(isMeaningfulEdit('hello', 'hello!')).toBe(true);
  });

  it('compares against the envelope body', () => {
    const env = buildMentionEnvelope('hi @alice', [{ npub: 'npub1alice', alias: 'alice' }], 'general');
    expect(editableBody(env)).toBe('hi @alice');
    expect(isMeaningfulEdit(env, 'hi @alice')).toBe(false);
  });
});

describe('edit history helpers', () => {
  const history = [
    { content: 'helo', edited_at: AT },
    { content: 'hello', edited_at: AT + 20_000 },
    { content: 'hello!', edited_at: AT + 40_000 },
  ];

  it('returns every version chronologically, keeping edits sharing a timestamp', () => {
    const entries = [...history, { content: 'hello again', edited_at: AT + 40_000 }];
    expect(historyVersions(entries).map((v) => v.content)).toEqual(['helo', 'hello', 'hello!', 'hello again']);
    expect(historyVersions([history[0], history[2], history[1]])).toEqual(history);
    expect(historyVersions([{ content: 'original', edited_at: AT + 250 }, history[0]])[0].content).toBe('original');
    expect(historyVersions(null)).toEqual([]);
    expect(historyVersions([history[0]])).toEqual([]);
  });

  it('reports the latest edit time', () => {
    expect(lastEditedAt(history)).toBe(AT + 40_000);
    expect(lastEditedAt(undefined)).toBeNull();
  });
});

describe('diffMessageWords', () => {
  it('marks a small word replacement, preserving spaces and line breaks', () => {
    expect(diffMessageWords('Meet at the east gate\ntoday', 'Meet at the west gate\ntoday')).toEqual([
      { type: 'equal', text: 'Meet at the ' },
      { type: 'delete', text: 'east' },
      { type: 'insert', text: 'west' },
      { type: 'equal', text: ' gate\ntoday' },
    ]);
  });

  it('returns plain text mode for a rewrite or a diff too large to read', () => {
    expect(diffMessageWords('Meet at the west gate today', 'Please bring the blue folder today')).toBeNull();
    expect(diffMessageWords('word '.repeat(500), 'other '.repeat(500))).toBeNull();
  });

  it('compares mention bodies without exposing envelopes', () => {
    const original = buildMentionEnvelope('hello @alice see you today', [{ npub: 'npub1alice', alias: 'alice' }], 'general');
    const edited = buildEditedContent(original, 'hello @alice see you tomorrow');
    const diff = diffMessageWords(original, edited)!;
    expect(diff.filter((part) => part.type !== 'insert').map((part) => part.text).join('')).toBe('hello @alice see you today');
    expect(diff.filter((part) => part.type !== 'delete').map((part) => part.text).join('')).toBe('hello @alice see you tomorrow');
  });
});

describe('editErrorMessage', () => {
  it('maps the closed-window backend error to friendly copy', () => {
    expect(editErrorMessage('edit window closed')).toBe(
      'Messages can only be edited for 1 minute after sending'
    );
  });

  it('passes other backend errors through', () => {
    expect(editErrorMessage(new Error('no trusted relay acknowledged the edit'))).toBe(
      'no trusted relay acknowledged the edit'
    );
  });
});
