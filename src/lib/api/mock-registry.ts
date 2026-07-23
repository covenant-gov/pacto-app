import type { MockCommandHandler } from './mock-invoke';
import {
  authFixtures,
  profileFixtures,
  chatFixtures,
  walletFixtures,
  settingFixtures,
  encryptionFixtures,
  relayFixtures,
  commonsFixtures,
} from './mock-fixtures';

export const mockCommandRegistry: Record<string, MockCommandHandler> = {
  ...authFixtures,
  ...profileFixtures,
  ...chatFixtures,
  ...walletFixtures,
  ...settingFixtures,
  ...encryptionFixtures,
  ...relayFixtures,
  ...commonsFixtures,
};
