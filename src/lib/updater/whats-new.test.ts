import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  acknowledgeWhatsNew,
  loadInstalledWhatsNew,
  loadWhatsNew,
  rememberVersionBeforeUpdate,
  type NotesLoaders,
} from './whats-new';

let values: Map<string, string>;
const key = 'pacto_whats_new_seen_alice';
function release(version: string, title = 'Easier conversations') {
  return { version, items: Array.from({ length: 3 }, () => ({ kind: 'improved', title: { en: title, es: 'Conversaciones más fáciles' }, detail: { en: 'Find your conversations faster.', es: 'Encuentra tus conversaciones más rápido.' } })) };
}
function loaders(...versions: string[]): NotesLoaders {
  return Object.fromEntries(versions.map(version => [`/whats-new/${version}.json`, async () => release(version)]));
}
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
  setCurrentNpubForPersistence('alice');
});
afterEach(() => { setCurrentNpubForPersistence(null); vi.unstubAllGlobals(); });

describe('post-update notes', () => {
  it('is silent on a fresh install, equal version, or downgrade', async () => {
    expect(await loadWhatsNew('0.10.0', loaders('0.10.0'))).toBeNull();
    rememberVersionBeforeUpdate('0.10.0');
    expect(await loadWhatsNew('0.10.0', loaders('0.10.0'))).toBeNull();
    expect(await loadWhatsNew('0.9.0', loaders('0.9.0'))).toBeNull();
  });
  it('accumulates all skipped releases in SemVer order, excluding origin and future versions', async () => {
    rememberVersionBeforeUpdate('0.8.0');
    const result = await loadWhatsNew('0.10.0', loaders('0.10.0', '0.8.0', '0.9.0', '0.11.0'));
    expect(result?.releases.map(r => r.version)).toEqual(['0.9.0', '0.10.0']);
    expect(values.get(key)).toBe('0.8.0');
    acknowledgeWhatsNew(result!);
    expect(await loadWhatsNew('0.10.0', loaders('0.9.0', '0.10.0'))).toBeNull();
  });
  it('retains unacknowledged notes through a second update', async () => {
    rememberVersionBeforeUpdate('0.8.0');
    rememberVersionBeforeUpdate('0.9.0');
    expect(values.get(key)).toBe('0.8.0');
  });
  it('handles a downgrade followed by an update without losing the origin', async () => {
    rememberVersionBeforeUpdate('0.8.0');
    expect(await loadWhatsNew('0.7.0', loaders('0.7.0'))).toBeNull();
    rememberVersionBeforeUpdate('0.7.0');
    expect((await loadWhatsNew('0.10.0', loaders('0.8.0', '0.9.0', '0.10.0')))?.releases).toHaveLength(3);
  });
  it('does not reopen empty notes or an explicit skip', async () => {
    rememberVersionBeforeUpdate('0.8.0');
    expect(await loadWhatsNew('0.9.0', { '/whats-new/0.9.0.json': async () => ({ version: '0.9.0', items: [] }) })).toBeNull();
    expect(values.get(key)).toBe('0.9.0');
    rememberVersionBeforeUpdate('0.9.0');
    expect(await loadWhatsNew('0.10.0', {})).toBeNull();
    expect(values.get(key)).toBe('0.10.0');
  });
  it('is silent on malformed data, invalid versions, and loading failures', async () => {
    rememberVersionBeforeUpdate('0.8.0');
    expect(await loadWhatsNew('bad', loaders('0.9.0'))).toBeNull();
    expect(await loadWhatsNew('0.9.0', { '/whats-new/0.9.0.json': async () => { throw Error('unavailable'); } })).toBeNull();
    expect(await loadWhatsNew('0.9.0', { '/whats-new/0.9.0.json': async () => ({ version: '0.9.0', items: [{ title: {} }] }) })).toBeNull();
    expect(values.get(key)).toBe('0.8.0');
  });
  it('rejects blank locales and malformed item counts silently', async () => {
    rememberVersionBeforeUpdate('0.8.0');
    const blank = release('0.9.0');
    blank.items[0].title.es = ' ';
    expect(await loadWhatsNew('0.9.0', { '/whats-new/0.9.0.json': async () => blank })).toBeNull();
    const short = release('0.9.0');
    short.items.pop();
    expect(await loadWhatsNew('0.9.0', { '/whats-new/0.9.0.json': async () => short })).toBeNull();
    expect(values.get(key)).toBe('0.8.0');
  });
  it('isolates accounts, including a switch while notes load', async () => {
    rememberVersionBeforeUpdate('0.8.0');
    const pending = Promise.withResolvers<unknown>();
    const result = loadWhatsNew('0.9.0', { '/whats-new/0.9.0.json': () => pending.promise });
    setCurrentNpubForPersistence('bob');
    pending.resolve(release('0.9.0'));
    expect(await result).toBeNull();
    expect(await loadWhatsNew('0.9.0', loaders('0.9.0'))).toBeNull();
    expect(values.get(key)).toBe('0.8.0');
  });
  it('is silent when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } });
    expect(() => rememberVersionBeforeUpdate('0.8.0')).not.toThrow();
    expect(await loadWhatsNew('0.9.0', loaders('0.9.0'))).toBeNull();
  });
});

describe('installed version notes for Settings', () => {
  it('reopens the installed release even after the post-update marker is caught up', async () => {
    values.set(key, '0.10.0');
    const result = await loadInstalledWhatsNew('v0.10.0', loaders('0.10.0', '0.9.0'));
    expect(result).toEqual({
      status: 'ready',
      version: '0.10.0',
      releases: [release('0.10.0')],
    });
  });

  it('does not need a signed-in account or storage marker', async () => {
    setCurrentNpubForPersistence(null);
    expect(await loadInstalledWhatsNew('0.9.0', loaders('0.9.0'))).toMatchObject({
      status: 'ready',
      version: '0.9.0',
    });
  });

  it('returns none for empty notes, missing files, betas, and malformed data', async () => {
    expect(await loadInstalledWhatsNew('0.9.0', {
      '/whats-new/0.9.0.json': async () => ({ version: '0.9.0', items: [] }),
    })).toEqual({ status: 'none' });
    expect(await loadInstalledWhatsNew('0.9.0', {})).toEqual({ status: 'none' });
    expect(await loadInstalledWhatsNew('0.9.0-beta.1', loaders('0.9.0'))).toEqual({ status: 'none' });
    expect(await loadInstalledWhatsNew('0.9.0', {
      '/whats-new/0.9.0.json': async () => ({ version: '0.9.0', items: [{ title: {} }] }),
    })).toEqual({ status: 'none' });
    expect(await loadInstalledWhatsNew('0.9.0', {
      '/whats-new/0.9.0.json': async () => { throw Error('unavailable'); },
    })).toEqual({ status: 'none' });
    expect(await loadInstalledWhatsNew('bad', loaders('0.9.0'))).toEqual({ status: 'none' });
  });
});
