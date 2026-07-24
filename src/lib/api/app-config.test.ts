import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getAppConfig, type AppConfigDto } from './app-config';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('app-config command wrappers', () => {
  it('getAppConfig sends get_app_config with no args and returns the result unchanged', async () => {
    const dto: AppConfigDto = {
      squadNameMaxLength: 50,
      channelNameMaxLength: 50,
      commonsMaxTags: 3,
      deploySafeMaxSigners: 10,
      roleLabelMaxLength: 32,
      walletAccountLabelMaxLength: 64,
      customTokenSymbolMaxLength: 16,
      pinDigitCount: 6,
      analyticsEnabled: false,
    };
    mockedInvoke.mockResolvedValueOnce(dto);

    const result = await getAppConfig();

    expect(mockedInvoke).toHaveBeenCalledWith('get_app_config');
    expect(result).toEqual(dto);
  });
});
