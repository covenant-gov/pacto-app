/**
 * Shared session dedupe + orchestration for dashboard parent prefetch (hub + #dashboard).
 */

import type { Squad } from '../../stores/squads';
import { resolveAutomatedAnnounceGroupId } from '../parent-navbar';
import { replayMlsAutomationSideEffects } from '../api/nostr';
import {
  resetDashboardDataSyncInflight,
  syncSquadInfraForParent,
  syncSquadMemberEvmForParent,
  syncTreasurySafesForParent,
} from '../dashboard/dashboard-data-sync';

const corePrefetchedParentIds = new Set<string>();
const automationReplayedGroupIds = new Set<string>();
let squadsWarmupDone = false;

function announcementsGroupIdFor(parent: Squad): string | null {
  return resolveAutomatedAnnounceGroupId(parent);
}

async function replayAutomationForGroup(
  groupId: string,
  parentId?: string | null,
): Promise<void> {
  if (automationReplayedGroupIds.has(groupId)) {
    if (parentId) await syncSquadInfraForParent(parentId);
    return;
  }
  automationReplayedGroupIds.add(groupId);
  try {
    await replayMlsAutomationSideEffects(groupId);
    if (parentId) await syncSquadInfraForParent(parentId);
  } catch {
    automationReplayedGroupIds.delete(groupId);
  }
}

async function replayAutomationForParent(parent: Squad): Promise<void> {
  const gid = announcementsGroupIdFor(parent);
  if (!gid) return;
  await replayAutomationForGroup(gid, parent.id);
}

/** Replay persisted MLS automation rows once per group per session (sponsor deploy, safes, etc.). */
export function ensureMlsAutomationReplayed(
  groupId: string | null | undefined,
  parentId?: string | null,
): void {
  const gid = groupId?.trim();
  if (!gid) return;
  void replayAutomationForGroup(gid, parentId);
}

function scheduleCoreParentPrefetch(parent: Squad): void {
  if (!parent.id || corePrefetchedParentIds.has(parent.id)) return;
  corePrefetchedParentIds.add(parent.id);
  void (async () => {
    await replayAutomationForParent(parent);
    await syncTreasurySafesForParent(parent.id);
    await syncSquadMemberEvmForParent(parent.id, announcementsGroupIdFor(parent));
  })();
}

/** Squad hub active: treasury + infra + member EVM, once per parent per session. */
export function scheduleHubParentPrefetch(parent: Squad | null | undefined): void {
  if (!parent?.id) return;
  scheduleCoreParentPrefetch(parent);
}

/** `#dashboard` channel selected: same core prefetch (shared session dedupe). */
export function scheduleDashboardChannelPrefetch(parent: Squad | null | undefined): void {
  if (!parent?.id) return;
  scheduleCoreParentPrefetch(parent);
}

/** After login when squads hydrate: best-effort warm all known parents once per session. */
export function scheduleAllSquadsHubWarmup(squads: Squad[]): void {
  if (squadsWarmupDone || squads.length === 0) return;
  squadsWarmupDone = true;
  for (const s of squads) scheduleCoreParentPrefetch(s);
}

export function resetDashboardPrefetchSession(): void {
  corePrefetchedParentIds.clear();
  automationReplayedGroupIds.clear();
  squadsWarmupDone = false;
  resetDashboardDataSyncInflight();
}
