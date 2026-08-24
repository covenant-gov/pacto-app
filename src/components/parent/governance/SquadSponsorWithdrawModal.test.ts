// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const withdrawSquadSponsorMock = vi.fn();
const getSquadSponsorWithdrawableMock = vi.fn();

vi.mock('../../../lib/governance/api', () => ({
  getSquadSponsorWithdrawable: (...args: unknown[]) => getSquadSponsorWithdrawableMock(...args),
  withdrawSquadSponsor: (...args: unknown[]) => withdrawSquadSponsorMock(...args),
}));

const listEvmAccountsMock = vi.fn();
vi.mock('../../../lib/wallet/evm-accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/wallet/evm-accounts')>();
  return {
    ...actual,
    listEvmAccounts: (...args: unknown[]) => listEvmAccountsMock(...args),
  };
});

import SquadSponsorWithdrawModal from './SquadSponsorWithdrawModal.svelte';
import type { EvmAccountRow } from '../../../lib/wallet/evm-accounts';

function account(overrides: Partial<EvmAccountRow> = {}): EvmAccountRow {
  return {
    id: 'acct-1',
    scheme: 'secp256k1',
    hdIndex: 0,
    address: '0x1111111111111111111111111111111111111a',
    label: 'Main',
    purpose: 'squad',
    isActive: true,
    isDefaultShared: true,
    isActiveAdvanced: false,
    ...overrides,
  };
}

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    open: true,
    network: 'sepolia',
    parentId: 'parent-1',
    sponsorAddress: '0xsponsor00000000000000000000000000000000',
    onClose: vi.fn(),
    onSubmitted: vi.fn(),
    ...overrides,
  };
}

describe('SquadSponsorWithdrawModal', () => {
  beforeEach(() => {
    listEvmAccountsMock.mockReset();
    withdrawSquadSponsorMock.mockReset();
    getSquadSponsorWithdrawableMock.mockReset();
    listEvmAccountsMock.mockResolvedValue([account()]);
    getSquadSponsorWithdrawableMock.mockResolvedValue('1000000000000000000');
  });

  afterEach(() => {
    cleanup();
  });

  it('submits exactly one withdrawal, even under a rapid double confirm click', async () => {
    let resolveWithdraw: (() => void) | undefined;
    withdrawSquadSponsorMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWithdraw = resolve;
        }),
    );
    const props = baseProps();

    render(SquadSponsorWithdrawModal, { props });

    const confirm = await screen.findByRole('button', { name: 'Confirm withdraw' });
    await fireEvent.click(confirm);
    // Second click lands while the first submission is still in flight (acting guard).
    await fireEvent.click(confirm);

    expect(withdrawSquadSponsorMock).toHaveBeenCalledTimes(1);

    resolveWithdraw?.();
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledTimes(1));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit a withdrawal when the still-open modal re-renders', async () => {
    withdrawSquadSponsorMock.mockResolvedValue(undefined);
    const props = baseProps();

    const { rerender } = render(SquadSponsorWithdrawModal, { props });

    const confirm = await screen.findByRole('button', { name: 'Confirm withdraw' });
    await fireEvent.click(confirm);
    await waitFor(() => expect(withdrawSquadSponsorMock).toHaveBeenCalledTimes(1));

    // Parent re-renders the still-open modal (e.g. an unrelated prop refresh). A resubmission
    // here would mean submission got wired to an effect instead of the confirm handler.
    await rerender({ ...props, sponsorAddress: props.sponsorAddress });
    await rerender({ ...props, sponsorAddress: props.sponsorAddress });

    expect(withdrawSquadSponsorMock).toHaveBeenCalledTimes(1);
  });

  it('closes immediately when withdraw is submitted', async () => {
    const backendMessage = 'insufficient funds for withdrawal';
    withdrawSquadSponsorMock.mockRejectedValue(new Error(backendMessage));
    const props = baseProps();

    render(SquadSponsorWithdrawModal, { props });

    const confirm = await screen.findByRole('button', { name: 'Confirm withdraw' });
    await fireEvent.click(confirm);

    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(withdrawSquadSponsorMock).toHaveBeenCalledTimes(1);
  });
});
