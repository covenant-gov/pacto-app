import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DARK_THEME_IDS, THEME_OPTIONS } from '../../stores/theme';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const themesDir = join(here);
const appCssPath = join(repoRoot, 'src/app.css');
const appHtmlPath = join(repoRoot, 'src/app.html');

const REQUIRED_THEME_TOKENS = [
  '--bg-page',
  '--bg-panel',
  '--bg-elevated',
  '--bg-hover',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--border',
  '--border-subtle',
  '--brand',
  '--brand-hover',
  '--on-brand',
  '--danger',
  '--success',
  '--warning',
  '--notif',
  '--on-notif',
  '--on-success',
  '--shell-rail-bg',
  '--user-strip-bg',
  '--gov-avatar-bg',
  '--role-quartermaster',
  '--role-community-manager',
  '--mention-accent',
  '--danger-muted-fg',
] as const;

const THEME_IDS = THEME_OPTIONS.map((o) => o.value);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    throw new Error(`expected 6-digit hex, got ${hex}`);
  }
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(channelToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenHex(css: string, name: string): string {
  const re = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`);
  const match = css.match(re);
  if (!match) {
    throw new Error(`missing hex for ${name}`);
  }
  return match[1];
}

describe('theme token contract', () => {
  it('registers one css file per theme id', () => {
    const files = readdirSync(themesDir)
      .filter((name) => name.endsWith('.css'))
      .map((name) => name.replace(/\.css$/, ''))
      .sort();
    expect(files).toEqual([...THEME_IDS].sort());
  });

  it('imports every theme file from app.css', () => {
    const appCss = read(appCssPath);
    for (const id of THEME_IDS) {
      expect(appCss).toContain(`@import './styles/themes/${id}.css';`);
    }
  });

  it('washes identity fills with brand and keeps glyphs light', () => {
    const appCss = read(appCssPath);
    expect(appCss).toContain('.identity-fill');
    expect(appCss).toContain('color-mix(in oklab, var(--identity) 62%, var(--brand) 38%)');
    expect(appCss).toContain('color-mix(in oklab, white 86%, var(--brand) 14%)');
    expect(appCss).not.toMatch(/\.identity-fill\s*\{[^}]*light-dark\(/s);
  });

  it('maps shadcn primary to brand and accent to hover surface', () => {
    const appCss = read(appCssPath);
    expect(appCss).toContain('--primary: var(--brand);');
    expect(appCss).toContain('--primary-foreground: var(--on-brand);');
    expect(appCss).toContain('--accent: var(--bg-hover);');
    expect(appCss).toContain('--accent-foreground: var(--text-primary);');
    expect(appCss).toContain('--font-mono: var(--font-mono-family);');
    expect(appCss).not.toMatch(/--font-mono:\s*var\(--font-mono\)\s*;/);
  });

  it('keeps early-load allowlist in sync with theme ids', () => {
    const appHtml = read(appHtmlPath);
    for (const id of THEME_IDS) {
      expect(appHtml).toContain(`t !== '${id}'`);
    }
  });

  for (const id of THEME_IDS) {
    it(`${id} defines the required tokens and color-scheme`, () => {
      const css = read(join(themesDir, `${id}.css`));
      for (const token of REQUIRED_THEME_TOKENS) {
        expect(css).toMatch(new RegExp(`${token}\\s*:`));
      }
      const expectDark = (DARK_THEME_IDS as readonly string[]).includes(id);
      expect(css).toContain(expectDark ? 'color-scheme: dark;' : 'color-scheme: light;');
      expect(css).not.toMatch(/--accent\s*:/);
      expect(css).not.toMatch(/--accent-hover\s*:/);
      expect(css).not.toMatch(/--accent-contrast\s*:/);
      expect(css).not.toMatch(/--bg-secondary\s*:/);
    });

    it(`${id} keeps readable on-brand text on brand`, () => {
      const css = read(join(themesDir, `${id}.css`));
      const brand = tokenHex(css, '--brand');
      const onBrand = tokenHex(css, '--on-brand');
      expect(contrastRatio(brand, onBrand)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${id} keeps readable notification and success fills`, () => {
      const css = read(join(themesDir, `${id}.css`));
      expect(contrastRatio(tokenHex(css, '--notif'), tokenHex(css, '--on-notif'))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokenHex(css, '--success'), tokenHex(css, '--on-success'))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${id} keeps readable active channel fills`, () => {
      const css = read(join(themesDir, `${id}.css`));
      expect(
        contrastRatio(tokenHex(css, '--channel-active-bg'), tokenHex(css, '--channel-active-fg')),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
