<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import Modal from '../ui/Modal.svelte';
  import type { WhatsNewRelease } from '../../lib/updater/whats-new';

  let { version, releases, onClose }: { version: string; releases: WhatsNewRelease[]; onClose: () => void } = $props();
  let language: 'en' | 'es' = $derived($locale?.startsWith('es') ? 'es' : 'en');
  let changelogUrl = $derived(`https://github.com/covenant-gov/pacto-app/releases/tag/v${encodeURIComponent(version.replace(/^v/, ''))}`);
</script>

<Modal titleId="whats-new-title" {onClose} contentClass="whats-new-panel">
  <div class="whats-new">
    <header>
      <h2 id="whats-new-title">{$t('updater.whatsNew.title', { values: { version } })}</h2>
      <p>{$t('updater.whatsNew.intro')}</p>
    </header>
    <div class="release-list">
      {#each releases as release (release.version)}
        <section aria-label={$t('updater.whatsNew.release', { values: { version: release.version } })}>
          {#if releases.length > 1}<h3 class="release-version">{$t('updater.whatsNew.release', { values: { version: release.version } })}</h3>{/if}
          <ul>
            {#each release.items as item (item)}
              <li>
                <span class="item-kind">{$t(`updater.whatsNew.kind.${item.kind}`)}</span>
                <h3>{item.title[language]}</h3>
                <p>{item.detail[language]}</p>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
    <footer>
      <a href={changelogUrl} target="_blank" rel="external noopener noreferrer" onclick={(event) => { event.preventDefault(); void openExternalUrl(changelogUrl); }}>{$t('updater.whatsNew.changelog')}</a>
      <button type="button" class="btn-primary" onclick={onClose}>{$t('updater.whatsNew.done')}</button>
    </footer>
  </div>
</Modal>

<style>
  :global(.whats-new-panel) { box-sizing: border-box; width: min(560px, calc(100vw - 32px)); max-width: 560px; max-height: calc(100dvh - 32px); overscroll-behavior: contain; }
  .whats-new { display: flex; flex-direction: column; gap: 24px; color: var(--text-primary); min-width: 0; }
  p { margin: 0; color: var(--text-secondary); line-height: 1.5; overflow-wrap: anywhere; }
  .release-list, ul { display: flex; flex-direction: column; gap: 20px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border-top: 1px solid var(--border-subtle); padding-top: 16px; }
  h3 { margin: 4px 0; font-size: 1rem; font-weight: 600; overflow-wrap: anywhere; }
  .release-version { margin: 0 0 12px; font-size: 0.875rem; color: var(--text-muted); }
  .item-kind { font-size: 0.75rem; color: var(--text-muted); }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  a { color: var(--text-primary); text-underline-offset: 3px; }
  button { flex-shrink: 0; }
  @media (max-width: 440px) { footer { align-items: stretch; flex-direction: column; } }
</style>
