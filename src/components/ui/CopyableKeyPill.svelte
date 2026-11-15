<script lang="ts">
  import { t } from 'svelte-i18n';
  import { shortPublicKey } from '../../lib/governance/hats-tree-annotations';
  import { copyTextToClipboard } from '../../lib/utils/clipboard-copy';
  import { showToast } from '../../stores/toast';
  import CopyIconButton from './CopyIconButton.svelte';

  let {
    value,
    ariaLabel = undefined,
    disabled = false,
  }: {
    /** Full npub or 0x address. This is what copy writes. */
    value: string;
    ariaLabel?: string;
    disabled?: boolean;
  } = $props();

  let copied = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const shown = $derived(shortPublicKey(value));
  const copyLabel = $derived(ariaLabel ?? $t('ui.copy'));

  async function copy() {
    const text = value.trim();
    if (!text || disabled) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      showToast($t('ui.couldNotCopy'));
      return;
    }
    copied = true;
    showToast($t('ui.copied'));
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied = false;
    }, 2000);
  }
</script>

<span class="copyable-key" title={value}>
  <code class="copyable-key-value">{shown}</code>
  <CopyIconButton
    size={28}
    {disabled}
    ariaLabel={copyLabel}
    title={copied ? $t('ui.copied') : copyLabel}
    onclick={() => void copy()}
  />
</span>

<style>
  .copyable-key {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
  }

  .copyable-key-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
</style>
