import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  searchGifs,
  trendingGifs,
  reportGifShare,
  klipyIsConfigured,
  isGifsDisclosureAccepted,
  acceptGifsDisclosure,
  createGifsSearchScheduler,
  GIFS_SEARCH_DEBOUNCE_MS,
  sendGifMessage,
  fetchGifMedia,
  fetchGifBlobUrl,
  isKlipyMediaUrl,
  type KlipyPage,
} from './klipy';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

function page(overrides: Partial<KlipyPage> = {}): KlipyPage {
  return {
    items: [
      {
        id: 'g1',
        slug: 'slug-1',
        title: 'Cool GIF',
        previewUrl: 'https://klipy.example/preview.gif?x=1',
        fullUrl: 'https://klipy.example/full.gif?x=1',
        width: 200,
        height: 150,
      },
    ],
    page: 1,
    perPage: 24,
    total: 1,
    hasMore: false,
    ...overrides,
  };
}

describe('klipy api wrappers', () => {
  const store = new Map<string, string>();
  // Node test env has no localStorage; stub it directly on globalThis.
  const globalStorageHolder = globalThis as unknown as { localStorage?: Storage };

  beforeEach(() => {
    mockedInvoke.mockReset();
    store.clear();
    globalStorageHolder.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    delete globalStorageHolder.localStorage;
    setCurrentNpubForPersistence(null);
  });

  describe('opt-in disclosure gate', () => {
    it('no Klipy invoke fires before the disclosure is accepted', async () => {
      expect(isGifsDisclosureAccepted()).toBe(false);
      await expect(searchGifs('cats', 1)).rejects.toThrow();
      await expect(trendingGifs(1)).rejects.toThrow();
      await expect(reportGifShare('slug-1')).rejects.toThrow();
      expect(mockedInvoke).not.toHaveBeenCalled();
    });

    it('acceptGifsDisclosure persists per npub and unblocks requests', async () => {
      acceptGifsDisclosure();
      expect(isGifsDisclosureAccepted()).toBe(true);
      expect(store.get('pacto_klipy_gifs_disclosure_accepted_v1_npub1test')).toBe('1');

      mockedInvoke.mockResolvedValueOnce(page());
      await searchGifs('cats', 1);
      expect(mockedInvoke).toHaveBeenCalledWith('klipy_search_gifs', { query: 'cats', page: 1 });
    });

    it('acceptance is scoped to the npub that accepted it', () => {
      acceptGifsDisclosure();
      expect(isGifsDisclosureAccepted()).toBe(true);
      setCurrentNpubForPersistence('npub1other');
      expect(isGifsDisclosureAccepted()).toBe(false);
    });

    it('persists without an npub and migrates onto the npub key once set', () => {
      setCurrentNpubForPersistence(null);
      expect(isGifsDisclosureAccepted()).toBe(false);
      acceptGifsDisclosure();
      expect(isGifsDisclosureAccepted()).toBe(true);
      expect(store.get('pacto_klipy_gifs_disclosure_accepted_v1_pending')).toBe('1');

      setCurrentNpubForPersistence('npub1test');
      expect(isGifsDisclosureAccepted()).toBe(true);
      expect(store.get('pacto_klipy_gifs_disclosure_accepted_v1_npub1test')).toBe('1');
    });

    it('clears the pending key after migrating it onto the npub key', () => {
      setCurrentNpubForPersistence(null);
      acceptGifsDisclosure();
      expect(store.get('pacto_klipy_gifs_disclosure_accepted_v1_pending')).toBe('1');

      setCurrentNpubForPersistence('npub1test');
      expect(isGifsDisclosureAccepted()).toBe(true);
      expect(store.get('pacto_klipy_gifs_disclosure_accepted_v1_pending')).toBeUndefined();
      expect(store.get('pacto_klipy_gifs_disclosure_accepted_v1_npub1test')).toBe('1');
    });

    it('klipyIsConfigured is not gated: it is a local check, not a Klipy request', async () => {
      mockedInvoke.mockResolvedValueOnce(true);
      const result = await klipyIsConfigured();
      expect(result).toBe(true);
      expect(mockedInvoke).toHaveBeenCalledWith('klipy_is_configured');
    });
  });

  describe('wrappers, once accepted', () => {
    beforeEach(() => {
      acceptGifsDisclosure();
    });

    it('searchGifs invokes klipy_search_gifs with the exact camelCase args', async () => {
      const result = page();
      mockedInvoke.mockResolvedValueOnce(result);
      const got = await searchGifs('cats', 2);
      expect(got).toEqual(result);
      expect(mockedInvoke).toHaveBeenCalledWith('klipy_search_gifs', { query: 'cats', page: 2 });
    });

    it('trendingGifs invokes klipy_trending_gifs with the exact camelCase args', async () => {
      const result = page();
      mockedInvoke.mockResolvedValueOnce(result);
      const got = await trendingGifs(1);
      expect(got).toEqual(result);
      expect(mockedInvoke).toHaveBeenCalledWith('klipy_trending_gifs', { page: 1 });
    });

    it('reportGifShare invokes klipy_report_share with a null query when none is given', async () => {
      mockedInvoke.mockResolvedValueOnce(true);
      const got = await reportGifShare('slug-1');
      expect(got).toBe(true);
      expect(mockedInvoke).toHaveBeenCalledWith('klipy_report_share', { slug: 'slug-1', query: null });
    });

    it('reportGifShare forwards a provided query', async () => {
      mockedInvoke.mockResolvedValueOnce(true);
      await reportGifShare('slug-1', 'cats');
      expect(mockedInvoke).toHaveBeenCalledWith('klipy_report_share', { slug: 'slug-1', query: 'cats' });
    });

    it('an invoke rejection surfaces through getInvokeErrorMessage', async () => {
      mockedInvoke.mockRejectedValueOnce({ message: 'Klipy is unreachable' });
      await expect(searchGifs('cats', 1)).rejects.toThrow('Klipy is unreachable');
    });

    it('a string invoke rejection also surfaces through getInvokeErrorMessage', async () => {
      mockedInvoke.mockRejectedValueOnce('rate limited');
      await expect(klipyIsConfigured()).rejects.toThrow('rate limited');
    });
  });
});

