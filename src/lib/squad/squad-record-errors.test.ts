import { describe, expect, it } from 'vitest';
import { squadRecordErrorMessage } from './squad-record-errors';
import en from '../i18n/locales/en/errors.json';

const t = (key: string) => (en as Record<string, string>)[key] ?? key;

describe('squadRecordErrorMessage', () => {
  it('translates known codes from strings and Error objects', () => {
    expect(squadRecordErrorMessage('squad_event_create_restricted', t)).toBe(
      'You cannot add events in this squad.',
    );
    expect(squadRecordErrorMessage(new Error(' squad_event_not_found '), t)).toBe('This event is no longer available.');
    expect(squadRecordErrorMessage('squad_doc_invalid_url', t)).toBe('Use a link that starts with http:// or https://.');
  });

  it('has a catalog entry for every code', () => {
    for (const code of [
      'squad_records_not_member',
      'squad_records_not_admin',
      'squad_records_wrong_group',
      'squad_event_create_restricted',
      'squad_event_not_found',
      'squad_event_not_editable',
      'squad_event_invalid_title',
      'squad_event_invalid_zone',
      'squad_event_invalid_time',
      'squad_event_invalid_place',
      'squad_event_invalid_series',
      'squad_doc_add_restricted',
      'squad_doc_not_found',
      'squad_doc_not_editable',
      'squad_doc_invalid_url',
      'squad_doc_invalid_title',
    ]) {
      expect(squadRecordErrorMessage(code, t)).not.toMatch(/^errors\./);
    }
  });

  it('falls back to the raw message, then the given fallback', () => {
    expect(squadRecordErrorMessage('relay offline', t, 'Could not post')).toBe('relay offline');
    expect(squadRecordErrorMessage(null, t, 'Could not post')).toBe('Could not post');
    expect(squadRecordErrorMessage(undefined, t)).toBe('Something went wrong');
  });
});
