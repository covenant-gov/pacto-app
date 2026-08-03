<script lang="ts">
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { t } from 'svelte-i18n';
  import type { PreviewMetadata } from '../../stores/dm';

  export let metadata: PreviewMetadata | null | undefined = undefined;

  $: displayTitle = metadata?.og_title || metadata?.title || '';
  $: displayDescription = metadata?.og_description || metadata?.description || '';
  function isHttpUrl(url: string | null | undefined): boolean {
    try {
      const parsed = new URL(url ?? '');
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  $: displayImage = isHttpUrl(metadata?.og_image) ? (metadata?.og_image ?? '') : '';
  $: linkUrl = metadata?.og_url || metadata?.domain || '';
  $: displayDomain = (metadata?.domain ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  $: hasContent = Boolean(displayTitle || displayDescription || displayImage);

  let imageError = false;
  let faviconError = false;
  $: if (metadata) {
    imageError = false;
    faviconError = false;
  }

  function handleClick(event: MouseEvent) {
    if (!linkUrl) return;
    event.preventDefault();
    openExternalUrl(linkUrl);
  }
</script>

{#if hasContent}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href={linkUrl || undefined}
    class="link-preview"
    class:with-image={displayImage && !imageError}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={$t('messaging.linkPreview.openAria', { values: { domain: displayDomain || linkUrl } })}
    on:click={handleClick}
  >
    {#if displayImage && !imageError}
      <img class="link-preview-image" src={displayImage} alt="" loading="lazy" on:error={() => (imageError = true)} />
    {/if}
    <div class="link-preview-body">
      <div class="link-preview-domain">
        {#if metadata?.favicon && isHttpUrl(metadata.favicon) && !faviconError}
          <img class="link-preview-favicon" src={metadata.favicon} alt="" on:error={() => (faviconError = true)} />
        {/if}
        <span>{displayDomain}</span>
      </div>
      {#if displayTitle}
        <div class="link-preview-title">{displayTitle}</div>
      {/if}
      {#if displayDescription}
        <div class="link-preview-description">{displayDescription}</div>
      {/if}
    </div>
  </a>
{/if}

<style>
  .link-preview {
    display: flex;
    flex-direction: column;
    max-width: 26rem;
    margin-top: 6px;
    border: 1px solid var(--bg-elevated);
    border-radius: 10px;
    background: var(--bg-hover);
    text-decoration: none;
    color: inherit;
    overflow: hidden;
    transition: background-color 0.15s ease;
  }

  .link-preview:hover {
    background: var(--bg-elevated);
  }

  .link-preview-image {
    display: block;
    width: 100%;
    max-height: 12rem;
    object-fit: cover;
  }

  .link-preview-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    min-width: 0;
  }

  .link-preview-domain {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-secondary);
  }

  .link-preview-favicon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .link-preview-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .link-preview-description {
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
