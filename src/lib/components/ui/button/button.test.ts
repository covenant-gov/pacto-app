// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ButtonHarness from './button.test.harness.svelte';

describe('Button disabled anchor', () => {
	it('drops href and keeps accessible disabled link semantics', () => {
		render(ButtonHarness, {
			props: {
				href: '/settings',
				disabled: true,
				label: 'Settings',
			},
		});

		const link = screen.getByRole('link', { name: 'Settings' });
		expect(link.getAttribute('href')).toBeNull();
		expect(link.getAttribute('aria-disabled')).toBe('true');
		expect(link.getAttribute('tabindex')).toBe('-1');
	});

	it('renders a native disabled button when href is absent', () => {
		render(ButtonHarness, {
			props: {
				disabled: true,
				label: 'Save',
			},
		});

		const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
	});

	it('applies success, danger-soft, dashed, and tab variants', () => {
		const { rerender } = render(ButtonHarness, {
			props: { label: 'Vote for', variant: 'success' },
		});
		expect(screen.getByRole('button', { name: 'Vote for' }).className).toContain('bg-gov-success');

		rerender({ label: 'Vote against', variant: 'danger-soft' });
		expect(screen.getByRole('button', { name: 'Vote against' }).className).toContain('bg-destructive/25');

		rerender({ label: 'Add channel', variant: 'dashed' });
		expect(screen.getByRole('button', { name: 'Add channel' }).className).toContain('border-dashed');

		rerender({ href: '/design/dashboard/status', label: 'Status', variant: 'tab' });
		expect(screen.getByRole('link', { name: 'Status' }).className).toContain('aria-[current=page]:bg-accent');
	});

	it('applies theme tokens on ghost without a dark: hover split', () => {
		render(ButtonHarness, {
			props: { label: 'Settings', variant: 'ghost' },
		});
		const ghost = screen.getByRole('button', { name: 'Settings' });
		expect(ghost.className).toContain('bg-transparent');
		expect(ghost.className).toContain('text-muted-foreground');
		expect(ghost.className).toContain('hover:bg-accent');
		expect(ghost.className).not.toContain('dark:hover:');
	});

	it('tints ghost icon idle fill from foreground in hsl', () => {
		render(ButtonHarness, {
			props: { label: 'Attach', variant: 'ghost', size: 'icon-sm' },
		});
		const icon = screen.getByRole('button', { name: 'Attach' });
		expect(icon.className).toContain('color-mix(in_hsl,var(--foreground)_10%,transparent)');
		expect(icon.className).not.toContain('dark:hover:');
	});
});
