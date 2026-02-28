/**
 * Embedded wallet: chain config, public client, and read-only account access.
 * Signing is done in the backend via Tauri (no private key in frontend).
 */

export {
  SUPPORTED_CHAINS,
  DEFAULT_CHAIN_ID,
  getChainConfig,
  createWalletPublicClient,
  type SupportedChainId,
} from './chains';

export { getCurrentAddress, getPublicClient, getBalance } from './client';
