const STORAGE_KEY = 'pacto_landing_theme';
const THEME_COLOR_LIGHT = '#ffffff';
const THEME_COLOR_DARK = '#141414';

export type ThemePreference = 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* ignore */
  }
  return 'light';
}

export function resolveTheme(preference: ThemePreference = readPreference()): ResolvedTheme {
  return preference;
}

export function syncThemeColor(resolved: ResolvedTheme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  }
}

/** Root bg is what rubber-band overscroll paints; match nav at top, footer at bottom. */
export function syncOverscrollBackground() {
  const root = document.documentElement;
  const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
  const nearBottom = maxScroll > 0 && window.scrollY >= maxScroll - 8;
  root.style.backgroundColor = nearBottom
    ? 'var(--surface-inverted)'
    : 'var(--surface-canvas)';
}

export function applyTheme(preference: ThemePreference = readPreference()): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  syncThemeColor(resolved);
  syncOverscrollBackground();
  return resolved;
}

export function writePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
}

export function toggleTheme(): ResolvedTheme {
  const next: ThemePreference = resolveTheme() === 'dark' ? 'light' : 'dark';
  writePreference(next);
  return applyTheme(next);
}

export function updateToggleLabel(button: HTMLElement, resolved: ResolvedTheme) {
  const label =
    resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
}

export function initThemeToggle(button: HTMLElement | null) {
  if (!button) return;

  const applyAndLabel = () => {
    const resolved = applyTheme();
    updateToggleLabel(button, resolved);
  };

  applyAndLabel();

  button.addEventListener('click', () => {
    const resolved = toggleTheme();
    updateToggleLabel(button, resolved);
  });
}

export function initOverscrollBackground() {
  syncOverscrollBackground();
  window.addEventListener('scroll', syncOverscrollBackground, { passive: true });
  window.addEventListener('resize', syncOverscrollBackground);
}
