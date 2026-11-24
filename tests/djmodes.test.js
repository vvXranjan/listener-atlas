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
  expect(planTransition('auto', s(120, '8A', 50), s(121, '9A', 55))).toMatchObject({ kind: 'smooth', bars: 8, fadeOutMs: 16000 }); // match: 12 s snapped to 8 bars at 120 BPM
  expect(planTransition('auto', s(140, '8A', 50), s(70, '8A', 52)).kind).toBe('smooth'); // half time counts as a match
});

it('fits transitions to whole bars of the tempo', async () => {
  const { snapBars, djBpm, planText } = await import('../src/djModes.js');
  expect(djBpm(240)).toBe(120);
  expect(djBpm(60)).toBe(120);
  expect(snapBars(7000, 2000)).toBe(4); // 7 s at 120 BPM (2 s bars) → 4 bars
  // you pick 4 bars at 120 BPM: exactly 8 s
  const p = planTransition('smooth', s(120), s(120), { bars: 4 });
  expect(p).toMatchObject({ bars: 4, fadeOutMs: 8000, bpm: 120 });
  expect(p.fadeInMs % 2000).toBe(0); // fade in is whole bars too
  // AI length snaps 12 s to 8 bars at 128 BPM (1.875 s bars) = 15 s... nearest is 8 bars (15 s) vs 4 (7.5 s)
  expect(planTransition('smooth', s(128), s(128)).bars).toBe(8);
  // echo steps once per beat: 2 bars = 8 beats by default, 4 bars = 16
  expect(planTransition('echo', s(120)).beats).toBe(8);
  expect(planTransition('echo', s(120), {}, { bars: 4 })).toMatchObject({ beats: 16, fadeOutMs: 8000 });
  // hype starts the next song on an 8-bar line near 20 s
  expect(planTransition('hype', s(120), s(120)).startAtMs).toBe(16000);
  // no tempo yet: seconds as before, no bars
  expect(planTransition('smooth', {}, {}, { bars: 4 })).toMatchObject({ fadeOutMs: 12000, bars: null });
  // very slow + 16 bars is capped to a sane length
  expect(planTransition('smooth', s(70), s(70), { bars: 16 }).fadeOutMs).toBeLessThanOrEqual(40000);
  expect(planText(p)).toContain('4 bars');
});
