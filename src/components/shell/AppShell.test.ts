// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AppShellHarness from './AppShell.test.harness.svelte';
import type { AppShellLabels } from '$lib/shell';

const labels: AppShellLabels = {
	main: 'Shell preview',
	openSidebar: 'Open channel navigation',
	openAside: 'Open member list',
	closeSidebar: 'Close channel navigation',
	closeAside: 'Close member list',
	sidebarDrawer: 'Channel navigation',
	asideDrawer: 'Member list',
};

const regionNames = {
	rail: 'Rail content',
	sidebar: 'Sidebar content',
	main: 'Main content',
	aside: 'Aside content',
};

function stubViewport(mode: 'narrow' | 'medium' | 'wide'): void {
	const width = mode === 'narrow' ? 720 : mode === 'medium' ? 1180 : 1400;
	vi.stubGlobal('matchMedia', (query: string) => {
		const maxWidth = /max-width:\s*(\d+)px/.exec(query)?.[1];
		const matches = maxWidth !== undefined ? width <= Number(maxWidth) : false;
		return {
			matches,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		};
	});
}

function stubViewportWithListeners(mode: 'narrow' | 'medium' | 'wide'): {
	setMode: (next: 'narrow' | 'medium' | 'wide') => void;
} {
	let width = mode === 'narrow' ? 720 : mode === 'medium' ? 1180 : 1400;
	const listeners = new Set<(ev: MediaQueryListEvent) => void>();

	vi.stubGlobal('matchMedia', (query: string) => {
		const maxWidth = /max-width:\s*(\d+)px/.exec(query)?.[1];
		return {
			get matches() {
				return maxWidth !== undefined ? width <= Number(maxWidth) : false;
			},
			media: query,
			onchange: null,
			addEventListener: (_event: string, fn: (ev: MediaQueryListEvent) => void) => {
				listeners.add(fn);
			},
			removeEventListener: (_event: string, fn: (ev: MediaQueryListEvent) => void) => {
				listeners.delete(fn);
			},
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		};
	});

	return {
		setMode(next: 'narrow' | 'medium' | 'wide') {
			width = next === 'narrow' ? 720 : next === 'medium' ? 1180 : 1400;
			for (const fn of listeners) fn({ matches: true } as MediaQueryListEvent);
		},
	};
}

async function renderShell() {
	const view = render(AppShellHarness, { props: { labels, regionNames } });
	await tick();
	return view;
}

describe('AppShell', () => {
	beforeEach(() => {
		stubViewport('wide');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders each typed shell region', async () => {
		const { container } = await renderShell();

		expect(container.querySelector('[data-shell-region="rail"]')).not.toBeNull();
		expect(container.querySelector('[data-shell-region="sidebar"]')).not.toBeNull();
		expect(container.querySelector('[data-shell-region="main"]')).not.toBeNull();
		expect(container.querySelector('[data-shell-region="aside"]')).not.toBeNull();
		expect(screen.getByRole('main', { name: labels.main })).not.toBeNull();
	});

	it('collapses the wide member column without unmounting it', async () => {
		const { container } = render(AppShellHarness, {
			props: { labels, regionNames, asideCollapsed: true },
		});
		await tick();

		const region = container.querySelector('[data-shell-region="aside"]');
		expect(region).not.toBeNull();
		expect(region?.getAttribute('data-collapsed')).toBe('true');
		expect((region as HTMLElement).inert).toBe(true);
		expect(region?.getAttribute('aria-hidden')).toBe('true');
		expect(screen.queryByRole('button', { name: labels.openAside })).toBeNull();
	});

	it('opens a labelled sidebar drawer without duplicating content or inerting the opener', async () => {
		stubViewport('narrow');
		await renderShell();
		const trigger = screen.getByRole('button', { name: labels.openSidebar });
		trigger.focus();

		await fireEvent.click(trigger);
		await tick();

		expect(screen.getByRole('dialog', { name: labels.sidebarDrawer })).not.toBeNull();
		expect(screen.getAllByText(regionNames.sidebar)).toHaveLength(1);
		expect(trigger.hasAttribute('inert')).toBe(false);
		expect(trigger.getAttribute('aria-hidden')).not.toBe('true');
		expect(trigger.closest('[inert]')).toBeNull();
		expect(trigger.closest('[aria-hidden="true"]')).toBeNull();

		await fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: labels.sidebarDrawer })).toBeNull();
			expect(document.activeElement).toBe(trigger);
		});
	});

	it('opens and closes the member drawer with its explicit close control', async () => {
		stubViewport('medium');
		await renderShell();
		const trigger = screen.getByRole('button', { name: labels.openAside });

		await fireEvent.click(trigger);
		expect(screen.getByRole('dialog', { name: labels.asideDrawer })).not.toBeNull();
		expect(screen.getAllByText(regionNames.aside)).toHaveLength(1);
		expect(trigger.closest('[inert]')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: labels.closeAside }));

		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: labels.asideDrawer })).toBeNull();
			expect(document.activeElement).toBe(trigger);
		});
	});

	it('restores focus to main when a breakpoint close unmounts the drawer trigger', async () => {
		const viewport = stubViewportWithListeners('narrow');
		await renderShell();
		const trigger = screen.getByRole('button', { name: labels.openSidebar });
		trigger.focus();
		await fireEvent.click(trigger);
		expect(screen.getByRole('dialog', { name: labels.sidebarDrawer })).not.toBeNull();

		viewport.setMode('medium');
		await tick();

		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: labels.sidebarDrawer })).toBeNull();
			expect(document.activeElement).toBe(screen.getByRole('main', { name: labels.main }));
		});
	});
});
