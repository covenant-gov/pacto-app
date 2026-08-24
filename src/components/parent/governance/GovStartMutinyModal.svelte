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
    onClose();
    runGovWriteInBackground({
      label,
      parentId,
      actionKey: `mutiny-start:${kind}`,
      job: () =>
        kind === 'pause'
          ? mutinyStartToPauseCaptain({ network, parentId, mutinyModule })
          : kind === 'crew'
            ? mutinyStartToCrewMember({ network, parentId, mutinyModule, proposed: proposedAddr })
            : kind === 'committee'
              ? mutinyStartToCommittee({ network, parentId, mutinyModule, proposed: proposedAddr })
              : kind === 'eoa'
                ? mutinyStartToArbitraryEoa({ network, parentId, mutinyModule, proposed: proposedAddr })
                : mutinyStartToArbitraryContract({ network, parentId, mutinyModule, proposed: proposedAddr }),
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
</style>
