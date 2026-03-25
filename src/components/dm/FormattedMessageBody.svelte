<script lang="ts">
  import { afterUpdate } from 'svelte';
  import { formatMessageContent } from '../../lib/utils/message-formatting';
  import { openExternalUrl } from '../../lib/utils/open-external';

  export let content: string = '';

  $: formatted = formatMessageContent(content);

  let bodyEl: HTMLDivElement | undefined;

  afterUpdate(() => {
    if (!bodyEl) return;
    bodyEl.querySelectorAll('img.twemoji').forEach((img) => {
      if ((img as HTMLElement).dataset.fallbackBound) return;
      (img as HTMLElement).dataset.fallbackBound = '1';
      img.addEventListener('error', () => {
        const alt = img.getAttribute('alt') ?? '';
        const span = document.createElement('span');
        span.className = 'twemoji-fallback';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = alt;
        img.parentNode?.replaceChild(span, img);
      });
    });
  });

  function revealSpoiler(el: HTMLElement | null) {
    const spoiler = el?.closest?.('.spoiler');
    if (spoiler && spoiler instanceof HTMLElement) {
      spoiler.classList.add('revealed');
    }
  }

  function handleClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;

    const anchor = target?.closest?.('a[href^="http"]');
    if (anchor instanceof HTMLAnchorElement) {
      const href = anchor.getAttribute('href');
      if (href) {
        event.preventDefault();
        openExternalUrl(href);
      }
    }

    revealSpoiler(target);

    const copyBtn = target?.closest?.('.code-copy-btn');
    if (copyBtn && copyBtn instanceof HTMLElement) {
      const wrapper = copyBtn.closest('.code-block-wrapper');
      const raw = wrapper?.getAttribute?.('data-raw-code');
      if (raw != null) {
        navigator.clipboard.writeText(raw).then(() => {
          const label = copyBtn.getAttribute('aria-label');
          copyBtn.textContent = 'Copied';
          copyBtn.setAttribute('aria-label', 'Copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
            if (label) copyBtn.setAttribute('aria-label', label);
          }, 2000);
        });
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement | null;
    const spoiler = target?.closest?.('.spoiler');
    if (spoiler && spoiler instanceof HTMLElement) {
      event.preventDefault();
      spoiler.classList.add('revealed');
    }
    const copyBtn = target?.closest?.('.code-copy-btn');
    if (copyBtn && copyBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      copyBtn.click();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={bodyEl}
  class="formatted-message-body"
  class:empty={!content?.trim()}
  on:click={handleClick}
  on:keydown={handleKeydown}
  role="document"
  aria-label="Message content"
>
  {#if content?.trim()}
    {@html formatted}
  {:else}
    <span class="formatted-message-body-empty"> </span>
  {/if}
</div>

<style>
  .formatted-message-body {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.375rem;
    word-wrap: break-word;
  }

  .formatted-message-body :global(strong) {
    font-weight: 600;
  }

  .formatted-message-body :global(em) {
    font-style: italic;
  }

  .formatted-message-body :global(del) {
    text-decoration: line-through;
  }

  .formatted-message-body :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.875em;
    padding: 0.15em 0.35em;
    border-radius: 4px;
    background: var(--code-bg);
    border: 1px solid var(--code-border);
  }

  .formatted-message-body :global(pre) {
    margin: 0.5em 0;
    padding: 12px;
    border-radius: 6px;
    background: var(--code-bg);
    border: 1px solid var(--code-border);
    overflow-x: auto;
  }

  .formatted-message-body :global(pre code) {
    padding: 0;
    background: none;
    border: none;
  }

  .formatted-message-body :global(.code-block-wrapper) {
    position: relative;
    margin: 0.5em 0;
  }

  .formatted-message-body :global(.code-block-wrapper pre) {
    margin: 0;
    padding-right: 60px;
  }

  .formatted-message-body :global(.code-copy-btn) {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 4px 10px;
    font-size: 0.75rem;
    color: var(--text-muted);
    background: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 4px;
    cursor: pointer;
  }

  .formatted-message-body :global(.code-copy-btn:hover) {
    color: var(--text-secondary);
    background: var(--code-border);
  }

  .formatted-message-body :global(.hljs) {
    background: transparent;
  }

  .formatted-message-body :global(blockquote) {
    margin: 0.5em 0;
    padding-left: 12px;
    border-left: 3px solid var(--blockquote-border);
    color: var(--text-muted);
  }

  .formatted-message-body :global(.spoiler) {
    background: var(--spoiler-bg);
    color: transparent;
    border-radius: 3px;
    cursor: pointer;
    user-select: none;
  }

  .formatted-message-body :global(.spoiler.revealed) {
    background: transparent;
    color: inherit;
    cursor: default;
    user-select: text;
  }

  .formatted-message-body :global(.twemoji) {
    height: 1.2em;
    width: auto;
    vertical-align: middle;
  }

  /* When Twemoji SVG is missing (404), we replace img with span; use emoji-capable font so character displays */
  .formatted-message-body :global(.twemoji-fallback) {
    display: inline;
    font-size: 1.2em;
    line-height: 1;
    vertical-align: middle;
    font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Android Emoji', emoji, sans-serif;
  }

  .formatted-message-body :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .formatted-message-body :global(a:hover) {
    text-decoration: underline;
  }

  .formatted-message-body :global(ul),
  .formatted-message-body :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .formatted-message-body :global(p) {
    margin: 0.25em 0;
  }

  .formatted-message-body :global(p:first-child) {
    margin-top: 0;
  }

  .formatted-message-body :global(p:last-child) {
    margin-bottom: 0;
  }

  .formatted-message-body.empty .formatted-message-body-empty {
    display: inline-block;
    min-height: 1em;
  }
</style>