describe('sendGifMessage', () => {
  it('sends the receiver, url, slug, and repliedTo through byte-identical, unmodified', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const url = 'https://static.klipy.com/hd.gif?ext=gif&itemid=abc123';
    const got = await sendGifMessage('npub1abc', url, 'slug-1', 'reply-1');
    expect(got).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith('klipy_gif_message', {
      receiver: 'npub1abc',
      url,
      slug: 'slug-1',
      repliedTo: 'reply-1',
    });
  });

  it('an invoke rejection surfaces through getInvokeErrorMessage', async () => {
    mockedInvoke.mockRejectedValueOnce({ message: 'Missing GIF URL' });
    await expect(sendGifMessage('npub1abc', '', 'slug-1', '')).rejects.toThrow('Missing GIF URL');
  });
});

describe('isKlipyMediaUrl', () => {
  it('accepts each documented Klipy media CDN host over https', () => {
    expect(isKlipyMediaUrl('https://static.klipy.com/hd.gif')).toBe(true);
    expect(isKlipyMediaUrl('https://static1.klipy.com/hd.gif')).toBe(true);
    expect(isKlipyMediaUrl('https://static2.klipy.com/hd.gif?ext=gif')).toBe(true);
  });

  it('rejects an obvious SSRF attempt', () => {
    expect(isKlipyMediaUrl('http://127.0.0.1:8080/x')).toBe(false);
  });

  it('rejects a lookalike host', () => {
    expect(isKlipyMediaUrl('https://static.klipy.com.evil.com/hd.gif')).toBe(false);
    expect(isKlipyMediaUrl('https://evil.com/static.klipy.com/hd.gif')).toBe(false);
  });

  it('rejects plain http even for a real host', () => {
    expect(isKlipyMediaUrl('http://static.klipy.com/hd.gif')).toBe(false);
  });

  it('rejects a malformed url without throwing', () => {
    expect(isKlipyMediaUrl('not a url')).toBe(false);
  });
});

describe('fetchGifMedia', () => {
  it('invokes klipy_fetch_media and returns the bytes as a Uint8Array', async () => {
    mockedInvoke.mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4]).buffer);
    const url = 'https://static.klipy.com/hd.gif';
    const got = await fetchGifMedia(url);
    expect(got).toBeInstanceOf(Uint8Array);
    expect(Array.from(got)).toEqual([1, 2, 3, 4]);
    expect(mockedInvoke).toHaveBeenCalledWith('klipy_fetch_media', { url });
  });

  it('a fetch failure surfaces as a rejected promise, not a thrown error mid-render', async () => {
    mockedInvoke.mockRejectedValueOnce({ message: 'Refusing to fetch: not a Klipy media URL' });
    await expect(fetchGifMedia('http://127.0.0.1:8080/x')).rejects.toThrow(
      'Refusing to fetch: not a Klipy media URL'
    );
  });
});

describe('fetchGifBlobUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the bytes and wraps them in an object URL for an image/gif blob', async () => {
    mockedInvoke.mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);
    const createObjectURL = vi.fn((_blob: Blob) => 'blob://mock-gif');
    vi.stubGlobal('URL', { ...URL, createObjectURL });
    const url = 'https://static.klipy.com/hd.gif';

    const got = await fetchGifBlobUrl(url);

    expect(got).toBe('blob://mock-gif');
    expect(mockedInvoke).toHaveBeenCalledWith('klipy_fetch_media', { url });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0];
    expect(blob.type).toBe('image/gif');
  });
});

describe('createGifsSearchScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses rapid input into a single search call after the debounce window', () => {
    const fetchPage = vi.fn();
    const scheduler = createGifsSearchScheduler(fetchPage);
    scheduler.scheduleSearch('c');
    scheduler.scheduleSearch('ca');
    scheduler.scheduleSearch('cat');
    scheduler.scheduleSearch('cats');
    expect(fetchPage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GIFS_SEARCH_DEBOUNCE_MS);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith('cats', 1);
  });

  it('cancel prevents a pending debounced search from firing', () => {
    const fetchPage = vi.fn();
    const scheduler = createGifsSearchScheduler(fetchPage);
    scheduler.scheduleSearch('cats');
    scheduler.cancel();
    vi.advanceTimersByTime(GIFS_SEARCH_DEBOUNCE_MS);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
