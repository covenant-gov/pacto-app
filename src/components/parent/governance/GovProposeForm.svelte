<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import { treasuryAuthorityPropose } from '../../../lib/governance/api';
  import { gateRequiresCaptainOrCrew, type GovernancePrivilege } from '../../../lib/governance/governance-privilege';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let privilege: GovernancePrivilege;
  export let onSubmitted: () => void = () => {};

  const tFn = get(t);

  let acting = false;
  let proposeTo = '';
  let proposeValue = '0';
  let proposeData = '0x';
  let proposeOp = 'call';

  $: proposeGate = gateRequiresCaptainOrCrew(privilege);

  async function submit() {
    if (acting || !proposeGate.enabled) return;
    acting = true;
    try {
      await treasuryAuthorityPropose({
        network,
        parentId,
        treasuryAuthority,
        to: proposeTo,
        valueWei: proposeValue,
        dataHex: proposeData,
        operation: proposeOp,
      });
      showToast(tFn('governance.toast.submitted', { values: { label: tFn('governance.action.submitProposal') } }));
      onSubmitted();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.toast.failed', { values: { label: tFn('governance.action.submitProposal') } })));
    } finally {
      acting = false;
    }
  }
</script>

<div class="propose-section">
  <h6 class="section-label">{$t('governance.section.submitProposal')}</h6>
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
