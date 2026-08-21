// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('../../lib/api/encryption', () => ({
  loadAndDecryptKey: vi.fn(async () => 'decrypted-nsec-placeholder'),
}));

vi.mock('../../lib/api/auth', () => ({
  exportEvmAccountKeyPlaintext: vi.fn(async () => '0xevmsecretkey'),
  exportRecoveryPhrase: vi.fn(async () => 'seed words go here'),
}));

vi.mock('../../lib/wallet/evm-accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/wallet/evm-accounts')>();
  return {
    ...actual,
    listEvmAccounts: vi.fn(async () => [
      {
        id: 'acc-1',
        scheme: 'secp256k1',
        hdIndex: 0,
        address: '0xabc0000000000000000000000000000000abc',
        label: 'Squad wallet',
        purpose: 'squad',
        isActive: true,
        isDefaultShared: false,
        isActiveAdvanced: false,
      },
    ]),
  };
});

import ExportAllSecretsModal from './ExportAllSecretsModal.svelte';
import { loadAndDecryptKey } from '../../lib/api/encryption';

async function submitPin() {
  const boxes = screen.getAllByLabelText(/PIN digit/i);
  for (let i = 0; i < boxes.length; i++) {
    await fireEvent.input(boxes[i], { target: { value: String((i % 9) + 1) } });
  }
}

describe('ExportAllSecretsModal reveal guards', () => {
  beforeEach(() => {
    vi.mocked(loadAndDecryptKey).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('never renders any secret before the PIN step is confirmed', () => {
    render(ExportAllSecretsModal, { props: { open: true, npub: 'npub1owner' } });

    expect(screen.getByRole('heading', { name: 'Enter your PIN' })).toBeTruthy();
    expect(screen.queryByText('seed words go here')).toBeNull();
    expect(screen.queryByText('decrypted-nsec-placeholder')).toBeNull();
    expect(screen.queryByText('0xevmsecretkey')).toBeNull();
  });

  it('masks every secret independently after PIN confirm, revealing each only via its own toggle', async () => {
    render(ExportAllSecretsModal, { props: { open: true, npub: 'npub1owner' } });

    await submitPin();

    const revealSeed = await screen.findByRole('button', { name: 'Reveal seed phrase' });
    const revealNsec = screen.getByRole('button', { name: 'Reveal nsec' });
    const revealEvm = screen.getByRole('button', { name: 'Reveal private key' });

    // Nothing revealed yet, even though the bundle has already been decrypted.
    expect(screen.queryByText('seed words go here')).toBeNull();
    expect(screen.queryByText('decrypted-nsec-placeholder')).toBeNull();
    expect(screen.queryByText('0xevmsecretkey')).toBeNull();

    await fireEvent.click(revealSeed);
    expect(await screen.findByText('seed words go here')).toBeTruthy();
    // Revealing the seed must not also reveal the nsec or the EVM key.
    expect(screen.queryByText('decrypted-nsec-placeholder')).toBeNull();
    expect(screen.queryByText('0xevmsecretkey')).toBeNull();

    await fireEvent.click(revealNsec);
    expect(await screen.findByText('decrypted-nsec-placeholder')).toBeTruthy();
    expect(screen.queryByText('0xevmsecretkey')).toBeNull();

    await fireEvent.click(revealEvm);
    expect(await screen.findByText('0xevmsecretkey')).toBeTruthy();
  });

  it('re-masks every secret when the modal is closed and reopened, without re-revealing anything', async () => {
    const { rerender } = render(ExportAllSecretsModal, {
      props: { open: true, npub: 'npub1owner' },
    });

    await submitPin();
    const revealSeed = await screen.findByRole('button', { name: 'Reveal seed phrase' });
    await fireEvent.click(revealSeed);
    expect(await screen.findByText('seed words go here')).toBeTruthy();

    await rerender({ open: false, npub: 'npub1owner' });
    await rerender({ open: true, npub: 'npub1owner' });

    expect(await screen.findByRole('heading', { name: 'Enter your PIN' })).toBeTruthy();
    expect(screen.queryByText('seed words go here')).toBeNull();
  });

  it('never calls the key decryption API before the PIN is submitted', () => {
    render(ExportAllSecretsModal, { props: { open: true, npub: 'npub1owner' } });
    expect(loadAndDecryptKey).not.toHaveBeenCalled();
  });
});
