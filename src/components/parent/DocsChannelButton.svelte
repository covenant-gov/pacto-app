<svelte:options runes={true} />

<script lang="ts">
  import { t } from 'svelte-i18n';
  import { openSquadDocs } from '../../stores/docs-navigation';

  interface Props {
    parentId: string;
    /** MLS group id of the channel; the shelf opens filtered to it. */
    channelGroupId: string;
    channelName: string;
  }

  let { parentId, channelGroupId, channelName }: Props = $props();

  const label = $derived($t('docs.channelButton.aria', { values: { name: channelName } }));
</script>

<button
  type="button"
  class="docs-channel-btn"
  aria-label={label}
  title={label}
  onclick={() => openSquadDocs(parentId, { channelId: channelGroupId })}
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
</button>

<style>
  .docs-channel-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .docs-channel-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .docs-channel-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
</style>
