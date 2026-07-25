import { invoke } from './index';

/** Runtime application configuration and feature flags, mirrored by `AppConfigSchema`. */
export interface AppConfigDto {
  squadNameMaxLength: number;
  channelNameMaxLength: number;
  commonsMaxTags: number;
  deploySafeMaxSigners: number;
  roleLabelMaxLength: number;
  walletAccountLabelMaxLength: number;
  customTokenSymbolMaxLength: number;
  pinDigitCount: number;
  analyticsEnabled: boolean;
}

/** Fetch the backend-owned runtime application configuration. */
export async function getAppConfig(): Promise<AppConfigDto> {
  return await invoke('get_app_config');
}
