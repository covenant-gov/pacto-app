<script lang="ts">
  import { currentNpubForPersistence } from '../../stores/persistence-context';
  import { resolveInstalledVersion, updateStatus } from '../../lib/updater/update-check';
  import { acknowledgeWhatsNew, loadWhatsNew, type WhatsNewAnnouncement } from '../../lib/updater/whats-new';
  import WhatsNewModal from './WhatsNewModal.svelte';

  let announcement = $state<WhatsNewAnnouncement | null>(null);
  let updateModalOpen = $derived(['available', 'downloading', 'installing', 'installed', 'error'].includes($updateStatus.status));
  $effect(() => {
    const npub = $currentNpubForPersistence;
    let cancelled = false;
    announcement = null;
    if (npub) {
      void resolveInstalledVersion().then(async version => {
        if (cancelled) return;
        const notes = await loadWhatsNew(version);
        if (!cancelled) announcement = notes;
      }).catch(() => { /* Post-update notes fail silently. */ });
    }
    return () => { cancelled = true; };
  });
  function dismiss(): void {
    if (announcement) acknowledgeWhatsNew(announcement);
    announcement = null;
  }
</script>

{#if announcement && !updateModalOpen}
  <WhatsNewModal version={announcement.version} releases={announcement.releases} onClose={dismiss} />
{/if}
