<script lang="ts">
  import { t } from 'svelte-i18n';
  import Check from '@lucide/svelte/icons/check';
  import { cn } from '$lib/utils.js';

  let {
    title,
    subtitle,
  }: {
    title: string;
    subtitle: string;
  } = $props();
</script>

<div
  class="mx-auto flex max-w-80 flex-col items-center gap-5 py-8"
  role="status"
  aria-live="polite"
>
  <div
    class={cn(
      'flex size-14 items-center justify-center rounded-full bg-gov-success/15 text-gov-success',
      'animate-in fade-in-0 zoom-in-95 duration-200 ease-[var(--ease-out)] fill-mode-both',
      'motion-reduce:animate-none'
    )}
  >
    <Check class="size-7" strokeWidth={2.5} aria-hidden="true" />
  </div>

  <h3
    class={cn(
      'm-0 text-center text-2xl font-semibold text-balance text-foreground',
      'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[var(--ease-out)] fill-mode-both delay-100',
      'motion-reduce:animate-none motion-reduce:delay-0'
    )}
  >
    {title}
  </h3>

  <p
    class={cn(
      'm-0 max-w-64 text-center text-sm text-pretty text-muted-foreground',
      'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[var(--ease-out)] fill-mode-both delay-200',
      'motion-reduce:animate-none motion-reduce:delay-0'
    )}
  >
    {subtitle}
  </p>

  <p class="sr-only">{$t('auth.pinSuccessContinueHint')}</p>
</div>
