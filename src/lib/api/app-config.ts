import { invoke } from './index';

/** One registered experimental feature, mirrored by `FeatureFlagDescriptorSchema`. */
export interface FeatureFlagDescriptorDto {
  key: string;
  defaultEnabled: boolean;
}

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
  featureFlags: FeatureFlagDescriptorDto[];
}

/** Fetch the backend-owned runtime application configuration. */
export async function getAppConfig(): Promise<AppConfigDto> {
  return await invoke('get_app_config');
}
