import { describe, it, expect } from 'vitest';
import { applyLocalDevDefaults } from './index';
import { applyLocalDevDefaults as originalApplyLocalDevDefaults } from './local-dev-setup';

describe('dev index', () => {
  it('re-exports applyLocalDevDefaults from local-dev-setup', () => {
    expect(applyLocalDevDefaults).toBe(originalApplyLocalDevDefaults);
  });
});
