import { it, expect } from 'vitest';
import { reorder, dropIndex } from '../src/reorder.js';

it('moves a song to a new place', () => {
  expect(reorder(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']); // play next
  expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  const same = ['a', 'b'];
  expect(reorder(same, 1, 1)).toBe(same);
  expect(reorder(same, 0, 5)).toBe(same);
});

it('works out where a dragged song lands', () => {
  const rows = [
    { i: 0, mid: 100 },
    { i: 1, mid: 200 },
    { i: 2, mid: 300 },
  ];
  expect(dropIndex(rows, 2, 50)).toBe(0); // dragged above everything: first
  expect(dropIndex(rows, 2, 150)).toBe(1);
  expect(dropIndex(rows, 0, 250)).toBe(1); // first song dragged below the second
  expect(dropIndex(rows, 0, 400)).toBe(2); // to the end
});
