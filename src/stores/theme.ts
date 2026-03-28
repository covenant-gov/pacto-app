import { writable } from 'svelte/store';

/**
 * Single registry for skins. To add one:
 * 1. Create `src/styles/themes/<id>.css` with `[data-theme="<id>"] { ...shared --tokens }`
 * 2. `@import` it in `app.css` (default skin should also target `:root` and load first)
 * 3. Append `{ value, label }` below
 * 4. Allow `<id>` in the inline script in `src/app.html` (prevents theme flash on load)
 */
export const THEME_OPTIONS = [
  { value: 'techno', label: 'Techno' },
  { value: 'dark-techno', label: 'Dark-Techno' },
  { value: 'union', label: 'Union' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'aztec', label: 'Aztec' },
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]['value'];

export const DEFAULT_THEME: Theme = 'dark-techno';

const STORAGE_KEY = 'pacto_theme';

const VALID_THEME_SET = new Set<string>(THEME_OPTIONS.map((o) => o.value));

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && VALID_THEME_SET.has(value);
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
}
