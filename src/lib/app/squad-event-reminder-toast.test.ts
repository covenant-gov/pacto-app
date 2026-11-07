import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { eventTimeFormat } from '../../stores/event-time-format';
import { clearToast, runToastRetryAction, toastMessage } from '../../stores/toast';
import { formatEventStart } from '../squad/squad-event-display';
import { showSquadEventReminderToast } from './squad-event-reminder-toast';

const mocks = vi.hoisted(() => ({ focusSquadEvent: vi.fn() }));

vi.mock('@tauri-apps/api/core');
vi.mock('../../stores/events-navigation', () => ({
  focusSquadEvent: mocks.focusSquadEvent,
  focusSquadEventSeries: vi.fn(),
}));

const due = {
  eventId: 'evt-1',
  parentId: 'squad-1',
  mlsGroupId: 'grp-ann',
  title: 'Standup',
  startUnix: 1_767_225_600,
  startDate: null,
  startTzid: 'America/New_York',
};

afterEach(() => {
  clearToast();
  eventTimeFormat.set('system');
  mocks.focusSquadEvent.mockReset();
});

describe('showSquadEventReminderToast', () => {
  it('shows the title and start only', () => {
    showSquadEventReminderToast(due);
    const toast = get(toastMessage);
    expect(toast?.text).toBe(`Starting soon: Standup, ${formatEventStart(due, { locale: 'en' })}`);
    expect(toast?.retryLabel).toBe('Open event');
  });

  it.each(['12h', '24h'] as const)('uses the selected %s format for reminder time', (clockFormat) => {
    eventTimeFormat.set(clockFormat);
    showSquadEventReminderToast(due);
    expect(get(toastMessage)?.text).toContain(formatEventStart(due, { locale: 'en', clockFormat }));
  });

  it('opens the event detail from the toast action and dismisses the toast', () => {
    showSquadEventReminderToast(due);
    runToastRetryAction();
    expect(mocks.focusSquadEvent).toHaveBeenCalledWith('squad-1', 'evt-1');
    expect(get(toastMessage)).toBeNull();
  });
});
