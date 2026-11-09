import { describe, expect, it } from 'vitest';
import { nextHubModeIndex } from './hub-mode-tab-keyboard';

describe('nextHubModeIndex', () => {
  it('moves with arrows and wraps', () => {
    expect(nextHubModeIndex(3, 0, 'ArrowRight')).toBe(1);
    expect(nextHubModeIndex(3, 2, 'ArrowRight')).toBe(0);
    expect(nextHubModeIndex(3, 0, 'ArrowLeft')).toBe(2);
    expect(nextHubModeIndex(3, 1, 'ArrowUp')).toBe(0);
    expect(nextHubModeIndex(3, 1, 'ArrowDown')).toBe(2);
  });

  it('jumps with Home and End', () => {
    expect(nextHubModeIndex(3, 2, 'Home')).toBe(0);
    expect(nextHubModeIndex(3, 0, 'End')).toBe(2);
  });

  it('ignores other keys and empty lists', () => {
    expect(nextHubModeIndex(3, 1, 'Enter')).toBeNull();
    expect(nextHubModeIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});
