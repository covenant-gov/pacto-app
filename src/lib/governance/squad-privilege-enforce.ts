/**
 * SquadAdmin packed-role enforcement for MLS/Commons actions.
 * No SquadAdmin infra → allow (privilege system inactive).
 * SquadAdmin present → require FULL or decoded flag; unbound / RPC fail → deny.
 */

import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { currentUser } from '../../stores/auth-session';
import { squadInfraByParentId } from '../../stores/squads';
import { getSquadAdminExecutorRoles } from './api/squad-admin';
import {
  resolveSettingsPrivilegesAdmin,
  type ResolvedSquadAdminContext,
} from './squad-admin-payload';
import {
  hasPrivilegeAction,
  resolveEffectivePrivilegeFlags,
  type EffectivePrivilegeFlags,
} from './effective-privilege-flags';
import { listSquadMemberEvmInvokeArgs } from '../squad/squad-member-evm-share';

export type SquadPrivilegeAction =
  | 'inviteAccept'
  | 'createChannel'
  | 'broadcast'
  | 'manageNetwork'
  | 'createEvent'
  | 'addDoc';

export type SquadPrivilegeDecision =
  | { ok: true; active: boolean; flags: EffectivePrivilegeFlags | null }
  | { ok: false; reason: 'unbound' | 'rpc' | 'denied' | 'paused'; active: true };

type SquadMemberEvmRow = { memberNpub: string; evmAddress: string };

async function listMemberEvmMap(parentId: string): Promise<Record<string, string>> {
  const q = listSquadMemberEvmInvokeArgs(parentId, parentId);
  if (!q.parentId) return {};
  try {
    const rows = await invoke<SquadMemberEvmRow[]>('list_squad_member_evm', q);
    const m: Record<string, string> = {};
    for (const r of rows) {
      const npub = r.memberNpub?.trim();
      const addr = r.evmAddress?.trim();
      if (npub && addr) m[npub] = addr;
    }
    return m;
  } catch {
    return {};
  }
}

export function resolveSquadAdminForParent(parentId: string): ResolvedSquadAdminContext | null {
  const id = parentId.trim();
  if (!id) return null;
  return resolveSettingsPrivilegesAdmin(get(squadInfraByParentId)[id] ?? []);
}

export async function loadEffectivePrivilegesForAddress(params: {
  parentId: string;
  executorAddress: string;
  admin?: ResolvedSquadAdminContext | null;
}): Promise<EffectivePrivilegeFlags | null> {
  const admin = params.admin ?? resolveSquadAdminForParent(params.parentId);
  if (!admin) return null;
  const dto = await getSquadAdminExecutorRoles({
    network: admin.chain,
    squadAdminProxy: admin.proxy,
    executorAddress: params.executorAddress,
    parentId: params.parentId,
    trustedRpc: true,
  });
  return resolveEffectivePrivilegeFlags({
    fullPermission: dto.fullPermission,
    paused: dto.paused,
    enabledRoleIds: dto.roles.filter((r) => r.enabled).map((r) => r.role),
  });
}

/** Resolve flags for an npub in a parent. `evmAddress` skips roster lookup when known. */
export async function decideSquadPrivilege(params: {
  parentId: string;
  memberNpub: string;
  action: SquadPrivilegeAction;
  evmAddress?: string | null;
}): Promise<SquadPrivilegeDecision> {
  const parentId = params.parentId.trim();
  const npub = params.memberNpub.trim();
  if (!parentId || !npub) {
    return { ok: false, reason: 'denied', active: true };
  }

  const admin = resolveSquadAdminForParent(parentId);
  if (!admin) {
    return { ok: true, active: false, flags: null };
  }

  let addr = params.evmAddress?.trim() || '';
  if (!addr) {
    const map = await listMemberEvmMap(parentId);
    addr = map[npub]?.trim() || '';
  }
  if (!addr) {
    return { ok: false, reason: 'unbound', active: true };
  }

  let flags: EffectivePrivilegeFlags;
  try {
    const loaded = await loadEffectivePrivilegesForAddress({
      parentId,
      executorAddress: addr,
      admin,
    });
    if (!loaded) {
      return { ok: false, reason: 'rpc', active: true };
    }
    flags = loaded;
  } catch {
    return { ok: false, reason: 'rpc', active: true };
  }

  if (flags.paused) {
    return { ok: false, reason: 'paused', active: true };
  }
  if (!hasPrivilegeAction(flags, params.action)) {
    return { ok: false, reason: 'denied', active: true };
  }
  return { ok: true, active: true, flags };
}

/** Current-user publish preflight. */
export async function requireMySquadPrivilege(
  parentId: string,
  action: SquadPrivilegeAction,
): Promise<SquadPrivilegeDecision> {
  const me = get(currentUser)?.npub?.trim() ?? '';
  return decideSquadPrivilege({ parentId, memberNpub: me, action });
}

export function squadPrivilegeDeniedMessage(
  decision: Extract<SquadPrivilegeDecision, { ok: false }>,
  tFn: (key: string) => string,
): string {
  switch (decision.reason) {
    case 'unbound':
      return tFn('governance.privileges.enforce.unbound');
    case 'rpc':
      return tFn('governance.privileges.enforce.rpc');
    case 'paused':
      return tFn('governance.privileges.enforce.paused');
    default:
      return tFn('governance.privileges.enforce.denied');
  }
}
