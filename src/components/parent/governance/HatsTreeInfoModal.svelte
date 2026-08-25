<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../../ui/Modal.svelte';
  import type { HatsTreeInfoViewModel } from '../../../lib/governance/hats-tree-info';

  let {
    open = false,
    viewModel = null,
    onClose = () => {},
  }: {
    open?: boolean;
    viewModel?: HatsTreeInfoViewModel | null;
    onClose?: () => void;
  } = $props();

  const titleId = 'hats-tree-info-title';
  const descriptionId = 'hats-tree-info-desc';

  const hatName = $derived(
    viewModel?.displayName?.trim()
      ? viewModel.displayName
      : viewModel
        ? $t(viewModel.nameKey)
        : '',
  );

  const quantityLabel = $derived.by(() => {
    if (!viewModel) return '';
    const { count, unlimited, max } = viewModel.quantity;
    if (unlimited) {
      return $t('governance.hats.info.quantityUnlimited', { values: { count } });
    }
    return $t('governance.hats.info.quantityFinite', { values: { count, max } });
  });

  const wearerLabel = $derived(
    viewModel ? $t(`governance.hats.info.wearer.${viewModel.wearerKind}`) : '',
  );
</script>

{#if open && viewModel}
  <Modal {titleId} {descriptionId} {onClose} contentClass="hats-tree-info-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.hats.info.title')}</h2>
    <dl id={descriptionId} class="info-factsheet">
      <div class="info-factsheet-row">
        <dt>{$t('governance.hats.info.field.hat')}</dt>
        <dd>{hatName}</dd>
      </div>
      <div class="info-factsheet-row">
        <dt>{$t('governance.hats.info.field.quantity')}</dt>
        <dd>{quantityLabel}</dd>
      </div>
      <div class="info-factsheet-row">
        <dt>{$t('governance.hats.info.field.wearer')}</dt>
        <dd>{wearerLabel}</dd>
      </div>
      {#if viewModel.functions.length > 0}
        <div class="info-factsheet-row info-factsheet-functions">
          <dt>{$t('governance.hats.info.field.functions')}</dt>
          <dd>
            <ul>
              {#each viewModel.functions as fn (fn.nameKey)}
                <li>
                  <span class="fn-name">{$t(fn.nameKey)}</span>
                  <span class="fn-desc">{$t(fn.descKey)}</span>
                </li>
              {/each}
            </ul>
          </dd>
        </div>
      {/if}
      <div class="info-factsheet-row info-factsheet-purpose">
        <dt>{$t('governance.hats.info.field.purpose')}</dt>
        <dd>{$t(viewModel.purposeKey)}</dd>
      </div>
    </dl>
    <div class="info-factsheet-actions">
      <button type="button" class="btn-close" onclick={onClose}>
        {$t('governance.hats.info.close')}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .info-factsheet {
    margin: 12px 0 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .info-factsheet-row {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 8px 12px;
    align-items: start;
  }

  .info-factsheet-row dt {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .info-factsheet-row dd {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .info-factsheet-functions ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .info-factsheet-functions li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fn-name {
    font-weight: 600;
  }

  .fn-desc {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .info-factsheet-purpose dd {
    color: var(--text-secondary);
  }

  .info-factsheet-actions {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }

  .btn-close {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .btn-close:hover {
    border-color: var(--text-muted);
  }

  :global(.hats-tree-info-modal) {
    max-width: 480px;
  }
</style>
