// @vitest-environment jsdom
// Permanent regression test: a legacy-mode parent (not yet converted) still renders and
// forwards events through a runes-mode child (already converted), so converting a component
// never requires a coordinated cutover with its as-yet-unconverted consumers.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Tab from './Tab.svelte';
import LegacyRenderHarness from './interop-fixtures/LegacyRenderHarness.svelte';
import LegacySlotHarness from './interop-fixtures/LegacySlotHarness.svelte';
import LegacyForwardingHarness from './interop-fixtures/LegacyForwardingHarness.svelte';
import RunesParentHarness from './interop-fixtures/RunesParentHarness.svelte';
import LegacyModalHarness from './interop-fixtures/LegacyModalHarness.svelte';
import LegacySidebarHarness from './interop-fixtures/LegacySidebarHarness.svelte';

describe('cross-mode interop', () => {
  it('a legacy-mode parent renders content into a runes-mode child through {@render children()}', () => {
    render(LegacyRenderHarness, { props: { message: 'render-mode content' } });
    expect(screen.getByTestId('render-content').textContent).toBe('render-mode content');
  });

  it('a legacy-mode parent -> runes-mode child render mechanism survives a prop update, not just initial mount', async () => {
    const { rerender } = render(LegacyRenderHarness, { props: { message: 'A' } });
    expect(screen.getByTestId('render-content').textContent).toBe('A');
    await rerender({ message: 'B' });
    expect(screen.getByTestId('render-content').textContent).toBe('B');
  });

  it('a legacy-mode parent renders content into a runes-mode child that still uses <slot />', () => {
    render(LegacySlotHarness, { props: { message: 'slot-mode content' } });
    expect(screen.getByTestId('slot-content').textContent).toBe('slot-mode content');
  });

  it("a runes-mode child's bare on:click forwarding reaches a legacy-mode parent's handler", async () => {
    const onForwardedClick = vi.fn();
    render(LegacyForwardingHarness, { props: { onForwardedClick } });
    await fireEvent.click(screen.getByTestId('forwarding-child'));
    expect(onForwardedClick).toHaveBeenCalledTimes(1);
  });

  it('a runes-mode parent renders default slot content into a legacy-mode child that still uses <slot />', () => {
    render(RunesParentHarness, { props: { message: 'reverse-slot content' } });
    expect(screen.getByTestId('reverse-slot-content').textContent).toBe('reverse-slot content');
  });

  it('a legacy-mode parent renders content into runes-mode Modal', () => {
    render(LegacyModalHarness, { props: { message: 'modal content' } });
    expect(screen.getByTestId('modal-content').textContent).toBe('modal content');
  });

  it('a legacy-mode parent renders content into runes-mode ResizableSidebar', () => {
    render(LegacySidebarHarness, { props: { message: 'sidebar content' } });
    expect(screen.getByTestId('sidebar-content').textContent).toBe('sidebar content');
  });

  it('Tab renders passed content instead of the firstLetter fallback', () => {
    const content = createRawSnippet(() => ({
      render: () => `<span data-testid="tab-passed-content">icon</span>`,
    }));
    render(Tab, { props: { label: 'General', children: content } });
    expect(screen.queryByTestId('tab-passed-content')).not.toBeNull();
    expect(screen.queryByText('G')).toBeNull();
  });

  it('Tab renders the firstLetter fallback when no content is passed', () => {
    render(Tab, { props: { label: 'General' } });
    expect(screen.queryByText('G')).not.toBeNull();
  });
});

describe('Tab image fallback', () => {
  it('falls back to the firstLetter on image error, and shows the image again after the image prop changes', async () => {
    const { rerender } = render(Tab, {
      props: { label: 'General', image: 'https://example.invalid/broken.png' },
    });
    const img = screen.getByAltText('General');
    await fireEvent.error(img);
    expect(screen.queryByText('G')).not.toBeNull();
    expect(screen.queryByAltText('General')).toBeNull();

    await rerender({ label: 'General', image: 'https://example.invalid/new.png' });
    expect(screen.getByAltText('General')).toBeTruthy();
    expect(screen.queryByText('G')).toBeNull();
  });
});
