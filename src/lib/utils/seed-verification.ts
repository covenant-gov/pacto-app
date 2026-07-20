export interface SeedChallenge {
  /** 1-indexed word positions to ask the user. */
  positions: number[];
  /** Expected words at those positions (in matching order). */
  answers: string[];
}

export interface ChallengeCheckResult {
  correct: boolean;
  /** Per-position comparison details. */
  details: { position: number; expected: string; actual: string }[];
}

/** Pick a random subset of distinct positions from a seed phrase.
 *  @param count - number of positions to pick (default 3)
 *  @param rng - optional random number generator returning [0, 1); defaults to Math.random
 */
export function createChallenge(
  seedWords: string[],
  count = 3,
  rng: () => number = Math.random,
): SeedChallenge {
  if (count < 1) throw new Error('Challenge count must be at least 1');
  if (count > seedWords.length) {
    throw new Error('Challenge count cannot exceed seed word count');
  }
  const positions: number[] = [];
  const taken = new Set<number>();
  while (positions.length < count) {
    const index = Math.floor(rng() * seedWords.length);
    if (!taken.has(index)) {
      taken.add(index);
      positions.push(index + 1); // store 1-indexed positions
    }
  }
  return {
    positions,
    answers: positions.map((p) => seedWords[p - 1]!),
  };
}

/** Check user-entered words against the challenge. Comparison is case-insensitive and trimmed. */
export function checkChallenge(
  seedWords: string[],
  positions: number[],
  inputs: string[],
): ChallengeCheckResult {
  const details: { position: number; expected: string; actual: string }[] = [];
  let allCorrect = true;
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i]!;
    const expected = seedWords[position - 1] ?? '';
    const actual = (inputs[i] ?? '').trim().toLowerCase();
    const match = actual === expected.trim().toLowerCase();
    if (!match) allCorrect = false;
    details.push({ position, expected, actual: inputs[i] ?? '' });
  }
  return { correct: allCorrect, details };
}
