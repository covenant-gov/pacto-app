<script lang="ts">
  import { t } from 'svelte-i18n';

  let { reason }: { reason: string } = $props();
</script>

<p class="hat-required" role="alert">{$t(reason)}</p>

<style>
  .hat-required {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--danger, #e53e3e);
    background: color-mix(in srgb, var(--danger, #e53e3e) 12%, var(--bg-elevated));
    color: var(--danger, #e53e3e);
    font-size: 0.8125rem;
    line-height: 1.35;
  }
</style>
