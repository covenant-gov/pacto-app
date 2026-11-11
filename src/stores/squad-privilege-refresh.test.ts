import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { bumpSquadPrivilegeNonce, squadPrivilegeNonceByParentId } from './squad-privilege-refresh';

describe('squad privilege refresh nonce', () => {
  beforeEach(() => squadPrivilegeNonceByParentId.set({}));

  it('increments per parent and ignores blank ids', () => {
    bumpSquadPrivilegeNonce(' p1 ');
    bumpSquadPrivilegeNonce('p1');
    bumpSquadPrivilegeNonce('p2');
    bumpSquadPrivilegeNonce('  ');
    expect(get(squadPrivilegeNonceByParentId)).toEqual({ p1: 2, p2: 1 });
  });
});
