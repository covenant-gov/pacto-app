<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import GovCtaButton from './GovCtaButton.svelte';
  import {
    quartermasterCrewOffboardVote,
    quartermasterExecuteOffboard,
    quartermasterExpireOffboard,
    quartermasterProposeOffboard,
    type QuartermasterStatusDto,
  } from '../../../lib/governance/api';
  import {
    isCrewOffboardActive,
    isCrewOffboardExecutable,
    isCrewOffboardExpirable,
    parseQuorumBps,
  } from '../../../lib/governance/crew-offboard';
  import { scheduleDeadlineTimeout } from '../../../lib/utils/deadline-timeout';
  import { quorumBpsToPercent } from '../../../lib/governance/crew-vote-mode';
  import {
    gatePermissionlessSigner,
    gateRequiresCrew,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import { hasPendingJob, pendingOnChainJobs } from '../../../stores/pending-on-chain';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';

  let {
    network,
    parentId,
    quartermaster,
    privilege,
    mutinyActive = false,
    qmStatus = null,
    memberEvmOptions = [],
    hasVoted = false,
    onRefresh = () => {},
  }: {
    network: string;
    parentId: string;
    quartermaster: string;
    privilege: GovernancePrivilege;
    mutinyActive?: boolean;
    qmStatus?: QuartermasterStatusDto | null;
    memberEvmOptions?: { address: string; label: string }[];
    hasVoted?: boolean;
    onRefresh?: () => void;
  } = $props();

  const tFn = get(t);

  let acting = $derived.by(() => {
    void $pendingOnChainJobs;
    return (
      hasPendingJob(parentId, 'offboard-propose') ||
      hasPendingJob(parentId, 'offboard-vote') ||
      hasPendingJob(parentId, 'offboard-exec') ||
      hasPendingJob(parentId, 'offboard-expire')
    );
  });
  let target = $state('');
  let nowSec = $state(Math.floor(Date.now() / 1000));

  const crewGate = $derived(gateRequiresCrew(privilege));
  const execGate = $derived(gatePermissionlessSigner(privilege));
  const offboard = $derived(qmStatus?.offboard ?? null);
  const offboardActive = $derived(isCrewOffboardActive(qmStatus));
  const quorumBps = $derived(parseQuorumBps(qmStatus?.crewOffboardQuorumBps));
  const expired = $derived(isCrewOffboardExpirable(offboard, nowSec));
  const executable = $derived(isCrewOffboardExecutable(offboard, quorumBps, nowSec));
  const targetOptions = $derived.by(() => {
    void memberEvmOptions.length;
    return memberEvmOptions.map((o) => ({ address: o.address, label: o.label }));
  });
  const targetFormKey = $derived(
    `${qmStatus?.activeCrewOffboardId ?? '0'}|${targetOptions.map((o) => o.address).join(',')}`,
  );

  $effect(() => {
    const deadline = offboard?.deadline ?? 0;
    nowSec = Math.floor(Date.now() / 1000);
    if (!deadline || deadline <= nowSec) return;
    return scheduleDeadlineTimeout(deadline, () => {
      nowSec = Math.floor(Date.now() / 1000);
    });
  });

  $effect(() => {
    const opts = targetOptions;
    if (opts.length === 0) {
      if (target) target = '';
      return;
    }
    const hit = opts.some(
      (o) => o.address.trim().toLowerCase() === target.trim().toLowerCase(),
    );
    if (!target.trim() || !hit) {
      target = opts[0].address;
    }
  });

  const proposeGate: CtaGate = $derived.by(() => {
    if (mutinyActive) {
      return { enabled: false, reason: 'governance.gate.cannotOffboardWhileMutiny' };
    }
    const self = privilege.myAddress.trim().toLowerCase();
    if (self && target.trim().toLowerCase() === self) {
      return { enabled: false, reason: 'governance.gate.cannotOffboardSelf' };
    }
    return crewGate;
  });

  const voteGate: CtaGate = $derived.by(() => {
    if (!offboardActive || !offboard) return { enabled: false, reason: 'governance.offboard.none' };
    if (expired) return { enabled: false, reason: 'governance.gate.offboardExpired' };
    if (hasVoted) return { enabled: false, reason: 'governance.gate.alreadyVotedOffboard' };
    return crewGate;
  });

  const executeGate: CtaGate = $derived.by(() => {
    if (!offboardActive || !offboard) return { enabled: false, reason: 'governance.offboard.none' };
    if (expired) return { enabled: false, reason: 'governance.gate.offboardExpired' };
    if (!executable) return { enabled: false, reason: 'governance.offboard.none' };
    return execGate;
  });

  const expireGate: CtaGate = $derived.by(() => {
    if (!expired) return { enabled: false, reason: 'governance.offboard.none' };
    return execGate;
  });

  function run(label: string, actionKey: string, fn: () => Promise<unknown>) {
    runGovWriteInBackground({
      label,
      parentId,
      actionKey,
      job: fn,
      onSettled: () => void onRefresh(),
    });
  }
</script>

<section class="contract-box" aria-labelledby="crew-offboard-heading">
  <h5 id="crew-offboard-heading" class="contract-title">{$t('governance.title.crewOffboard')}</h5>
  <p class="muted">{$t('governance.offboard.hint')}</p>
  <p class="muted">
    {$t('governance.offboard.quorum', { values: { percent: quorumBpsToPercent(quorumBps) } })}
  </p>

  {#if offboardActive && offboard}
    <div class="section">
      <h6 class="section-label">{$t('governance.section.crewOffboard')}</h6>
      <p class="muted">
        {$t('governance.offboard.active', {
          values: {
            id: offboard.offboardId,
            address: offboard.target,
            yeas: offboard.yeas,
            nays: offboard.nays,
            snapshot: offboard.snapshot,
          },
        })}
      </p>
      {#if offboard.deadline > 0}
        <p class="muted">
          {$t('governance.offboard.deadline', {
            values: { when: new Date(offboard.deadline * 1000).toLocaleString() },
          })}
        </p>
      {/if}
      {#if expired}
        <p class="muted">{$t('governance.offboard.expired')}</p>
      {/if}
      <div class="row">
        <GovCtaButton
          label={hasVoted ? tFn('governance.action.alreadyVotedOffboard') : tFn('governance.action.voteYea')}
          variant="primary"
          gate={voteGate}
          {acting}
          onClick={() => {
            if (!requireBackupVerified()) return;
            void run(tFn('governance.action.voteYea'), 'offboard-vote', () =>
              quartermasterCrewOffboardVote({
                network,
                parentId,
                quartermaster,
                offboardId: offboard.offboardId,
                support: true,
              }));
          }}
        />
        <GovCtaButton
          label={tFn('governance.action.voteNay')}
          gate={voteGate}
          {acting}
          onClick={() => {
            if (!requireBackupVerified()) return;
            void run(tFn('governance.action.voteNay'), 'offboard-vote', () =>
              quartermasterCrewOffboardVote({
                network,
                parentId,
                quartermaster,
                offboardId: offboard.offboardId,
                support: false,
              }));
          }}
        />
        <GovCtaButton
          label={tFn('governance.action.executeOffboard')}
          variant="execute"
          gate={executeGate}
          {acting}
          onClick={() =>
            void run(tFn('governance.action.executeOffboard'), 'offboard-exec', () =>
              quartermasterExecuteOffboard({
                network,
                parentId,
                quartermaster,
                offboardId: offboard.offboardId,
              }))}
        />
        {#if expired}
          <GovCtaButton
            label={tFn('governance.action.expireOffboard')}
            gate={expireGate}
            {acting}
            onClick={() =>
              void run(tFn('governance.action.expireOffboard'), 'offboard-expire', () =>
                quartermasterExpireOffboard({
                  network,
                  parentId,
                  quartermaster,
                  offboardId: offboard.offboardId,
                }))}
          />
        {/if}
      </div>
    </div>
  {:else}
    <div class="section">
      <label class="field-label">
        {$t('governance.field.targetMember')}
        {#key targetFormKey}
          {#if targetOptions.length > 0}
            <select bind:value={target} disabled={acting || !proposeGate.enabled} aria-label={$t('governance.field.targetMemberAriaLabel')}>
              {#each targetOptions as opt (opt.address)}
                <option value={opt.address}>{opt.label} — {shortEvmAddress(opt.address)}</option>
              {/each}
            </select>
          {:else}
            <input bind:value={target} placeholder={$t('governance.field.targetMemberPlaceholder')} disabled={acting || !proposeGate.enabled} />
          {/if}
        {/key}
      </label>
      <GovCtaButton
        label={tFn('governance.action.proposeOffboard')}
        variant="primary"
        gate={proposeGate}
        {acting}
        onClick={() => {
          if (!requireBackupVerified()) return;
          void run(tFn('governance.action.proposeOffboard'), 'offboard-propose', () =>
            quartermasterProposeOffboard({
              network,
              parentId,
              quartermaster,
              target,
            }));
        }}
      />
    </div>
  {/if}
</section>

<style>
  .contract-box {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
  }
  .contract-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .section {
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
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
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
