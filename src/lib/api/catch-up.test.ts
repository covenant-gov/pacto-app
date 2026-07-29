import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  listCatchUpEntries,
  getCatchUpCount,
  resolveCatchUpEntry,
  resolveAllCatchUpEntries,
  recordActionNeededEntry,
} from './catch-up';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('catch up command wrappers', () => {
  it('listCatchUpEntries sends list_catch_up_entries with null filters when omitted', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await listCatchUpEntries();
    expect(mockedInvoke).toHaveBeenCalledWith('list_catch_up_entries', { kind: null, squadId: null });
  });

  it('listCatchUpEntries forwards a kind and squad filter and returns the parsed result', async () => {
    const entries = [
      { id: 'a', sourceEventId: 'evt-1', kind: 'mention', chatId: 'chat-1', createdAt: 1, resolvedAt: null },
    ];
    mockedInvoke.mockResolvedValueOnce(entries);
    const result = await listCatchUpEntries('mention', 'squad-1');
    expect(mockedInvoke).toHaveBeenCalledWith('list_catch_up_entries', { kind: 'mention', squadId: 'squad-1' });
    expect(result).toEqual(entries);
  });

  it('getCatchUpCount sends catch_up_count with no payload and returns the parsed count', async () => {
    mockedInvoke.mockResolvedValueOnce(3);
    const count = await getCatchUpCount();
    expect(mockedInvoke).toHaveBeenCalledWith('catch_up_count');
    expect(count).toBe(3);
  });

  it('resolveCatchUpEntry sends resolve_catch_up_entry with the source event id', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const resolved = await resolveCatchUpEntry('evt-1');
    expect(mockedInvoke).toHaveBeenCalledWith('resolve_catch_up_entry', { sourceEventId: 'evt-1' });
    expect(resolved).toBe(true);
  });

  it('resolveAllCatchUpEntries forwards filters and returns the resolved count', async () => {
    mockedInvoke.mockResolvedValueOnce(5);
    const count = await resolveAllCatchUpEntries('action_prompt', 'squad-1');
    expect(mockedInvoke).toHaveBeenCalledWith('resolve_all_catch_up_entries', {
      kind: 'action_prompt',
      squadId: 'squad-1',
    });
    expect(count).toBe(5);
  });

  it('recordActionNeededEntry sends record_action_needed_entry with chat and source ids', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await recordActionNeededEntry('chat-1', 'roster-key:squad-1');
    expect(mockedInvoke).toHaveBeenCalledWith('record_action_needed_entry', {
      chatId: 'chat-1',
      sourceEventId: 'roster-key:squad-1',
    });
  });
});
