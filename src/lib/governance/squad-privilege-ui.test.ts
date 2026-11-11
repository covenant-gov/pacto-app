import { describe, expect, it } from 'vitest';
import { privilegeUiAllowed } from './squad-privilege-ui';

describe('privilegeUiAllowed', () => {
  it('allows on ok', () => {
    expect(privilegeUiAllowed({ ok: true, active: false, flags: null })).toBe(true);
  });

  it('denies on denied, paused and unbound', () => {
    for (const reason of ['denied', 'paused', 'unbound'] as const) {
      expect(privilegeUiAllowed({ ok: false, reason, active: true })).toBe(false);
    }
  });

  it('is unknown on an rpc failure', () => {
    expect(privilegeUiAllowed({ ok: false, reason: 'rpc', active: true })).toBeNull();
  });
});
