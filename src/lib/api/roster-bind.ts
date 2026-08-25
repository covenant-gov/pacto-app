import { invoke } from './index';

export type SquadRosterBindCert = {
  memberNpub: string;
  evmAddress: string;
  issuedAt: number;
  signature: string;
};

export async function signSquadRosterBindCert(parentId: string): Promise<SquadRosterBindCert> {
  return invoke<SquadRosterBindCert>('sign_squad_roster_bind_cert', { parentId });
}
