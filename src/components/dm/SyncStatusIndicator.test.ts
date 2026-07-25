// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SyncStatusIndicator from './SyncStatusIndicator.svelte';

describe('SyncStatusIndicator', () => {
  it('renders idle state by default', () => {
    render(SyncStatusIndicator);
    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(status.textContent?.trim()).toBe('Idle');
  });

  it('renders syncing with a spinner', () => {
    render(SyncStatusIndicator, { props: { status: 'syncing' } });
    const status = screen.getByRole('status');
    expect(status.textContent?.trim()).toBe('Syncing…');
    expect(status.querySelector('svg')).toBeTruthy();
  });

  it('renders stalled state when stalled is true', () => {
    render(SyncStatusIndicator, { props: { status: 'syncing', stalled: true } });
    const status = screen.getByRole('status');
    expect(status.textContent?.trim()).toBe('Stalled');
    expect(status.getAttribute('aria-label')).toBe('Sync status: stalled');
  });

  it('renders finished state', () => {
    render(SyncStatusIndicator, { props: { status: 'finished' } });
    expect(screen.getByRole('status').textContent?.trim()).toBe('Synced');
  });

  it('stalled overrides finished status', () => {
    render(SyncStatusIndicator, { props: { status: 'finished', stalled: true } });
    expect(screen.getByRole('status').textContent?.trim()).toBe('Stalled');
  });
});
