import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { sendSquadRecordsSnapshot } from './squad-records';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(undefined);
});

describe('squad records snapshot wrapper', () => {
  it('sendSquadRecordsSnapshot passes camelCase ids', async () => {
    const params = { mlsGroupId: 'g1', parentId: 'g1' };
    await sendSquadRecordsSnapshot(params);
    expect(mockedInvoke).toHaveBeenCalledWith('send_squad_records_snapshot', params);
  });
});
