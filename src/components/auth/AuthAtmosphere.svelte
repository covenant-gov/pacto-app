<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { t } from 'svelte-i18n';
	import { openExternalUrl } from '../../lib/utils/open-external';

	const NYPL_ITEM_URL =
		'https://digitalcollections.nypl.org/items/510d47e3-6d81-a3d9-e040-e00a18064a99';
	const HERO_SRC = '/the-new-york-public-library-qGLE_4n0S4M-unsplash.jpg';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		const link = document.createElement('link');
		link.rel = 'preload';
		link.as = 'image';
		link.href = HERO_SRC;
		document.head.appendChild(link);
		return () => {
			link.remove();
		};
	});

	function openCredit(event: MouseEvent): void {
		event.preventDefault();
		void openExternalUrl(NYPL_ITEM_URL);
	}
</script>

<div class="auth-atmosphere">
	<section class="auth-atmosphere-panel">
		{@render children()}
	</section>
	<aside class="auth-atmosphere-wall" aria-label={$t('auth.photoCreditTitle')}>
		<figure class="auth-atmosphere-piece">
			<div class="auth-atmosphere-frame">
				<div class="auth-atmosphere-frame-lip">
					<div
						class="auth-atmosphere-photo"
						style="background-image: url('{HERO_SRC}')"
						role="img"
						aria-label={$t('auth.photoCreditTitle')}
					></div>
				</div>
			</div>
			<figcaption class="auth-atmosphere-credit">
				<span class="auth-atmosphere-credit-title">“{$t('auth.photoCreditTitle')}”</span>
				<span class="auth-atmosphere-credit-meta">
					{$t('auth.photoCreditCollection')}
					·
					{$t('auth.photoCreditCollections')}
				</span>
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
		position: relative;
		isolation: isolate;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 0;
		padding: clamp(1.5rem, 4.5vw, 3.5rem);
		background: var(--bg-panel);
	}

	/* Soft ceiling wash — no extra libs */
	.auth-atmosphere-wall::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		background:
			radial-gradient(
				ellipse 85% 50% at 50% -8%,
				color-mix(in srgb, var(--text-primary) 16%, transparent) 0%,
				transparent 70%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--text-primary) 7%, transparent) 0%,
				transparent 38%
			);
	}

	.auth-atmosphere-piece {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.85rem;
		width: min(100%, 52rem);
		margin: 0;
	}

	/* Concentric moulding: outer 10 + lip 3 ≈ theme-aware frame (SVG 9-slice lives at /painting-frame.svg) */
	.auth-atmosphere-frame {
		padding: 10px;
		border-radius: 2px;
		background: linear-gradient(
			165deg,
			color-mix(in srgb, var(--text-primary) 28%, var(--bg-elevated)) 0%,
			color-mix(in srgb, var(--text-primary) 10%, var(--bg-panel)) 48%,
			color-mix(in srgb, #000 42%, var(--bg-elevated)) 100%
		);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent),
			inset 0 -1px 0 color-mix(in srgb, #000 35%, transparent),
			0 1px 0 color-mix(in srgb, var(--text-primary) 10%, transparent),
			0 22px 52px color-mix(in srgb, #000 34%, transparent),
			0 6px 14px color-mix(in srgb, #000 18%, transparent);
	}

	.auth-atmosphere-frame-lip {
		padding: 3px;
		background: color-mix(in srgb, var(--text-primary) 28%, #8a7355);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, #000 45%, transparent),
			inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent);
	}

	.auth-atmosphere-photo {
		aspect-ratio: 2057 / 1424;
		width: 100%;
		background-color: var(--bg-elevated);
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		box-shadow: inset 0 12px 28px color-mix(in srgb, #000 18%, transparent);
	}

	.auth-atmosphere-credit {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0 0.15rem;
		max-width: 42rem;
		text-align: left;
	}

	.auth-atmosphere-credit-title {
		color: var(--text-primary);
		font-size: 0.875rem;
		font-weight: 500;
		font-style: italic;
		line-height: 1.35;
		text-wrap: pretty;
	}

	.auth-atmosphere-credit-meta,
	.auth-atmosphere-credit a {
		color: var(--text-muted);
		font-size: 0.75rem;
		line-height: 1.45;
		text-wrap: pretty;
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
