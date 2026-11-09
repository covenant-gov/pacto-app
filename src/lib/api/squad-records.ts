import { invoke } from './index';

/** Republish the current events, docs, and content-policy replica to the announcements group. */
export async function sendSquadRecordsSnapshot(params: {
  mlsGroupId: string;
  parentId: string;
}): Promise<void> {
  await invoke('send_squad_records_snapshot', params);
}
