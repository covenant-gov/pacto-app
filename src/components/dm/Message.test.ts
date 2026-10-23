// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/svelte';
import Message from './Message.svelte';
import { stripTrackingMarkersEnabled } from '../../stores/strip-tracking-markers';
import { pendingReactionSent, clearPendingReactions } from '../../lib/messaging/reactions';
import type { Reaction } from '../../stores/dm';
import type { NostrProfile } from '../../lib/api/nostr';

const ME = 'npub1me';
const ALICE = 'npub1alice';
const BOB = 'npub1bob';
const CAROL = 'npub1carol';

function reaction(id: string, author_id: string, emoji: string, reference_id = 'msg-1'): Reaction {
  return { id, reference_id, author_id, emoji };
}

function makeProfile(overrides: Partial<NostrProfile>): NostrProfile {
  return {
    id: '',
    name: '',
    display_name: '',
    avatar: '',
    banner: '',
    about: '',
    website: '',
    nip05: '',
    lud06: '',
    lud16: '',
    nickname: '',
    last_read: '',
    status: { title: '', purpose: '', url: '' },
    last_updated: 0,
    typing_until: 0,
    mine: false,
    ...overrides,
  } as NostrProfile;
}

beforeEach(() => {
  clearPendingReactions();
});

afterEach(() => {
  cleanup();
  clearPendingReactions();
});

describe('Message reaction chips', () => {
  it('renders an unpressed chip for a reaction from someone else and calls onReact on click', async () => {
    const onReact = vi.fn();
    render(Message, {
      props: {
        id: 'msg-1',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ALICE, '👍')],
        onReact,
      },
    });

    const chip = screen.getByRole('button', { name: '👍 1' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.classList.contains('own')).toBe(false);

    await fireEvent.click(chip);
    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact).toHaveBeenCalledWith('msg-1', '👍');
  });

  it('renders a pressed/own chip for the current user\'s reaction and does not call onReact on click', async () => {
    const onReact = vi.fn();
    render(Message, {
      props: {
        id: 'msg-2',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ME, '❤️')],
        onReact,
      },
    });

    const chip = screen.getByRole('button', { name: '❤️ 1' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.classList.contains('own')).toBe(true);

    await fireEvent.click(chip);
    expect(onReact).not.toHaveBeenCalled();
  });

  it('does not call onReact again when the reaction is already pending', async () => {
    const onReact = vi.fn();
    pendingReactionSent('msg-3', '🔥');

    render(Message, {
      props: {
        id: 'msg-3',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ALICE, '🔥')],
        onReact,
      },
    });

    const chip = screen.getByRole('button', { name: '🔥 1' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(chip);
    expect(onReact).not.toHaveBeenCalled();
  });

  it('renders a single chip with the aggregated count for 3+ distinct reactors', () => {
    const onReact = vi.fn();
    render(Message, {
      props: {
        id: 'msg-4',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [
          reaction('r1', ALICE, '🎉'),
          reaction('r2', BOB, '🎉'),
          reaction('r3', CAROL, '🎉'),
        ],
        onReact,
      },
    });

    const chips = screen.getAllByRole('button', { name: /🎉/ });
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute('aria-label')).toBe('🎉 3');
    expect(chips[0].querySelector('.reaction-count')?.textContent).toBe('3');
  });
});

