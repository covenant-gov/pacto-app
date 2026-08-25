// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

import CatchUpEntry from './CatchUpEntry.svelte';
import { pendingMlsWelcomes } from '../../stores/mls-chat';
import { squads } from '../../stores/squads';
import { backendDmMessages } from '../../stores/dm';
import type { CatchUpEntry as CatchUpEntryType } from '../../lib/api/catch-up';

function welcomeEntry(overrides: Partial<CatchUpEntryType> = {}): CatchUpEntryType {
  return {
    kind: 'welcome',
    chatId: 'group-1',
    sourceEventId: 'ev-1',
    ...overrides,
  } as CatchUpEntryType;
}

describe('CatchUpEntry', () => {
  beforeEach(() => {
    pendingMlsWelcomes.set([]);
    squads.set([]);
    backendDmMessages.set({});
  });

  afterEach(() => {
    cleanup();
    pendingMlsWelcomes.set([]);
    squads.set([]);
    backendDmMessages.set({});
  });

  it('disables Accept when no matching pending welcome exists for the entry chatId', () => {
    render(CatchUpEntry, { props: { entry: welcomeEntry({ chatId: 'group-missing' }) } });
    const accept = screen.getByText('Accept').closest('button') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
  });
});
