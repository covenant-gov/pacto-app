<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import GovCtaButton from './GovCtaButton.svelte';
  import {
    getQuartermasterPending,
    quartermasterCancelAddCrew,
    quartermasterCancelRemoveCrew,
    quartermasterExecuteAddCrew,
    quartermasterExecuteRemoveCrew,
    quartermasterRequestAddCrew,
    quartermasterRequestRemoveCrew,
    type QuartermasterPendingDto,
    type QuartermasterStatusDto,
  } from '../../../lib/governance/api';
  import { isCrewOffboardActive } from '../../../lib/governance/crew-offboard';
  import { type CtaGate } from '../../../lib/governance/governance-privilege';
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import GovMemberPicker from './GovMemberPicker.svelte';

  let {
    open = false,
    onClose = () => {},
    mode,
    network,
    parentId,
    quartermaster,
    qmStatus = null,
    memberEvmOptions = [],
    memberOptionsLoading = false,
    emptyKey = 'governance.gate.noSquadMemberToAdd',
    qmGate,
    execGate,
    onSubmitted = () => {},
  }: {
    open?: boolean;
    onClose?: () => void;
    mode: 'add' | 'remove';
    network: string;
    parentId: string;
    quartermaster: string;
    qmStatus?: QuartermasterStatusDto | null;
    memberEvmOptions?: { address: string; label: string }[];
    memberOptionsLoading?: boolean;
    emptyKey?: string;
    qmGate: CtaGate;
    execGate: CtaGate;
    onSubmitted?: () => void;
  } = $props();

  const tFn = get(t);
  const titleId = $derived(mode === 'add' ? 'gov-captain-add-crew-title' : 'gov-captain-remove-crew-title');
  const titleKey = $derived(mode === 'add' ? 'governance.shell.addCrew' : 'governance.shell.removeCrew');

  let qmAddress = $state('');
  let qmPending: QuartermasterPendingDto | null = $state(null);

  let offboardActive = $derived(isCrewOffboardActive(qmStatus));

  function run(label: string, actionKey: string, fn: () => Promise<unknown>) {
    onClose();
    runGovWriteInBackground({
      label,
      parentId,
      actionKey,
      job: fn,
      onSettled: () => void onSubmitted(),
    });
  }

  async function checkQmPending() {
    if (!quartermaster || !qmAddress.trim()) return;
    try {
      qmPending = await getQuartermasterPending({
        network,
        quartermaster,
        address: qmAddress.trim(),
      });
    } catch {
      qmPending = null;
    }
  }
</script>

{#if open}
  <Modal {titleId} {onClose} contentClass="gov-action-modal">
    <h2 id={titleId} class="modal-title">{$t(titleKey)}</h2>
    {#if qmStatus?.mutinyActive}
      <p class="muted"><strong>{$t('governance.info.mutinyModeOn')}</strong> — {$t('governance.info.mutinyModeBlocked')}</p>
    {:else if offboardActive}
      <p class="muted">{$t('governance.gate.rosterFrozenOffboard')}</p>
    {:else if qmStatus}
      <p class="muted">{$t('governance.info.crewChangeDelay', { values: { delay: qmStatus.crewChangeDelaySecs } })}</p>
    {/if}
    <GovMemberPicker
      bind:value={qmAddress}
      options={memberEvmOptions}
      labelKey="governance.field.targetMember"
      ariaLabelKey="governance.field.targetMemberAriaLabel"
      {emptyKey}
      loading={memberOptionsLoading}
    />
    <button
      type="button"
      class="linkish"
      disabled={!qmAddress.trim()}
      onclick={() => void checkQmPending()}
    >
      {$t('governance.quartermaster.checkPending')}
    </button>
    {#if qmPending}
      <p class="muted tiny">
        {$t('governance.quartermaster.pendingAdd', { values: { at: qmPending.pendingAddAt || '0' } })} · {$t('governance.quartermaster.pendingRemove', { values: { at: qmPending.pendingRemoveAt || '0' } })}
      </p>
    {/if}
    {#if mode === 'add'}
      <div class="row">
        <GovCtaButton
          label={tFn('governance.action.requestAdd')}
          gate={qmGate}
          onClick={() =>
            run(tFn('governance.action.requestAdd'), `crew-add:${qmAddress}`, () =>
              quartermasterRequestAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: qmAddress,
              }))}
        />
        <GovCtaButton
          label={tFn('governance.action.cancelAdd')}
          gate={qmGate}
          onClick={() =>
            run(tFn('governance.action.cancelAdd'), `crew-add-cancel:${qmAddress}`, () =>
              quartermasterCancelAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: qmAddress,
              }))}
        />
        <GovCtaButton
          label={tFn('governance.action.executeAdd')}
          gate={execGate}
          onClick={() =>
            run(tFn('governance.action.executeAdd'), `crew-add-exec:${qmAddress}`, () =>
              quartermasterExecuteAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: qmAddress,
              }))}
        />
      </div>
    {:else}
      <div class="row">
        <GovCtaButton
          label={tFn('governance.action.requestRemove')}
          gate={qmGate}
          onClick={() =>
            run(tFn('governance.action.requestRemove'), `crew-remove:${qmAddress}`, () =>
              quartermasterRequestRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: qmAddress,
              }))}
        />
        <GovCtaButton
          label={tFn('governance.action.cancelRemove')}
          gate={qmGate}
          onClick={() =>
            run(tFn('governance.action.cancelRemove'), `crew-remove-cancel:${qmAddress}`, () =>
              quartermasterCancelRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: qmAddress,
              }))}
        />
        <GovCtaButton
          label={tFn('governance.action.executeRemove')}
          gate={execGate}
          onClick={() =>
            run(tFn('governance.action.executeRemove'), `crew-remove-exec:${qmAddress}`, () =>
              quartermasterExecuteRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: qmAddress,
              }))}
        />
      </div>
    {/if}
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
  .muted {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .tiny {
    font-size: 0.6875rem;
  }
  .linkish {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    margin: 8px 0 0;
    color: var(--brand);
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .linkish:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
