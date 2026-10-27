<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import GovCtaButton from './GovCtaButton.svelte';
  import {
    mutinyStartToArbitraryContract,
    mutinyStartToArbitraryEoa,
    mutinyStartToCommittee,
    mutinyStartToCrewMember,
    mutinyStartToPauseCaptain,
  } from '../../../lib/governance/api';
  import { type CtaGate } from '../../../lib/governance/governance-privilege';
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import GovMemberPicker from './GovMemberPicker.svelte';

  let {
    open = false,
    onClose = () => {},
    network,
    parentId,
    mutinyModule,
    startGate,
    kindGate,
    memberEvmOptions = [],
    squadMemberOptions = [],
    memberOptionsLoading = false,
    onSubmitted = () => {},
  }: {
    open?: boolean;
    onClose?: () => void;
    network: string;
    parentId: string;
    mutinyModule: string;
    startGate: CtaGate;
    kindGate: CtaGate;
    memberEvmOptions?: { address: string; label: string }[];
    squadMemberOptions?: { address: string; label: string }[];
    memberOptionsLoading?: boolean;
    onSubmitted?: () => void;
  } = $props();

  const tFn = get(t);
  const titleId = 'gov-start-mutiny-title';

  let startKind: 'crew' | 'committee' | 'eoa' | 'contract' | 'pause' = $state('crew');
  let proposed = $state('');
  let seatFormerCaptain = $state(true);

  let startPickerOptions = $derived.by(() => {
    const src =
      startKind === 'crew' ? memberEvmOptions : startKind === 'eoa' ? squadMemberOptions : [];
    void src.length;
    return src.map((o) => ({ address: o.address, label: o.label }));
  });
  let startFormKey = $derived(
    `${startKind}|${startPickerOptions.map((o) => o.address).join(',')}`,
  );
  let submitGate = $derived.by((): CtaGate => {
    if (!startGate.enabled) return startGate;
    if (startKind === 'crew' && startPickerOptions.length === 0) {
      return { enabled: false, reason: 'governance.gate.noCrewHatForMutiny' };
    }
    if (startKind === 'eoa' && startPickerOptions.length === 0) {
      return { enabled: false, reason: 'governance.gate.noSquadMemberForMutiny' };
    }
    return startGate;
  });

  function startMutiny() {
    const label =
      startKind === 'pause'
        ? tFn('governance.action.startPauseCaptainMutiny')
        : tFn('governance.action.startMutiny');
    const proposedAddr = proposed;
    const kind = startKind;
    const seat = seatFormerCaptain;
    onClose();
    runGovWriteInBackground({
      label,
      parentId,
      actionKey: `mutiny-start:${kind}`,
      job: () =>
        kind === 'pause'
          ? mutinyStartToPauseCaptain({ network, parentId, mutinyModule, seatFormerCaptain: seat })
          : kind === 'crew'
            ? mutinyStartToCrewMember({
                network,
                parentId,
                mutinyModule,
                proposed: proposedAddr,
                seatFormerCaptain: seat,
              })
            : kind === 'committee'
              ? mutinyStartToCommittee({
                  network,
                  parentId,
                  mutinyModule,
                  proposed: proposedAddr,
                  seatFormerCaptain: seat,
                })
              : kind === 'eoa'
                ? mutinyStartToArbitraryEoa({
                    network,
                    parentId,
                    mutinyModule,
                    proposed: proposedAddr,
                    seatFormerCaptain: seat,
                  })
                : mutinyStartToArbitraryContract({
                    network,
                    parentId,
                    mutinyModule,
                    proposed: proposedAddr,
                    seatFormerCaptain: seat,
                  }),
      onSettled: () => onSubmitted(),
    });
  }
</script>

{#if open}
  <Modal {titleId} {onClose} contentClass="gov-action-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.section.startMutiny')}</h2>
    <div class="section">
      {#key startFormKey}
        <select
          bind:value={startKind}
          disabled={!kindGate.enabled}
          aria-label={$t('governance.section.startMutiny')}
        >
          <option value="crew">{$t('governance.mutiny.startOption.crew')}</option>
          <option value="committee">{$t('governance.mutiny.startOption.committee')}</option>
          <option value="eoa">{$t('governance.mutiny.startOption.eoa')}</option>
          <option value="contract">{$t('governance.mutiny.startOption.contract')}</option>
          <option value="pause">{$t('governance.mutiny.startOption.pause')}</option>
        </select>
        {#if startKind === 'crew' || startKind === 'eoa'}
          <GovMemberPicker
            bind:value={proposed}
            options={startPickerOptions}
            ariaLabelKey="governance.field.proposedAddress"
            emptyKey={
              startKind === 'crew'
                ? 'governance.gate.noCrewHatForMutiny'
                : 'governance.gate.noSquadMemberForMutiny'
            }
            loading={memberOptionsLoading}
            disabled={!kindGate.enabled}
          />
        {:else if startKind !== 'pause'}
          <input
            bind:value={proposed}
            placeholder={$t('governance.field.proposedAddressPlaceholder')}
            disabled={!kindGate.enabled}
          />
        {/if}
      {/key}
      <label class="seat-former">
        <input type="checkbox" bind:checked={seatFormerCaptain} disabled={!kindGate.enabled} />
        <span>{$t('governance.mutiny.seatFormerCaptain')}</span>
      </label>
      <GovCtaButton
        label={tFn('governance.action.startMutiny')}
        variant="primary"
        gate={submitGate}
        onClick={() => void startMutiny()}
      />
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
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  input,
  select {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
  .seat-former {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
  .seat-former input {
    margin-top: 2px;
    padding: 0;
  }
</style>
