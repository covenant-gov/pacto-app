import { get, writable } from 'svelte/store';

/**
 * Single registry for skins. To add one:
 * 1. Create `src/styles/themes/<id>.css` with `[data-theme="<id>"] { ...shared --tokens }`
 * 2. `@import` it in `app.css` (default skin should also target `:root` and load first)
 * 3. Append `{ value, labelKey }` below and add matching `settings.theme.*` keys in en+es
 * 4. Allow `<id>` in the inline script in `src/app.html` (prevents theme flash on load)
 * 5. Mark dark skins in `DARK_THEME_IDS` so `color-scheme: dark` stays in sync
 * 6. Window chrome follows `--bg-elevated` via `syncWindowChrome` (macOS titlebar tint)
 */
export const THEME_OPTIONS = [
  { value: 'techno', labelKey: 'settings.theme.techno' },
  { value: 'dark-techno', labelKey: 'settings.theme.darkTechno' },
  { value: 'union', labelKey: 'settings.theme.union' },
  { value: 'midnight', labelKey: 'settings.theme.midnight' },
  { value: 'aztec', labelKey: 'settings.theme.aztec' },
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]['value'];

export const DEFAULT_THEME: Theme = 'dark-techno';

/** Matches dark-techno `--bg-elevated` and tauri.conf window backgroundColor. */
export const DEFAULT_WINDOW_BG = '#242019';

/** These ids use `color-scheme: dark`. */
export const DARK_THEME_IDS = ['dark-techno', 'aztec', 'midnight', 'union'] as const;

export type DarkTheme = (typeof DARK_THEME_IDS)[number];

const DARK_THEME_SET = new Set<string>(DARK_THEME_IDS);

export function isDarkTheme(value: Theme): boolean {
  return DARK_THEME_SET.has(value);
}

const STORAGE_KEY = 'pacto_theme';

const VALID_THEME_SET = new Set<string>(THEME_OPTIONS.map((o) => o.value));

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && VALID_THEME_SET.has(value);
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

export function readElevatedBackground(): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return DEFAULT_WINDOW_BG;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim();
  return raw || DEFAULT_WINDOW_BG;
}

/** Pin NSWindow / webview chrome to the active skin so macOS titlebar tint spans full width. */
export async function syncWindowChrome(value: Theme = get(theme)): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await Promise.all([
      win.setBackgroundColor(readElevatedBackground()),
      win.setTheme(isDarkTheme(value) ? 'dark' : 'light'),
    ]);
  } catch {
    // Browser, missing capability, or pre-API runtime — ignore.
  }
}

let resizeChromeHooked = false;

async function ensureResizeChromeSync(): Promise<void> {
  if (resizeChromeHooked || !isTauriRuntime()) return;
  resizeChromeHooked = true;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().onResized(() => {
      void syncWindowChrome(get(theme));
    });
  } catch {
    resizeChromeHooked = false;
  }
}

export function getStoredTheme(): Theme | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    if (!isTheme(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function applyThemeToDocument(value: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', value);
}

export const theme = writable<Theme>(DEFAULT_THEME);

export function setTheme(value: Theme): void {
  if (!isTheme(value)) return;
  theme.set(value);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, value);
    }
  } catch {
    // ignore
  }
  applyThemeToDocument(value);
  void syncWindowChrome(value);
  void ensureResizeChromeSync();
}
