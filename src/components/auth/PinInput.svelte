<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { cn } from '$lib/utils.js';

  let {
    title,
    onComplete,
    isProcessing = false,
    error = null,
    onErrorClear = undefined,
    onBack = undefined,
    pinDigitCount = 6,
  }: {
    title: string;
    onComplete: (pin: string) => void;
    isProcessing?: boolean;
    error?: string | null;
    onErrorClear?: (() => void) | undefined;
    onBack?: (() => void) | undefined;
    pinDigitCount?: number;
  } = $props();

  let digits: string[] = $state<string[]>([]);
  let inputs: (HTMLInputElement | null)[] = $state<(HTMLInputElement | null)[]>([]);
  let isShaking = $state(false);
  let lastClearedForError: string | null = $state(null);

  $effect.pre(() => {
    const n = pinDigitCount;
    if (digits.length !== n) {
      digits = Array.from({ length: n }, () => '');
      inputs = Array.from({ length: n }, () => null);
    }
  });

  function maskChar(digit: string): string {
    return digit ? '*' : '';
  }

  function syncInputDisplay(): void {
    for (let i = 0; i < pinDigitCount; i++) {
      const el = inputs[i];
      if (el) el.value = maskChar(digits[i]);
    }
  }

  function clearInputs() {
    digits = Array(pinDigitCount).fill('');
    syncInputDisplay();
    setTimeout(() => inputs[0]?.focus(), 100);
  }

  function triggerShake() {
    isShaking = true;
    setTimeout(() => {
      isShaking = false;
    }, 280);
  }

  function tryComplete(pin = digits.join('')): void {
    if (isProcessing || pin.length !== pinDigitCount) return;
    lastClearedForError = null;
    if (error && onErrorClear) onErrorClear();
    onComplete(pin);
  }

  function applyPinDigits(raw: string): void {
    const cleaned = raw.replace(/[^0-9]/g, '').slice(0, pinDigitCount);
    if (!cleaned) return;

    const next = Array(pinDigitCount).fill('') as string[];
    cleaned.split('').forEach((digit, i) => {
      next[i] = digit;
    });
    digits = next;
    syncInputDisplay();

    if (cleaned.length < pinDigitCount) {
      inputs[cleaned.length]?.focus();
      return;
    }

    inputs[pinDigitCount - 1]?.blur();
    tryComplete(cleaned);
  }

  function handleInput(index: number, event: Event) {
    const target = event.target as HTMLInputElement;
    const raw = target.value.replace(/[^0-9*]/g, '');
    const typedDigits = raw.replace(/\*/g, '');

    // Paste/autofill into one box often lands as a multi-digit string.
    if (typedDigits.length > 1) {
      applyPinDigits(typedDigits);
      return;
    }

    // Keep existing digit when the field only shows the mask glyph.
    const value = typedDigits.slice(0, 1) || (raw.includes('*') ? digits[index] : '');
    digits[index] = value;
    target.value = maskChar(value);

    if (value && index < pinDigitCount - 1) {
      inputs[index + 1]?.focus();
    }

    tryComplete();
  }

  function handleKeydown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      digits[index] = '';
      const el = inputs[index];
      if (el) el.value = '';
      if (index > 0) inputs[index - 1]?.focus();
      return;
    }

    // Don't block Ctrl/Cmd shortcuts (paste, select-all, copy, …).
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      digits[index] = event.key;
      const el = inputs[index];
      if (el) el.value = '*';
      if (index < pinDigitCount - 1) {
        inputs[index + 1]?.focus();
      }
      tryComplete();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
    }
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    applyPinDigits(event.clipboardData?.getData('text') || '');
  }

  onMount(() => {
    inputs[0]?.focus();
  });

  $effect(() => {
    if (error && error !== lastClearedForError && digits.every((d) => d !== '')) {
      lastClearedForError = error;
      clearInputs();
      triggerShake();
    } else if (!error) {
      lastClearedForError = null;
    }
  });
</script>

<div
  class="mx-auto flex max-w-full flex-col gap-6 py-8"
  style="width: calc({pinDigitCount} * 2.5rem + ({pinDigitCount} - 1) * 0.5rem)"
>
  <h3 class="m-0 text-center text-2xl font-semibold text-balance text-foreground">
    {title}
  </h3>

  <div class="pin-inputs flex gap-2" class:pin-inputs-shake={isShaking}>
    {#each digits as digit, i (i)}
      <Input
        bind:ref={inputs[i]}
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength={pinDigitCount}
        value={maskChar(digit)}
        disabled={isProcessing}
        aria-describedby={error ? 'pin-error' : undefined}
        aria-label={$t('auth.pinDigitAriaLabel', { values: { n: i + 1 } })}
        class={cn(
          // !size-10 beats Input's w-full so cells stay square.
          'size-10! shrink-0 px-0 text-center tabular-nums',
          // Beat unlayered `input { font: inherit }` in app.css (wins over @layer utilities).
          '!font-mono text-xl! font-semibold! leading-none',
          'transition-[box-shadow,border-color] duration-100 ease-[var(--ease-out)]',
          'motion-reduce:transition-none'
        )}
        oninput={(e) => handleInput(i, e)}
        onkeydown={(e) => handleKeydown(i, e)}
        onpaste={handlePaste}
      />
    {/each}
  </div>

  {#if isProcessing}
    <div class="flex flex-col items-center gap-3 text-muted-foreground" role="status">
      <LoaderCircle class="size-8 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <p class="m-0 text-sm">{$t('auth.processing')}</p>
    </div>
  {/if}

  {#if error}
    <div
      id="pin-error"
      class="box-border min-w-0 max-w-full w-full rounded-lg bg-destructive/12 px-3 py-2 text-center text-sm text-balance text-destructive animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[var(--ease-out)] motion-reduce:animate-none"
      role="alert"
    >
      {error}
    </div>
  {/if}

  {#if onBack}
    <Button
      type="button"
      variant="outline"
      class="h-10 w-full min-w-0 max-w-full"
      disabled={isProcessing}
      onclick={onBack}
    >
      {$t('auth.back')}
    </Button>
  {/if}
</div>

<style>
  /* Scoped keyframes — Tailwind arbitrary animate-* cannot see these names. */
  @keyframes pin-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    15% {
      transform: translateX(-5px);
    }
    30% {
      transform: translateX(5px);
    }
    45% {
      transform: translateX(-3px);
    }
    60% {
      transform: translateX(2px);
    }
    75% {
      transform: translateX(-1px);
    }
  }

  .pin-inputs-shake {
    animation: pin-shake 280ms ease-in-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .pin-inputs-shake {
      animation: none;
    }
  }
</style>
