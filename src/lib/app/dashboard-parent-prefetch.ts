/**
 * Shared session dedupe + orchestration for dashboard parent prefetch (hub + #dashboard).
 */

import type { Squad } from '../../stores/squads';
import { resolveAutomatedAnnounceGroupId } from '../parent-navbar';
import {
  resetDashboardDataSyncInflight,
  syncSquadInfraForParent,
  syncSquadMemberEvmForParent,
  syncTreasurySafesForParent,
} from '../dashboard/dashboard-data-sync';

const corePrefetchedParentIds = new Set<string>();
let squadsWarmupDone = false;

function announcementsGroupIdFor(parent: Squad): string | null {
  return resolveAutomatedAnnounceGroupId(parent);
}

function scheduleCoreParentPrefetch(parent: Squad): void {
  if (!parent.id || corePrefetchedParentIds.has(parent.id)) return;
  corePrefetchedParentIds.add(parent.id);
  void syncTreasurySafesForParent(parent.id);
  void syncSquadInfraForParent(parent.id);
  void syncSquadMemberEvmForParent(parent.id, announcementsGroupIdFor(parent));
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
  squadsWarmupDone = false;
  resetDashboardDataSyncInflight();
}
