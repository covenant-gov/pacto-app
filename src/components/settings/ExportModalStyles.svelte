<!-- Shared rules for the sensitive-export dialogs. Rendered once inside each modal. -->
<span hidden></span>

<style>
  :global(.sensitive-export .export-desc) {
    margin: 0 0 12px;
    color: var(--text-muted);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  :global(.sensitive-export .export-warning) {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0 0 10px;
    padding: 12px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--warning);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    color: var(--text-primary);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  :global(.sensitive-export .export-warning-icon) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--warning);
  }

  :global(.sensitive-export .export-note) {
    margin: 0 0 8px;
    color: var(--text-muted);
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  :global(.sensitive-export .export-identity) {
    margin: 0 0 2px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  :global(.sensitive-export .export-address) {
    margin: 0 0 12px;
    color: var(--text-muted);
    font-family: var(--font-mono-family), ui-monospace, monospace;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  :global(.sensitive-export .export-actions) {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  :global(.sensitive-export .export-actions button) {
    flex: 1;
    min-height: 40px;
  }

  :global(.sensitive-export .export-success) {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 4px 0 16px;
    padding: 14px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--text-primary);
  }

  :global(.sensitive-export .export-success-icon) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--success);
  }

  :global(.sensitive-export .export-success-title) {
    margin: 0 0 4px;
    font-weight: 600;
    color: var(--success);
  }

  :global(.sensitive-export .export-success p) {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
  }

  :global(.sensitive-export .export-status) {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  :global(.sensitive-export .export-status-ok) {
    color: var(--success);
  }

  :global(.sensitive-export .export-error) {
    margin: 4px 0 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  :global(.sensitive-export .export-list-heading) {
    margin: 8px 0;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  :global(.sensitive-export .export-list) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  :global(.sensitive-export .export-row) {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  :global(.sensitive-export .export-row-text) {
    flex: 1;
    min-width: 0;
  }

  :global(.sensitive-export .export-row-title) {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  :global(.sensitive-export .export-row-detail) {
    margin-top: 2px;
    color: var(--text-muted);
    font-family: var(--font-mono-family), ui-monospace, monospace;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  :global(.sensitive-export .export-row button) {
    flex: 0 0 auto;
  }

  :global(.sensitive-export .export-backoff) {
    margin: 0 0 12px;
    color: var(--warning);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }
</style>
