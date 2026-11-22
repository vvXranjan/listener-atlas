import { it, expect } from 'vitest';
import { planTransition, MODES } from '../src/djModes.js';

const s = (bpm, camelot, energy) => ({ bpm, key: camelot ? { camelot } : undefined, energy });

it('fixed modes use their own shape', () => {
  expect(planTransition('smooth').fadeOutMs).toBe(12000);
  expect(planTransition('quick').fadeOutMs).toBeLessThan(2000);
  expect(planTransition('hype').startAtMs).toBe(20000);
  expect(planTransition('chill').gapMs).toBeGreaterThan(0);
  const e = planTransition('echo', s(120));
  expect(e.beatMs).toBe(500);
  expect(e.fadeOutMs).toBe(4000); // 8 beats at 120 BPM
  expect(MODES.map((m) => m.id)).toEqual(['auto', 'smooth', 'quick', 'echo', 'hype', 'chill']);
});

it('AI auto picks a transition from tempo, key and energy', () => {
  expect(planTransition('auto', {}, {})).toMatchObject({ kind: 'smooth', fadeOutMs: 7000, auto: true });
  expect(planTransition('auto', s(87, '10A', 50), s(151, '8A', 55)).kind).toBe('echo'); // big tempo jump
  expect(planTransition('auto', s(120, '8A', 40), s(122, '8A', 70)).kind).toBe('hype'); // energy up
  expect(planTransition('auto', s(120, '8A', 50), s(121, '2B', 52)).kind).toBe('quick'); // keys clash
  expect(planTransition('auto', s(120, '8A', 70), s(121, '8A', 40)).kind).toBe('chill'); // energy drops
  expect(planTransition('auto', s(120, '8A', 50), s(121, '9A', 55))).toMatchObject({ kind: 'smooth', fadeOutMs: 12000 }); // match
  expect(planTransition('auto', s(140, '8A', 50), s(70, '8A', 52)).kind).toBe('smooth'); // half time counts as a match
});
