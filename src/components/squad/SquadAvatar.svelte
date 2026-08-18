<script lang="ts">
  import { commonsTagGradient } from '../../lib/commons/tag-catalog';

  let {
    src = null,
    name = '',
    seed = '',
    size = 40,
    variant = 'circle',
    fill = false,
  }: {
    src?: string | null;
    name?: string;
    seed?: string;
    size?: number;
    variant?: 'circle' | 'cover';
    fill?: boolean;
  } = $props();

  let broken = $state(false);

  const displaySrc = $derived(src?.trim() && !broken ? src.trim() : null);
  const letter = $derived((name.trim() || '?').charAt(0).toUpperCase());
  const gradientSeed = $derived(seed.trim() || name.trim() || '?');

  $effect(() => {
    void src;
    broken = false;
  });

  const boxStyle = $derived.by(() => {
    const parts: string[] = [];
    if (variant === 'circle' && !fill) {
      parts.push(`width:${size}px`, `height:${size}px`);
    }
    if (!displaySrc) {
      parts.push(`background-image:${commonsTagGradient(gradientSeed)}`);
    }
    return parts.join(';');
  });
</script>

<div class="squad-avatar" class:squad-avatar-cover={variant === 'cover'} class:squad-avatar-fill={fill} style={boxStyle}>
  {#if displaySrc}
    <img src={displaySrc} alt="" loading="lazy" decoding="async" onerror={() => (broken = true)} />
  {:else}
    <span aria-hidden="true">{letter}</span>
  {/if}
</div>

<style>
  .squad-avatar {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 50%;
    background-color: var(--bg-elevated);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .squad-avatar-fill {
    width: 100%;
    height: 100%;
  }

  .squad-avatar-cover {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 0;
  }

  .squad-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .squad-avatar span {
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
    font-size: 1.25rem;
  }

  .squad-avatar-cover span {
    font-size: 2.5rem;
  }
</style>
