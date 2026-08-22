<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import { treasuryAuthorityPropose } from '../../../lib/governance/api';
  import {
    gateRequiresCaptainOrCrew,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { showGovWriteErrorToast } from '../../../lib/governance/gov-write-errors';
  import { showToast } from '../../../stores/toast';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  interface Props {
    network: string;
    parentId: string;
    treasuryAuthority: string;
    privilege: GovernancePrivilege;
    fundingHint?: string;
    /** True while capability preflight is still loading; forces the gate closed. */
    capabilitiesPending?: boolean;
    onSubmitted?: () => void;
  }

  let {
    network,
    parentId,
    treasuryAuthority,
    privilege,
    fundingHint = '',
    capabilitiesPending = false,
    onSubmitted = () => {},
  }: Props = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

  let acting = $state(false);
  let proposeTo = $state('');
  let proposeValue = $state('0');
  let proposeData = $state('0x');
  let proposeOp = $state('call');

  let proposeGate = $derived(capabilitiesPending ? PENDING_GATE : gateRequiresCaptainOrCrew(privilege));

  async function submit() {
    if (acting || !proposeGate.enabled) return;
    acting = true;
    const label = tFn('governance.action.submitProposal');
    try {
      const result = await treasuryAuthorityPropose({
        network,
        parentId,
        treasuryAuthority,
        to: proposeTo,
        valueWei: proposeValue,
        dataHex: proposeData,
        operation: proposeOp,
      });
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      onSubmitted();
    } catch (e) {
      showGovWriteErrorToast(e, label);
    } finally {
      acting = false;
    }
  }
</script>

<div class="propose-section">
  <h6 class="section-label">{$t('governance.section.submitProposal')}</h6>
  {#if fundingHint}
    <p class="muted funding-hint">{fundingHint}</p>
  {/if}
  <div class="form-grid">
    <label>{$t('governance.field.to')}<input bind:value={proposeTo} placeholder={$t('governance.field.toPlaceholder')} disabled={!proposeGate.enabled || acting} /></label>
    <label>{$t('governance.field.valueWei')}<input bind:value={proposeValue} disabled={!proposeGate.enabled || acting} /></label>
    <label>{$t('governance.field.data')}<input bind:value={proposeData} placeholder={$t('governance.field.dataPlaceholder')} disabled={!proposeGate.enabled || acting} /></label>
    <label
      >{$t('governance.field.op')}
      <select bind:value={proposeOp} disabled={!proposeGate.enabled || acting}>
        <option value="call">{$t('governance.field.opCall')}</option>
        <option value="delegatecall">{$t('governance.field.opDelegatecall')}</option>
      </select>
    </label>
  </div>
  <GovCtaButton label={tFn('governance.action.submitProposal')} variant="primary" gate={proposeGate} {acting} onClick={submit} />
</div>

<style>
  .propose-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .funding-hint {
    margin: 0 0 4px;
  }
  .section-label {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 8px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--text-muted);
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
