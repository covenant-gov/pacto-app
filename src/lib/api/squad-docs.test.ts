import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  listSquadDocs,
  sendSquadDocAdd,
  sendSquadDocRemove,
  sendSquadDocUpdate,
  SQUAD_DOC_REPLICA_UPDATED,
} from './squad-docs';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);
const doc = { url: 'https://cryptpad.fr/pad/#/2/x', title: 'Pad', channelId: 'general', note: null };

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(undefined);
});

describe('squad docs command wrappers', () => {
  it('listSquadDocs sends parentId and returns rows', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    expect(await listSquadDocs('p1')).toEqual([]);
    expect(mockedInvoke).toHaveBeenCalledWith('list_squad_docs', { parentId: 'p1' });
  });

  it('sendSquadDocAdd and sendSquadDocUpdate pass camelCase args with the doc input', async () => {
    const params = { mlsGroupId: 'g1', parentId: 'p1', docId: 'd1', doc };
    await sendSquadDocAdd(params);
    expect(mockedInvoke).toHaveBeenCalledWith('send_squad_doc_add', params);
    await sendSquadDocUpdate(params);
    expect(mockedInvoke).toHaveBeenCalledWith('send_squad_doc_update', params);
  });

  it('sendSquadDocRemove passes ids only', async () => {
    await sendSquadDocRemove({ mlsGroupId: 'g1', parentId: 'p1', docId: 'd1' });
    expect(mockedInvoke).toHaveBeenCalledWith('send_squad_doc_remove', {
      mlsGroupId: 'g1',
      parentId: 'p1',
      docId: 'd1',
    });
  });

  it('exposes the replica event name', () => {
    expect(SQUAD_DOC_REPLICA_UPDATED).toBe('squad_doc_replica_updated');
  });
});
