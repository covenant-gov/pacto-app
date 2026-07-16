<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import { treasuryAuthorityPropose } from '../../../lib/governance/api';
  import { gateRequiresCaptainOrCrew, type GovernancePrivilege } from '../../../lib/governance/governance-privilege';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let privilege: GovernancePrivilege;
  export let onSubmitted: () => void = () => {};

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
      showToast('Proposal submitted.');
      onSubmitted();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Proposal failed.'));
    } finally {
      acting = false;
    }
  }
</script>

<div class="action-block">
  <h5 class="subhead">Submit proposal</h5>
  <div class="form-grid">
    <label>To<input bind:value={proposeTo} placeholder="0x…" disabled={!proposeGate.enabled || acting} /></label>
    <label>Value (wei)<input bind:value={proposeValue} disabled={!proposeGate.enabled || acting} /></label>
    <label>Data<input bind:value={proposeData} placeholder="0x" disabled={!proposeGate.enabled || acting} /></label>
    <label
      >Op
      <select bind:value={proposeOp} disabled={!proposeGate.enabled || acting}>
        <option value="call">call</option>
        <option value="delegatecall">delegatecall</option>
      </select>
    </label>
  </div>
  <GovCtaButton
    label="Submit proposal"
    variant="primary"
    contractHint="Treasury Authority"
    gate={proposeGate}
    {acting}
    onClick={submit}
  />
</div>

<style>
  .action-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
  }
  .subhead {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
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
