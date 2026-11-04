import { getInvokeErrorMessage } from '../utils/tauri-errors';

/** Backend error codes for squad records commands → `errors.squadRecords.*` keys. */
const KEY_BY_CODE: Record<string, string> = {
  squad_records_not_member: 'errors.squadRecords.notMember',
  squad_records_not_admin: 'errors.squadRecords.notAdmin',
  squad_records_wrong_group: 'errors.squadRecords.wrongGroup',
  squad_event_create_restricted: 'errors.squadRecords.eventCreateRestricted',
  squad_event_not_found: 'errors.squadRecords.eventNotFound',
  squad_event_not_editable: 'errors.squadRecords.eventNotEditable',
  squad_event_invalid_title: 'errors.squadRecords.eventInvalidTitle',
  squad_event_invalid_zone: 'errors.squadRecords.eventInvalidZone',
  squad_event_invalid_time: 'errors.squadRecords.eventInvalidTime',
  squad_event_invalid_place: 'errors.squadRecords.eventInvalidPlace',
  squad_event_invalid_series: 'errors.squadRecords.eventInvalidSeries',
  squad_doc_add_restricted: 'errors.squadRecords.docAddRestricted',
  squad_doc_not_found: 'errors.squadRecords.docNotFound',
  squad_doc_not_editable: 'errors.squadRecords.docNotEditable',
  squad_doc_invalid_url: 'errors.squadRecords.docInvalidUrl',
  squad_doc_invalid_title: 'errors.squadRecords.docInvalidTitle',
};

/** Translated message for a known squad records error code; otherwise the raw invoke message, then `fallback`. */
export function squadRecordErrorMessage(error: unknown, t: (key: string) => string, fallback?: string): string {
  const raw = getInvokeErrorMessage(error, '').trim();
  const key = KEY_BY_CODE[raw];
  if (key) return t(key);
  return raw || fallback || t('errors.fallback');
}
