// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SyncStatusIndicator from './SyncStatusIndicator.svelte';

describe('SyncStatusIndicator', () => {
  it('renders no dot when idle', () => {
    render(SyncStatusIndicator);
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('idle');
    expect(status.querySelector('.sync-dot')).toBeNull();
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

  it('stalled overrides the status', () => {
    render(SyncStatusIndicator, { props: { status: 'finished', stalled: true } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('stalled');
    expect(status.querySelector('.sync-dot')).toBeTruthy();
  });

  it('exposes the state as a tooltip and to assistive tech only', () => {
    render(SyncStatusIndicator, { props: { status: 'syncing' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('title')).toBe('Syncing…');
    expect(status.querySelector('.sync-label')?.textContent).toBe('Syncing…');
  });
});
