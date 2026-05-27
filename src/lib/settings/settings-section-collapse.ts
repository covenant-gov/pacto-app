import { writable } from 'svelte/store';

export const SETTINGS_SECTION_IDS = [
  'settings-profile',
  'settings-nostr',
  'settings-evm',
  'settings-app',
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

const STORAGE_KEY = 'pacto_settings_section_collapsed_v1';
const STORAGE_VERSION = 1 as const;

/** `true` = collapsed. Missing keys default to collapsed. */
export type SettingsSectionCollapseState = Partial<Record<SettingsSectionId, boolean>>;

function isSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

function loadCollapseState(): SettingsSectionCollapseState {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as {
      v?: number;
      sections?: unknown;
    };
    if (parsed?.v !== STORAGE_VERSION || typeof parsed.sections !== 'object' || !parsed.sections) {
      return {};
    }
    const out: SettingsSectionCollapseState = {};
    for (const [key, value] of Object.entries(parsed.sections)) {
      if (isSectionId(key) && typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function persistCollapseState(state: SettingsSectionCollapseState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, sections: state }));
  } catch {
    // ignore
  }
}

export const settingsSectionCollapsed = writable<SettingsSectionCollapseState>(loadCollapseState());

export function isSettingsSectionCollapsed(
  sectionId: SettingsSectionId,
  state: SettingsSectionCollapseState = loadCollapseState(),
): boolean {
  return state[sectionId] ?? true;
}

export function setSettingsSectionCollapsed(sectionId: SettingsSectionId, collapsed: boolean): void {
  settingsSectionCollapsed.update((current) => {
    const next = { ...current, [sectionId]: collapsed };
    persistCollapseState(next);
    return next;
  });
}