describe('Message reactor tooltip', () => {
  const alice = makeProfile({ id: ALICE, display_name: 'Alice A.', avatar: 'https://example.com/alice.png' });

  it('shows a popover listing avatar and display name for each reactor on hover', async () => {
    render(Message, {
      props: {
        id: 'msg-10',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ALICE, '👍')],
        profiles: { [ALICE]: alice },
        onReact: vi.fn(),
      },
    });

    const chip = screen.getByRole('button', { name: '👍 1' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    await fireEvent.mouseEnter(chip);
    const tooltip = screen.getByRole('tooltip');
    const entry = tooltip.querySelector('.reactor-tooltip-entry');
    expect(entry?.querySelector('.reactor-tooltip-name')?.textContent).toBe('Alice A.');
    expect(entry?.querySelector('img')?.getAttribute('src')).toBe('https://example.com/alice.png');

    await fireEvent.mouseLeave(chip);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('reveals the popover on focus and dismisses it on blur', async () => {
    render(Message, {
      props: {
        id: 'msg-11',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ALICE, '❤️')],
        profiles: { [ALICE]: alice },
        onReact: vi.fn(),
      },
    });

    const chip = screen.getByRole('button', { name: '❤️ 1' });
    await fireEvent.focus(chip);
    expect(screen.getByRole('tooltip')).toBeTruthy();

    await fireEvent.blur(chip);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dismisses the popover on Escape', async () => {
    render(Message, {
      props: {
        id: 'msg-12',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ALICE, '🔥')],
        profiles: { [ALICE]: alice },
        onReact: vi.fn(),
      },
    });

    const chip = screen.getByRole('button', { name: '🔥 1' });
    await fireEvent.focus(chip);
    expect(screen.getByRole('tooltip')).toBeTruthy();

    await fireEvent.keyDown(chip, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('falls back to a truncated npub when no cached profile exists for a reactor', async () => {
    render(Message, {
      props: {
        id: 'msg-13',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', BOB, '😂')],
        profiles: {},
        onReact: vi.fn(),
      },
    });

    const chip = screen.getByRole('button', { name: '😂 1' });
    await fireEvent.mouseEnter(chip);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.querySelector('.reactor-tooltip-name')?.textContent).toBe(`${BOB.slice(0, 16)}…`);
  });

  it("resolves the current user's own reaction to the 'You' label instead of a raw id", async () => {
    render(Message, {
      props: {
        id: 'msg-14',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ME, '🎉'), reaction('r2', ALICE, '🎉')],
        profiles: { [ALICE]: alice },
        onReact: vi.fn(),
      },
    });

    const chip = screen.getByRole('button', { name: '🎉 2' });
    await fireEvent.mouseEnter(chip);
    const tooltip = screen.getByRole('tooltip');
    const names = Array.from(tooltip.querySelectorAll('.reactor-tooltip-name')).map((el) => el.textContent);
    expect(names).toContain('You');
    expect(names).not.toContain(ME);
  });

  it('reveals the popover on long-press without triggering the react-toggle click', async () => {
    const onReact = vi.fn();
    render(Message, {
      props: {
        id: 'msg-15',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: [reaction('r1', ALICE, '👏')],
        profiles: { [ALICE]: alice },
        onReact,
      },
    });

    const chip = screen.getByRole('button', { name: '👏 1' });
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(chip, { pointerType: 'touch', clientX: 10, clientY: 10 });
      await act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(screen.getByRole('tooltip')).toBeTruthy();

      await fireEvent.pointerUp(chip, { pointerType: 'touch', clientX: 10, clientY: 10 });
      await fireEvent.click(chip);
      expect(onReact).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the reactor list and shows an "and N more" line for many reactors on one emoji', async () => {
    const manyReactors = Array.from({ length: 12 }, (_, i) => reaction(`r${i}`, `npub1reactor${i}`, '🎊'));
    render(Message, {
      props: {
        id: 'msg-16',
        authorName: 'Alice',
        content: 'hello',
        currentUserNpub: ME,
        reactions: manyReactors,
        profiles: {},
        onReact: vi.fn(),
      },
    });

    const chip = screen.getByRole('button', { name: '🎊 12' });
    await fireEvent.mouseEnter(chip);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.querySelectorAll('.reactor-tooltip-entry')).toHaveLength(8);
    expect(tooltip.querySelector('.reactor-tooltip-more')?.textContent?.trim()).toBe('and 4 more');
  });
});

