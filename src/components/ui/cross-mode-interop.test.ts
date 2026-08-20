// @vitest-environment jsdom
// R27: a permanent regression test proving the assumption U4-U19 batch independence rests on --
// a legacy-mode parent (not yet converted) still renders and forwards events through a
// runes-mode child (already converted), so converting a component never requires a
// coordinated cutover with its as-yet-unconverted consumers.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Tab from './Tab.svelte';
import LegacyRenderHarness from './interop-fixtures/LegacyRenderHarness.svelte';
import LegacySlotHarness from './interop-fixtures/LegacySlotHarness.svelte';
import LegacyForwardingHarness from './interop-fixtures/LegacyForwardingHarness.svelte';

describe('cross-mode interop', () => {
  it('a legacy-mode parent renders content into a runes-mode child through {@render children()}', () => {
    render(LegacyRenderHarness, { props: { message: 'render-mode content' } });
    expect(screen.getByTestId('render-content').textContent).toBe('render-mode content');
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
