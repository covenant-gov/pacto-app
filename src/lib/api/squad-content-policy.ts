import { invoke } from './index';

export type SquadContentPolicyFlag = 'restrict_event_create' | 'restrict_doc_add';

/** Squad add restrictions plus the caller's standing in the announcements group. Absent policy = both off. */
export interface SquadContentPolicyView {
  restrictEventCreate: boolean;
  restrictEventCreateUpdatedAtMs: number;
  restrictDocAdd: boolean;
  restrictDocAddUpdatedAtMs: number;
  /** Caller is in the announcements group's MLS `admin_pubkeys`. */
  callerIsAdmin: boolean;
  /** At least one admin is still a current member; false means a restriction locks everyone out. */
  adminIsMember: boolean;
}

export async function getSquadContentPolicy(mlsGroupId: string, parentId: string): Promise<SquadContentPolicyView> {
  return await invoke<SquadContentPolicyView>('get_squad_content_policy', { mlsGroupId, parentId });
}

/** Admin only. The backend stamps the changed flag and keeps the other flag's stored value and timestamp. */
export async function setSquadContentPolicy(params: {
  mlsGroupId: string;
  parentId: string;
  flag: SquadContentPolicyFlag;
  value: boolean;
}): Promise<SquadContentPolicyView> {
  return await invoke<SquadContentPolicyView>('set_squad_content_policy', params);
}

/** Events create gate shared by the shelf and the settings copy. */
export function canCreateSquadEvent(policy: SquadContentPolicyView): boolean {
  return !policy.restrictEventCreate || policy.callerIsAdmin;
}
