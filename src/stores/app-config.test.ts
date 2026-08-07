import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../lib/api/app-config', () => ({
  getAppConfig: vi.fn(),
}));
vi.mock('./toast', () => ({
  showToast: vi.fn(),
}));

import { getAppConfig } from '../lib/api/app-config';
import { showToast } from './toast';
import { appConfig, loadAppConfig, DEFAULT_APP_CONFIG, AppConfigSchema } from './app-config';

const mockedGetAppConfig = vi.mocked(getAppConfig);
const mockedShowToast = vi.mocked(showToast);

describe('app-config store', () => {
  beforeEach(() => {
    mockedGetAppConfig.mockReset();
    mockedShowToast.mockReset();
  });

  afterEach(() => {
    appConfig.set(DEFAULT_APP_CONFIG);
  });

  it('starts with DEFAULT_APP_CONFIG before any load', () => {
    expect(get(appConfig)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('loadAppConfig populates appConfig with a valid backend response and shows no toast', async () => {
    const fetched = { ...DEFAULT_APP_CONFIG, squadNameMaxLength: 80 };
    mockedGetAppConfig.mockResolvedValueOnce(fetched);

    await loadAppConfig();

    expect(get(appConfig)).toEqual(fetched);
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('loadAppConfig falls back to DEFAULT_APP_CONFIG and toasts once when getAppConfig rejects', async () => {
    mockedGetAppConfig.mockRejectedValueOnce(new Error('backend unreachable'));

    await loadAppConfig();

    expect(get(appConfig)).toEqual(DEFAULT_APP_CONFIG);
    expect(mockedShowToast).toHaveBeenCalledTimes(1);
  });

  it('loadAppConfig falls back to DEFAULT_APP_CONFIG and toasts once when the response is malformed', async () => {
    mockedGetAppConfig.mockResolvedValueOnce({
      ...DEFAULT_APP_CONFIG,
      squadNameMaxLength: 'not-a-number',
    } as never);

    await loadAppConfig();

    expect(get(appConfig)).toEqual(DEFAULT_APP_CONFIG);
    expect(mockedShowToast).toHaveBeenCalledTimes(1);
  });

  // Must be kept in sync with the compiled constants in src-tauri/src/app_config.rs
  // (SQUAD_NAME_MAX_LENGTH, CHANNEL_NAME_MAX_LENGTH, COMMONS_MAX_TAGS,
  // DEPLOY_SAFE_MAX_SIGNERS, ROLE_LABEL_MAX_LENGTH, WALLET_ACCOUNT_LABEL_MAX_LENGTH,
  // CUSTOM_TOKEN_SYMBOL_MAX_LENGTH, PIN_DIGIT_COUNT, ANALYTICS_ENABLED).
  it('DEFAULT_APP_CONFIG matches the Rust default_app_config() constants', () => {
    expect(DEFAULT_APP_CONFIG).toEqual({
      squadNameMaxLength: 50,
      channelNameMaxLength: 35,
      commonsMaxTags: 3,
      deploySafeMaxSigners: 10,
      roleLabelMaxLength: 32,
      walletAccountLabelMaxLength: 64,
      customTokenSymbolMaxLength: 16,
      pinDigitCount: 6,
      analyticsEnabled: false,
    });
  });

  it('AppConfigSchema accepts DEFAULT_APP_CONFIG', () => {
    expect(AppConfigSchema.safeParse(DEFAULT_APP_CONFIG).success).toBe(true);
  });
});
