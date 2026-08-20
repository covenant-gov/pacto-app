<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import GovCtaButton from './GovCtaButton.svelte';
  import CrewVoteModeSwitch from './CrewVoteModeSwitch.svelte';
  import { getTreasuryVoteConfig, treasuryAuthorityPropose } from '../../../lib/governance/api';
  import {
    encodeSetCrewVoteMode,
    encodeSetQuorumBps,
    parseCrewVoteMode,
    pendingVoteConfigChanges,
    quorumBpsToPercent,
  } from '../../../lib/governance/crew-vote-mode';
  import {
    MAX_QUORUM_BPS,
    MIN_QUORUM_BPS,
    PRODUCTION_QUORUM_BPS,
    type CrewVoteMode,
  } from '../../../lib/governance/squad-params';
  import {
    gateRequiresCaptainOrCrew,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { govWriteErrorMessage } from '../../../lib/governance/gov-write-errors';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';

  let {
    network,
    parentId,
    treasuryAuthority,
    privilege,
    fundingHint = '',
    onSubmitted = () => {},
  }: {
    network: string;
    parentId: string;
    treasuryAuthority: string;
    privilege: GovernancePrivilege;
    fundingHint?: string;
    onSubmitted?: () => void;
  } = $props();

  const tFn = get(t);

  let loading = $state(false);
  let acting = $state(false);
  let loadError = $state('');
  let hydrated = $state(false);
  let loadedMode = $state<CrewVoteMode>('majority');
  let loadedBps = $state(PRODUCTION_QUORUM_BPS);
  let draftMode = $state<CrewVoteMode>('majority');
  let draftBps = $state(PRODUCTION_QUORUM_BPS);
  let loadSeq = 0;

  const roleGate = $derived(gateRequiresCaptainOrCrew(privilege));
  const fieldsDisabled = $derived(loading || acting || !roleGate.enabled || !hydrated);
  const pending = $derived(
    pendingVoteConfigChanges({
      loadedMode,
      loadedBps,
      draftMode,
      draftBps,
    }),
  );
  const bpsInvalid = $derived(
    draftMode === 'quorum' &&
      (Number(draftBps) < MIN_QUORUM_BPS || Number(draftBps) > MAX_QUORUM_BPS),
  );
  const proposeGate: CtaGate = $derived.by(() => {
    if (!roleGate.enabled) return roleGate;
    if (loading) return { enabled: false, reason: 'governance.status.loading' };
    if (!hydrated || loadError) {
      return { enabled: false, reason: 'governance.error.couldNotLoadVoteConfig' };
    }
    if (bpsInvalid) return { enabled: false, reason: 'governance.squadParams.error.invalid' };
    if (pending.length === 0) return { enabled: false, reason: 'governance.crewVoteSettings.noChanges' };
    return roleGate;
  });
  const currentPercent = $derived(quorumBpsToPercent(loadedBps));
  const currentModeKey = $derived(
    loadedMode === 'quorum' ? 'governance.squadParams.quorum' : 'governance.squadParams.majority',
  );

  async function loadConfig() {
    const ta = treasuryAuthority.trim();
    if (!ta) {
      loadError = '';
      hydrated = false;
      return;
    }
    const seq = ++loadSeq;
    loading = true;
    loadError = '';
    try {
      const cfg = await getTreasuryVoteConfig({
        network,
        treasuryAuthority: ta,
        parentId,
      });
      if (seq !== loadSeq) return;
      loadedMode = parseCrewVoteMode(cfg.crewVoteMode);
      loadedBps = Number(cfg.quorumBps) || PRODUCTION_QUORUM_BPS;
      draftMode = loadedMode;
      draftBps = loadedBps;
      hydrated = true;
    } catch (e) {
      if (seq !== loadSeq) return;
      hydrated = false;
      loadError = getInvokeErrorMessage(e, tFn('governance.error.couldNotLoadVoteConfig'));
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    void network;
    void parentId;
    void treasuryAuthority;
    void loadConfig();
  });

  async function submit() {
    if (acting || !proposeGate.enabled) return;
    acting = true;
    const changes = pending;
    try {
      for (const change of changes) {
        const label =
          change.kind === 'set_crew_vote_mode'
            ? tFn('governance.action.proposeCrewVoteMode')
            : tFn('governance.action.proposeQuorumBps');
        const dataHex =
          change.kind === 'set_crew_vote_mode'
            ? encodeSetCrewVoteMode(change.mode)
            : encodeSetQuorumBps(change.quorumBps);
        const result = await treasuryAuthorityPropose({
          network,
          parentId,
          treasuryAuthority,
          to: treasuryAuthority,
          valueWei: '0',
          dataHex,
          operation: 'call',
        });
        showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      }
      onSubmitted();
      await loadConfig();
    } catch (e) {
      showToast(govWriteErrorMessage(e, tFn('governance.action.submitProposal')));
      onSubmitted();
    } finally {
      acting = false;
    }
  }
</script>

<div class="vote-settings">
  <div class="head">
    <h6 class="section-label">{$t('governance.section.crewVoteSettings')}</h6>
    <RefreshIconButton
      spinning={loading}
      disabled={!treasuryAuthority.trim() || acting}
      ariaLabel={loading
        ? $t('governance.aria.refreshingVoteConfig')
        : $t('governance.aria.refreshVoteConfig')}
      onclick={() => void loadConfig()}
    />
  </div>
  {#if fundingHint}
    <p class="muted funding-hint">{fundingHint}</p>
  {/if}
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if hydrated}
    <p class="current">
      {$t('governance.crewVoteSettings.current', {
        values: { mode: $t(currentModeKey), percent: currentPercent },
      })}
    </p>
  {:else}
    <p class="muted">{$t('governance.status.loading')}</p>
  {/if}

  <CrewVoteModeSwitch bind:mode={draftMode} disabled={fieldsDisabled} name="live-crew-vote-mode" />

  {#if draftMode === 'quorum'}
    <div class="field">
      <label class="label" for="live-quorum-bps">{$t('governance.squadParams.quorumBps')}</label>
      <input
        id="live-quorum-bps"
        class="input"
        type="number"
        min={MIN_QUORUM_BPS}
        max={MAX_QUORUM_BPS}
        step="1"
        bind:value={draftBps}
        disabled={fieldsDisabled}
      />
      <p class="muted">
        {$t('governance.squadParams.quorumBounds', {
          values: { min: MIN_QUORUM_BPS, max: MAX_QUORUM_BPS },
        })}
      </p>
    </div>
  {/if}

  <p class="muted independence">{$t('governance.crewVoteSettings.independenceNote')}</p>

  <GovCtaButton
    label={tFn('governance.crewVoteSettings.propose')}
    variant="primary"
    gate={proposeGate}
    {acting}
    onClick={() => void submit()}
  />
</div>

<style>
  .vote-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .funding-hint {
    margin: 0 0 4px;
  }
  .current {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }
  .error {
    margin: 0;
    font-size: 0.875rem;
    color: var(--danger, #c44);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .input {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
  .independence {
    line-height: 1.4;
  }
</style>
