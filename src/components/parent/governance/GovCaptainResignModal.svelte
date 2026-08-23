<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import GovCtaButton from './GovCtaButton.svelte';
  import { mutinyCaptainResign } from '../../../lib/governance/api';
  import { type CtaGate } from '../../../lib/governance/governance-privilege';
  import {
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { showGovWriteErrorToast } from '../../../lib/governance/gov-write-errors';
  import { showToast } from '../../../stores/toast';

  let {
    open = false,
    onClose = () => {},
    network,
    parentId,
    mutinyModule,
    resignGate,
    randomizeGate,
    warGameStack = false,
    captainGateEnabled = false,
    mutinyActive = false,
    onRandomize = () => {},
    onSubmitted = () => {},
    parentActing = false,
  }: {
    open?: boolean;
    onClose?: () => void;
    network: string;
    parentId: string;
    mutinyModule: string;
    resignGate: CtaGate;
    randomizeGate: CtaGate;
    warGameStack?: boolean;
    captainGateEnabled?: boolean;
    mutinyActive?: boolean;
    onRandomize?: () => void;
    onSubmitted?: () => void;
    parentActing?: boolean;
  } = $props();

  const tFn = get(t);
  const titleId = 'gov-captain-resign-title';

  let acting = $state(false);
  let resignTo = $state('');
  let busy = $derived(acting || parentActing);

  async function resign() {
    if (acting) return;
    acting = true;
    const label = tFn('governance.action.captainResign');
    try {
      const result = await mutinyCaptainResign({
        network,
        parentId,
        mutinyModule,
        newCaptain: resignTo,
      });
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      onSubmitted();
      onClose();
    } catch (e) {
      showGovWriteErrorToast(e, label);
    } finally {
      acting = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} {onClose} contentClass="gov-action-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.section.captainResign')}</h2>
    <input
      bind:value={resignTo}
      placeholder={$t('governance.field.newCaptainPlaceholder')}
      disabled={!captainGateEnabled || busy || mutinyActive}
    />
    <div class="row">
      <GovCtaButton
        label={tFn('governance.action.resignCaptain')}
        gate={resignGate}
        acting={busy}
        onClick={() => void resign()}
      />
      {#if warGameStack}
        <GovCtaButton
          label={tFn('governance.action.randomizeCaptain')}
          gate={randomizeGate}
          acting={busy}
          onClick={onRandomize}
        />
      {/if}
    </div>
  </Modal>
{/if}

<style>
  :global(.gov-action-modal) {
    max-width: 32rem;
  }
  .modal-title {
    margin: 0 0 12px;
    font-size: 1.0625rem;
    font-weight: 600;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
</style>
