import { describe, it, expect } from 'vitest';
import * as wallet from './index';

describe('wallet index re-exports', () => {
  it('re-exports chain helpers', () => {
    expect(wallet.SUPPORTED_CHAINS).toBeDefined();
    expect(wallet.DEFAULT_CHAIN_ID).toBe('sepolia');
    expect(wallet.getChainConfig).toBeInstanceOf(Function);
    expect(wallet.getEffectiveRpcUrlsForChain).toBeInstanceOf(Function);
    expect(wallet.createWalletPublicClient).toBeInstanceOf(Function);
  });

  it('re-exports public client and backend wallet helpers', () => {
    expect(wallet.getPublicClient).toBeInstanceOf(Function);
    expect(wallet.getWalletSummary).toBeInstanceOf(Function);
    expect(wallet.walletBuildAndSendTransaction).toBeInstanceOf(Function);
    expect(wallet.walletWaitForTransaction).toBeInstanceOf(Function);
    expect(wallet.parseWalletOpError).toBeInstanceOf(Function);
    expect(wallet.safeDeployProxy).toBeInstanceOf(Function);
    expect(wallet.userFacingDeploySafeMessage).toBeInstanceOf(Function);
  });

  it('re-exports Safe and pricing helpers', () => {
    expect(wallet.getSafeState).toBeInstanceOf(Function);
    expect(wallet.getWalletUsdSpotPrices).toBeInstanceOf(Function);
    expect(wallet.amountToApproxUsd).toBeInstanceOf(Function);
    expect(wallet.formatApproxUsd).toBeInstanceOf(Function);
  });

  it('re-exports asset and watched-token helpers', () => {
    expect(wallet.WALLET_ASSETS).toBeDefined();
    expect(wallet.WALLET_ASSETS_CHAIN_IDS).toBeDefined();
    expect(wallet.getWalletAssetsForChain).toBeInstanceOf(Function);
    expect(wallet.loadWatchedErc20Rows).toBeInstanceOf(Function);
    expect(wallet.saveWatchedErc20Rows).toBeInstanceOf(Function);
    expect(wallet.defaultWatchedErc20Rows).toBeInstanceOf(Function);
  });

  it('re-exports DM wallet and clipboard helpers', () => {
    expect(wallet.parseWalletTxRequest).toBeInstanceOf(Function);
    expect(wallet.parseWalletTxAnnouncement).toBeInstanceOf(Function);
    expect(wallet.copyTextToClipboard).toBeInstanceOf(Function);
  });
});