describe('Message copy', () => {
  afterEach(() => {
    stripTrackingMarkersEnabled.set(true);
  });

  async function copyBody(content: string, onCopy: (messageId: string, text: string) => void) {
    render(Message, {
      props: {
        id: 'msg-copy',
        authorName: 'Alice',
        content,
        onCopy,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Message options' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
  }

  it('hands the parent a body with tracking parameters removed when the setting is on', async () => {
    stripTrackingMarkersEnabled.set(true);
    const onCopy = vi.fn();
    await copyBody('https://example.com/a?utm_source=nl&id=1', onCopy);
    expect(onCopy).toHaveBeenCalledWith('msg-copy', 'https://example.com/a?id=1');
  });

  it('hands the parent the original body when the setting is off', async () => {
    stripTrackingMarkersEnabled.set(false);
    const onCopy = vi.fn();
    await copyBody('https://example.com/a?utm_source=nl&id=1', onCopy);
    expect(onCopy).toHaveBeenCalledWith('msg-copy', 'https://example.com/a?utm_source=nl&id=1');
  });
});

describe('Message editing', () => {
  async function openMenu() {
    await fireEvent.click(screen.getByRole('button', { name: 'Message options' }));
  }

  it('offers Edit inside the window and sends the new body on Enter', async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(Message, {
      props: {
        id: 'msg-edit',
        authorName: 'You',
        content: 'helo',
        editableUntil: Date.now() + 30_000,
        onEdit,
      },
    });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const input = screen.getByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement;
    expect(input.value).toBe('helo');

    await fireEvent.input(input, { target: { value: 'hello' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('msg-edit', 'hello');
    await act(() => Promise.resolve());
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
  });

  it('cancels editing on Escape without sending', async () => {
    const onEdit = vi.fn();
    render(Message, {
      props: { id: 'msg-esc', content: 'helo', editableUntil: Date.now() + 30_000, onEdit },
    });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('keeps the editor open when the edit fails', async () => {
    const onEdit = vi.fn().mockResolvedValue(false);
    render(Message, {
      props: { id: 'msg-fail', content: 'helo', editableUntil: Date.now() + 30_000, onEdit },
    });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const input = screen.getByRole('textbox', { name: 'Edit message' });
    await fireEvent.input(input, { target: { value: 'hello' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(() => Promise.resolve());
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeTruthy();
  });

  it('hides Edit once the window has closed or for non-editable messages', async () => {
    render(Message, {
      props: { id: 'msg-old', content: 'old', editableUntil: Date.now() - 1, onEdit: vi.fn() },
    });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    cleanup();

    render(Message, { props: { id: 'msg-theirs', content: 'hi', editableUntil: null, onEdit: vi.fn() } });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  });

  it('opens a popover with the original and every edit, readable diffs, and plain rewrites', async () => {
    const sentAt = new Date(2026, 9, 22, 15, 41, 10).getTime();
    const editedAt = new Date(2026, 9, 22, 15, 41, 40).getTime();
    render(Message, {
      props: {
        id: 'msg-edited',
        content: 'Please bring the blue folder tomorrow',
        edited: true,
        editHistory: [
          { content: 'Meet at the east gate today', edited_at: sentAt },
          { content: 'Meet at the west gate today', edited_at: sentAt + 10_000 },
          { content: 'Please bring the blue folder today', edited_at: sentAt + 20_000 },
          { content: 'Please bring the blue folder tomorrow', edited_at: editedAt },
        ],
      },
    });

    const label = screen.getByRole('button', { name: '(edited 3:41 PM)' });
    expect(label.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    label.focus();
    await fireEvent.click(label);
    expect(label.getAttribute('aria-expanded')).toBe('true');
    const popover = screen.getByRole('dialog', { name: 'Edit history' });
    const entries = within(popover).getAllByRole('listitem');
    expect(entries).toHaveLength(4);
    expect(entries[0].textContent).toContain('Meet at the east gate today');
    expect(entries[1].querySelector('del')?.textContent).toBe('east');
    expect(entries[1].querySelector('ins')?.textContent).toBe('west');
    expect(entries[2].textContent).toContain('Please bring the blue folder today');
    expect(entries[2].querySelector('del, ins')).toBeNull();
    expect(entries[3].querySelector('del')?.textContent).toBe('today');
    expect(entries[3].querySelector('ins')?.textContent).toBe('tomorrow');
    expect(entries[3].textContent).toContain('Current');
    expect(entries.map((entry) => entry.querySelector('time')?.getAttribute('datetime'))).toEqual(
      [sentAt, sentAt + 10_000, sentAt + 20_000, editedAt].map((at) => new Date(at).toISOString()),
    );

    await fireEvent.keyDown(popover, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(label));

    await fireEvent.click(label);
    expect(screen.getByRole('dialog', { name: 'Edit history' })).toBeTruthy();
    await fireEvent.pointerDown(document.body);
    await fireEvent.pointerUp(document.body);
    await fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows no edited label on unedited messages', () => {
    render(Message, { props: { id: 'msg-plain', content: 'hello' } });
    expect(screen.queryByText(/\(edited/)).toBeNull();
  });
});
