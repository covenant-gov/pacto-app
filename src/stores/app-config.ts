import { writable } from 'svelte/store';
import { z } from 'zod';
import { getAppConfig } from '../lib/api/app-config';
import { showToast } from './toast';

/** Mirrors the Rust `AppConfig` struct (`src-tauri/src/app_config.rs`). See `docs/RUNTIME_CONFIG.md`. */
export const AppConfigSchema = z.object({
  squadNameMaxLength: z.number().int().positive(),
  channelNameMaxLength: z.number().int().positive(),
  commonsMaxTags: z.number().int().positive(),
  deploySafeMaxSigners: z.number().int().positive(),
  roleLabelMaxLength: z.number().int().positive(),
  walletAccountLabelMaxLength: z.number().int().positive(),
  customTokenSymbolMaxLength: z.number().int().positive(),
  pinDigitCount: z.number().int().min(4),
  analyticsEnabled: z.boolean(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Compiled fallback; must match `default_app_config()` in `src-tauri/src/app_config.rs`. */
export const DEFAULT_APP_CONFIG: AppConfig = {
  squadNameMaxLength: 50,
  channelNameMaxLength: 35,
  commonsMaxTags: 3,
  deploySafeMaxSigners: 10,
  roleLabelMaxLength: 32,
  walletAccountLabelMaxLength: 64,
  customTokenSymbolMaxLength: 16,
  pinDigitCount: 6,
  analyticsEnabled: false,
};

/** Runtime application configuration, fetched from the backend at boot. */
export const appConfig = writable<AppConfig>(DEFAULT_APP_CONFIG);

/**
 * Fetch and validate `get_app_config` from the backend, populating `appConfig`.
 * On an unreachable backend or a malformed/missing field, falls back to
 * `DEFAULT_APP_CONFIG` and shows exactly one error toast.
 */
export async function loadAppConfig(): Promise<void> {
  try {
    const raw = await getAppConfig();
    appConfig.set(AppConfigSchema.parse(raw));
  } catch (e) {
    console.error('[app-config] Failed to load/validate app config:', e);
    appConfig.set(DEFAULT_APP_CONFIG);
    showToast('Could not load app configuration. Using defaults.', undefined, undefined, { error: true });
  }
}
