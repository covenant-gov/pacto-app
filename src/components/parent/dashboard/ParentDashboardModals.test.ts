// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type * as DeployWizardModule from '../../../lib/parent/deploy-wizard-components';

const FakeDeploySafeModal = () => {};

vi.mock('../../../lib/parent/deploy-wizard-components', async (importOriginal) => {
  const actual = await importOriginal<typeof DeployWizardModule>();
  return {
    ...actual,
    loadDeploySafeModal: vi.fn(),
  };
});

import ParentDashboardModals from './ParentDashboardModals.svelte';
import { loadDeploySafeModal } from '../../../lib/parent/deploy-wizard-components';

const baseProps = {
  parentId: 'squad-1',
  announcementsGroupId: 'group-1',
  squadAdminProxy: '',
};

describe('ParentDashboardModals — deploy-safe wizard lazy-load gate', () => {
  beforeEach(() => {
    vi.mocked(loadDeploySafeModal).mockReset();
    vi.mocked(loadDeploySafeModal).mockResolvedValue(FakeDeploySafeModal as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('does not load the deploy-safe (transaction submission) wizard while the modal is closed', () => {
    render(ParentDashboardModals, { props: { ...baseProps, showDeploySafeModal: false } });
    expect(loadDeploySafeModal).not.toHaveBeenCalled();
  });

  it('loads the deploy-safe wizard once on open, then reuses the cached component across close/reopen cycles', async () => {
    const { rerender } = render(ParentDashboardModals, {
      props: { ...baseProps, showDeploySafeModal: true },
    });

    await vi.waitFor(() => {
      expect(loadDeploySafeModal).toHaveBeenCalledTimes(1);
    });

    // User closes the modal, then cycles back and reopens it — the cached wizard
    // component must not trigger a second network fetch.
    await rerender({ ...baseProps, showDeploySafeModal: false });
    await rerender({ ...baseProps, showDeploySafeModal: true });

    expect(loadDeploySafeModal).toHaveBeenCalledTimes(1);
  });
});
