import { describe, it, expect } from 'vitest';
import { mockInvoke } from './mock-invoke';
import { mockCommandRegistry } from './mock-registry';
import { mockListen } from './mock-listen';

describe('mock backend API', () => {
  it('returns a fixture for every registered command without throwing', async () => {
    for (const command of Object.keys(mockCommandRegistry)) {
      await mockInvoke(command);
    }
  });

  it('throws a descriptive error for unregistered commands', async () => {
    await expect(mockInvoke('unregistered_command')).rejects.toThrow(
      'Unmocked backend command: unregistered_command'
    );
  });

  it('passes arguments through to fixture handlers', async () => {
    const result = await mockInvoke('encrypt', { input: 'hello', password: '123456' });
    expect(result).toBe('encrypted(hello)');
  });

  it('mock listen returns a no-op unlisten function', async () => {
    const unlisten = await mockListen('test-event', () => {});
    expect(unlisten).toBeInstanceOf(Function);
    expect(() => unlisten()).not.toThrow();
  });
});
