import { describe, it, expect } from 'vitest';
import { createChallenge, checkChallenge } from './seed-verification';

describe('createChallenge', () => {
  it('picks 3 distinct 1-indexed positions from a 12-word seed', () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${i + 1}`);
    const rng = makeRng([0.1, 0.5, 0.9, 0.2, 0.6, 0.3]);
    const challenge = createChallenge(words, 3, rng);

    expect(challenge.positions.length).toBe(3);
    expect(new Set(challenge.positions).size).toBe(3);
    for (const p of challenge.positions) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(12);
    }
    expect(challenge.answers).toEqual(challenge.positions.map((p) => words[p - 1]));
  });

  it('works for a 24-word seed and stays within bounds', () => {
    const words = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
    const challenge = createChallenge(words, 3, makeRng([0.05, 0.95, 0.45, 0.12]));

    for (const p of challenge.positions) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(24);
    }
    expect(challenge.positions.length).toBe(3);
  });

  it('throws when count exceeds seed length', () => {
    const words = ['one', 'two', 'three'];
    expect(() => createChallenge(words, 4)).toThrow();
  });

  it('throws when count is zero', () => {
    const words = ['one', 'two', 'three'];
    expect(() => createChallenge(words, 0)).toThrow();
  });

  it('de-duplicates positions when rng picks the same index twice', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i + 1}`);
    const rng = makeRng([0.2, 0.2, 0.2, 0.7, 0.8]);
    const challenge = createChallenge(words, 3, rng);

    expect(new Set(challenge.positions).size).toBe(3);
  });
});

describe('checkChallenge', () => {
  const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent'];

  it('returns correct when all inputs match', () => {
    const result = checkChallenge(words, [1, 3, 5], ['abandon', 'able', 'above']);
    expect(result.correct).toBe(true);
    expect(result.details).toHaveLength(3);
    expect(result.details.every((d) => d.expected === d.actual.trim().toLowerCase())).toBe(true);
  });

  it('returns incorrect and reports mismatching positions', () => {
    const result = checkChallenge(words, [1, 3, 5], ['abandon', 'wrong', 'above']);
    expect(result.correct).toBe(false);
    expect(result.details.find((d) => d.position === 3)?.actual).toBe('wrong');
    expect(result.details.find((d) => d.position === 3)?.expected).toBe('able');
  });

  it('ignores case and surrounding whitespace', () => {
    const result = checkChallenge(words, [2, 4], ['  ABILITY  ', 'AbOuT']);
    expect(result.correct).toBe(true);
  });

  it('treats missing inputs as empty', () => {
    const result = checkChallenge(words, [1, 2], ['abandon']);
    expect(result.correct).toBe(false);
    expect(result.details).toHaveLength(2);
    expect(result.details[1]?.actual).toBe('');
  });
});

function makeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i] ?? 0;
    i = (i + 1) % values.length;
    return v;
  };
}
