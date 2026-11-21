import { describe, it, expect } from 'vitest';
import {
  detectBpm, detectKey, detectEnergy, keyScore, tempoGap, tempoScore, transitionScore, transitionTip,
} from '../src/audioAnalysis.js';

const SR = 22050;

// kick-like clicks at a given tempo, with a little noise
function clicks(bpm, seconds = 20) {
  const out = new Float32Array(SR * seconds);
  const every = (60 / bpm) * SR;
  for (let t = 0; t < out.length; t += every) {
    const s = Math.round(t);
    for (let i = 0; i < 800 && s + i < out.length; i++) {
      out[s + i] += Math.sin((2 * Math.PI * 60 * i) / SR) * Math.exp(-i / 150) * 0.8;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += (Math.random() - 0.5) * 0.01;
  return out;
}

// a held chord made of sine tones (MIDI note numbers)
function chord(midis, seconds = 6) {
  const out = new Float32Array(SR * seconds);
  for (const m of midis) {
    const f = 440 * 2 ** ((m - 69) / 12);
    for (let i = 0; i < out.length; i++) out[i] += Math.sin((2 * Math.PI * f * i) / SR) * 0.2;
  }
  return out;
}

describe('Mix Lab audio analysis', () => {
  it('finds the tempo of a click track', () => {
    for (const bpm of [90, 120, 140]) {
      const got = detectBpm(clicks(bpm), SR);
      expect(tempoGap(bpm, got)).toBeLessThan(3); // exact or half/double time
    }
  });

  it('finds the key of a chord (C major = 8B, A minor = 8A)', () => {
    const cMaj = detectKey(chord([48, 52, 55, 60, 64, 67]), SR);
    expect(cMaj.camelot).toBe('8B');
    const aMin = detectKey(chord([45, 48, 52, 57, 60, 64]), SR);
    expect(aMin.camelot).toBe('8A');
  });

  it('louder audio = more energy', () => {
    const quiet = chord([60], 2).map((v) => v * 0.05);
    const loud = chord([60, 64, 67], 2);
    expect(detectEnergy(loud)).toBeGreaterThan(detectEnergy(quiet));
  });

  it('Camelot rules: same key best, neighbours good, far keys poor', () => {
    expect(keyScore('8A', '8A')).toBe(1);
    expect(keyScore('8A', '8B')).toBe(0.85);
    expect(keyScore('8A', '9A')).toBe(0.9);
    expect(keyScore('12A', '1A')).toBe(0.9); // wheel wraps around
    expect(keyScore('8A', '2B')).toBe(0.3);
  });

  it('half or double time counts as a tempo match', () => {
    expect(tempoGap(140, 70)).toBe(0);
    expect(tempoScore(140, 141)).toBe(1);
    expect(tempoScore(140, 100)).toBeLessThan(0.5);
  });

  it('transition score rewards matching tempo and key', () => {
    const from = { bpm: 140, key: { camelot: '8A' }, energy: 70 };
    const good = transitionScore(from, { match: 70, bpm: 141, key: { camelot: '9A' }, energy: 75 });
    const bad = transitionScore(from, { match: 70, bpm: 100, key: { camelot: '2B' }, energy: 20 });
    expect(good).toBeGreaterThan(bad);
    // no audio info: falls back to the data score only
    expect(transitionScore({}, { match: 60 })).toBe(60);
    expect(transitionTip(from, { bpm: 141, key: { camelot: '8A' }, energy: 72 })).toMatch(/Tempos already match, keys blend smoothly/);
  });
});

describe('Sound and vibe', async () => {
  const { detectSound, describeVibe } = await import('../src/audioAnalysis.js');
  const SR2 = 22050;
  const tone = (f, sec = 4, amp = 0.5) => Float32Array.from({ length: SR2 * sec }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR2) * amp);

  it('a deep 808-like tone has more bass than a high tone', () => {
    expect(detectSound(tone(50), SR2).bass).toBeGreaterThan(80);
    expect(detectSound(tone(2000), SR2).bass).toBeLessThan(10);
    expect(detectSound(tone(2000), SR2).brightness).toBeGreaterThan(detectSound(tone(200), SR2).brightness);
  });

  it('a held pad sounds "spacey", short dry hits do not', () => {
    const pad = tone(300);
    const hits = new Float32Array(SR2 * 4);
    for (let t = 0; t < hits.length; t += SR2 / 2) for (let i = 0; i < 400; i++) hits[t + i] = Math.sin(i / 3) * Math.exp(-i / 60);
    expect(detectSound(pad, SR2).space).toBeGreaterThan(detectSound(hits, SR2).space);
    expect(detectSound(hits, SR2).punch).toBeGreaterThan(detectSound(pad, SR2).punch);
  });

  it('labels mood and sound', () => {
    const v = describeVibe({ bpm: 150, energy: 85, key: { name: 'G#m' }, sound: { bass: 80, space: 30, brightness: 30, punch: 80 } });
    expect(v.mood).toBe('Hype');
    expect(v.moods).toContain('Dark');
    expect(v.sound).toEqual(expect.arrayContaining(['Heavy 808s', 'Hard drums']));
    expect(describeVibe({ bpm: 80, energy: 30, key: { name: 'C' }, sound: { bass: 20, space: 85, brightness: 55, punch: 10 } }).mood).toBe('Dreamy');
  });
});

describe('Faster measuring', async () => {
  const { middleSlice } = await import('../src/audioAnalysis.js');
  it('keeps only the middle 15 seconds', () => {
    const x = Float32Array.from({ length: 30 * 100 }, (_, i) => i);
    const m = middleSlice(x, 100);
    expect(m.length).toBe(1500);
    expect(m[0]).toBe(750);
    expect(middleSlice(new Float32Array(10), 100).length).toBe(10);
  });
});

describe('Best order for a set', async () => {
  const { bestOrder, flowScore } = await import('../src/audioAnalysis.js');
  const song = (t, bpm, cam) => ({ title: t, bpm, key: { camelot: cam }, energy: 60, analysed: true });

  it('puts songs in the smoothest order after the current one', () => {
    const now = song('now', 140, '8A');
    const far = song('far', 95, '2B');
    const near = song('near', 141, '9A');
    const mid = song('mid', 120, '10A');
    const mine = [far, mid, near];
    const r = bestOrder(now, mine);
    expect(r.order.map((x) => x.title)).toEqual(['near', 'mid', 'far']);
    expect(r.score).toBeGreaterThan(flowScore(now, mine));
  });

  it('handles big sets with the fast method', () => {
    const now = song('now', 120, '8A');
    const list = Array.from({ length: 11 }, (_, i) => song(`s${i}`, 90 + ((i * 37) % 60), `${(i % 12) + 1}${i % 2 ? 'A' : 'B'}`));
    const r = bestOrder(now, list);
    expect(r.order).toHaveLength(11);
    expect(new Set(r.order).size).toBe(11);
    expect(r.score).toBeGreaterThanOrEqual(flowScore(now, list));
  });
});
