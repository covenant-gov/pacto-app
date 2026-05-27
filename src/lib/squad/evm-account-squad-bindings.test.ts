import { describe, it, expect } from 'vitest';
import { bindingsByAccountId } from './evm-account-squad-bindings';

describe('bindingsByAccountId', () => {
  it('groups bindings by evm account id', () => {
    const map = bindingsByAccountId([
      { evmAccountId: 'a1', parentId: 'squad-1' },
      { evmAccountId: 'a1', parentId: 'squad-2' },
      { evmAccountId: 'a2', parentId: 'squad-3' },
    ]);
    expect(map.get('a1')?.map((b) => b.parentId)).toEqual(['squad-1', 'squad-2']);
    expect(map.get('a2')?.map((b) => b.parentId)).toEqual(['squad-3']);
  });
});
