import { describe, expect, it } from 'vitest';
import {
  appendSquadNavId,
  moveSquadNavId,
  moveSquadNavIdToGapIndex,
  orderSquads,
  parseSquadNavOrder,
  reconcileSquadNavOrder,
  removeSquadNavId,
  replaceSquadNavId,
  seedSquadNavOrder,
} from './squad-nav-order';

const a = { id: 'a', createdAt: 100 };
const b = { id: 'b', createdAt: 200 };
const c = { id: 'c', createdAt: 300 };

describe('squad-nav-order', () => {
  it('seedSquadNavOrder sorts by createdAt then id', () => {
    expect(seedSquadNavOrder([c, a, b])).toEqual(['a', 'b', 'c']);
    expect(seedSquadNavOrder([{ id: 'z', createdAt: 1 }, { id: 'y', createdAt: 1 }])).toEqual([
      'y',
      'z',
    ]);
  });

  it('orderSquads walks manual ids then appends unknowns by age', () => {
    expect(orderSquads([a, b, c], ['c', 'a']).map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(orderSquads([a, b], ['missing', 'b', 'a']).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('appendSquadNavId appends once', () => {
    expect(appendSquadNavId(['a'], 'b')).toEqual(['a', 'b']);
    expect(appendSquadNavId(['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(appendSquadNavId(['a'], '  ')).toEqual(['a']);
  });

  it('removeSquadNavId removes when present', () => {
    expect(removeSquadNavId(['a', 'b'], 'a')).toEqual(['b']);
    expect(removeSquadNavId(['a'], 'missing')).toEqual(['a']);
  });

  it('replaceSquadNavId swaps temp create ids', () => {
    expect(replaceSquadNavId(['temp', 'a'], 'temp', 'real')).toEqual(['real', 'a']);
    expect(replaceSquadNavId(['a'], 'temp', 'real')).toEqual(['a', 'real']);
    expect(replaceSquadNavId(['temp', 'real'], 'temp', 'real')).toEqual(['real']);
    expect(replaceSquadNavId(['a'], '', 'real')).toEqual(['a']);
    expect(replaceSquadNavId(['a'], 'temp', '')).toEqual(['a']);
    expect(replaceSquadNavId(['a'], 'a', 'a')).toEqual(['a']);
  });

  it('moveSquadNavId reorders before target or to end', () => {
    expect(moveSquadNavId(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveSquadNavId(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
    expect(moveSquadNavId(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveSquadNavId(['a', 'b'], 'missing', 'a')).toEqual(['a', 'b']);
    expect(moveSquadNavId(['a', 'b'], 'a', 'gone')).toEqual(['b', 'a']);
  });

  it('moveSquadNavIdToGapIndex places by visual gap index', () => {
    expect(moveSquadNavIdToGapIndex(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveSquadNavIdToGapIndex(['a', 'b', 'c'], 'a', 3)).toEqual(['b', 'c', 'a']);
    expect(moveSquadNavIdToGapIndex(['a', 'b', 'c'], 'a', 1)).toEqual(['a', 'b', 'c']);
    expect(moveSquadNavIdToGapIndex(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'a', 'c']);
    expect(moveSquadNavIdToGapIndex(['a', 'b'], 'missing', 0)).toEqual(['a', 'b']);
  });

  it('reconcileSquadNavOrder seeds, prunes, and appends newcomers', () => {
    expect(reconcileSquadNavOrder([], [c, a])).toEqual(['a', 'c']);
    expect(reconcileSquadNavOrder(['c', 'gone', 'a'], [a, b, c])).toEqual(['c', 'a', 'b']);
    expect(reconcileSquadNavOrder(['c', 'a'], [a, b, c])).toEqual(['c', 'a', 'b']);
  });

  it('parseSquadNavOrder resets corrupt values', () => {
    expect(parseSquadNavOrder(null)).toEqual([]);
    expect(parseSquadNavOrder('{"nope":1}')).toEqual([]);
    expect(parseSquadNavOrder('["a",2,"b"]')).toEqual(['a', 'b']);
    expect(parseSquadNavOrder('not-json')).toEqual([]);
  });
});
