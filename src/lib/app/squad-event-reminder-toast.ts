import { get } from 'svelte/store';
import { t, locale } from 'svelte-i18n';
import type { SquadEventReminderDue } from '../api/squad-events';
import { formatEventStart } from '../squad/squad-event-display';
import { focusSquadEvent } from '../../stores/events-navigation';
import { clearToast, showToast } from '../../stores/toast';

/** In-app notice for an on-time reminder: title and start only; the action opens the event detail. */
export function showSquadEventReminderToast(due: SquadEventReminderDue): void {
  const tr = get(t);
  const start = formatEventStart(due, { locale: get(locale) ?? undefined });
  showToast(tr('events.reminder.toast', { values: { title: due.title, start } }), undefined, {
    label: tr('events.reminder.open'),
    action: () => {
      clearToast();
      focusSquadEvent(due.parentId, due.eventId);
    },
  });
}
