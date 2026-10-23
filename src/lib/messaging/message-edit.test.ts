import { describe, it, expect } from 'vitest';
import type { DmMessage } from '../../stores/dm';
import {
  EDIT_WINDOW_MS,
  buildEditedContent,
  canEditMessage,
  editErrorMessage,
  editableBody,
  editableUntil,
  isMeaningfulEdit,
  lastEditedAt,
  previousVersions,
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

  it('returns prior versions newest first, without the current text', () => {
    expect(previousVersions(history).map((v) => v.content)).toEqual(['hello', 'helo']);
    expect(previousVersions(null)).toEqual([]);
    expect(previousVersions([history[0]])).toEqual([]);
  });

  it('reports the latest edit time', () => {
    expect(lastEditedAt(history)).toBe(AT + 40_000);
    expect(lastEditedAt(undefined)).toBeNull();
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
