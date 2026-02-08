import { writable } from 'svelte/store';

export type Theme = 'default' | 'light' | 'colorful';

const STORAGE_KEY = 'pacto_theme';

const VALID_THEMES: Theme[] = ['default', 'light', 'colorful'];

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && VALID_THEMES.includes(value as Theme);
}

export function getStoredTheme(): Theme | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

function applyThemeToDocument(value: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', value);
}

export const theme = writable<Theme>('default');

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
