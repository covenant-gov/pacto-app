<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from 'svelte-i18n';
	import { openExternalUrl } from '../../lib/utils/open-external';

	const NYPL_ITEM_URL =
		'https://digitalcollections.nypl.org/items/510d47e3-6d81-a3d9-e040-e00a18064a99';

	let { children }: { children: Snippet } = $props();

	function openCredit(event: MouseEvent): void {
		event.preventDefault();
		void openExternalUrl(NYPL_ITEM_URL);
	}
</script>

<div class="auth-atmosphere">
	<section class="auth-atmosphere-panel">
		{@render children()}
	</section>
	<aside class="auth-atmosphere-wall" aria-label={$t('auth.photoCreditCollections')}>
		<figure class="auth-atmosphere-piece">
			<div
				class="auth-atmosphere-photo"
				style="background-image: url('/the-new-york-public-library-qGLE_4n0S4M-unsplash.jpg')"
				role="img"
				aria-label={$t('auth.photoCreditTitle')}
			></div>
			<figcaption class="auth-atmosphere-credit">
				<span class="auth-atmosphere-credit-collection">{$t('auth.photoCreditCollection')}</span>
				<span class="auth-atmosphere-credit-title">“{$t('auth.photoCreditTitle')}”</span>
				<span class="auth-atmosphere-credit-collections">{$t('auth.photoCreditCollections')}</span>
				<a href={NYPL_ITEM_URL} onclick={openCredit}>
					{$t('auth.photoCreditLink')}
				</a>
			</figcaption>
		</figure>
	</aside>
</div>

<style>
	.auth-atmosphere {
		display: grid;
		grid-template-columns: 2fr 4fr;
		width: 100%;
		height: 100%;
		min-height: 100vh;
		overflow: hidden;
		background: var(--bg-panel);
		color: var(--text-primary);
	}

	.auth-atmosphere-panel {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: auto;
		background: var(--bg-panel);
		color: var(--text-primary);
		border-right: 1px solid var(--border-subtle);
	}

	.auth-atmosphere-wall {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 0;
		padding: clamp(1.5rem, 4.5vw, 3.5rem);
		background: var(--bg-panel);
	}

	.auth-atmosphere-piece {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.85rem;
		width: min(100%, 52rem);
		margin: 0;
	}

	.auth-atmosphere-photo {
		aspect-ratio: 2057 / 1424;
		width: 100%;
		background-color: var(--bg-elevated);
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		border: 1px solid color-mix(in srgb, var(--text-primary) 14%, transparent);
		box-shadow:
			0 1px 0 color-mix(in srgb, var(--text-primary) 8%, transparent),
			0 18px 48px color-mix(in srgb, #000 28%, transparent),
			0 4px 12px color-mix(in srgb, #000 16%, transparent);
	}

	.auth-atmosphere-credit {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
		padding: 0 0.15rem;
		color: var(--text-muted);
		font-size: 0.625rem;
		line-height: 1.45;
		letter-spacing: 0.01em;
		text-align: left;
		max-width: 42rem;
	}

	.auth-atmosphere-credit-title {
		color: var(--text-secondary);
		font-style: italic;
	}

	.auth-atmosphere-credit a {
		color: var(--text-secondary);
		text-decoration: underline;
		text-underline-offset: 2px;
		width: fit-content;
	}

	.auth-atmosphere-credit a:hover {
		color: var(--text-primary);
	}

	.auth-atmosphere-credit a:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	@media (max-width: 720px) {
		.auth-atmosphere {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
		}

		.auth-atmosphere-panel {
			border-right: none;
			border-top: 1px solid var(--border-subtle);
			order: 1;
		}

		.auth-atmosphere-wall {
			order: 0;
			padding: 1.25rem 1.25rem 0.75rem;
		}

		.auth-atmosphere-piece {
			width: 100%;
			gap: 0.6rem;
		}

		.auth-atmosphere-photo {
			aspect-ratio: 16 / 9;
			max-height: 28vh;
		}
	}
</style>
