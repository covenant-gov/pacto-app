// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

const api = vi.hoisted(() => ({
  getSquadCapabilities: vi.fn(),
  getSquadAdminRoleCatalog: vi.fn(),
  squadAdminCreateRole: vi.fn(),
  squadAdminEnableExecutor: vi.fn(),
  squadAdminDisableExecutor: vi.fn(),
  squadAdminEnableFullPermission: vi.fn(),
}));

vi.mock('../../../lib/governance/api', () => api);
vi.mock('../../../lib/governance/gov-write-background', () => ({
  runGovWriteInBackground: vi.fn(
    (opts: {
      job: () => Promise<unknown>;
      onSettled?: () => void | Promise<void>;
    }) => {
      void (async () => {
        try {
          await opts.job();
          await opts.onSettled?.();
        } catch {
          /* write errors toast via the real helper */
        }
      })();
      return true;
    },
  ),
}));

import CrewPrivilegesSection from './CrewPrivilegesSection.svelte';
import { squadPrivilegeNonceByParentId } from '../../../stores/squad-privilege-refresh';
import {
  FLAG_ADD_DOC,
  FLAG_CREATE_EVENT,
  encodePrivilegeRoleId,
} from '../../../lib/governance/privilege-role-id';

const PARENT = 'parent-crew';
const PROXY = '0x1111111111111111111111111111111111111111';

function captainSnapshot() {
  return {
    rosterAddress: '0x2222222222222222222222222222222222222222',
    wearsCaptain: true,
    wearsCrew: false,
    captainIsSafe: false,
    roleLabel: 'Captain',
    capabilities: { squadAdminCreateRole: { allowed: true, reason: '' } },
    squadAdminFull: false,
    squadAdminPaused: false,
  };
}

function nonce(): number {
  return get(squadPrivilegeNonceByParentId)[PARENT] ?? 0;
}

async function renderReady(props: Record<string, unknown> = {}) {
  const onPrivilegesChanged = vi.fn();
  const view = render(CrewPrivilegesSection, {
    props: { parentId: PARENT, squadAdminProxy: PROXY, onPrivilegesChanged, ...props },
  });
  const newRole = await screen.findByRole('button', { name: 'New role' });
  await waitFor(() => expect((newRole as HTMLButtonElement).disabled).toBe(false));
  return { view, newRole, onPrivilegesChanged };
}

async function draftEventDocRole(container: HTMLElement, newRole: HTMLElement) {
  await fireEvent.click(newRole);
  const name = container.querySelector<HTMLInputElement>('#crew-priv-role-name')!;
  await fireEvent.input(name, { target: { value: 'Ed' } });
  await fireEvent.click(screen.getByLabelText('Create events'));
  await fireEvent.click(screen.getByLabelText('Add docs'));
  await fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
}

describe('CrewPrivilegesSection privilege refresh', () => {
  beforeEach(() => {
    squadPrivilegeNonceByParentId.set({});
    for (const fn of Object.values(api)) fn.mockReset();
    api.getSquadCapabilities.mockResolvedValue(captainSnapshot());
    api.getSquadAdminRoleCatalog.mockResolvedValue({ roles: [] });
    api.squadAdminCreateRole.mockResolvedValue({ txHash: '0xabc' });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens Create on an empty catalog and hides Assign / Revoke', async () => {
    await renderReady();
    expect(screen.getByRole('heading', { name: 'Create role' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create role' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('creates a role with the event and doc bits and bumps the nonce once on success', async () => {
    const createdId = encodePrivilegeRoleId({
      name: 'Ed',
      flags: FLAG_CREATE_EVENT | FLAG_ADD_DOC,
    });
    api.getSquadAdminRoleCatalog
      .mockResolvedValueOnce({ roles: [] })
      .mockResolvedValue({ roles: [createdId] });

    const { view, newRole, onPrivilegesChanged } = await renderReady();
    expect(nonce()).toBe(0);

    await draftEventDocRole(view.container, newRole);

    await waitFor(() => expect(nonce()).toBe(1));
    expect(api.squadAdminCreateRole).toHaveBeenCalledTimes(1);
    expect(api.squadAdminCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: PARENT,
        squadAdminProxy: PROXY,
        roleId: createdId,
      }),
    );
    expect(onPrivilegesChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Assign members' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ed' })).toBeTruthy();
    expect(view.container.querySelector('.summary-name')?.textContent).toBe('Ed');
  });

  it('shows Assign only when selecting a catalog role', async () => {
    const roleId = encodePrivilegeRoleId({
      name: 'Mod',
      flags: FLAG_CREATE_EVENT,
    });
    api.getSquadAdminRoleCatalog.mockResolvedValue({ roles: [roleId] });

    await renderReady();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Assign members' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
    expect(screen.getByText('Create events')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'New role' }));
    expect(screen.getByRole('heading', { name: 'Create role' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create role' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Mod' }));
    expect(screen.getByRole('heading', { name: 'Assign members' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
  });

  it('refreshes the catalog before bumping the nonce', async () => {
    const createdId = encodePrivilegeRoleId({
      name: 'Ed',
      flags: FLAG_CREATE_EVENT | FLAG_ADD_DOC,
    });
    api.getSquadAdminRoleCatalog
      .mockResolvedValueOnce({ roles: [] })
      .mockResolvedValue({ roles: [createdId] });

    const { view, newRole } = await renderReady();
    const catalogCallsBefore = api.getSquadAdminRoleCatalog.mock.calls.length;

    await draftEventDocRole(view.container, newRole);

    await waitFor(() => expect(nonce()).toBe(1));
    expect(api.getSquadAdminRoleCatalog.mock.calls.length).toBeGreaterThan(catalogCallsBefore);
  });

  it('does not bump the nonce or notify when the write fails', async () => {
    api.squadAdminCreateRole.mockRejectedValue(new Error('rpc exploded'));
    const { view, newRole, onPrivilegesChanged } = await renderReady();

    await draftEventDocRole(view.container, newRole);

    await waitFor(() => expect(api.squadAdminCreateRole).toHaveBeenCalledTimes(1));
    expect(nonce()).toBe(0);
    expect(onPrivilegesChanged).not.toHaveBeenCalled();
  });

  it('does not submit or bump when the role name is empty', async () => {
    const { newRole } = await renderReady();
    await fireEvent.click(newRole);
    await fireEvent.click(screen.getByRole('button', { name: 'Create role' }));

    await screen.findByRole('alert');
    expect(api.squadAdminCreateRole).not.toHaveBeenCalled();
    expect(nonce()).toBe(0);
  });
});
