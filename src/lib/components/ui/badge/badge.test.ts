// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BadgeHarness from './badge.test.harness.svelte';

describe('Badge variants', () => {
	it('renders notification and soft product variants', () => {
		const { rerender } = render(BadgeHarness, { props: { variant: 'notif', label: '3' } });
		expect(screen.getByText('3').className).toContain('bg-notif');

		rerender({ variant: 'brand-soft', label: 'Poll' });
		expect(screen.getByText('Poll').className).toContain('text-mention-accent');

		rerender({ variant: 'bot', label: 'Bot' });
		expect(screen.getByText('Bot').className).toContain('text-role-community-manager');
	});
});
