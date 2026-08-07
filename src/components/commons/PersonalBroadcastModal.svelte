<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../ui/Modal.svelte';
  import UserCommonsBroadcastPanel from './UserCommonsBroadcastPanel.svelte';
  import { currentUser } from '../../stores/auth';

  import { closeCommonsBroadcastModal } from '../../stores/commons-ui';

  export let onClose: () => void = closeCommonsBroadcastModal;

  let publishing = false;

  $: userNpub = $currentUser?.npub ?? '';
</script>

<Modal
  titleId="personal-broadcast-title"
  descriptionId="personal-broadcast-description"
  onClose={onClose}
  dismissible={!publishing}
>
  <h2 id="personal-broadcast-title">{$t('commons.broadcast.personalTitle')}</h2>
  <p id="personal-broadcast-description" class="broadcast-modal-lead">
    {$t('commons.broadcast.personalLead')}
  </p>
  {#if userNpub}
    <UserCommonsBroadcastPanel {userNpub} bind:publishing onPublished={onClose} />
  {:else}
    <p class="broadcast-private-note">{$t('commons.broadcast.loginPrompt')}</p>
  {/if}
</Modal>

<style>
  .broadcast-modal-lead {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 20px;
    line-height: 1.45;
  }

  .broadcast-private-note {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    margin: 0 0 16px;
    line-height: 1.45;
  }
</style>
