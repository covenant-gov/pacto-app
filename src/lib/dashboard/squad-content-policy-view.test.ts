import { describe, expect, it } from 'vitest';
import type { SquadContentPolicyView } from '../api/squad-content-policy';
import { squadContentPolicyRows } from './squad-content-policy-view';

const defaultView: SquadContentPolicyView = {
  restrictEventCreate: false,
  restrictEventCreateUpdatedAtMs: 0,
  restrictDocAdd: false,
  restrictDocAddUpdatedAtMs: 0,
  callerIsAdmin: false,
  adminIsMember: true,
};

describe('squadContentPolicyRows', () => {
  it('gives an admin two independent switches', () => {
    const rows = squadContentPolicyRows({ ...defaultView, callerIsAdmin: true, restrictDocAdd: true });
    expect(rows.map((r) => [r.flag, r.control, r.checked])).toEqual([
      ['restrict_event_create', 'switch', false],
      ['restrict_doc_add', 'switch', true],
    ]);
  });

  it('gives a non-admin no switches, only the current state', () => {
    const rows = squadContentPolicyRows({ ...defaultView, restrictEventCreate: true });
    expect(rows.every((r) => r.control === 'readonly')).toBe(true);
    expect(rows.map((r) => [r.copyKey, r.state])).toEqual([
      ['events', 'adminOnly'],
      ['docs', 'open'],
    ]);
  });

  it('renders the default policy as both switches off for an admin', () => {
    const rows = squadContentPolicyRows({ ...defaultView, callerIsAdmin: true });
    expect(rows.map((r) => [r.control, r.checked, r.state])).toEqual([
      ['switch', false, 'open'],
      ['switch', false, 'open'],
    ]);
  });

  it('locks out a restriction that is on when no admin is a member, with no switch', () => {
    const view = { ...defaultView, restrictEventCreate: true, adminIsMember: false };
    for (const callerIsAdmin of [true, false]) {
      const [events, docs] = squadContentPolicyRows({ ...view, callerIsAdmin });
      expect(events).toMatchObject({ state: 'lockedOut', control: 'readonly' });
      expect(docs.state).toBe('open');
    }
  });

  it('keeps an admin switch for an off restriction even without an admin member', () => {
    const [events] = squadContentPolicyRows({ ...defaultView, callerIsAdmin: true, adminIsMember: false });
    expect(events).toMatchObject({ state: 'open', control: 'switch' });
  });
});
