import { invoke } from './index';

export type SquadDocProvider = 'cryptpad' | 'google' | 'zoho' | 'notion' | 'etherpad' | 'other';

export interface SquadDocInput {
  url: string;
  title: string;
  channelId: string | null;
  note: string | null;
}

/** Replica row (`list_squad_docs`); hidden rows are omitted by the backend. */
export interface SquadDocDto {
  id: string;
  parentId: string;
  mlsGroupId: string;
  /** Raw URL, fragment included. Display through `maskDocUrl`. */
  url: string;
  title: string;
  provider: SquadDocProvider;
  channelId: string | null;
  note: string | null;
  /** Stored MLS signer of the add. */
  authorNpub: string;
  createdAtMs: number;
  updatedAtMs: number;
  updatedByNpub: string;
  /** Caller is the author or a current MLS admin. */
  canEdit: boolean;
}

/** Payload of the `squad_doc_replica_updated` event. */
export interface SquadDocReplicaUpdated {
  parentId: string;
  docId: string | null;
}

export const SQUAD_DOC_REPLICA_UPDATED = 'squad_doc_replica_updated';

export async function listSquadDocs(parentId: string): Promise<SquadDocDto[]> {
  return await invoke<SquadDocDto[]>('list_squad_docs', { parentId });
}

/** Posts the doc-added card. `docId` is minted by the caller so a retry reuses it. */
export async function sendSquadDocAdd(params: {
  mlsGroupId: string;
  parentId: string;
  docId: string;
  doc: SquadDocInput;
}): Promise<void> {
  await invoke('send_squad_doc_add', params);
}

export async function sendSquadDocUpdate(params: {
  mlsGroupId: string;
  parentId: string;
  docId: string;
  doc: SquadDocInput;
}): Promise<void> {
  await invoke('send_squad_doc_update', params);
}

export async function sendSquadDocRemove(params: {
  mlsGroupId: string;
  parentId: string;
  docId: string;
}): Promise<void> {
  await invoke('send_squad_doc_remove', params);
}
