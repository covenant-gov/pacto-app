// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { initI18n } from '../../../i18n';
import DialogContentHarness from './dialog-content.test.harness.svelte';

beforeAll(async () => {
	await initI18n('en');
});

describe('DialogContent close control', () => {
	it('renders translated sr-only close label by default', () => {
		render(DialogContentHarness);
		expect(screen.getByText('Close', { selector: '.sr-only' })).toBeTruthy();
	});

	it('omits close control when showCloseButton is false', () => {
		render(DialogContentHarness, { props: { showCloseButton: false } });
		expect(screen.queryByText('Close', { selector: '.sr-only' })).toBeNull();
	});
});
