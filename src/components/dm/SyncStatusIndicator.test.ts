// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SyncStatusIndicator from './SyncStatusIndicator.svelte';
import { deepRescan } from '../../lib/api/nostr';

vi.mock('../../lib/api/nostr', () => ({
  deepRescan: vi.fn(),
}));

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    vi.mocked(deepRescan).mockReset();
    vi.mocked(deepRescan).mockResolvedValue(true);
  });

  it('renders no dot when idle', () => {
    render(SyncStatusIndicator);
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('idle');
    expect(status.querySelector('.sync-dot')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a dot while syncing', () => {
    render(SyncStatusIndicator, { props: { status: 'syncing' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('syncing');
    expect(status.querySelector('.sync-dot')).toBeTruthy();
  });

  it('renders a dot when finished', () => {
    render(SyncStatusIndicator, { props: { status: 'finished' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('finished');
    expect(status.querySelector('.sync-dot')).toBeTruthy();
  });

  it('renders a non-interactive dot for idle/syncing/finished', () => {
    render(SyncStatusIndicator, { props: { status: 'finished' } });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('exposes the state as a tooltip and to assistive tech only', () => {
    render(SyncStatusIndicator, { props: { status: 'syncing' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('title')).toBe('Syncing…');
    expect(status.querySelector('.sync-label')?.textContent).toBe('Syncing…');
  });

  it('renders behind as a clickable dot with an accessible name', () => {
    render(SyncStatusIndicator, { props: { status: 'behind' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('behind');
    expect(status.querySelector('.sync-dot')).toBeTruthy();
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Behind');
    expect(status.querySelector('.sync-label')?.textContent).toBe('Behind');
  });

  it('renders stalled as a clickable dot with an accessible name', () => {
    render(SyncStatusIndicator, { props: { status: 'stalled' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('stalled');
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Stalled');
  });

  it('clicking the behind dot opens the deep-rescan confirmation', async () => {
    render(SyncStatusIndicator, { props: { status: 'behind' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('confirming invokes deepRescan and closes the popover', async () => {
    render(SyncStatusIndicator, { props: { status: 'stalled' } });
    await fireEvent.click(screen.getByRole('button'));
    const confirmBtn = screen.getByRole('button', { name: /run deep rescan/i });
    await fireEvent.click(confirmBtn);
    expect(deepRescan).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelling closes the popover without invoking deepRescan', async () => {
    render(SyncStatusIndicator, { props: { status: 'behind' } });
    await fireEvent.click(screen.getByRole('button'));
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    await fireEvent.click(cancelBtn);
    expect(deepRescan).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the popover open and surfaces an error when deepRescan fails', async () => {
    vi.mocked(deepRescan).mockRejectedValue(new Error('Already Scanning! Please wait.'));
    render(SyncStatusIndicator, { props: { status: 'behind' } });
    await fireEvent.click(screen.getByRole('button'));
    const confirmBtn = screen.getByRole('button', { name: /run deep rescan/i });
    await fireEvent.click(confirmBtn);
    await waitFor(() => expect(deepRescan).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
