import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  mentionAlertsByChannelKey,
  incrementMentionAlert,
  clearMentionAlert,
  getMentionAlertKey,
  hubChannelAlertCount,
  resetSquadHubAlertStores,
  personalAlertsNeededBySquadId,
} from './squad-hub-alerts';
import {
  SQUAD_DASHBOARD_CHANNEL_NAME,
  MY_DASHBOARD_CHANNEL_NAME,
} from '../lib/squad/hub-channel-names';
import type { CommonsJoinRequestDto } from '../lib/commons/types';

describe('squad-hub-alerts', () => {
  beforeEach(() => {
    resetSquadHubAlertStores();
  });

  describe('incrementMentionAlert', () => {
    it('increases the keyed count', () => {
      incrementMentionAlert('squad-1', 'chat');
      incrementMentionAlert('squad-1', 'chat');
      incrementMentionAlert('squad-1', 'announcements');

      expect(get(mentionAlertsByChannelKey)).toEqual({
        'squad-1:chat': 2,
        'squad-1:announcements': 1,
      });
    });
  });

  describe('clearMentionAlert', () => {
    it('removes the keyed count', () => {
      incrementMentionAlert('squad-1', 'chat');
      incrementMentionAlert('squad-1', 'announcements');

      clearMentionAlert('squad-1', 'chat');

      expect(get(mentionAlertsByChannelKey)).toEqual({
        'squad-1:announcements': 1,
      });
    });

    it('does nothing when the key does not exist', () => {
      incrementMentionAlert('squad-1', 'announcements');

      clearMentionAlert('squad-1', 'chat');

      expect(get(mentionAlertsByChannelKey)).toEqual({
        'squad-1:announcements': 1,
      });
    });
  });

  describe('getMentionAlertKey', () => {
    it('trims both ids', () => {
      expect(getMentionAlertKey(' squad-1 ', ' chat ')).toBe('squad-1:chat');
    });
  });

  describe('hubChannelAlertCount', () => {
    it('returns mention counts for regular channels', () => {
      incrementMentionAlert('squad-1', 'chat');
      incrementMentionAlert('squad-1', 'chat');

      expect(hubChannelAlertCount('chat', 'squad-1', {})).toBe(2);
    });

    it('returns join-request counts for squad dashboard', () => {
      const joinRequests: Record<string, CommonsJoinRequestDto[]> = {
        'squad-1': [
          {
            eventId: 'a',
            requesterNpub: 'npub-1',
            squadId: 'squad-1',
            squadName: 'Squad One',
            broadcastEventId: 'e1',
            createdAt: 0,
            status: 'pending',
          },
          {
            eventId: 'b',
            requesterNpub: 'npub-2',
            squadId: 'squad-1',
            squadName: 'Squad One',
            broadcastEventId: 'e2',
            createdAt: 0,
            status: 'pending',
          },
        ],
      };

      expect(hubChannelAlertCount(SQUAD_DASHBOARD_CHANNEL_NAME, 'squad-1', joinRequests)).toBe(2);
    });

    it('returns personal alert count for my-dashboard', () => {
      personalAlertsNeededBySquadId.set({ 'squad-1': true });

      expect(hubChannelAlertCount(MY_DASHBOARD_CHANNEL_NAME, 'squad-1', {})).toBe(1);
    });

    it('returns zero for my-dashboard when no personal alert is needed', () => {
      personalAlertsNeededBySquadId.set({ 'squad-1': false });

      expect(hubChannelAlertCount(MY_DASHBOARD_CHANNEL_NAME, 'squad-1', {})).toBe(0);
    });

    it('returns zero when squadId is missing', () => {
      incrementMentionAlert('squad-1', 'chat');

      expect(hubChannelAlertCount('chat', '', {})).toBe(0);
      expect(hubChannelAlertCount('chat', null, {})).toBe(0);
      expect(hubChannelAlertCount('chat', undefined, {})).toBe(0);
    });

    it('trims squadId before looking up counts', () => {
      incrementMentionAlert('squad-1', 'chat');

      expect(hubChannelAlertCount('chat', ' squad-1 ', {})).toBe(1);
    });
  });

  describe('resetSquadHubAlertStores', () => {
    it('clears the store', () => {
      incrementMentionAlert('squad-1', 'chat');
      personalAlertsNeededBySquadId.set({ 'squad-1': true });

      resetSquadHubAlertStores();

      expect(get(mentionAlertsByChannelKey)).toEqual({});
      expect(get(personalAlertsNeededBySquadId)).toEqual({});
    });
  });
});
