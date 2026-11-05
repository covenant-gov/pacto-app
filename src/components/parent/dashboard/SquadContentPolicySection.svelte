<script lang="ts">
  import { t } from 'svelte-i18n';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import { listen } from '../../../lib/api';
  import {
    getSquadContentPolicy,
    setSquadContentPolicy,
    type SquadContentPolicyFlag,
    type SquadContentPolicyView,
  } from '../../../lib/api/squad-content-policy';
  import { squadContentPolicyRows } from '../../../lib/dashboard/squad-content-policy-view';
  import { squadRecordErrorMessage } from '../../../lib/squad/squad-record-errors';

  type Props = {
    parentId: string;
    mlsGroupId: string | null;
  };
  const { parentId, mlsGroupId }: Props = $props();

  const headingId = $derived(`squad-content-policy-heading-${parentId}`);
  const groupId = $derived(mlsGroupId?.trim() ?? '');

  let policy = $state<SquadContentPolicyView | null>(null);
  let loadError = $state('');
  let saving = $state(false);
  let saveError = $state('');
  /** Drops responses for a squad or group the section no longer shows. */
  let loadToken = 0;

  const rows = $derived(policy ? squadContentPolicyRows(policy) : []);

  async function load(pid: string, gid: string): Promise<void> {
    const token = ++loadToken;
    try {
      const view = await getSquadContentPolicy(gid, pid);
      if (token !== loadToken) return;
      policy = view;
      loadError = '';
    } catch (e) {
      if (token !== loadToken) return;
      loadError = squadRecordErrorMessage(e, $t);
    }
  }

  $effect(() => {
    const pid = parentId;
    const gid = groupId;
    policy = null;
    loadError = '';
    saveError = '';
    if (!pid || !gid) return;
    void load(pid, gid);

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<{ parentId: string }>('squad_content_policy_updated', (event) => {
      if (event.payload?.parentId === pid) void load(pid, gid);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  async function toggle(flag: SquadContentPolicyFlag, input: HTMLInputElement): Promise<void> {
    const value = input.checked;
    if (saving || !groupId) return;
    saving = true;
    saveError = '';
    const token = ++loadToken;
    try {
      const view = await setSquadContentPolicy({ mlsGroupId: groupId, parentId, flag, value });
      if (token === loadToken) policy = view;
    } catch (e) {
      input.checked = !value;
      saveError = squadRecordErrorMessage(e, $t);
    } finally {
      saving = false;
    }
  }
</script>

<DashboardAssetCard
  {headingId}
  heading={$t('governance.contentPolicy.title')}
  hint={$t('governance.contentPolicy.hint')}
>
  {#if !groupId}
    <p class="policy-muted">{$t('governance.contentPolicy.unavailable')}</p>
  {:else if loadError}
    <p class="policy-error" role="alert">{loadError}</p>
  {:else if !policy}
    <p class="policy-muted" role="status">{$t('governance.contentPolicy.loading')}</p>
  {:else}
    <ul class="policy-list" role="list">
      {#each rows as row (row.flag)}
        {@const nameId = `${headingId}-${row.copyKey}-name`}
        {@const descriptionId = `${headingId}-${row.copyKey}-description`}
        <li>
          {#if row.control === 'switch'}
            <label class="policy-row policy-row-interactive" class:policy-row-disabled={saving}>
              <span class="policy-copy">
                <span id={nameId} class="policy-name">
                  {$t(`governance.contentPolicy.${row.copyKey}.switchLabel`)}
                </span>
                <span id={descriptionId} class="policy-description">
                  {$t(`governance.contentPolicy.${row.copyKey}.switchDescription`)}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="policy-switch"
                checked={row.checked}
                disabled={saving}
                aria-labelledby={nameId}
                aria-describedby={descriptionId}
                onchange={(e) => void toggle(row.flag, e.currentTarget)}
              />
            </label>
          {:else}
            <p class="policy-row policy-readonly" class:policy-locked={row.state === 'lockedOut'}>
              {$t(`governance.contentPolicy.${row.copyKey}.${row.state}`)}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if saveError}
      <p class="policy-error" role="alert">{saveError}</p>
    {/if}
  {/if}
</DashboardAssetCard>

<style>
  .policy-muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .policy-error {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .policy-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .policy-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .policy-row-interactive {
    cursor: pointer;
  }

  .policy-row-interactive:hover {
    background: var(--bg-hover);
  }

  .policy-row-disabled {
    cursor: progress;
  }

  .policy-readonly {
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .policy-locked {
    color: var(--warning);
  }

  .policy-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .policy-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .policy-description {
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .policy-switch {
    appearance: none;
    flex-shrink: 0;
    position: relative;
    width: 40px;
    height: 24px;
    margin: 0;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    cursor: pointer;
    transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
  }

  .policy-switch::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: transform 0.15s var(--ease-out);
  }

  .policy-switch:checked {
    background: var(--brand);
    border-color: var(--brand);
  }

  .policy-switch:checked::before {
    background: var(--on-brand);
    transform: translateX(16px);
  }

  .policy-switch:disabled {
    cursor: progress;
    opacity: 0.6;
  }

  .policy-switch:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .policy-switch,
    .policy-switch::before {
      transition: none;
    }
  }
</style>
