/** Prefetch dashboard data when `#dashboard` is selected for the open hub parent. */

import type { Squad } from '../../stores/squads';
import { scheduleDashboardChannelPrefetch } from './dashboard-parent-prefetch';

export function scheduleDashboardPrefetch(parent: Squad | null | undefined): void {
  scheduleDashboardChannelPrefetch(parent);
}
