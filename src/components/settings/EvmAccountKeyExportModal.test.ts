// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('../../lib/api/encryption', () => ({
  loadAndDecryptKey: vi.fn(async () => 'decrypted-nsec-placeholder'),
}));

vi.mock('../../lib/api/auth', () => ({
  exportEvmAccountKeyPlaintext: vi.fn(async () => '0xsecretprivatekey'),
  exportRecoveryPhrase: vi.fn(async () => 'seed words go here'),
}));

import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
import { loadAndDecryptKey } from '../../lib/api/encryption';
import type { EvmAccountRow } from '../../lib/wallet/evm-accounts';

const account: EvmAccountRow = {
  id: 'acc-1',
  scheme: 'secp256k1',
  hdIndex: 0,
  address: '0xabc0000000000000000000000000000000abc',
  label: 'Squad wallet',
  purpose: 'squad',
  isActive: true,
  isDefaultShared: false,
  isActiveAdvanced: false,
};

async function submitPin() {
  const boxes = screen.getAllByLabelText(/PIN digit/i);
  for (let i = 0; i < boxes.length; i++) {
    await fireEvent.input(boxes[i], { target: { value: String((i % 9) + 1) } });
  }
}

describe('EvmAccountKeyExportModal reveal guard', () => {
  beforeEach(() => {
    vi.mocked(loadAndDecryptKey).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('never renders the private key before the PIN step is confirmed', () => {
    render(EvmAccountKeyExportModal, { props: { open: true, variant: 'evm', account } });

    expect(screen.getByRole('heading', { name: 'Enter your PIN' })).toBeTruthy();
    expect(screen.queryByText('0xsecretprivatekey')).toBeNull();
  });

  it('reveals the secret only after PIN confirm, and it is masked until the reveal toggle is clicked', async () => {
    render(EvmAccountKeyExportModal, { props: { open: true, variant: 'evm', account } });

    await submitPin();

    const revealButton = await screen.findByRole('button', { name: 'Reveal private key' });
    expect(screen.queryByText('0xsecretprivatekey')).toBeNull();

    await fireEvent.click(revealButton);

    expect(await screen.findByText('0xsecretprivatekey')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide private key' })).toBeTruthy();
  });

  it('re-masks the secret when the modal is closed and reopened, without re-revealing it', async () => {
    const { rerender } = render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account },
    });

    await submitPin();
    const revealButton = await screen.findByRole('button', { name: 'Reveal private key' });
    await fireEvent.click(revealButton);
    expect(await screen.findByText('0xsecretprivatekey')).toBeTruthy();

    await rerender({ open: false, variant: 'evm', account });
    await rerender({ open: true, variant: 'evm', account });

    expect(await screen.findByRole('heading', { name: 'Enter your PIN' })).toBeTruthy();
    expect(screen.queryByText('0xsecretprivatekey')).toBeNull();
  });

  it('never calls the key decryption API before the PIN is submitted', () => {
    render(EvmAccountKeyExportModal, { props: { open: true, variant: 'evm', account } });
    expect(loadAndDecryptKey).not.toHaveBeenCalled();
  });
});
