/**
 * Embedded wallet: chain config, public client, and read-only account access.
 * Signing is done in the backend via Tauri (no private key in frontend).
 */

export {
  SUPPORTED_CHAINS,
  DEFAULT_CHAIN_ID,
  getChainConfig,
  getEffectiveRpcUrlsForChain,
  createWalletPublicClient,
  type SupportedChainId,
} from './chains';

export { getPublicClient } from './client';
export {
  getWalletSummary,
  walletBuildAndSendTransaction,
  walletWaitForTransaction,
  parseWalletOpError,
  safeDeployProxy,
  userFacingDeploySafeMessage,
  type WalletSummary,
  type WalletSummaryResult,
  type WalletSummaryNetwork,
  type WalletSummaryAsset,
  type WalletSendResult,
  type WalletSendResultOutcome,
  type WalletOpParsedError,
  type WalletTransferSuccessDetail,
  type SafeDeployProxyResult,
  type SafeDeployProxyOutcome,
} from './backend-wallet';
export { getSafeState, type SafeState } from './safe';
export {
  getWalletUsdSpotPrices,
  amountToApproxUsd,
  formatApproxUsd,
  type WalletUsdSpotPrices,
  type WalletUsdSpotPricesResult,
} from './pricing';
export {
  WALLET_ASSETS,
  WALLET_ASSETS_CHAIN_IDS,
  WALLET_CHAIN_GROUPS,
  getWalletAssetsForChain,
  getWalletNetworkDisplayName,
  getExplorerTxUrl,
  explorerTxLinkLabel,
  listWalletAssetOptionsForChain,
  type WalletAssetCode,
  type WalletStablecoin,
  type WalletAssetsFile,
  type WalletNetworkAssets,
} from './assets';
export {
  loadWatchedErc20Rows,
  saveWatchedErc20Rows,
  watchedRowsToWire,
  defaultWatchedErc20Rows,
  buildCatalogSearchEntries,
  listWalletAssetOptionsForChainWithWatched,
  type WatchedErc20Row,
  type WatchedErc20Wire,
  type CatalogSearchEntry,
  type WalletAssetOptionRow,
} from './watched-tokens';

export {
  WALLET_TX_REQUEST_WIRE_TYPE,
  WALLET_TX_ANNOUNCEMENT_WIRE_TYPE,
  parseWalletTxRequest,
  parseWalletTxAnnouncement,
  formatWalletTxRequest,
  formatWalletTxAnnouncement,
  getFulfilledWalletRequestIdsFromMessages,
  type WalletTxRequestPayload,
  type WalletTxAnnouncementPayload,
} from './dm-messages';
export {
  WALLET_SUMMARY_CACHE_VERSION,
  hydrateWalletSummaryCacheFromDisk,
  persistWalletSummaryCache,
  clearWalletSummaryCacheStore,
  getMatchingCachedSummary,
  walletSummaryHydrated,
  watchedWireFingerprint,
  type WalletSummaryHydrated,
} from './wallet-summary-cache';
export { scheduleWalletSummaryBackgroundPrefetch } from './wallet-summary-prefetch';
export { copyTextToClipboard } from './clipboard-copy';
