import { describe, it, expect } from 'vitest';
import { validateRecoveryPhraseForImport } from './encryption';

describe('validateRecoveryPhraseForImport', () => {
  const twelve =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const twentyFour =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

  it('accepts normalized 12-word phrase', () => {
    expect(validateRecoveryPhraseForImport(`  ${twelve}  `)).toBe(true);
  });

  it('accepts 24-word phrase', () => {
    expect(validateRecoveryPhraseForImport(twentyFour)).toBe(true);
  });

  it('rejects wrong word count', () => {
    expect(validateRecoveryPhraseForImport('one two three')).toBe(false);
    expect(validateRecoveryPhraseForImport(`${twelve} extra`)).toBe(false);
  });

  it('rejects nsec', () => {
    expect(validateRecoveryPhraseForImport('nsec1qv'.padEnd(63, 'x'))).toBe(false);
  });

  it('rejects hex-only secret', () => {
    expect(validateRecoveryPhraseForImport('a'.repeat(64))).toBe(false);
  });

  it('rejects empty', () => {
    expect(validateRecoveryPhraseForImport('')).toBe(false);
    expect(validateRecoveryPhraseForImport('   ')).toBe(false);
  });
});
