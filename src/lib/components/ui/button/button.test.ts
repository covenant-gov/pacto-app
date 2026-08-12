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
});
