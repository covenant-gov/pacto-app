import type { SquadDocProvider } from '../api/squad-docs';

/** Provider badge from the hostname; mirrors the backend map. Unparseable → `other`. */
export function docProviderFromUrl(url: string): SquadDocProvider {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host.includes('cryptpad')) return 'cryptpad';
  if (host.includes('docs.google.') || host.includes('drive.google.')) return 'google';
  if (host.includes('zoho')) return 'zoho';
  if (host.includes('notion.')) return 'notion';
  if (host.includes('etherpad')) return 'etherpad';
  return 'other';
}
