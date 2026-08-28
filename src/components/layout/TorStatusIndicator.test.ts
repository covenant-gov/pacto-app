// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import TorStatusIndicator from './TorStatusIndicator.svelte';
import { torRoutingEnabled } from '../../stores/tor';
import type { TorStatus } from '../../lib/api/tor';

vi.mock('../../lib/api/tor', () => ({
  getTorStatus: vi.fn(),
  setTorRoutingEnabled: vi.fn(),
}));

import { getTorStatus, setTorRoutingEnabled } from '../../lib/api/tor';

const mockedGetTorStatus = vi.mocked(getTorStatus);
const mockedSetTorRoutingEnabled = vi.mocked(setTorRoutingEnabled);

const CONNECTED_STATUS: TorStatus = {
  available: true,
  enabled: true,
  bootstrapped: true,
  bootstrap_fraction: 1,
  blocked_reason: null,
  active_connections: 2,
  bytes_up: 2048,
  bytes_down: 4096,
  avg_connect_latency_ms: 850,
  enabled_seconds: 125,
  startup_error: null,
};

afterEach(() => {
  cleanup();
  torRoutingEnabled.set(false);
  vi.clearAllMocks();
});

describe('TorStatusIndicator', () => {
  it('renders nothing when Tor routing is disabled', () => {
    torRoutingEnabled.set(false);
    render(TorStatusIndicator);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a trigger button, with the popover closed, when Tor routing is enabled', () => {
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);
    expect(screen.getByRole('button', { name: 'Traffic is routed through Tor' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reacts live to the shared store toggling while the popover is closed', async () => {
    torRoutingEnabled.set(false);
    render(TorStatusIndicator);
    expect(screen.queryByRole('button')).toBeNull();

    torRoutingEnabled.set(true);
    expect(await screen.findByRole('button')).toBeTruthy();

    torRoutingEnabled.set(false);
    await tick();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the popover and shows fetched status on click', async () => {
    mockedGetTorStatus.mockResolvedValue(CONNECTED_STATUS);
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await waitFor(() => expect(mockedGetTorStatus).toHaveBeenCalled());
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('850 ms')).toBeTruthy();
    expect(screen.getByText('2m')).toBeTruthy();
  });

  it('shows an always-checked "Enabled" checkbox in the popover', async () => {
    mockedGetTorStatus.mockResolvedValue(CONNECTED_STATUS);
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('unchecking the popover checkbox disables Tor, unchecks visibly, and shows a confirmation -- without closing the popover', async () => {
    mockedGetTorStatus.mockResolvedValue(CONNECTED_STATUS);
    mockedSetTorRoutingEnabled.mockResolvedValue(undefined);
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement;
    await fireEvent.click(checkbox);

    expect(mockedSetTorRoutingEnabled).toHaveBeenCalledWith(false);
    // The popover, its trigger, and the checkbox all stay mounted and visible --
    // this is the fix for the "checkbox looks unresponsive" bug: no more
    // instant unmount out from under the user's cursor.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement).checked).toBe(false));
    expect(await screen.findByText('Tor routing is now off.')).toBeTruthy();
  });

  it('closing the popover after a successful disconnect fully unmounts the indicator', async () => {
    mockedGetTorStatus.mockResolvedValue(CONNECTED_STATUS);
    mockedSetTorRoutingEnabled.mockResolvedValue(undefined);
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' });
    await fireEvent.click(checkbox);
    await screen.findByText('Tor routing is now off.');

    await fireEvent.click(document.body);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('surfaces a disconnect failure inline and keeps the checkbox checked', async () => {
    mockedGetTorStatus.mockResolvedValue(CONNECTED_STATUS);
    mockedSetTorRoutingEnabled.mockRejectedValue(new Error('backend unreachable'));
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement;
    await fireEvent.click(checkbox);

    expect(await screen.findByText('backend unreachable')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement).checked).toBe(true);
  });

  it('surfaces a load error instead of stats when the backend rejects', async () => {
    mockedGetTorStatus.mockRejectedValue(new Error('boom'));
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('closes the popover on outside click', async () => {
    mockedGetTorStatus.mockResolvedValue(CONNECTED_STATUS);
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await fireEvent.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the popover on Escape', async () => {
    mockedGetTorStatus.mockResolvedValue(CONNECTED_STATUS);
    torRoutingEnabled.set(true);
    render(TorStatusIndicator);

    await fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
