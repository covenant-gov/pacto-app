/**
 * Certified roster snapshot on #announcements (late-joiner catch-up).
 */

import { invoke } from '@tauri-apps/api/core';
import { sendDmMessage } from '../api/nostr';
import {
  listSquadMemberEvmInvokeArgs,
  type SquadMemberEvmRow,
} from './squad-member-evm-share';

export const SQUAD_EVM_ROSTER_SNAPSHOT_TYPE = 'squad_evm_roster_snapshot';
export const SQUAD_EVM_ROSTER_SNAPSHOT_VERSION = 1;

export type SquadEvmRosterSnapshotMember = {
  member_npub: string;
  evm_address: string;
  issued_at: number;
  signature: string;
};

export type SquadEvmRosterSnapshotPayload = {
  parent_id: string;
  members: SquadEvmRosterSnapshotMember[];
};

export function formatSquadEvmRosterSnapshot(payload: SquadEvmRosterSnapshotPayload): string {
  return JSON.stringify({
    version: SQUAD_EVM_ROSTER_SNAPSHOT_VERSION,
    type: SQUAD_EVM_ROSTER_SNAPSHOT_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

function parseMember(raw: unknown): SquadEvmRosterSnapshotMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const member_npub = typeof m.member_npub === 'string' ? m.member_npub.trim() : '';
  const evm_address = typeof m.evm_address === 'string' ? m.evm_address.trim() : '';
  const signature = typeof m.signature === 'string' ? m.signature.trim() : '';
  const issued_at =
    typeof m.issued_at === 'number'
      ? m.issued_at
      : typeof m.issued_at === 'string'
        ? Number.parseInt(m.issued_at, 10)
        : NaN;
  if (!member_npub || !evm_address || !signature || !Number.isFinite(issued_at) || issued_at <= 0) {
    return null;
  }
  return { member_npub, evm_address, issued_at, signature };
}

export function parseSquadEvmRosterSnapshot(
  content: string | null | undefined,
): SquadEvmRosterSnapshotPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_EVM_ROSTER_SNAPSHOT_TYPE) return null;
    if (root.version != null && root.version !== SQUAD_EVM_ROSTER_SNAPSHOT_VERSION) return null;
    const p = root.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
    if (!parent_id || !Array.isArray(p.members)) return null;
    const members: SquadEvmRosterSnapshotMember[] = [];
    for (const raw of p.members) {
      const m = parseMember(raw);
      if (m) members.push(m);
    }
    return { parent_id, members };
  } catch {
    return null;
  }
}

export function certifiedRosterMembersFromRows(rows: SquadMemberEvmRow[]): SquadEvmRosterSnapshotMember[] {
  const out: SquadEvmRosterSnapshotMember[] = [];
  for (const r of rows) {
    const signature = r.bindSignature?.trim() ?? '';
    const issued_at = r.issuedAt ?? 0;
    const evm_address = r.evmAddress?.trim() ?? '';
    const member_npub = r.memberNpub?.trim() ?? '';
    if (!signature || issued_at <= 0 || !evm_address || !member_npub) continue;
    out.push({ member_npub, evm_address, issued_at, signature });
  }
  return out;
}

export async function publishSquadEvmRosterSnapshot(
  announcementsGroupId: string,
  altParentId?: string | null,
): Promise<boolean> {
  const gid = announcementsGroupId.trim();
  if (!gid) return false;
  const q = listSquadMemberEvmInvokeArgs(altParentId?.trim() || gid, gid);
  let rows: SquadMemberEvmRow[] = [];
  try {
    rows = (await invoke<SquadMemberEvmRow[]>('list_squad_member_evm', q)) ?? [];
  } catch (e) {
    console.warn('[squad-evm-roster] list failed', e);
    return false;
  }
  const members = certifiedRosterMembersFromRows(rows);
  if (members.length === 0) return false;
  const json = formatSquadEvmRosterSnapshot({ parent_id: gid, members });
  try {
    await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
    return true;
  } catch (e) {
    console.warn('[squad-evm-roster] snapshot publish failed', e);
    return false;
  }
}
