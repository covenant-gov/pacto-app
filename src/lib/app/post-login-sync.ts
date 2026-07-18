/**
 * Non-blocking network sync after account unlock / import.
 * Must not block PIN UI.
 */

import { get } from 'svelte/store';
import { connect as apiConnect } from '../api/auth';
import { fetchMessages, refreshProfileNow, syncMlsGroupsNow } from '../api/nostr';
import { dmLog } from '../utils/dm-debug';
import { dmSyncStatus } from '../../stores/dm';
import { scheduleCommonsStartupPrefetch } from '../commons/commons-prefetch';
import { checkForUpdates } from '../updater/update-check';
import {
  startupCheckEnabled,
  markStartupCheckRun,
  getHasRunStartupCheckThisSession,
} from '../../stores/startup-check';
import { isDevBuild } from '../updater/update-check';

export function runPostLoginNetworkSync(npub: string): void {
  scheduleCommonsStartupPrefetch();
  void (async () => {
    try {
      dmLog('post-login: connect()');
      await apiConnect();
      dmLog('post-login: connect() done');
    } catch (e) {
      console.error('connect after login failed:', e);
    }

    dmLog('post-login: fetchMessages(true)');
    dmSyncStatus.set('syncing');
    fetchMessages(true).catch((e) => console.error('fetch_messages failed:', e));

    try {
      await refreshProfileNow(npub);
    } catch (e) {
      console.error('Auto profile refresh failed:', e);
    }

    syncMlsGroupsNow(null).catch((e) => console.error('syncMlsGroupsNow after login failed:', e));
    dmLog('post-login: network sync done');

    runStartupUpdateCheckIfEnabled();
  })();
}

function runStartupUpdateCheckIfEnabled(): void {
  if (isDevBuild()) return;
  if (getHasRunStartupCheckThisSession()) return;
  if (!get(startupCheckEnabled)) return;

  markStartupCheckRun();
  void checkForUpdates();
}
