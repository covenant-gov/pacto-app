/** Prefetch dashboard data when a squad hub parent becomes active. */

import type { Squad } from '../../stores/squads';
import {
  resetDashboardPrefetchSession,
  scheduleAllSquadsHubWarmup,
  scheduleHubParentPrefetch,
  ensureMlsAutomationReplayed,
} from './dashboard-parent-prefetch';

export {
  resetDashboardPrefetchSession,
  scheduleAllSquadsHubWarmup,
  scheduleHubParentPrefetch,
  ensureMlsAutomationReplayed,
};

export function scheduleHubPrefetch(parent: Squad | null | undefined): void {
  scheduleHubParentPrefetch(parent);
}
